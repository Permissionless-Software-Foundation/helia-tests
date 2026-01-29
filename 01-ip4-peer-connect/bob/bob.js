/*
  This script creates a Helia IPFS node and attaches helia-coord to it.
  This is the "bob" node for testing IP4 peer connections and pubsub.
*/

// Polyfill for Promise.withResolvers (Node.js v22+ feature, needed for Node.js v20)
if (!Promise.withResolvers) {
  Promise.withResolvers = function () {
    let resolve, reject
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

// Global npm libraries
import { createHelia } from 'helia'
import fs from 'fs'
import { FsBlockstore } from 'blockstore-fs'
import { FsDatastore } from 'datastore-fs'
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { publicIpv4 } from 'public-ip'
import { multiaddr } from '@multiformats/multiaddr'
import SlpWallet from 'minimal-slp-wallet'
import IpfsCoord from 'helia-coord'

const ROOT_DIR = './'
const IPFS_DIR = './.ipfsdata/ipfs'

// Configuration: Add Alice's multiaddr here (e.g., '/ip4/1.2.3.4/tcp/4001/p2p/Qm...')
// This will be used to extract Alice's peer ID for the test
const ALICE_MULTIADDR = '/ip4/192.168.1.65/tcp/4001/p2p/12D3KooW9xvgBbE9tDkNHe6WdvzkDU8cH8zPBHWeUvn3NjWpw5aQ'

// Test state
let alicePeerId = null
let acknowledgmentReceived = false
let acknowledgmentData = null

async function start () {
  try {
    // Ensure the directory structure exists that is needed by the IPFS node to store data.
    ensureBlocksDir()

    // Create block and data stores.
    const blockstore = new FsBlockstore(`${IPFS_DIR}/blockstore`)
    const datastore = new FsDatastore(`${IPFS_DIR}/datastore`)

    // Configure services
    const services = {
      identify: identify(),
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true })
    }

    // libp2p is the networking layer that underpins Helia
    const libp2p = await createLibp2p({
      datastore,
      addresses: {
        listen: [
          '/ip4/127.0.0.1/tcp/0',
          '/ip4/0.0.0.0/tcp/4001',
          '/ip4/0.0.0.0/tcp/4003/ws'
        ]
      },
      transports: [
        tcp(),
        webSockets()
      ],
      connectionEncrypters: [
        noise()
      ],
      streamMuxers: [
        yamux()
      ],
      services
    })

    // Create a Helia node
    const ipfs = await createHelia({
      blockstore,
      datastore,
      libp2p
    })

    const id = ipfs.libp2p.peerId.toString()
    console.log('IPFS ID: ', id)

    // Attempt to guess our ip4 IP address.
    const ip4 = await publicIpv4()
    let detectedMultiaddr = `/ip4/${ip4}/tcp/4001/p2p/${id}`
    detectedMultiaddr = multiaddr(detectedMultiaddr)

    // Get the multiaddrs for the node.
    const multiaddrs = ipfs.libp2p.getMultiaddrs()
    multiaddrs.push(detectedMultiaddr)
    console.log('Multiaddrs: ', multiaddrs)

    // Create an instance of wallet
    const wallet = new SlpWallet()
    await wallet.walletInfoPromise

    // Extract Alice's peer ID from multiaddr if provided
    if (ALICE_MULTIADDR) {
      try {
        // Parse the multiaddr string directly to extract peer ID
        // Format: /ip4/.../tcp/.../p2p/PEER_ID
        const p2pMatch = ALICE_MULTIADDR.match(/\/p2p\/([^/]+)/)
        if (p2pMatch && p2pMatch[1]) {
          alicePeerId = p2pMatch[1]
          console.log(`Alice peer ID extracted from multiaddr: ${alicePeerId}`)
        } else {
          console.warn('Warning: Could not extract peer ID from Alice multiaddr (no /p2p/ component found)')
        }
      } catch (err) {
        console.error('Error parsing Alice multiaddr:', err)
      }
    }

    // Set up private message handler
    // This will be called when private messages are received
    // Note: We'll update this handler after ipfsCoord is created to have access to peerList
    let handlePrivateMessage = (decryptedPayload, from) => {
      try {
        console.log(`Private message received from ${from}:`, decryptedPayload)
        
        // Check if message is from Alice
        // If alicePeerId is not set yet, we'll accept messages from any peer
        // (This handles edge cases, but normally alicePeerId should be set by announcement time)
        const isFromAlice = alicePeerId ? (from === alicePeerId) : true
        
        if (isFromAlice) {
          // If we don't have alicePeerId yet, set it now (fallback case)
          if (!alicePeerId) {
            alicePeerId = from
            console.log(`Alice peer ID identified from private message: ${alicePeerId}`)
          }
          
          // Only process if this is actually from Alice
          if (from === alicePeerId) {
            // Try to parse as JSON
            let messageData
            try {
              messageData = JSON.parse(decryptedPayload)
            } catch {
              // If not JSON, treat as string
              messageData = decryptedPayload
            }
            
            // Check if this looks like an acknowledgment
            // It could be a JSON object with acknowledgment/ack/response field, or a string containing "ack"
            const isAcknowledgment = messageData && (
              messageData.acknowledgment || 
              messageData.ack || 
              messageData.response ||
              (typeof messageData === 'string' && (
                messageData.toLowerCase().includes('ack') ||
                messageData.toLowerCase().includes('acknowledgment')
              ))
            )
            
            if (isAcknowledgment) {
              acknowledgmentReceived = true
              acknowledgmentData = messageData
              console.log('Acknowledgment received from Alice:', messageData)
            }
          }
        }
      } catch (err) {
        console.error('Error handling private message:', err)
      }
    }

    // Pass IPFS and wallet to ipfs-coord when instantiating it.
    const ipfsCoord = new IpfsCoord({
      ipfs,
      wallet,
      type: 'node.js',
      nodeType: 'external',
      debugLevel: 2,
      privateLog: handlePrivateMessage
    })

    await ipfsCoord.start()
    console.log('IPFS and the coordination library is ready.')

    // Run the test workflow
    await runTest(ipfsCoord, ipfs)
  } catch (err) {
    console.error('Error in start(): ', err)
    process.exit(1)
  }
}

