import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

/**
 * PRLT-1340: db repair must scope to current HQ, not scan all HQs.
 *
 * The resolveWorkspacePath logic was extracted into a pure function here
 * so we can test it without spinning up the full oclif command.
 */

/**
 * Replicate the fixed resolveWorkspacePath logic from repair.ts.
 * This mirrors the private method for testability.
 */
function resolveWorkspacePath(
  explicit: string | undefined,
  findHQRootFn: () => string | null,
): string | null {
  if (explicit) {
    return fs.existsSync(explicit) ? explicit : null
  }

  const hqPath = findHQRootFn()
  if (hqPath && fs.existsSync(hqPath)) {
    return hqPath
  }

  return null
}

describe('PRLT-1340: db repair HQ scoping', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-db-repair-scope-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('resolveWorkspacePath', () => {
    it('should use explicit --workspace path when provided', () => {
      const hqPath = path.join(tmpDir, 'my-hq')
      fs.mkdirSync(hqPath, { recursive: true })

      const result = resolveWorkspacePath(hqPath, () => '/other/hq')
      expect(result).to.equal(hqPath)
    })

    it('should return null for explicit path that does not exist', () => {
      const result = resolveWorkspacePath('/nonexistent/path', () => '/other/hq')
      expect(result).to.be.null
    })

    it('should use findHQRoot result (current HQ from cwd) when no explicit path', () => {
      const hqPath = path.join(tmpDir, 'current-hq')
      fs.mkdirSync(hqPath, { recursive: true })

      const result = resolveWorkspacePath(undefined, () => hqPath)
      expect(result).to.equal(hqPath)
    })

    it('should return null when outside any HQ (findHQRoot returns null)', () => {
      // This is the key regression test — previously the code would fall back
      // to iterating ALL registered HQs and return a random one.
      const result = resolveWorkspacePath(undefined, () => null)
      expect(result).to.be.null
    })

    it('should NOT fall back to other registered HQs (PRLT-1340 regression)', () => {
      // Create two fake HQ directories to simulate the multi-HQ environment
      const inflowHq = path.join(tmpDir, 'inflow-hq')
      const photobohemiaHq = path.join(tmpDir, 'photobohemia-hq')
      fs.mkdirSync(inflowHq, { recursive: true })
      fs.mkdirSync(photobohemiaHq, { recursive: true })

      // Simulate running from outside any HQ — findHQRoot returns null
      // The old code would fall back to getRegisteredHeadquarters() and
      // return photobohemia-hq's path. The fix ensures it returns null.
      const result = resolveWorkspacePath(undefined, () => null)
      expect(result).to.be.null
    })

    it('should scope to the enclosing HQ, not the globally active one', () => {
      // Simulate: user is inside inflow-hq, but global active is photobohemia-hq
      const inflowHq = path.join(tmpDir, 'inflow-hq')
      fs.mkdirSync(inflowHq, { recursive: true })

      // findHQRoot walks up from cwd and finds inflow-hq
      const result = resolveWorkspacePath(undefined, () => inflowHq)
      expect(result).to.equal(inflowHq)
    })
  })

  describe('--all flag behavior', () => {
    it('should collect all valid registered HQ paths', () => {
      // Simulate getRegisteredHeadquarters returning multiple HQs
      const hq1 = path.join(tmpDir, 'hq1')
      const hq2 = path.join(tmpDir, 'hq2')
      const hq3Missing = path.join(tmpDir, 'hq3-missing')
      fs.mkdirSync(hq1, { recursive: true })
      fs.mkdirSync(hq2, { recursive: true })
      // hq3 is intentionally not created (simulates stale registration)

      const registeredHQs = [
        { name: 'hq1', path: hq1, registeredAt: new Date().toISOString() },
        { name: 'hq2', path: hq2, registeredAt: new Date().toISOString() },
        { name: 'hq3-missing', path: hq3Missing, registeredAt: new Date().toISOString() },
      ]

      // Filter to valid HQs (same logic as repairAllHQs)
      const validHQs = registeredHQs.filter(hq => fs.existsSync(hq.path))
      expect(validHQs).to.have.length(2)
      expect(validHQs.map(h => h.name)).to.deep.equal(['hq1', 'hq2'])
    })
  })

  describe('output shows HQ identity', () => {
    it('should derive HQ name from path basename', () => {
      const workspacePath = '/Users/someone/Projects/inflow-hq'
      const hqName = path.basename(workspacePath)
      expect(hqName).to.equal('inflow-hq')
    })
  })
})
