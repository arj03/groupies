const ssbSingleton = require('ssb-browser-core/ssb-singleton')
const pull = require('pull-stream')
const hkdf = require('futoin-hkdf')
const crypto = require('crypto')

const Crut = require('ssb-crut')
const Overwrite = require('@tangle/overwrite')
const SimpleSet = require('@tangle/simple-set')

const { getGroupKeysFeed, getChatFeed, groupConfigChanges,
        replicateSubfeeds, dumpDB } = require('./helpers')
const { monkeyPatchBox2Libs } = require('./browser-hack')

function extraModules(secretStack) {
  return secretStack
    .use(require("ssb-meta-feeds"))
    .use(require("ssb-db2-box2"))
    // crut
    .use(require('ssb-db2/compat/db'))
    .use(require('ssb-db2/compat/history-stream'))
    .use(require('ssb-db2/compat/feedstate'))
    .use({
      init: function (sbot, config) {
        sbot.db.registerIndex(require('ssb-db2/indexes/about-self'))
      }
    })
}

let config = {
  connections: {
    incoming: {
      tunnel: [{ scope: 'public', transform: 'shs' }]
    },
    outgoing: {
      ws: [{ transform: 'shs' }],
      tunnel: [{ transform: 'shs' }]
    }
  },
  conn: {
    populatePubs: false
  },
  ebt: {
    logging: false
  },
  blobs: {
    max: 10 * 1024 * 1024
  }
}

const spec = {
  type: 'groupconfig',
  props: {
    title: Overwrite(),
    rooms: SimpleSet()
  }
}
let crut

// setup ssb browser core
ssbSingleton.setup("/.groupies", config, extraModules)

ssbSingleton.getSimpleSSBEventually(
  (err, SSB) => {
    if (err) return console.error(err)

    crut = new Crut(SSB, spec)

    SSB.ebt.registerFormat(require('ssb-ebt/formats/bendy-butt'))
    setupBox2(SSB)
  }
)

const chatApp = require('./chat')

// load ssb-profile-link component
require('./ssb-profile-link')

let afterGroupSave = () => {}

const menu = new Vue({
  el: '#menu',

  data: function() {
    return {
      id: '',
      groups: [],
      peers: [],

      activeId: '',

      // group dialog
      groupKey: '',
      showGroupEdit: false,
      groupSaveText: 'Create group',
      groupTitle: '',
      rooms: [],
      newRoomAddress: ''
    }
  },

  methods: {
    dumpDB,
    openGroup: function(group) {
      this.activeId = group.id
      const app = chatApp(ssbSingleton, group, crut, getChatFeed,
                          groupConfigChanges, this.editGroupConfig)
      new Vue(app).$mount("#app")
    },
    addRoomToConfig: function() {
      this.rooms.push(this.newRoomAddress)
      this.newRoomAddress = ''
    },
    editGroupConfig: function(group, title, rooms) {
      afterGroupSave = () => { this.showGroupEdit = false }

      this.groupKey = group.key
      this.groupSaveText = 'Save group config'
      this.groupTitle = title
      this.rooms = rooms
      this.showGroupEdit = true
    },
    copyGroupKey: function() {
      navigator.clipboard.writeText(this.groupKey)
    },
    saveGroupConfig: function() {
      group = { id: this.groupKey + '.groupies' }

      const groupKey = Buffer.from(this.groupKey, 'hex')
      SSB.box2.addGroupKey(group.id, groupKey)

      getChatFeed(SSB, group, (err, chatFeed) => {
        if (err) return console.error("failed to get chat feed", err)

        // this assumes that the root config will be available
        // here be dragons

        const { where, type, toPullStream } = SSB.db.operators
        pull(
          SSB.db.query(
            where(type('groupconfig')),
            toPullStream()
          ),
          pull.filter(msg => {
            const { recps, tangles } = msg.value.content
            const correctGroup = recps && recps[0] === group.id
            const isRoot = tangles && tangles.groupconfig && tangles.groupconfig.root === null
            return correctGroup && isRoot
          }),
          pull.collect((err, msgs) => {
            if (err) return console.error(err)

            const content = { title: this.groupTitle }

            if (msgs.length > 0) {
              crut.read(msgs[0].key, (err, record) => {
                if (err) return console.error(err)

                const currentRooms = new Set(record.states[0].rooms)
                const newRooms = new Set(this.rooms)

                const added = []
                const removed = []

                for (let room of currentRooms)
                  if (!newRooms.has(room))
                    removed.push(room)

                for (let room of newRooms)
                  if (!currentRooms.has(room))
                    added.push(room)

                content.rooms = {
                  add: added,
                  remove: removed
                }

                crut.update(msgs[0].key, content, chatFeed.keys, (err) => {
                  if (err) return console.error(err)
                  else afterGroupSave()
                })
              })
            } else {
              content.rooms = this.rooms
              content.recps = [group.id]
              crut.create(content, chatFeed.keys, (err) => {
                if (err) return console.error(err)
                else afterGroupSave()
              })
            }
          })
        )
      })
    },
    addGroupKey: function() {
      this.activeId = 'addGroupKey'

      const addGroupKey = require('./add-group-key')
      new Vue(addGroupKey(ssbSingleton, getGroupKeysFeed)).$mount("#app")
    },
    newGroup: function() {
      const groupKey = crypto.randomBytes(32)

      this.groupTitle = ''
      this.groupKey = groupKey.toString('hex')
      this.groupSaveText = 'Create group'
      this.showGroupEdit = true

      afterGroupSave = () => {
        const groupId = this.groupKey + '.groupies'

        ssbSingleton.getSimpleSSBEventually(
          (err, SSB) => {
            if (err) return console.error(err)

            getGroupKeysFeed(SSB, (err, keysFeed) => {
              SSB.db.publishAs(keysFeed.keys, {
                type: 'groupkey',
                key: this.groupKey,
                id: groupId,
                recps: [SSB.id]
              }, (err, msg) => {
                if (err) return console.error(err)

                this.showGroupEdit = false
                this.activeId = groupId

                const group = { key: groupKey.toString('hex'), id: groupId }
                const app = chatApp(ssbSingleton, group, crut, getChatFeed,
                                    groupConfigChanges, this.editGroupConfig)
                new Vue(app).$mount("#app")
              })
            })
          }
        )
      }
    },
    openProfile: function() {
      this.activeId = ''

      const profile = require('./profile')
      new Vue(profile(SSB.id)).$mount("#app")
    },
  }
})

