const ssbSingleton = require('ssb-browser-core/ssb-singleton')

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
      imgURL: '',
      isBlocked: false,
      name: ''
    }
  },

  methods: {
    renderProfile: function(profile) {
      var self = this
      ssbSingleton.getSSBEventually(
        -1,
        () => { return self.componentStillLoaded },
        (SSB) => { return SSB },
        (err, SSB) => {
          self.renderProfileCallback(err, SSB, profile)
        }
      )
    },

    renderProfileCallback: function (err, SSB, existingProfile) {
      const self = this
      const profile = existingProfile || SSB.db.getIndex("aboutSelf").getProfile(self.feed)

      // set a default image to be overridden if there is an actual avatar to show.
      self.imgURL = "noavatar.svg"

      if (self.feed == SSB.id)
        self.name = 'You'
      else
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
      SSB.friends.isBlocking({ source: SSB.id, dest: self.feed }, (err, result) => {
        if (!err) self.isBlocked = result
      })
    },

    refresh: function() {
      var self = this

      // set a default image while we wait for an SSB.
      self.imgURL = "noavatar.svg"

      ssbSingleton.getSSBEventually(
        -1,
        () => { return self.componentStillLoaded },
        (SSB) => { return SSB },
        self.loadBlocking
      )

      ssbSingleton.getSSBEventually(
        -1,
        () => { return self.componentStillLoaded },
        (SSB) => {
          if (!SSB || !SSB.db) return false

          let profile = SSB.db.getIndex("aboutSelf").getProfile(self.feed)
          return Object.keys(profile).length > 0
        },
        self.renderProfileCallback)
    }
  },

  created: function() {
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
