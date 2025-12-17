# 01-ip4-peer-connect

The purpose of this task is to assert that a peer node behind a firewall (*bob*) can successfully connect to a peer node with a public IP4 address (*alice*) using TCP, and that they can successfully pass announcement objects over pubsub.

## Setup

- Run the *alice* node on a VPS with a public IP4 address.
- Make note of the libp2p multiaddr for the alice node.
- Add the *alice* multiaddr to the top of the *bob.js* file.
- Run the *bob* node on a development machine, on a home internet connection, behind a firewall.

## Test Details

The *bob* node will automatically start connecting to other nodes on the network, and it will listen for announcement object. After it receives the announcement object for the *alice* node, it will automatically try to connect to it.

Once the *bob* node has successfully registered the *alice* node as a peer, the bob node will send a private message to the alice node with a random number inside the message. The alice node will acknowledge the message by replying to it in a second private message over pubsub. Once that happens, the test will end and both nodes will shut down.

This will confirm that both nodes can connect to one another and transfer pubsub messages.