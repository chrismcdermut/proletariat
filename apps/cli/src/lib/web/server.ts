/**
 * Web Dashboard Server
 *
 * Hono-based HTTP server that serves the dashboard HTML template
 * and exposes JSON API + SSE endpoints for live data updates.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as http from 'node:http'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { gatherDashboardData } from '../dashboard/data.js'
import type { PMOStorage } from '../pmo/types.js'

const SSE_INTERVAL_MS = 4_000

export interface WebServerOptions {
  port: number
  storage: PMOStorage
  projectId: string
  projectName: string
}

export interface WebServer {
  url: string
  close: () => Promise<void>
}

/**
 * Resolve the dashboard.html template path.
 *
 * Works from both src/ (dev) and dist/ (compiled) by walking up
 * from the current file to find the template.
 */
function resolveTemplatePath(): string {
  const thisDir = path.dirname(new URL(import.meta.url).pathname)

  // From dist/lib/web/ -> src/lib/web/templates/
  const fromDist = path.resolve(thisDir, '..', '..', '..', 'src', 'lib', 'web', 'templates', 'dashboard.html')
  if (fs.existsSync(fromDist)) return fromDist

  // From src/lib/web/ -> templates/
  const fromSrc = path.resolve(thisDir, 'templates', 'dashboard.html')
  if (fs.existsSync(fromSrc)) return fromSrc

  throw new Error(`Dashboard template not found. Searched:\n  ${fromDist}\n  ${fromSrc}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createWebServer(options: WebServerOptions): Promise<WebServer> {
  const { port, storage, projectId, projectName } = options

  const templatePath = resolveTemplatePath()
  const html = fs.readFileSync(templatePath, 'utf-8')

  const app = new Hono()

  // Serve dashboard HTML
  app.get('/', (c) => c.html(html))

  // JSON API — full data snapshot
  app.get('/api/data', async (c) => {
    try {
      const data = await gatherDashboardData(storage, projectId, projectName)
      return c.json(data)
    } catch {
      return c.json({ error: 'Failed to gather data' }, 500)
    }
  })

  // SSE — live updates via Hono's native streamSSE
  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      // Send initial data
      try {
        const data = await gatherDashboardData(storage, projectId, projectName)
        await stream.writeSSE({ data: JSON.stringify(data) })
      } catch {
        // Will send on next cycle
      }

      // Poll and push updates until client disconnects
      while (!stream.aborted) {
        await sleep(SSE_INTERVAL_MS)
        if (stream.aborted) break
        try {
          const data = await gatherDashboardData(storage, projectId, projectName)
          await stream.writeSSE({ data: JSON.stringify(data) })
        } catch {
          // Data gathering failed, skip this cycle
        }
      }
    })
  })

  return new Promise<WebServer>((resolve, reject) => {
    const server = serve(
      {
        fetch: app.fetch,
        port,
        hostname: '127.0.0.1',
      },
      () => {
        resolve({
          url: `http://localhost:${port}`,
          close: () => {
            return new Promise<void>((resolveClose) => {
              server.close(() => resolveClose())
            })
          },
        })
      },
    )

    // Handle port-in-use errors
    ;(server as http.Server).on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Try --port <number> to use a different port.`))
      } else {
        reject(err)
      }
    })
  })
}
