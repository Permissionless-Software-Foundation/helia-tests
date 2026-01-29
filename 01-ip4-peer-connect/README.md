# 01-ip4-peer-connect

The purpose of this task is to assert that a peer node behind a firewall (*bob*) can successfully connect to a peer node with a public IP4 address (*alice*) using TCP, and that they can successfully pass announcement objects over pubsub.

## Setup

- Run the *alice* node on a VPS with a public IP4 address.
- Make note of the libp2p multiaddr for the alice node.
- Add the *alice* multiaddr to the top of the *bob.js* file.
- Run the *bob* node on a development machine, on a home internet connection, behind a firewall.

## Running the Test

**Important:** Start the nodes in the following order:

1. **Start the Alice node first:**
   ```bash
   cd alice
   npm start
   ```
   Wait for Alice to fully start and display its multiaddr. Make sure Alice is running and ready before proceeding.

2. **Start the Bob node second:**
   ```bash
   cd bob
   npm start
   ```
   Bob will attempt to connect directly to Alice using the multiaddr configured in `bob.js`. If the direct connection fails, Bob will fall back to waiting for Alice's announcement over pubsub.

## Test Details

The *bob* node will attempt to connect directly to the *alice* node using the multiaddr configured in `bob.js`. If a multiaddr is provided, Bob will connect immediately without waiting for pubsub announcements. If the direct connection fails or no multiaddr is provided, Bob will fall back to listening for announcement objects over pubsub and connect once Alice's announcement is received.

Once the *bob* node has successfully registered the *alice* node as a peer, the bob node will send a private message to the alice node with a random number inside the message. The alice node will acknowledge the message by replying to it in a second private message over pubsub. Once that happens, the test will end and both nodes will shut down.

This will confirm that both nodes can connect to one another and transfer pubsub messages.