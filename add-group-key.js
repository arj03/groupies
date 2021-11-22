module.exports = function (ssbSingleton, getGroupKeysFeed) {
  const { replicateSubfeeds } = require('./helpers')

  return {
    template: `
    <div id="app">
      <h2>Add group key</h2>
      <input type='text' style='width: 500px;' v-model="groupKey" @keyup.enter="addKey()">
      <button v-on:click="addKey">Add key</button>
    </div>`,

    data: function() {
      return {
        groupKey: ''
      }
    },

    methods: {
      addKey: function() {
        ssbSingleton.getSimpleSSBEventually(
          (err, SSB) => {
            if (err) return console.error(err)

            getGroupKeysFeed(SSB, async (err, keysFeed) => {
              const groupId = this.groupKey + '.groupies'

              const { where, type, toPromise } = SSB.db.operators

              const existing = (await SSB.db.query(
                where(type('groupkey')),
                toPromise()
              )).filter(msg => msg.value.content.id === groupId)

              if (existing.length !== 0) return alert('Key already added!')

              SSB.db.publishAs(keysFeed.keys, {
                type: 'groupkey',
                key: this.groupKey,
                id: groupId,
                recps: [SSB.id]
              }, (err, msg) => {
                if (err) return console.error(err)

                const groupKey = Buffer.from(this.groupKey, 'hex')
                SSB.box2.addGroupKey(groupId, groupKey)

                SSB.db.reindexEncrypted(() => {
                  // live can have problems with reindex
                  replicateSubfeeds(false)
                })

                alert('Key added!')
              })
            })
          }
        )
      }
    }
  }
}

