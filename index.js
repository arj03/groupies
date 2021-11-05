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

ssbSingleton.getSSBEventually(
  -1,
  () => { return true },
  (SSB) => { return SSB && SSB.net },
  (err, SSB) => {
    if (err) console.error(err)
    else ssbReady(SSB)
  }
)

const chatApp = require('./chat')

function getGroupKeysFeed(SSB, cb) {
  SSB.net.metafeeds.findOrCreate((err, metafeed) => {
    const details = {
      feedpurpose: 'groupkeys',
      feedformat: 'classic',
      metadata: {
        recps: [SSB.net.id]
      }
    }
    
    SSB.net.metafeeds.findOrCreate(
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
    openGroup: function(group) {
      new Vue(chatApp(pull, ssbSingleton, group)).$mount("#app")
    },
    copyKey: function(group) {
      navigator.clipboard.writeText(group.key)
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
              recps: [SSB.net.id]
            }, (err, msg) => {
              if (err) return console.error(err)

              SSB.net.box2.addGroupKey(groupId, groupKey)
              
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
  const { toPullStream } = SSB.dbOperators

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
  monkeyPatchBox2Libs()

  // We can't encrypt the seed to ourself with a own DM key generated
  // from the seed because we need to seed to read the private message
  // with the seed. Instead we encrypt the seed from box1. Another
  // option is to save the own DM key outside the system as in ahau,
  // but that complicates backup.
  
  SSB.net.box2.setReady()

  SSB.net.metafeeds.findOrCreate((err, metafeed) => {
    const KEY_LENGTH = 32

    const derived_key = hkdf(metafeed.seed, KEY_LENGTH, {
      salt: 'ssb',
      info: 'box2:this-is-my-own-direct-message-key',
      hash: 'SHA-256',
    })

    SSB.net.box2.addOwnDMKey(derived_key)
    SSB.net.box2.registerIsGroup((recp) => recp.endsWith('.groupies'))

    // now we can enable box2 (seed needs to be box1)
    SSB.net.config.box2 = { alwaysbox2: true }

    // add existing group keys
    const { where, type, toPullStream } = SSB.dbOperators
    pull(
      SSB.db.query(
        where(type('groupkey')),
        toPullStream()
      ),
      pull.filter(msg => {
        return msg.value.content.recps && msg.value.content.recps[0] === SSB.net.id
      }),
      pull.drain((msg) => {
        console.log("key msg", msg.value.content)
        const { key, id } = msg.value.content
        if (key) {
          console.log("got private key")
          SSB.net.box2.addGroupKey(id, Buffer.from(key, 'hex'))
        }
      }, () => { box2KeysReady(SSB) })
    )
  })
}

function box2KeysReady(SSB) {
  //console.log("got sbot", SSB)
  dumpDB()

  menu.id = SSB.net.id

  const { where, type, author, slowEqual, live,
          toPullStream, toCallback } = SSB.dbOperators

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

  SSB.net.conn.connect(room, {
    key: roomKey,
    type: 'room'
  }, () => {})

  // show connection errors
  pull(
    SSB.net.conn.hub().listen(),
    pull.drain((ev) => {
      if (ev.type.indexOf("failed") >= 0)
        console.warn("Connection error: ", ev)
    })
  )

  // update list of peers
  pull(
    SSB.net.conn.peers(),
    pull.drain((entries) => {
      menu.peers = entries.filter(([, x]) => !!x.key).map(([address, data]) => ({ address, data }))
    })
  )

  // auto reconnect
  setInterval(() => {
    if (menu.peers.length === 0) {
      SSB.net.conn.connect(room, {
        key: roomKey,
        type: 'room'
      })
    }
  }, 1000)

  // find all meta feeds & children and replicate those
  SSB.net.ebt.registerFormat(require('ssb-ebt/formats/bendy-butt'))

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
      SSB.net.ebt.request(metafeed, true)

      pull(
        SSB.db.query(
          where(author(metafeed)),
          live({ old: true }),
          toPullStream()
        ),
        pull.drain((msg) => {
          const { subfeed, feedpurpose } = msg.value.content
          if (feedpurpose !== 'main') { // special
            console.log("replicating subfeed", subfeed)
            // similar to ack self, we must ack own feeds!
            SSB.net.ebt.request(subfeed, true)
          }
        })
      )
    })
  )
}
