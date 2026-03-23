import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { isContainerEnvironment, tryMkdir } from '../../src/lib/container.js'

describe('container environment detection', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    // Restore environment
    process.env = { ...originalEnv }
  })

  describe('isContainerEnvironment', () => {
    it('should return false when no container env vars are set', () => {
      delete process.env.PRLT_AGENT_NAME
      delete process.env.DEVCONTAINER
      expect(isContainerEnvironment()).to.be.false
    })

    it('should return true when PRLT_AGENT_NAME is set', () => {
      process.env.PRLT_AGENT_NAME = 'test-agent'
      delete process.env.DEVCONTAINER
      expect(isContainerEnvironment()).to.be.true
    })

    it('should return true when DEVCONTAINER=true', () => {
      delete process.env.PRLT_AGENT_NAME
      process.env.DEVCONTAINER = 'true'
      expect(isContainerEnvironment()).to.be.true
    })

    it('should return false when DEVCONTAINER is set to something other than true', () => {
      delete process.env.PRLT_AGENT_NAME
      process.env.DEVCONTAINER = 'false'
      expect(isContainerEnvironment()).to.be.false
    })

    it('should return true when both PRLT_AGENT_NAME and DEVCONTAINER are set', () => {
      process.env.PRLT_AGENT_NAME = 'test-agent'
      process.env.DEVCONTAINER = 'true'
      expect(isContainerEnvironment()).to.be.true
    })
  })

  describe('tryMkdir', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-container-test-'))
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('should return true when directory already exists', () => {
      expect(tryMkdir(tmpDir, 'test')).to.be.true
    })

    it('should create directory and return true when path is writable', () => {
      const newDir = path.join(tmpDir, 'new-subdir')
      expect(fs.existsSync(newDir)).to.be.false
      expect(tryMkdir(newDir, 'test')).to.be.true
      expect(fs.existsSync(newDir)).to.be.true
    })

    it('should create nested directories with recursive flag', () => {
      const nested = path.join(tmpDir, 'a', 'b', 'c')
      expect(tryMkdir(nested, 'test')).to.be.true
      expect(fs.existsSync(nested)).to.be.true
    })

    it('should return false when directory creation fails with EACCES', () => {
      // Create a read-only directory
      const readOnlyDir = path.join(tmpDir, 'readonly')
      fs.mkdirSync(readOnlyDir)
      fs.chmodSync(readOnlyDir, 0o444)

      const result = tryMkdir(path.join(readOnlyDir, 'child'), 'test')
      expect(result).to.be.false

      // Restore write permission for cleanup
      fs.chmodSync(readOnlyDir, 0o755)
    })

    it('should throw on non-permission errors', () => {
      // Path with null byte is invalid and throws ENOENT-style error
      expect(() => tryMkdir('/dev/null/impossible/path\0', 'test')).to.throw()
    })
  })
})