function setupBox2(SSB) {
  monkeyPatchBox2Libs()

  // We can't encrypt the seed to ourself with a own DM key generated
  // from the seed because we need to seed to read the private message
  // with the seed. Instead we encrypt the seed from box1. Another
  // option is to save the own DM key outside the system as in ahau,
  // but that complicates backup.
  
  SSB.box2.setReady()

  SSB.metafeeds.findOrCreate((err, metafeed) => {
    const KEY_LENGTH = 32

    const derived_key = hkdf(metafeed.seed, KEY_LENGTH, {
      salt: 'ssb',
      info: 'box2:this-is-my-own-direct-message-key',
      hash: 'SHA-256',
    })

    SSB.box2.addOwnDMKey(derived_key)
    SSB.box2.registerIsGroup((recp) => recp.endsWith('.groupies'))

    // now we can enable box2 (seed needs to be box1)
    SSB.config.box2 = { alwaysbox2: true }

    // add existing group keys
    const { where, type, toPullStream } = SSB.db.operators
    pull(
      SSB.db.query(
        where(type('groupkey')),
        toPullStream()
      ),
      pull.filter(msg => {
        return msg.value.content.recps && msg.value.content.recps[0] === SSB.id
      }),
      pull.drain((msg) => {
        const { key, id } = msg.value.content
        if (key)
          SSB.box2.addGroupKey(id, Buffer.from(key, 'hex'))
      },
      () => { setupApp(SSB) }
     )
    )
  })
}

function setupApp(SSB) {
  menu.id = SSB.id

  const { where, type, live, toPullStream } = SSB.db.operators

  // add groups to menu
  pull(
    SSB.db.query(
      where(type('groupkey')),
      live({ old: true }),
      toPullStream()
    ),
    pull.drain((msg) => {
      const { key, id } = msg.value.content
      const group = {
        key, id, title: 'encrypted chat'
      }
      menu.groups.push(group)

      groupConfigChanges(SSB, crut, id, (err, record) => {
        if (!err) {
          const state = record.states[0]
          group.title = state.title
          if (state.rooms.length > 0) {
            state.rooms.forEach(room => {
              console.log("connecting to", room)
              SSB.conn.connect(room, () => {})
            })
          }
        }
      })
    })
  )

  // show connection errors
  pull(
    SSB.conn.hub().listen(),
    pull.drain((ev) => {
      if (ev.type.indexOf("failed") >= 0)
        console.warn("Connection error: ", ev)
    })
  )

  // update list of peers
  pull(
    SSB.conn.peers(),
    pull.drain((entries) => {
      menu.peers = entries.filter(([, x]) => !!x.key).map(([address, data]) => ({ address, data }))
    })
  )

  replicateSubfeeds(true, () => {
    // timeout to make sure we get all feeds replicated
    setTimeout(() => {
      // auto connect to room
      const roomKey = '@oPnjHuBpFNG+wXC1dzmdzvOO30mVNYmZB778fq3bn3Y=.ed25519'
      const room = 'wss:between-two-worlds.dk:444~shs:oPnjHuBpFNG+wXC1dzmdzvOO30mVNYmZB778fq3bn3Y='

      SSB.conn.connect(room, {
        key: roomKey,
        type: 'room'
      }, () => {})

      // auto reconnect on fail
      setInterval(() => {
        if (menu.peers.length === 0) {
          SSB.conn.connect(room, {
            key: roomKey,
            type: 'room'
          })
        }
      }, 1000)
    }, 1500)
  })
}
