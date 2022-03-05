module.exports = {
  extraModules(secretStack) {
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
  },

  config: {
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
}
