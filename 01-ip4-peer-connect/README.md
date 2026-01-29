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

### Bob's Workflow

1. **Connection Phase:**
   - If `ALICE_MULTIADDR` is configured in `bob.js`, Bob attempts a direct TCP connection to Alice using the multiaddr.
   - If the direct connection succeeds, Bob verifies the connection and then waits for Alice's announcement over pubsub (needed to populate peer data for encryption).
   - If the direct connection fails or no multiaddr is provided, Bob falls back to waiting for Alice's announcement over pubsub to discover her.
   - Once Alice appears in the peer list, Bob waits for her peer data to be populated (containing encryption keys).

2. **Messaging Phase:**
   - Bob sends a private encrypted message to Alice containing:
     - A random number (for verification)
     - Bob's encryption public key (`encryptPubKey`)
     - Test metadata (timestamp, test flag, etc.)

3. **Verification Phase:**
   - Bob waits for an acknowledgment message from Alice.
   - The acknowledgment should contain the received random number, confirming Alice successfully decrypted and processed the message.

### Alice's Workflow

1. **Initialization:**
   - Alice starts up and begins listening for announcements and private messages.
   - Alice sets up handlers to automatically add peers to peer data when their encryption keys are received in messages.

2. **Message Reception:**
   - Alice waits for Bob's test message.
   - Upon receiving the message, Alice extracts Bob's encryption public key from the message payload.
   - Alice adds Bob to her peer data with his encryption key (enabling her to encrypt the acknowledgment).

3. **Acknowledgment:**
   - Alice sends an encrypted acknowledgment message back to Bob containing:
     - The received random number (verifying message integrity)
     - Timestamps from both the original message and acknowledgment
     - Acknowledgment flag

### Test Completion

Once Bob receives the acknowledgment from Alice, both nodes shut down gracefully. This confirms that:
- Both nodes can establish TCP connections (even through firewalls/NAT)
- Pubsub announcements are working correctly
- Private encrypted messaging is functioning bidirectionally
- Peer data exchange and encryption key management is working

## Versioning

- v1.0.0 ran successfully, tested against node.js v20, helia-coord v1.8.0, helia v5.2.1, libp2p v2.6.0.