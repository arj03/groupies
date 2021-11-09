module.exports = function (ssbSingleton, getGroupKeysFeed) {
  return {
    template: `
    <div id="app">
      <h2>Add group key</h2>
      <input type='text' v-model="groupKey" @keyup.enter="addKey()">
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

            getGroupKeysFeed(SSB, (err, keysFeed) => {
              const groupId = this.groupKey.toString('hex') + '.groupies'

              SSB.db.publishAs(keysFeed.keys, {
                type: 'groupkey',
                key: this.groupKey.toString('hex'),
                id: groupId,
                recps: [SSB.id]
              }, (err, msg) => {
                if (err) return console.error(err)

                SSB.box2.addGroupKey(groupId, this.groupKey)
                SSB.db.reindexEncrypted()
                alert('Key added!')
              })
            })
          }
        )
      }
    }
  }
}

