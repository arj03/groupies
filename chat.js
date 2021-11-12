module.exports = function (pull, ssbSingleton, group) {
  let chatFeed = null

  function getChatFeed(SSB, cb) {
    if (chatFeed !== null) return cb(null, chatFeed)

    SSB.metafeeds.findOrCreate((err, metafeed) => {
      const details = {
        feedpurpose: 'groupchat',
        feedformat: 'classic',
        metadata: {
          groupId: group.id,
          recps: [group.id]
        }
      }
      
      SSB.metafeeds.findOrCreate(
        metafeed,
        (f) => {
          return f.feedpurpose === details.feedpurpose &&
                 f.metadata.groupId === group.id
        },
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
      <div class="chatmessage" v-for="msg in messages">
       <div style="width: 100px;">
         <ssb-profile-link :feed="msg.user"></ssb-profile-link>
       </div>
       <div>
         <div>{{ msg.text }}</div>
         <div class="timestamp">{{ msg.timestamp }}</div>
       </div>
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

      render: async function(err, SSB) {
        const { where, or, type, live,
                toPromise, toPullStream } = SSB.db.operators

        const metafeedMsgs = await SSB.db.query(
          where(
            or(
              type('metafeed/add/existing'),
              type('metafeed/add/derived')
            )
          ),
          toPromise()
        )

        const metafeeds = {}
        metafeedMsgs.forEach(msg => {
          const msgVal = msg.value
          const content = msgVal.content
          const metafeed = metafeeds[msgVal.author] || {}
          const groupId = content.groupId || ''
          metafeed[content.feedpurpose + groupId] = content.subfeed
          metafeeds[msgVal.author] = metafeed
        })

        const chatToMetafeed = {}
        for (let metafeed in metafeeds) {
          const chatId = metafeeds[metafeed]['groupchat' + group.id]
          if (chatId)
            chatToMetafeed[chatId] = metafeeds[metafeed]
        }

        pull(
          SSB.db.query(
            where(type('groupchat')),
            live({ old: true }),
            toPullStream()
          ),
          pull.filter(msg => msg.value.content.id === group.id), // FIXME slow
          pull.drain((msg) => {
            let { timestamp, author, content } = msg.value

            const authorChat = chatToMetafeed[author]
            if (authorChat)
              author = authorChat['main']

            this.messages.push({
              timestamp: (new Date(timestamp)).toLocaleString(),
              user: author,
              text: content.message
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
