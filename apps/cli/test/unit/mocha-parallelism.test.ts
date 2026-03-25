/**
 * Mocha Parallelism Regression Test — PRLT-1146
 *
 * Ensures mocha parallel jobs stay at 2 (not 4+) to prevent OOM kills in
 * agent containers. At jobs=4, each worker uses 400-900MB which combined
 * with Claude (~230MB) exceeds container memory limits.
 *
 * If this test fails, it means someone bumped mocha jobs back up, which
 * will cause agent containers to OOM and silently die.
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MOCHARC_PATH = path.resolve(__dirname, '../../.mocharc.json')

describe('Mocha parallelism config (PRLT-1146)', () => {
  let config: { jobs?: number; parallel?: boolean }

  before(() => {
    const raw = fs.readFileSync(MOCHARC_PATH, 'utf-8')
    config = JSON.parse(raw)
  })

  it('should have parallel enabled', () => {
    expect(config.parallel).to.equal(true)
  })

  it('should limit jobs to 2 to prevent OOM in agent containers', () => {
    // Regression: 4 parallel workers * 400-900MB each = OOM at 4GB/8GB container limits.
    // 2 workers keeps peak memory well within bounds.
    expect(config.jobs).to.equal(2)
  })
})
