const ssbSingleton = require('ssb-browser-core/ssb-singleton')
const pull = require('pull-stream')

const feedToMainCache = {}

Vue.component('ssb-profile-link', {
  template: `
        <div class="avatarcontainer">
          <div class="avatarlink" v-on:click="openProfile()">
            <img class='img' :src='imgURL' :title="feed" />
            <span v-if="isBlocked" class="blockedSymbol">🚫</span>
            <span class="name">{{ name }}</span>
          </div>
        </div>`,

  props: ['feed'],

  data: function() {
    return {
      componentStillLoaded: false,
      imgURL: 'noavatar.svg',
      isBlocked: false,
      name: '',
      mainfeed: ''
    }
  },

  methods: {
    renderProfileCallback: function (err, SSB, existingProfile) {
      const self = this
      const profile = existingProfile || SSB.db.getIndex("aboutSelf").getProfile(self.mainfeed)

      if (self.mainfeed == SSB.id)
        self.name = 'You'
      else if (profile.name !== '')
        self.name = profile.name
  
      if (profile.imageURL) self.imgURL = profile.imageURL
      else if (profile.image) {
        SSB.blobs.localProfileGet(profile.image, (err, url) => {
          if (err) return console.error("failed to get img", err)
  
          profile.imageURL = self.imgURL = url
        })
      }
    },

    openProfile: function() {
      const profile = require('./profile')
      new Vue(profile(this.feed)).$mount("#app")
    },

    loadBlocking: function (err, SSB) {
      const self = this
      SSB.friends.isBlocking({ source: SSB.id, dest: self.mainfeed }, (err, result) => {
        if (!err) self.isBlocked = result
      })
    },

    load: function() {
      const self = this

      ssbSingleton.getSimpleSSBEventually(
        () => { return self.componentStillLoaded },
        self.loadBlocking
      )

      ssbSingleton.getSimpleSSBEventually(
        () => { return self.componentStillLoaded },
        self.renderProfileCallback
      )
    },

    refresh: function() {
      const self = this

      // convert feed to main feed
      if (feedToMainCache[self.feed]) {
        self.mainfeed = feedToMainCache[self.feed]
        self.load()
      } else {
        const { where, author, slowEqual, toPullStream } = SSB.db.operators

        pull(
          SSB.db.query(
            where(slowEqual('value.content.subfeed', self.feed)),
            toPullStream()
          ),
          pull.collect((err, messages) => {
            if (err || messages.length == 0) return console.error(err)

            const { metafeed } = messages[0].value.content

            pull(
              SSB.db.query(
                where(author(metafeed)),
                toPullStream()
              ),
              pull.filter((msg) => msg.value.content.feedpurpose === 'main'),
              pull.collect((err, messages) => {
                if (err || messages.length == 0) return console.error(err)

                self.mainfeed = messages[0].value.content.subfeed
                feedToMainCache[self.feed] = self.mainfeed
                self.load()
              })
            )
          })
        )
      }
    }
  },

  created: function() {
    this.name = this.feed.substr(0,5)

    this.componentStillLoaded = true
    this.refresh()
  },

  destroyed: function() {
    this.componentStillLoaded = false
  },

  watch: {
    feed: function (oldValue, newValue) {
      this.refresh()
    }
  }
})
