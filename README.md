# Groupies

Groupies is a tech demo showcasing [private groups] for SSB running
directly in the browser using [ssb-browser-core] with no installation
required. The demo is a primitive chat application that uses [meta
feeds] to split each group into their own feed. This means that you
will only store data for the groups you are a part of. Furthermore the
classic follow/block paradigm is used for replication within a certain
hop distance. Data is transferred between nodes via a [rooms] server.

![Screenshot of groupies demo][screenshot]

[private groups]: https://github.com/ssbc/private-group-spec
[ssb-browser-core]: https://github.com/arj03/ssb-browser-core
[meta feeds]: https://github.com/ssb-ngi-pointer/ssb-meta-feeds-spec
[rooms]: https://github.com/ssb-ngi-pointer/go-ssb-room
[screenshot]: assets/buttchat.jpg

