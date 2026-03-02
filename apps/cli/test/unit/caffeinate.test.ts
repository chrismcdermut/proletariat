import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  assertMacOS,
  isMacOS,
  readState,
  writeState,
  clearState,
  isProcessRunning,
  getStatus,
  startCaffeinate,
  stopCaffeinate,
  _internals,
  type CaffeinateState,
} from '../../src/lib/caffeinate.js'

const IS_MACOS = process.platform === 'darwin'

describe('caffeinate', () => {
  let originalPidFile: string
  let originalRuntimeDir: string
  let tmpDir: string

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-caffeinate-test-'))
    originalPidFile = _internals.PID_FILE
    originalRuntimeDir = _internals.RUNTIME_DIR
    ;(_internals as { PID_FILE: string }).PID_FILE = path.join(tmpDir, 'caffeinate.pid')
    ;(_internals as { RUNTIME_DIR: string }).RUNTIME_DIR = tmpDir
  })

  afterEach(() => {
    try {
      fs.unlinkSync(_internals.PID_FILE)
    } catch {
      // fine
    }
  })

  after(() => {
    ;(_internals as { PID_FILE: string }).PID_FILE = originalPidFile
    ;(_internals as { RUNTIME_DIR: string }).RUNTIME_DIR = originalRuntimeDir
    try {
      fs.rmSync(tmpDir, { recursive: true })
    } catch {
      // fine
    }
  })

  describe('isMacOS', () => {
    it('returns a boolean', () => {
      expect(isMacOS()).to.be.a('boolean')
    })

    it('matches process.platform', () => {
      expect(isMacOS()).to.equal(process.platform === 'darwin')
    })
  })

  describe('assertMacOS', () => {
    if (IS_MACOS) {
      it('does not throw on macOS', () => {
        expect(() => assertMacOS()).not.to.throw()
      })
    } else {
      it('throws on non-macOS platforms', () => {
        expect(() => assertMacOS()).to.throw(/only supported on macOS/)
      })
    }
  })

  describe('readState / writeState / clearState', () => {
    it('returns null when no PID file exists', () => {
      expect(readState()).to.be.null
    })

    it('writes and reads state correctly', () => {
      const state: CaffeinateState = {
        pid: 12345,
        startedAt: '2026-01-01T00:00:00.000Z',
        flags: ['-d', '-i'],
        duration: 3600,
      }
      writeState(state)
      const read = readState()
      expect(read).to.deep.equal(state)
    })

    it('clearState removes the PID file', () => {
      const state: CaffeinateState = {
        pid: 12345,
        startedAt: '2026-01-01T00:00:00.000Z',
        flags: [],
      }
      writeState(state)
      expect(readState()).not.to.be.null
      clearState()
      expect(readState()).to.be.null
    })

    it('clearState does not throw if file does not exist', () => {
      expect(() => clearState()).not.to.throw()
    })
  })

  describe('isProcessRunning', () => {
    it('returns true for the current process PID', () => {
      expect(isProcessRunning(process.pid)).to.be.true
    })

    it('returns false for a non-existent PID', () => {
      expect(isProcessRunning(999999999)).to.be.false
    })
  })

  describe('getStatus', () => {
    it('returns not running when no state exists', () => {
      const { running, state } = getStatus()
      expect(running).to.be.false
      expect(state).to.be.null
    })

    it('returns running for a live process', () => {
      const testState: CaffeinateState = {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        flags: [],
      }
      writeState(testState)

      const { running, state } = getStatus()
      expect(running).to.be.true
      expect(state).to.not.be.null
      expect(state!.pid).to.equal(process.pid)
    })

    it('cleans up stale state for dead processes', () => {
      const testState: CaffeinateState = {
        pid: 999999999,
        startedAt: new Date().toISOString(),
        flags: [],
      }
      writeState(testState)

      const { running, state } = getStatus()
      expect(running).to.be.false
      expect(state).to.be.null
      expect(readState()).to.be.null
    })
  })

  if (IS_MACOS) {
    describe('startCaffeinate (macOS)', () => {
      afterEach(() => {
        // Always clean up any spawned caffeinate
        stopCaffeinate()
      })

      it('starts caffeinate and returns state', () => {
        const state = startCaffeinate(['-i'], 5)
        expect(state.pid).to.be.a('number')
        expect(state.pid).to.be.greaterThan(0)
        expect(state.startedAt).to.be.a('string')
        expect(state.flags).to.include('-t')
        expect(state.duration).to.equal(5)
      })

      it('is idempotent - returns existing state if already running', () => {
        const state1 = startCaffeinate()
        const state2 = startCaffeinate()
        expect(state1.pid).to.equal(state2.pid)
      })
    })

    describe('stopCaffeinate (macOS)', () => {
      it('returns false when nothing is running', () => {
        expect(stopCaffeinate()).to.be.false
      })

      it('stops a running process and returns true', () => {
        startCaffeinate()
        const stopped = stopCaffeinate()
        expect(stopped).to.be.true

        const { running } = getStatus()
        expect(running).to.be.false
      })
    })
  } else {
    describe('startCaffeinate (non-macOS)', () => {
      it('throws on non-macOS', () => {
        expect(() => startCaffeinate()).to.throw(/only supported on macOS/)
      })
    })

    describe('stopCaffeinate (non-macOS)', () => {
      it('returns false when nothing is running', () => {
        expect(stopCaffeinate()).to.be.false
      })
    })
  }
})
