module.exports = function (ssbSingleton, group,
                           getChatFeedHelper, editGroupHelper) {
  const pull = require('pull-stream')
  let chatFeed = null

  function getChatFeed(SSB, cb) {
    if (chatFeed !== null) return cb(null, chatFeed)

    getChatFeedHelper(SSB, group, (err, feed) => {
      if (err) return cb(err)

      chatFeed = feed
      cb(null, chatFeed)
    })
  }

  return {
    template: `
    <div id="app">
      <h2>{{ title }} chat <button v-on:click="editGroup" class="clickButton" style="float: right;">Edit group</button></h2>
      <div style="padding-bottom: 1rem;">
        <input type='text' style="width: 400px;" v-model="message" @keyup.enter="post()">
        <button v-on:click="post">Send</button>
      </div>
      <div class="chatmessage" v-for="msg in messages">
       <div style="min-width: 3rem;">
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
        title: '',
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
                message: this.message,
                recps: [group.id]
              }, (err, msg) => {
                if (err) console.log(err)
                else this.message = ''
              })
            })
          }
        )
      },

      editGroup: function() {
        editGroupHelper(group, this.title)
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
            where(type('groupconfig')),
            live({ old: true }),
            toPullStream()
          ),
          pull.filter(msg => {
            return msg.value.content.id === group.id
          }),
          pull.drain((msg) => {
            this.title = msg.value.content.title
            document.title = 'Groupies chat - ' + this.title
          })
        )

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

      document.title = 'Groupies chat'

      this.load()
    },

    destroyed: function () {
      this.componentStillLoaded = false
    }
  }
}
