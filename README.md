# helia-tests

The purpose of this repository is to set up simple, focuses manual test for [js-libp2p](https://github.com/libp2p/js-libp2p) and [helia](https://github.com/ipfs/helia). I write a lot of software that depends on these pieces of software, and new versions often break existing features. The code in this repository allows me to test new versions and ensure they don't break core features that my software depends on. It also allows me to host code examples when I file GitHub Issues in those repositories.

Core features I depend on:
- Two nodes directly connected over ipv4 can transfer a file.
- Two firewalled nodes can connect to one other using webRTC and a v2 Circuit Relay.
- Two nodes can communicate over pubsub
