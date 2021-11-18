const ssbSingleton = require('ssb-browser-core/ssb-singleton')
const pull = require('pull-stream')
const hkdf = require('futoin-hkdf')
const crypto = require('crypto')

const { getGroupKeysFeed, getChatFeed, dumpDB } = require('./helpers')
const { monkeyPatchBox2Libs } = require('./browser-hack')

function extraModules(secretStack) {
  return secretStack
    .use(require("ssb-meta-feeds"))
    .use(require("ssb-db2-box2"))
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

// setup ssb browser core
ssbSingleton.setup("/.groupies", config, extraModules)

ssbSingleton.getSimpleSSBEventually(
  (err, SSB) => {
    if (err) return console.error(err)

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
      groupTitle: ''
    }
  },

  methods: {
    dumpDB,
    openGroup: function(group) {
      this.activeId = group.id
      new Vue(chatApp(ssbSingleton, group, getChatFeed, this.editGroupConfig)).$mount("#app")
    },
    editGroupConfig: function(group, title) {
      afterGroupSave = () => { this.showGroupEdit = false }

      this.groupKey = group.key
      this.groupSaveText = 'Save group config'
      this.groupTitle = title
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

        SSB.db.publishAs(chatFeed.keys, {
          type: 'groupconfig',
          id: group.id,
          title: this.groupTitle,
          recps: [group.id]
        }, (err, msg) => {
          if (err) return console.log(err)

          afterGroupSave()
        })
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
                new Vue(
                  chatApp(ssbSingleton, group, getChatFeed, this.editGroupConfig)
                ).$mount("#app")
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

  const { where, type, author, slowEqual, live,
          toPullStream, toCallback } = SSB.db.operators

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

      pull(
        SSB.db.query(
          where(type('groupconfig')),
          live({ old: true }),
          toPullStream()
        ),
        pull.filter(msg => {
          return msg.value.content.id === id
        }),
        pull.drain((msg) => {
          group.title = msg.value.content.title
        })
      )
    })
  )

  // auto connect to room
  const roomKey = '@oPnjHuBpFNG+wXC1dzmdzvOO30mVNYmZB778fq3bn3Y=.ed25519'
  const room = 'wss:between-two-worlds.dk:444~shs:oPnjHuBpFNG+wXC1dzmdzvOO30mVNYmZB778fq3bn3Y='

  SSB.conn.connect(room, {
    key: roomKey,
    type: 'room'
  }, () => {})

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

  // auto reconnect to room
  setInterval(() => {
    if (menu.peers.length === 0) {
      SSB.conn.connect(room, {
        key: roomKey,
        type: 'room'
      })
    }
  }, 1000)

  // find all meta feeds & children and replicate those
  pull(
    SSB.db.query(
      where(type('metafeed/announce')),
      live({ old: true }),
      toPullStream()
    ),
    pull.drain((msg) => {
      const { metafeed } = msg.value.content
      console.log("replicating metafeed", metafeed)
      // similar to ack self, we must ack own feeds!
      SSB.ebt.request(metafeed, true)

      // FIXME: this doesn't work on reindex!
      pull(
        SSB.db.query(
          where(author(metafeed)),
          live({ old: true }),
          toPullStream()
        ),
        pull.drain((msg) => {
          const { subfeed, feedpurpose } = msg.value.content
          if (feedpurpose && feedpurpose !== 'main') { // special
            console.log("replicating subfeed", subfeed)
            // similar to ack self, we must ack own feeds!
            SSB.ebt.request(subfeed, true)
          }
        })
      )
    })
  )
}
