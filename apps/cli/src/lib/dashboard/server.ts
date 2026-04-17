/**
 * Dashboard HTTP Server
 *
 * Serves the dashboard HTML, JSON API, and SSE events.
 * Zero external dependencies — uses Node.js built-in http module.
 */

import * as http from 'node:http'
import { getDashboardHTML } from './html.js'
import { gatherDashboardData } from './data.js'
import type { PMOStorage } from '../pmo/types.js'

const SSE_INTERVAL_MS = 4_000

export interface DashboardServerOptions {
  port: number
  storage: PMOStorage
  projectId: string
  projectName: string
}

export interface DashboardServer {
  server: http.Server
  url: string
  close: () => Promise<void>
}

export function createDashboardServer(options: DashboardServerOptions): Promise<DashboardServer> {
  const { port, storage, projectId, projectName } = options
  const sseClients = new Set<http.ServerResponse>()
  let sseInterval: ReturnType<typeof setInterval> | null = null

  const html = getDashboardHTML(port)

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/'

    // CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*')

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }

    if (url === '/api/data') {
      try {
        const data = await gatherDashboardData(storage, projectId, projectName)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(data))
      } catch (_err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Failed to gather data' }))
      }
      return
    }

    if (url === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })

      // Send initial data
      try {
        const data = await gatherDashboardData(storage, projectId, projectName)
        res.write(`data: ${JSON.stringify(data)}\n\n`)
      } catch {
        // Will retry on next interval
      }

      sseClients.add(res)

      req.on('close', () => {
        sseClients.delete(res)
      })

      return
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  })

  // Start SSE broadcast interval
  sseInterval = setInterval(async () => {
    if (sseClients.size === 0) return

    try {
      const data = await gatherDashboardData(storage, projectId, projectName)
      const payload = `data: ${JSON.stringify(data)}\n\n`
      for (const client of sseClients) {
        try {
          client.write(payload)
        } catch {
          sseClients.delete(client)
        }
      }
    } catch {
      // Data gathering failed, skip this cycle
    }
  }, SSE_INTERVAL_MS)

  const url = `http://localhost:${port}`

  return new Promise<DashboardServer>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Try --port <number> to use a different port.`))
      } else {
        reject(err)
      }
    })

    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        url,
        close: () => {
          return new Promise<void>((resolveClose) => {
            if (sseInterval) clearInterval(sseInterval)

            // Close all SSE connections
            for (const client of sseClients) {
              try { client.end() } catch { /* client may have already disconnected — safe to ignore */ }
            }
            sseClients.clear()

            server.close(() => resolveClose())
          })
        },
      })
    })
  })
}
