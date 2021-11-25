const pull = require('pull-stream')

function getMetaFeed(SSB, details, check, cb) {
  SSB.metafeeds.findOrCreate((err, metafeed) => {
    SSB.metafeeds.findOrCreate(
      metafeed,
      check,
      details,
      cb
    )
  })
}

module.exports = {
  getGroupKeysFeed: (SSB, cb) => {
    const details = {
      feedpurpose: 'groupkeys',
      feedformat: 'classic',
      metadata: {
        recps: [SSB.id]
      }
    }

    getMetaFeed(
      SSB, details,
      (f) => f.feedpurpose === details.feedpurpose,
      cb
    )
  },

  getChatFeed: (SSB, group, cb) => {
    const details = {
      feedpurpose: 'groupchat',
      feedformat: 'classic',
      metadata: {
        groupId: group.id,
        recps: [group.id]
      }
    }

    getMetaFeed(
      SSB, details,
      (f) => {
        return f.feedpurpose === details.feedpurpose &&
          f.metadata.groupId === group.id
      },
      cb
    )
  },

  groupConfigChanges(SSB, crut, id, cb) {
    const { where, type, live, toPullStream } = SSB.db.operators

    function isCorrectConfig(msg) {
      const { recps } = msg.value.content
      return recps && recps[0] === id
    }

    function crutRead(msg) {
      const { tangles } = msg.value.content
      if (tangles && tangles.groupconfig) {
        if (tangles.groupconfig.root === null)
          crut.read(msg.key, cb)
        else
          crut.read(tangles.groupconfig.root, cb)
      }
    } 

    pull(
      SSB.db.query(
        where(type('groupconfig')),
        toPullStream()
      ),
      pull.filter(isCorrectConfig),
      pull.collect((err, msgs) => {
        if (msgs.length > 0)
          crutRead(msgs[0])

        pull(
          SSB.db.query(
            where(type('groupconfig')),
            live({ old: false }),
            toPullStream()
          ),
          pull.filter(isCorrectConfig),
          pull.drain(crutRead)
        )        
      })
    )
  },

  replicateSubfeeds: (isLive, cb) => {
    const { where, type, author, live, toPullStream } = SSB.db.operators

    function replicateMetaFeed(metafeed) {
      console.log("replicating metafeed", metafeed)
      // similar to ack self, we must ack own feeds!
      SSB.ebt.request(metafeed, true)

      pull(
        SSB.db.query(
          where(author(metafeed)),
          isLive ? live({ old: true }) : null,
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
    }

    pull(
      SSB.db.query(
        where(type('metafeed/announce')),
        toPullStream()
      ),
      pull.drain((msg) => {
        const { metafeed } = msg.value.content
        replicateMetaFeed(metafeed)
      }, () => {
        if (isLive) {
          pull(
            SSB.db.query(
              where(type('metafeed/announce')),
              live({ old: false }),
              toPullStream()
            ),
            pull.drain((msg) => {
              const { metafeed } = msg.value.content
              replicateMetaFeed(metafeed)
            })
          )
        }

        if (cb) cb()
      })
    )
  },

  dumpDB: () => {
    const { where, author, toPullStream } = SSB.db.operators

    pull(
      SSB.db.query(
        toPullStream()
      ),
      pull.drain((msg) => {
        console.log(`author ${msg.value.author}, seq: ${msg.value.sequence}`)
        // , content: ${JSON.stringify(msg.value.content, null, 2)}
      })
    )
  }
}
