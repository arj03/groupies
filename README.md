# Groupies

Groupies is a tech demo showcasing [private groups] for SSB running
directly in the browser using [ssb-browser-core] with no installation
required. The demo is a primitive chat application that uses [meta
feeds] to split each group into their own feed. This means that you
will only store data for the groups you are a part of. Furthermore the
classic follow/block paradigm is used for replication within a certain
hop distance. Data is transferred between nodes via a [rooms] server.

![Screenshot of groupies demo][screenshot]

You can try a [live demo].

The demo can be used as a starting point for building other
applications. The UI is written in Vue.js and is structured into the
following files:

```
   61 add-group-key.js
   29 browser-hack.js
  125 chat.js
  158 helpers.js
  367 index.js
  372 profile.js
  136 ssb-profile-link.js
 1248 total
```

`browser-hack.js`, `helpers.js` and `index.js` represents the
core. `profile.js` and the `ssb-profile-link.js` component are
relavant for profile information and
following/blocking. `add-group-key.js` and `chat.js` are the only
application specific components and can be easily replaced with any
other application you can think of. The application makes use of
[ssb-crut] to make it really easy to work with multiple writers to a
shared datastructure such as the group configuration. Lastly there is
the html and css that can be found in dist/.

[private groups]: https://github.com/ssbc/private-group-spec
[ssb-browser-core]: https://github.com/arj03/ssb-browser-core
[meta feeds]: https://github.com/ssb-ngi-pointer/ssb-meta-feeds-spec
[rooms]: https://github.com/ssb-ngi-pointer/go-ssb-room
[screenshot]: assets/buttchat.jpg
[live demo]: https://between-two-worlds.dk/groupies/
[ssb-crut]: https://gitlab.com/ahau/lib/ssb-crut
