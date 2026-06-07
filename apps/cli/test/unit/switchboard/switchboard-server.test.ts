import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as net from 'node:net'
import { SwitchboardServer } from '../../../src/lib/switchboard/server.js'
import type { SwitchboardAddress } from '../../../src/lib/switchboard/types.js'

describe('SwitchboardServer', () => {
  let tmpDir: string
  let socketPath: string
  let server: SwitchboardServer
  const clients: net.Socket[] = []

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-switchboard-server-test-')))
    socketPath = path.join(tmpDir, 'switchboard.sock')
    server = new SwitchboardServer({ socketPath })
  })

  afterEach(async () => {
    // Destroy all client sockets first
    for (const client of clients) {
      client.destroy()
    }
    clients.length = 0
    await sleep(50)

    await server.stop()
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup
    }
  })

  function connectClient(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const client = net.createConnection(socketPath, () => {
        clients.push(client)
        resolve(client)
      })
      client.on('error', reject)
    })
  }

  // ===========================================================================
  // start() / stop()
  // ===========================================================================

  describe('start() and stop()', () => {
    it('starts and accepts connections', async () => {
      await server.start()
      expect(server.clientCount).to.equal(0)

      // Verify we can connect (socket is listening)
      const client = await connectClient()
      expect(server.clientCount).to.equal(1)
      client.destroy()
    })

    it('removes socket file on stop', async () => {
      await server.start()
      await server.stop()
      expect(fs.existsSync(socketPath)).to.be.false
    })

    it('replaces stale socket file on start', async () => {
      // Create a fake stale socket file
      fs.writeFileSync(socketPath, '')

      await server.start()
      // Verify we can connect (server replaced the stale file)
      const client = await connectClient()
      expect(server.clientCount).to.equal(1)
      client.destroy()
    })
  })

  // ===========================================================================
  // Client connections
  // ===========================================================================

  describe('client connections', () => {
    it('tracks client connections', async () => {
      await server.start()

      const client = await connectClient()
      expect(server.clientCount).to.equal(1)

      client.destroy()
      await sleep(100)
      expect(server.clientCount).to.equal(0)
    })

    it('handles client registration', async () => {
      await server.start()

      const client = await connectClient()
      client.write(JSON.stringify({
        type: 'register',
        address: { kind: 'agent', id: 'MRUN-1234' },
      }) + '\n')

      await sleep(100)
      expect(server.registeredAddresses).to.include('agent:MRUN-1234')

      client.destroy()
      await sleep(100)
      expect(server.registeredAddresses).to.not.include('agent:MRUN-1234')
    })

    it('handles multiple clients', async () => {
      await server.start()

      const client1 = await connectClient()
      const client2 = await connectClient()
      expect(server.clientCount).to.equal(2)

      client1.destroy()
      client2.destroy()
      await sleep(100)
      expect(server.clientCount).to.equal(0)
    })
  })

  // ===========================================================================
  // Wakeup notifications
  // ===========================================================================

  describe('notifyEnqueued()', () => {
    it('sends wakeup notification to registered client', async () => {
      await server.start()

      const client = await connectClient()
      const address: SwitchboardAddress = { kind: 'agent', id: 'MRUN-1234' }
      client.write(JSON.stringify({ type: 'register', address }) + '\n')
      await sleep(100)

      const received = waitForData(client)
      server.notifyEnqueued(address, null)

      const data = await received
      const parsed = JSON.parse(data.trim())
      expect(parsed.type).to.equal('wakeup')
    })

    it('broadcasts topic notifications', async () => {
      await server.start()

      const client1 = await connectClient()
      const client2 = await connectClient()

      const received1 = waitForData(client1)
      const received2 = waitForData(client2)

      server.notifyEnqueued(null, 'agent:spawned')

      const [data1, data2] = await Promise.all([received1, received2])
      expect(JSON.parse(data1.trim()).type).to.equal('wakeup')
      expect(JSON.parse(data2.trim()).type).to.equal('wakeup')
    })

    it('handles missing target without error', async () => {
      await server.start()

      const addr: SwitchboardAddress = { kind: 'agent', id: 'NON-EXISTENT' }
      server.notifyEnqueued(addr, null) // Should not throw
    })
  })

  // ===========================================================================
  // Protocol handling
  // ===========================================================================

  describe('protocol', () => {
    it('handles malformed JSON gracefully', async () => {
      await server.start()

      const client = await connectClient()
      client.write('not json at all\n')
      await sleep(100)

      // Server still running, client still connected
      expect(server.clientCount).to.equal(1)
    })

    it('forwards enqueued notifications to target', async () => {
      await server.start()

      const sender = await connectClient()
      const receiver = await connectClient()

      const targetAddr: SwitchboardAddress = { kind: 'agent', id: 'TARGET' }
      receiver.write(JSON.stringify({ type: 'register', address: targetAddr }) + '\n')
      await sleep(100)

      const received = waitForData(receiver)

      sender.write(JSON.stringify({
        type: 'enqueued',
        messageId: 'MSG-TEST',
        to: targetAddr,
        topic: null,
      }) + '\n')

      const data = await received
      expect(JSON.parse(data.trim()).type).to.equal('wakeup')
    })
  })
})

function waitForData(socket: net.Socket, timeoutMs: number = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('waitForData timed out')), timeoutMs)
    socket.once('data', (data) => {
      clearTimeout(timer)
      resolve(data.toString())
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
