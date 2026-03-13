import { expect } from 'chai'
import * as http from 'node:http'
import { createDashboardServer, type DashboardServer } from '../../src/lib/dashboard/server.js'

/**
 * Tests for the dashboard HTTP server.
 *
 * Tests focus on server mechanics (routing, content-types, CORS, SSE setup,
 * port conflict, shutdown). Data-gathering routes are tested with a mock
 * storage that resolves instantly, but gatherAgentData/gatherSessionData/
 * gatherPRData call real system commands (gh, tmux) that may timeout.
 * To keep tests fast, we only assert on routes that don't depend on those.
 */
describe('Dashboard Server', function (this: Mocha.Suite) {
  this.timeout(15_000)

  let dashboard: DashboardServer | null = null

  // Use a random high port to avoid conflicts
  const TEST_PORT = 49152 + Math.floor(Math.random() * 10000)

  // Minimal mock PMOStorage
  const mockStorage = {
    getBoard: async () => ({
      id: 'board-1',
      projectId: 'proj-1',
      columns: [],
    }),
  }

  afterEach(async () => {
    if (dashboard) {
      await dashboard.close()
      dashboard = null
    }
  })

  // ===========================================================================
  // Server startup
  // ===========================================================================

  describe('server startup', () => {
    it('starts an HTTP server on the specified port', async () => {
      dashboard = await createDashboardServer({
        port: TEST_PORT,
        storage: mockStorage as any,
        projectId: 'proj-1',
        projectName: 'Test Project',
      })

      expect(dashboard.url).to.equal(`http://localhost:${TEST_PORT}`)
      expect(dashboard.server).to.be.instanceOf(http.Server)
    })

    it('rejects with helpful error on port conflict', async () => {
      dashboard = await createDashboardServer({
        port: TEST_PORT,
        storage: mockStorage as any,
        projectId: 'proj-1',
        projectName: 'Test Project',
      })

      try {
        const conflicting = await createDashboardServer({
          port: TEST_PORT,
          storage: mockStorage as any,
          projectId: 'proj-2',
          projectName: 'Conflict',
        })
        // If we get here, close the second one
        await conflicting.close()
        expect.fail('Should have thrown on port conflict')
      } catch (err) {
        expect((err as Error).message).to.include(`Port ${TEST_PORT} is already in use`)
      }
    })
  })

  // ===========================================================================
  // HTTP routes (structural — no external dependencies)
  // ===========================================================================

  describe('HTTP routes', () => {
    beforeEach(async () => {
      dashboard = await createDashboardServer({
        port: TEST_PORT,
        storage: mockStorage as any,
        projectId: 'proj-1',
        projectName: 'Test Project',
      })
    })

    it('serves HTML on /', (done) => {
      http.get(`http://127.0.0.1:${TEST_PORT}/`, (res) => {
        expect(res.statusCode).to.equal(200)
        expect(res.headers['content-type']).to.include('text/html')

        let body = ''
        res.on('data', (chunk: Buffer) => { body += chunk })
        res.on('end', () => {
          expect(body).to.include('<!DOCTYPE html>')
          done()
        })
      }).on('error', done)
    })

    it('returns 404 for unknown paths', (done) => {
      http.get(`http://127.0.0.1:${TEST_PORT}/unknown`, (res) => {
        expect(res.statusCode).to.equal(404)
        res.resume()
        res.on('end', done)
      }).on('error', done)
    })

    it('sets CORS headers on all responses', (done) => {
      http.get(`http://127.0.0.1:${TEST_PORT}/`, (res) => {
        expect(res.headers['access-control-allow-origin']).to.equal('*')
        res.resume()
        res.on('end', done)
      }).on('error', done)
    })

    // Note: /api/events (SSE) and /api/data routes call gatherDashboardData()
    // which runs real system commands (gh pr list, tmux). These routes are
    // tested via E2E tests where the full workspace is available. Here we
    // only test routes that respond from static data (HTML, 404).
  })

  // ===========================================================================
  // close()
  // ===========================================================================

  describe('close()', () => {
    it('stops server from accepting new connections', async () => {
      dashboard = await createDashboardServer({
        port: TEST_PORT,
        storage: mockStorage as any,
        projectId: 'proj-1',
        projectName: 'Test Project',
      })

      await dashboard.close()
      dashboard = null

      await new Promise<void>((resolve) => {
        const req = http.get(`http://127.0.0.1:${TEST_PORT}/`, () => {
          expect.fail('Server should not be listening')
        })
        req.on('error', () => {
          resolve() // ECONNREFUSED — expected
        })
      })
    })
  })
})