// Ensure that the directories exist to store blocks from the IPFS network.
// This function is called at startup, before the IPFS node is started.
function ensureBlocksDir () {
  try {
    !fs.existsSync(`${ROOT_DIR}.ipfsdata`) && fs.mkdirSync(`${ROOT_DIR}.ipfsdata`)

    !fs.existsSync(`${IPFS_DIR}`) && fs.mkdirSync(`${IPFS_DIR}`)

    !fs.existsSync(`${IPFS_DIR}/blockstore`) && fs.mkdirSync(`${IPFS_DIR}/blockstore`)

    !fs.existsSync(`${IPFS_DIR}/datastore`) && fs.mkdirSync(`${IPFS_DIR}/datastore`)

    return true
  } catch (err) {
    console.error('Error in ensureBlocksDir(): ', err)
    throw err
  }
}

// Helper function to sleep/delay
function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Poll for a condition with timeout
async function pollUntil (conditionFn, intervalMs = 1000, timeoutMs = 60000*5, description = 'condition') {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    if (await conditionFn()) {
      return true
    }
    await sleep(intervalMs)
  }
  throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`)
}

// Main test workflow
async function runTest (ipfsCoord, ipfs) {
  try {
    console.log('\n=== Starting IP4 Peer Connection Test ===\n')

    // Step 1: Connect directly to Alice using multiaddr (if provided)
    if (ALICE_MULTIADDR && alicePeerId) {
      console.log('Step 1: Connecting directly to Alice using multiaddr...')
      console.log(`Alice multiaddr: ${ALICE_MULTIADDR}`)
      console.log(`Alice peer ID: ${alicePeerId}`)
      
      try {
        const connectionResult = await ipfsCoord.adapters.ipfs.connectToPeer({ 
          multiaddr: ALICE_MULTIADDR 
        })
        
        if (connectionResult.success) {
          console.log(`Successfully connected to Alice via ${ALICE_MULTIADDR}`)
          
          // Wait a moment for the connection to fully establish
          await sleep(1000)
          
          // Verify connection
          const connectedPeers = await ipfsCoord.adapters.ipfs.getPeers()
          if (connectedPeers.includes(alicePeerId)) {
            console.log('Connection verified!')
          } else {
            console.log('Connection may still be establishing, waiting...')
            // Wait a bit more and verify again
            await pollUntil(
              async () => {
                const peers = await ipfsCoord.adapters.ipfs.getPeers()
                return peers.includes(alicePeerId)
              },
              500, // Check every 500ms
              10000, // 10 second timeout
              'connection verification'
            )
            console.log('Connection verified!')
          }
          
          // IMPORTANT: Wait for Alice's announcement to populate peer data
          // The direct connection establishes the link, but we still need the
          // announcement to get Alice's public key and other peer data for encryption
          console.log('Waiting for Alice\'s announcement to populate peer data...')
          await pollUntil(
            () => {
              const peerData = ipfsCoord.thisNode.peerData.filter(x => x.from === alicePeerId)
              return peerData.length > 0
            },
            500, // Check every 500ms
            60000*5, // 5 minute timeout (announcements happen every ~2 minutes, but should be faster with direct connection)
            'Alice peer data from announcement'
          )
          console.log('Alice peer data received!')
        } else {
          throw new Error(`Failed to connect: ${connectionResult.details}`)
        }
      } catch (err) {
        console.error('Error connecting directly:', err)
        console.log('Falling back to announcement-based discovery...')
        
        // Fallback: Wait for Alice's announcement
        console.log('Waiting for Alice\'s announcement...')
        await pollUntil(
          () => {
            return ipfsCoord.thisNode.peerList.includes(alicePeerId)
          },
          2000, // Check every 2 seconds
          60000*5, // 5 minute timeout
          'Alice announcement'
        )
        console.log(`Alice found in peer list!`)
        
        // Verify peer data is available
        console.log('Verifying Alice peer data is available...')
        await pollUntil(
          () => {
            const peerData = ipfsCoord.thisNode.peerData.filter(x => x.from === alicePeerId)
            return peerData.length > 0
          },
          500, // Check every 500ms
          10000, // 10 second timeout (should be immediate if peerList has it)
          'Alice peer data verification'
        )
        console.log('Alice peer data verified!')
        
        // Try connection refresh as fallback
        try {
          await ipfsCoord.useCases.peer.refreshPeerConnections()
          console.log('Connection refresh triggered')
        } catch (refreshErr) {
          console.error('Error triggering connection refresh:', refreshErr)
        }
        
        // Wait for connection
        await pollUntil(
          async () => {
            const connectedPeers = await ipfsCoord.adapters.ipfs.getPeers()
            return connectedPeers.includes(alicePeerId)
          },
          1000, // Check every second
          30000, // 30 second timeout
          'connection to Alice'
        )
        console.log(`Successfully connected to Alice!`)
      }
    } else {
      // No multiaddr provided - fall back to announcement-based discovery
      console.log('Step 1: Waiting for Alice\'s announcement (no multiaddr provided)...')
      
      if (!alicePeerId) {
        console.log('Alice peer ID not provided, waiting for announcement...')
        console.log('Will identify Alice as the first peer that announces itself.')
        await pollUntil(
          () => {
            return ipfsCoord.thisNode.peerList.length > 0
          },
          2000, // Check every 2 seconds
          60000*5, // 5 minute timeout
          'Alice announcement'
        )
        
        // Get the first peer as Alice
        if (ipfsCoord.thisNode.peerList.length > 0) {
          alicePeerId = ipfsCoord.thisNode.peerList[0]
          console.log(`Alice discovered from announcement! Peer ID: ${alicePeerId}`)
        } else {
          throw new Error('Failed to discover Alice from announcements')
        }
      } else {
        // Wait for Alice to appear in peerList
        await pollUntil(
          () => {
            return ipfsCoord.thisNode.peerList.includes(alicePeerId)
          },
          2000, // Check every 2 seconds
          60000*5, // 5 minute timeout
          'Alice in peer list'
        )
        console.log(`Alice found in peer list!`)
      }
      
      // Verify peer data is available (should be populated with peerList, but check to be safe)
      console.log('Verifying Alice peer data is available...')
      await pollUntil(
        () => {
          const peerData = ipfsCoord.thisNode.peerData.filter(x => x.from === alicePeerId)
          return peerData.length > 0
        },
        500, // Check every 500ms
        10000, // 10 second timeout (should be immediate if peerList has it)
        'Alice peer data verification'
      )
      console.log('Alice peer data verified!')
      
      // Step 2: Connect to Alice
      console.log('\nStep 2: Connecting to Alice...')
      
      // Trigger connection attempt
      try {
        await ipfsCoord.useCases.peer.refreshPeerConnections()
        console.log('Connection refresh triggered')
      } catch (err) {
        console.error('Error triggering connection refresh:', err)
      }
      
      // Wait for connection to be established
      console.log('Waiting for connection to Alice...')
      await pollUntil(
        async () => {
          const connectedPeers = await ipfsCoord.adapters.ipfs.getPeers()
          return connectedPeers.includes(alicePeerId)
        },
        1000, // Check every second
        30000, // 30 second timeout
        'connection to Alice'
      )
      console.log(`Successfully connected to Alice!`)
    }

    // Step 2: Send private message
    console.log('\nStep 2: Sending private message to Alice...')
    const randomNumber = Math.floor(Math.random() * 1000000)
    const testMessage = {
      test: true,
      randomNumber: randomNumber,
      timestamp: new Date().toISOString(),
      from: 'bob',
      encryptPubKey: ipfsCoord.thisNode.publicKey // Include Bob's encryption public key
    }
    const messageString = JSON.stringify(testMessage)
    
    console.log(`Sending message with random number: ${randomNumber}`)
    await ipfsCoord.useCases.peer.sendPrivateMessage(
      alicePeerId,
      messageString,
      ipfsCoord.thisNode
    )
    console.log('Message sent successfully!')

    // Step 3: Wait for acknowledgment
    console.log('\nStep 3: Waiting for acknowledgment from Alice...')
    
    // Reset acknowledgment state before waiting
    acknowledgmentReceived = false
    acknowledgmentData = null

    // Wait for acknowledgment (polling approach)
    await pollUntil(
      () => {
        return acknowledgmentReceived
      },
      500, // Check every 500ms
      60000*5, // 5 minute timeout
      'acknowledgment from Alice'
    )
    console.log('Acknowledgment received from Alice!')
    console.log('Acknowledgment data:', acknowledgmentData)

    // Step 4: Shutdown
    console.log('\nStep 4: Test completed successfully! Shutting down...')
    await ipfs.stop()
    console.log('IPFS node stopped gracefully.')
    console.log('\n=== Test Completed Successfully ===\n')
    process.exit(0)

  } catch (err) {
    console.error('\n=== Test Failed ===')
    console.error('Error in test workflow:', err)
    
    // Cleanup on error
    try {
      console.log('Cleaning up...')
      await ipfs.stop()
    } catch (cleanupErr) {
      console.error('Error during cleanup:', cleanupErr)
    }
    
    process.exit(1)
  }
}

start()
