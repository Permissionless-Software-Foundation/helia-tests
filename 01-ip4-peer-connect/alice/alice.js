/*
  This script creates a Helia IPFS node and attaches helia-coord to it.
  This is the "alice" node for testing IP4 peer connections.
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
import { webRTC } from '@libp2p/webrtc'
import SlpWallet from 'minimal-slp-wallet'
import IpfsCoord from 'helia-coord'

const ROOT_DIR = './'
const IPFS_DIR = './.ipfsdata/ipfs'

// Test state
let bobPeerId = null
let testMessageReceived = false
let testMessageData = null
let acknowledgmentSent = false

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
          '/ip4/0.0.0.0/tcp/4003/ws',
          '/webrtc'
        ]
      },
      transports: [
        tcp(),
        webSockets(),
        webRTC()
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

    // Set up private message handler
    // This will be called when private messages are received
    const handlePrivateMessage = (decryptedPayload, from) => {
      try {
        console.log(`Private message received from ${from}:`, decryptedPayload)
        
        // Try to parse as JSON
        let messageData
        try {
          messageData = JSON.parse(decryptedPayload)
        } catch {
          // If not JSON, treat as string
          messageData = decryptedPayload
        }
        
        // Check if this is a test message from bob
        // Look for test: true or from: 'bob' in the message
        const isTestMessage = messageData && (
          (messageData.test === true) ||
          (messageData.from === 'bob') ||
          (typeof messageData === 'object' && messageData.randomNumber !== undefined)
        )
        
        if (isTestMessage) {
          // Store bob's peer ID if we don't have it yet
          if (!bobPeerId) {
            bobPeerId = from
            console.log(`Bob peer ID identified from message: ${bobPeerId}`)
          }
          
          // Only process if this is from the same peer (bob)
          // This ensures we only process messages from the peer we identified as bob
          if (from === bobPeerId) {
            testMessageReceived = true
            testMessageData = messageData
            console.log('Test message received from Bob!')
            console.log('Test message data:', testMessageData)
            
            // Extract random number if present
            if (messageData.randomNumber !== undefined) {
              console.log(`Received random number: ${messageData.randomNumber}`)
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
    console.log('\n=== Starting IP4 Peer Connection Test (Alice) ===\n')
    console.log('Alice is ready and waiting for Bob\'s test message...\n')

    // Step 1: Wait for Bob's test message
    console.log('Step 1: Waiting for test message from Bob...')
    
    // Reset test message state
    testMessageReceived = false
    testMessageData = null
    bobPeerId = null

    // Wait for test message (polling approach)
    await pollUntil(
      () => {
        return testMessageReceived
      },
      500, // Check every 500ms
      60000*5, // 5 minute timeout
      'test message from Bob'
    )
    
    console.log('Test message received from Bob!')
    if (testMessageData) {
      console.log('Message details:', testMessageData)
      if (testMessageData.randomNumber !== undefined) {
        console.log(`Random number received: ${testMessageData.randomNumber}`)
      }
    }

    // Ensure we have bob's peer ID
    if (!bobPeerId) {
      throw new Error('Bob peer ID not identified from message')
    }
    console.log(`Bob peer ID: ${bobPeerId}`)

    // IMPORTANT: Extract Bob's encryption key from the message and add to peerData
    // This allows us to encrypt the acknowledgment without waiting for Bob's announcement
    if (!testMessageData || !testMessageData.encryptPubKey) {
      throw new Error('Bob\'s encryption public key not found in test message')
    }
    
    console.log('\nAdding Bob to peerData with encryption key from message...')
    
    // Check if Bob is already in peerData
    const existingPeerData = ipfsCoord.thisNode.peerData.filter(x => x.from === bobPeerId)
    
    if (existingPeerData.length === 0) {
      // Add Bob to peerList if not already there
      if (!ipfsCoord.thisNode.peerList.includes(bobPeerId)) {
        ipfsCoord.thisNode.peerList.push(bobPeerId)
      }
      
      // Create peer data object with Bob's encryption key
      const bobPeerData = {
        from: bobPeerId,
        data: {
          encryptPubKey: testMessageData.encryptPubKey
        }
      }
      
      // Add to peerData
      ipfsCoord.thisNode.peerData.push(bobPeerData)
      console.log('Bob added to peerData with encryption key from message')
    } else {
      // Update existing peer data with encryption key if not present
      if (!existingPeerData[0].data || !existingPeerData[0].data.encryptPubKey) {
        if (!existingPeerData[0].data) {
          existingPeerData[0].data = {}
        }
        existingPeerData[0].data.encryptPubKey = testMessageData.encryptPubKey
        console.log('Updated existing Bob peerData with encryption key from message')
      } else {
        console.log('Bob already has encryption key in peerData')
      }
    }

    // Step 2: Send acknowledgment
    console.log('\nStep 2: Sending acknowledgment to Bob...')
    
    // Create acknowledgment message
    const acknowledgmentMessage = {
      acknowledgment: true,
      receivedRandomNumber: testMessageData?.randomNumber || null,
      originalTimestamp: testMessageData?.timestamp || null,
      timestamp: new Date().toISOString(),
      from: 'alice'
    }
    const messageString = JSON.stringify(acknowledgmentMessage)
    
    console.log('Sending acknowledgment:', acknowledgmentMessage)
    await ipfsCoord.useCases.peer.sendPrivateMessage(
      bobPeerId,
      messageString,
      ipfsCoord.thisNode
    )
    acknowledgmentSent = true
    console.log('Acknowledgment sent successfully!')

    // Step 3: Shutdown
    console.log('\nStep 3: Test completed successfully! Shutting down...')
    
    // Wait a brief moment to ensure message is sent
    await sleep(2000) // 2 second delay
    
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
