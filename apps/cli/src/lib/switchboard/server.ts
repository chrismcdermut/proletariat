/**
 * Switchboard Server — Unix domain socket for wakeup notifications.
 *
 * The daemon hosts the socket server at ~/.proletariat/switchboard.sock.
 * Clients connect for low-latency push notifications when messages are
 * enqueued. This avoids the 500ms polling delay for time-sensitive
 * patterns like call/reply.
 *
 * Protocol:
 * - Client → Server: newline-delimited JSON
 *   - { type: 'register', address: SwitchboardAddress }
 *   - { type: 'enqueued', messageId, to, topic }
 * - Server → Client: newline-delimited JSON
 *   - { type: 'wakeup', reason: string }
 *
 * See: PRLT-1371
 */

import * as net from 'node:net'
import * as fs from 'node:fs'
import { getSwitchboardSocketPath } from './db.js'
import {
  type SwitchboardAddress,
  addressKey,
} from './types.js'

// =============================================================================
// Types
// =============================================================================

interface ConnectedClient {
  socket: net.Socket
  address: SwitchboardAddress | null
}

export interface SwitchboardServerOptions {
  /** Path for the Unix domain socket (default: ~/.proletariat/switchboard.sock). */
  socketPath?: string
  /** Logger function. */
  log?: (msg: string) => void
}

// =============================================================================
// SwitchboardServer
// =============================================================================

export class SwitchboardServer {
  private server: net.Server | null = null
  private clients = new Map<net.Socket, ConnectedClient>()
  private addressIndex = new Map<string, Set<net.Socket>>()
  private socketPath: string
  private log: (msg: string) => void

  constructor(options?: SwitchboardServerOptions) {
    this.socketPath = options?.socketPath ?? getSwitchboardSocketPath()
    this.log = options?.log ?? (() => {})
  }

  /**
   * Start the socket server. Removes stale socket file if present.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Remove stale socket file
      try {
        if (fs.existsSync(this.socketPath)) {
          fs.unlinkSync(this.socketPath)
        }
      } catch {
        // Best-effort cleanup
      }

      this.server = net.createServer((socket) => {
        this.handleConnection(socket)
      })

      // Single error handler — reject during startup, log after
      let started = false
      this.server.on('error', (err) => {
        if (!started) {
          reject(err)
        } else {
          this.log(`switchboard server error: ${err.message}`)
        }
      })

      this.server.listen(this.socketPath, () => {
        started = true
        // Make socket world-readable so containers can connect
        try {
          fs.chmodSync(this.socketPath, 0o777)
        } catch {
          // Best-effort — permissions may not matter in all environments
        }
        this.log(`switchboard server listening on ${this.socketPath}`)
        resolve()
      })
    })
  }

  /**
   * Stop the socket server. Disconnects all clients.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Disconnect all clients
      for (const [socket] of this.clients) {
        socket.destroy()
      }
      this.clients.clear()
      this.addressIndex.clear()

      if (this.server) {
        this.server.close(() => {
          // Clean up socket file
          try {
            if (fs.existsSync(this.socketPath)) {
              fs.unlinkSync(this.socketPath)
            }
          } catch {
            // Best-effort
          }
          this.server = null
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  /**
   * Notify clients that a message was enqueued for them.
   * Wakes up the target client (by address) or broadcasts for events.
   */
  notifyEnqueued(to: SwitchboardAddress | null, topic: string | null): void {
    if (to) {
      // Direct message — notify the target
      const key = addressKey(to)
      const sockets = this.addressIndex.get(key)
      if (sockets) {
        for (const socket of sockets) {
          this.sendWakeup(socket, `message for ${key}`)
        }
      }
    }

    if (topic) {
      // Event message — notify all connected clients
      // (they'll check their own subscriptions when they poll)
      for (const [socket] of this.clients) {
        this.sendWakeup(socket, `event on ${topic}`)
      }
    }
  }

  /**
   * Get the number of connected clients.
   */
  get clientCount(): number {
    return this.clients.size
  }

  /**
   * Get registered addresses of connected clients.
   */
  get registeredAddresses(): string[] {
    return Array.from(this.addressIndex.keys())
  }

  // ===========================================================================
  // Connection Handling
  // ===========================================================================

  private handleConnection(socket: net.Socket): void {
    const client: ConnectedClient = { socket, address: null }
    this.clients.set(socket, client)
    this.log(`switchboard client connected (${this.clients.size} total)`)

    let buffer = ''

    socket.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        this.handleMessage(client, line.trim())
      }
    })

    socket.on('close', () => {
      this.removeClient(socket)
      this.log(`switchboard client disconnected (${this.clients.size} remaining)`)
    })

    socket.on('error', () => {
      this.removeClient(socket)
    })
  }

  private handleMessage(client: ConnectedClient, raw: string): void {
    try {
      const msg = JSON.parse(raw)

      switch (msg.type) {
        case 'register':
          this.handleRegister(client, msg.address)
          break

        case 'enqueued':
          // Client is telling us about a new message — notify recipients
          this.notifyEnqueued(msg.to ?? null, msg.topic ?? null)
          break
      }
    } catch {
      // Malformed message — ignore
    }
  }

  private handleRegister(client: ConnectedClient, address: SwitchboardAddress): void {
    if (!address?.kind || !address?.id) return

    client.address = address
    const key = addressKey(address)

    let sockets = this.addressIndex.get(key)
    if (!sockets) {
      sockets = new Set()
      this.addressIndex.set(key, sockets)
    }
    sockets.add(client.socket)

    this.log(`switchboard client registered as ${key}`)
  }

  private removeClient(socket: net.Socket): void {
    const client = this.clients.get(socket)
    if (client?.address) {
      const key = addressKey(client.address)
      const sockets = this.addressIndex.get(key)
      if (sockets) {
        sockets.delete(socket)
        if (sockets.size === 0) {
          this.addressIndex.delete(key)
        }
      }
    }
    this.clients.delete(socket)
  }

  private sendWakeup(socket: net.Socket, reason: string): void {
    try {
      const notification = JSON.stringify({ type: 'wakeup', reason })
      socket.write(notification + '\n')
    } catch {
      // Best-effort notification
    }
  }
}
