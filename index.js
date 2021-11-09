const ssbSingleton = require('ssb-browser-core/ssb-singleton')
const pull = require('pull-stream')
const hkdf = require('futoin-hkdf')
const crypto = require('crypto')

function extraModules(secretStack) {
  return secretStack
    .use(require("ssb-meta-feeds"))
    .use(require("ssb-db2-box2"))
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
    if (err) console.error(err)
    else ssbReady(SSB)
  }
)

const chatApp = require('./chat')

function getGroupKeysFeed(SSB, cb) {
  SSB.metafeeds.findOrCreate((err, metafeed) => {
    const details = {
      feedpurpose: 'groupkeys',
      feedformat: 'classic',
      metadata: {
        recps: [SSB.id]
      }
    }
    
    SSB.metafeeds.findOrCreate(
      metafeed,
      (f) => f.feedpurpose === details.feedpurpose,
      details,
      cb
    )
  })
}

const menu = new Vue({
  el: '#menu',

  data: function() {
    return {
      id: '',
      groups: [],
      peers: []
    }
  },

  methods: {
    dumpDB,
    openGroup: function(group) {
      new Vue(chatApp(pull, ssbSingleton, group)).$mount("#app")
    },
    copyKey: function(group) {
      navigator.clipboard.writeText(group.key)
    },
    addGroupKey: function() {
      const addGroupKey = require('./add-group-key')
      new Vue(addGroupKey(ssbSingleton, getGroupKeysFeed)).$mount("#app")
    },
    newGroup: function() {
      const groupKey = crypto.randomBytes(32)
      const title = 'encrypted chat'

      const groupId = groupKey.toString('hex') + '.groupies'

      ssbSingleton.getSimpleSSBEventually(
        (err, SSB) => {
          if (err) return console.error(err)

          getGroupKeysFeed(SSB, (err, keysFeed) => {
            SSB.db.publishAs(keysFeed.keys, {
              type: 'groupkey',
              key: groupKey.toString('hex'),
              id: groupId,
              recps: [SSB.id]
            }, (err, msg) => {
              if (err) return console.error(err)

              SSB.box2.addGroupKey(groupId, groupKey)
              
              new Vue(
                chatApp(pull, ssbSingleton,
                        { key: groupKey, id: groupId, title })
              ).$mount("#app")
            })
          })
        }
      )
    },
  }
})

function dumpDB() {
  const { toPullStream } = SSB.db.operators

  pull(
    SSB.db.query(
      toPullStream()
    ),
    pull.drain((msg) => {
      console.log(`author ${msg.value.author}, seq: ${msg.value.sequence}, content: ${JSON.stringify(msg.value.content, null, 2)}`)
      // , content: ${JSON.stringify(msg.value.content, null, 2)}
    })
  )
}

function monkeyPatchBox2Libs() {
  Uint8Array.prototype.equals = function equals (b) {
    let a = this

    if (a === b) {
      return true
    }

    if (a.byteLength !== b.byteLength) {
      return false
    }

    for (let i = 0; i < a.byteLength; i++) {
      if (a[i] !== b[i]) {
        return false
      }
    }

    return true
  }

  Uint8Array.prototype.copy = function equals (b) {
    let a = this
    for (let i = 0; i < a.length; ++i)
      b[i] = a[i]
  }
}

function ssbReady(SSB) {
  SSB.ebt.registerFormat(require('ssb-ebt/formats/bendy-butt'))

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
      }, () => { box2KeysReady(SSB) })
    )
  })
}

function box2KeysReady(SSB) {
  //console.log("got sbot", SSB)
  //dumpDB()

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
      menu.groups.push({
        key, id, title: 'encrypted chat'
      })
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

  // auto reconnect
  setInterval(() => {
    if (menu.peers.length === 0) {
      SSB.conn.connect(room, {
        key: roomKey,
        type: 'room'
      })
    }
  }, 1000)

  // main feed replicated on rpc connect
  SSB.on('rpc:connect', function (rpc, isClient) {
    if (rpc.id !== roomKey) {
      console.log("request connect", rpc.id)
      SSB.ebt.request(rpc.id, true)
    }
  })

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
