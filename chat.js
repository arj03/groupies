module.exports = function (pull, ssbSingleton, group) {
  let chatFeed = null

  function getChatFeed(SSB, cb) {
    if (chatFeed !== null) return cb(null, chatFeed)

    SSB.net.metafeeds.findOrCreate((err, metafeed) => {
      const details = {
        feedpurpose: 'groupchat',
        feedformat: 'classic',
        metadata: {
          groupId: group.id,
          recps: [group.id]
        }
      }
      
      SSB.net.metafeeds.findOrCreate(
        metafeed,
        (f) => f.feedpurpose === details.feedpurpose && f.groupId === group.id,
        details,
        (err, feed) => {
          if (err) return cb(err)

          chatFeed = feed
          cb(null, chatFeed)
        }
      )
    })
  }

  return {
    template: `
    <div id="app">
      <h2>Chat</h2>
      <input type='text' v-model="message" @keyup.enter="post()">
      <button v-on:click="post">Send</button>
      <div v-for="msg in messages">
       <span>{{ msg.user }}:</span>
       <span>{{ msg.text }}</span>
      </div>
    </div>`,

    data: function() {
      return {
        message: '',
        messages: [],
        componentStillLoaded: false,
      }
    },

    methods: {
      post: function() {
        if (this.message === '') return

        ssbSingleton.getSimpleSSBEventually(
          () => this.componentStillLoaded,
          (err, SSB) => {
            getChatFeed(SSB, (err, chatFeed) => {
              if (err) return console.error(err)

              SSB.db.publishAs(chatFeed.keys, {
                type: 'groupchat',
                id: group.id,
                message: this.message
              }, (err, msg) => {
                if (err) console.log(err)
                else this.message = ''
              })
            })
          }
        )
      },
      
      load: function() {
        ssbSingleton.getSimpleSSBEventually(
          () => this.componentStillLoaded,
          this.render
        )
      },

      render: function(err, SSB) {
        const { where, type, live, toPullStream } = SSB.dbOperators

        pull(
          SSB.db.query(
            where(type('groupchat')),
            live({ old: true }),
            toPullStream()
          ),
          pull.filter(msg => msg.value.content.id === group.id), // FIXME 
          pull.drain((msg) => {
            this.messages.push({
              user: msg.value.author.substring(0,5),
              text: msg.value.content.message
            })
          })
        )
      }
    },

    created: function () {
      this.componentStillLoaded = true

      document.title = 'Group chat:' + group.title

      this.load()
    },

    destroyed: function () {
      this.componentStillLoaded = false
    }
  }
}
