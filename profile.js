module.exports = function (feedId) {
  const ssbSingleton = require('ssb-browser-core/ssb-singleton')
  
  let initialState = function(self) {
    return {
      componentStillLoaded: false,
      isSelf: false,
      following: false,
      blocking: false,
      name: '',
      image: 'noavatar.svg',
      imageBlobId: '',
      showFriends: true,
      showBlocked: false,
      showFollowers: false,
      showBlockingUs: false,
      friends: [],
      followers: [],
      blocked: [],
      blockingUs: [],
      waitingForBlobURLs: 0,
    }
  }

  return {
    template: `
       <div id="app">
       <div id="profile">
         <span v-if="isSelf">
           <div class="avatar">
             <img :src='image'><br>
             <input type="file" v-on:change="onFileSelect"><br>
           </div>
           <div class="description">
             <div class="feedId">{{ feedId }}</div>
             Name: <input id="name" type="text" v-model="name" placeholder="(Your name / nickname)">
           </div>
         </span>
         <span v-else>
           <div v-bind:class="{ avatar: true, blockedAvatar: blocking }">
             <img :src='image'><br>
             <span v-if="blocking" class="blockedSymbol">🚫</span>
           </div>
           <div class="description">
             <div class="feedId">{{ feedId }}</div>
             <h2 class="profileName">{{ name }}</h2>
           </div>
         </span>
         <div class="profileButtons" v-if="isSelf">
           <button class="clickButton" v-on:click="saveProfile">Save profile</button>
         </div>
         <div class="profileButtons" v-else>
           <button class="clickButton" v-on:click="changeFollowStatus">{{ followText }}</button>
           <button class="clickButton" v-on:click="changeBlockStatus">{{ blockText }}</button>
           <br><br>
         </div>
         <h2 v-if="friends">
           <a href="javascript:void(0)" @click="showFriends=!showFriends">
             <span v-if="showFriends">▼</span>
             <span v-else>►</span>
             &nbsp;Following ({{ friends.length }})
           </a>
         </h2>
         <div v-if="showFriends" id="follows">
           <div v-for="friend in friends">
             <ssb-profile-link :feed="friend"></ssb-profile-link>
           </div>
         </div>
         <h2 v-if="blocked">
           <a href="javascript:void(0)" @click="showBlocked=!showBlocked">
             <span v-if="showBlocked">▼</span>
             <span v-else>►</span>
             &nbsp;
             Blocking ({{ blocked.length }})
           </a>
         </h2>
         <div v-if="showBlocked" id="blocked">
           <div v-for="block in blocked">
             <ssb-profile-link :feed="block"></ssb-profile-link>
           </div>
         </div>
         <h2 v-if="followers && followers.length > 0">
           <a href="javascript:void(0)" @click="showFollowers=!showFollowers">
             <span v-if="showFollowers">▼</span>
             <span v-else>►</span>
             &nbsp;Followers ({{ followers.length }})
           </a>
         </h2>
         <div v-if="followers && followers.length > 0 && showFollowers" id="followers">
           <div v-for="friend in followers">
             <ssb-profile-link :feed="friend"></ssb-profile-link>
           </div>
         </div>
         <h2 v-if="blockingUs && blockingUs.length > 0">
           <a href="javascript:void(0)" @click="showBlockingUs=!showBlockingUs">
             <span v-if="showBlockingUs">▼</span>
             <span v-else>►</span>
             &nbsp;Blocking us ({{ blockingUs.length }})
           </a>
         </h2>
         <div v-if="blockingUs && blockingUs.length > 0 && showBlockingUs" id="blockingUs">
           <div v-for="friend in blockingUs">
             <ssb-profile-link :feed="friend"></ssb-profile-link>
           </div>
         </div>
         <div v-if="blockingUs && blockingUs.length > 0" style="clear: both;"></div>
       </div>
     </div>`,

    data: function() {
      return initialState(this)
    },

    computed: {
      followText: function() { return this.following ? 'Unfollow' : 'Follow' },
      blockText: function() { return this.blocking ? 'Unblock' : 'Block' },
    },
    
    methods: {
      cacheImageURLForPreview: function(blobId, cb) {
        var self = this;
        [ err, SSB ] = ssbSingleton.getSSB()
        if (!SSB || !SSB.blobs) {
          // Not going to hurt anything to try again later.
          setTimeout(function() {
            self.cacheImageURLForPreview(blobId, cb)
          }, 3000)
          return
        }

        ++this.waitingForBlobURLs
        SSB.blobs.fsURL(blobId, (err, blobURL) => {
          // If this is the last blob we were waiting for, call the callback.
          --self.waitingForBlobURLs
          if (self.waitingForBlobURLs == 0)
            cb(null, true)
        })
      },

      onFileSelect: function(ev) {
        const file = ev.target.files[0]

        if (!file) return

        var self = this;
        [ err, SSB ] = ssbSingleton.getSSB()
        if (!SSB || !SSB.blobs) {
          alert("Can't add file right now.  Database couldn't be locked.  Please make sure you only have one running instance of ssb-browser.")
          return
        }

        file.arrayBuffer().then(function (buffer) {
          SSB.blobs.hash(new Uint8Array(buffer), (err, digest) => {
            var blobId = "&" + digest
            SSB.blobs.add(blobId, file, (err) => {
              if (!err) {
                SSB.blobs.push(blobId, (err) => {
                  SSB.blobs.localGet(blobId, (err, url) => {
                    if (!err) {
                      self.image = url
                      self.imageBlobId = blobId
                    }
                  })
                })
              } else
                alert("failed to add img", err)
            })
          })
        })
      },

      saveProfile: function() {
        [ err, SSB ] = ssbSingleton.getSSB()
        if (!SSB || !SSB.db) {
          alert("Can't save right now.  Database couldn't be locked.  Please make sure you only have one running instance of ssb-browser.")
          return
        }

        var msg = { type: 'about', about: SSB.id }
        if (this.name)
          msg.name = this.name
        if (this.imageBlobId != '') {
          msg.image = {
            link: this.imageBlobId
          }
        }

        // Make sure the full post (including headers) is not larger than the 8KiB limit.
        if (JSON.stringify(msg).length > 8192) {
          alert('Your post is too large.  Each post can only be 8KiB.  Please shorten your post or split it into multiple posts.')
          return
        }

        SSB.db.publish(msg, (err) => {
          if (err) return alert(err)

          alert("Saved!")
        })
      },

      changeFollowStatus: function() {
        [ err, SSB ] = ssbSingleton.getSSB()
        var self = this
        if (!SSB || !SSB.db) {
          alert("Can't change follow status right now.  Database couldn't be locked.  Please make sure you only have one running instance of ssb-browser.")
          return
        }

        if (this.following) {
          SSB.db.publish({
            type: 'contact',
            contact: this.feedId,
            following: false
          }, () => {
            alert('Unfollowed') // FIXME: proper UI
          })
        } else {
          SSB.db.publish({
            type: 'contact',
            contact: this.feedId,
            following: true
          }, () => {
            alert('Followed') // FIXME: proper UI
          })
        }
      },

      changeBlockStatus: function() {
        [ err, SSB ] = ssbSingleton.getSSB()
        if (!SSB || !SSB.db) {
          alert("Can't change blocking status right now.  Database couldn't be locked.  Please make sure you only have one running instance of ssb-browser.")
          return
        }

        var self = this
        if (this.blocking) {
          SSB.db.publish({
            type: 'contact',
            contact: this.feedId,
            blocking: false
          }, () => {
            self.blocking = false
            alert('Unblocked') // FIXME: proper UI
          })
        } else {
          SSB.db.publish({
            type: 'contact',
            contact: this.feedId,
            blocking: true
          }, () => {
            SSB.db.deleteFeed(this.feedId, (err) => {
              if (err) {
                self.blocking = true
                alert('Failed to delete messages, but user is blocked.')
              } else {
                alert('Blocked') // FIXME: proper UI
              }
            })
          })
        }
      },

      updateFollowers: function(err, SSB) {
        var self = this
        var opts = {
          start: this.feedId,
          max: 1,
          reverse: true
        }
        SSB.friends.hops(opts, (err, feeds) => {
          var newFollowers = []
          for(f in feeds) {
            if (feeds[f] > 0)
              newFollowers.push(f)
          }
          self.followers = newFollowers
        })
      },

      updateBlockingUs: function(err, SSB) {
        var self = this
        var opts = {
          start: this.feedId,
          max: 0,
          reverse: true
        }
        SSB.friends.hops(opts, (err, feeds) => {
          var newBlocks = []
          for (f in feeds) {
            if (Math.round(feeds[f]) == -1)
              newBlocks.push(f)
          }
          self.blockingUs = newBlocks
        })
      },

      renderFollowsCallback: function (err, SSB) {
        var self = this
        
        self.isSelf = (SSB.id == this.feedId)

        SSB.helpers.getGraphForFeed(self.feedId, (err, graph) => {
          self.friends = graph.following
          self.blocked = graph.blocking

          SSB.friends.isFollowing({ source: SSB.id, dest: self.feedId }, (err, result) => {
            self.following = result
          })

          SSB.friends.isBlocking({ source: SSB.id, dest: self.feedId }, (err, result) => {
            self.blocking = result
          })
        })

        this.updateFollowers(err, SSB)
        this.updateBlockingUs(err, SSB)
      },
      
      renderProfileCallback: function (err, SSB) {
        var self = this
        const profile = SSB.db.getIndex("aboutSelf").getProfile(self.feedId)
        if (profile.name)
          self.name = profile.name
          
        if (profile.imageURL) {
          self.image = profile.imageURL
          self.imageBlobId = profile.image
        } else if (profile.image) {
          SSB.blobs.localGet(profile.image, (err, url) => {
            if (!err) {
              self.image = url
              self.imageBlobId = profile.image
            }
          })
        }
      },

      renderProfile() {
        var self = this

        ssbSingleton.getSimpleSSBEventually(
          () => { return self.componentStillLoaded },
          self.renderFollowsCallback
        )

        ssbSingleton.getSSBEventually(
          -1,
          () => { return self.componentStillLoaded },
          (SSB) => {
            if (!SSB || !SSB.db) return false
            
            let profile = SSB.db.getIndex("aboutSelf").getProfile(self.feedId)
            return Object.keys(profile).length > 0
          },
          self.renderProfileCallback
        )
      }
    },

    created: function () {
      this.feedId = feedId
      Object.assign(this.$data, initialState(this))
      this.componentStillLoaded = true

      this.renderProfile()
    },

    destroyed: function () {
      this.componentStillLoaded = false
    }
  }
}
