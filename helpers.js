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

  dumpDB: () => {
    const { where, author, toPullStream } = SSB.db.operators

    pull(
      SSB.db.query(
        where(author('@0PiWdHohzPjNnQmr5e7w1DseATXHkvH9ndfE7yLrLf0=.ed25519')),
        toPullStream()
      ),
      pull.drain((msg) => {
        console.log(`author ${msg.value.author}, seq: ${msg.value.sequence}, content: ${JSON.stringify(msg, null, 2)}`)
        // , content: ${JSON.stringify(msg.value.content, null, 2)}
      })
    )
  }
}
