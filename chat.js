module.exports = function (ssbSingleton, group, crut, getChatFeedHelper,
                           groupConfigChanges, editGroupHelper) {
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
        rooms: [],
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
        editGroupHelper(group, this.title, this.rooms)
      },
      
      load: function() {
        ssbSingleton.getSimpleSSBEventually(
          () => this.componentStillLoaded,
          this.render
        )
      },

      render: function(err, SSB) {
        const { where, type, live, toPullStream } = SSB.db.operators

        groupConfigChanges(SSB, crut, group.id, (err, record) => {
          if (!err) {
            const state = record.states[0]
            this.title = state.title
            document.title = 'Groupies chat - ' + state.title
            this.rooms = state.rooms
          }
        })

        pull(
          SSB.db.query(
            where(type('groupchat')),
            live({ old: true }),
            toPullStream()
          ),
          pull.filter(msg => msg.value.content.id === group.id), // FIXME slow
          pull.drain((msg) => {
            let { timestamp, author, content } = msg.value

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
