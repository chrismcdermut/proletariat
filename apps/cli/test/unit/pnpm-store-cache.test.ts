import { expect } from 'chai'
import {
  PNPM_STORE_CACHE_VOLUME,
} from '../../src/lib/execution/runners/docker-management.js'
import {
  generateDevcontainerJson,
  generatePrltSetupScript,
  DevcontainerOptions,
} from '../../src/lib/execution/devcontainer.js'

/**
 * Tests for pnpm store cache feature (PRLT-1130).
 * Validates cache volume naming, mount configuration, and setup script behavior.
 */
describe('pnpm Store Cache (PRLT-1130)', () => {
  // ===========================================================================
  // Cache volume constant
  // ===========================================================================
  describe('PNPM_STORE_CACHE_VOLUME', () => {
    it('should be named pnpm-store-cache', () => {
      expect(PNPM_STORE_CACHE_VOLUME).to.equal('pnpm-store-cache')
    })
  })

  // ===========================================================================
  // Devcontainer JSON — cache mount
  // ===========================================================================
  describe('devcontainer.json cache mount', () => {
    const makeOptions = (overrides: Partial<DevcontainerOptions> = {}): DevcontainerOptions => ({
      agentName: 'test-agent',
      agentDir: '/path/to/agents/staff/test-agent',
      ...overrides,
    })

    it('should include pnpm-store-cache volume mount as read-only', () => {
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      const cacheMount = result.mounts.find(m => m.includes('pnpm-store-cache'))
      expect(cacheMount).to.exist
      expect(cacheMount).to.include('target=/tmp/pnpm-store-cache')
      expect(cacheMount).to.include('type=volume')
      expect(cacheMount).to.include('readonly')
    })

    it('should mount cache at /tmp/pnpm-store-cache (not /tmp/pnpm-store)', () => {
      // Cache is mounted read-only at a separate path from the writable store.
      // The setup script copies from cache to the writable store.
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      const cacheMount = result.mounts.find(m => m.includes('pnpm-store-cache'))
      expect(cacheMount).to.include('target=/tmp/pnpm-store-cache')
      expect(cacheMount).to.not.include('target=/tmp/pnpm-store,')
    })
  })

  // ===========================================================================
  // Setup script — pnpm store-dir configuration
  // ===========================================================================
  describe('setup script pnpm store-dir', () => {
    it('should configure pnpm store-dir to /tmp/pnpm-store', () => {
      const script = generatePrltSetupScript()

      expect(script).to.include('pnpm config set store-dir /tmp/pnpm-store')
    })

    it('should configure store-dir BEFORE install_workspace_deps', () => {
      const script = generatePrltSetupScript()

      const storeDirIndex = script.indexOf('pnpm config set store-dir /tmp/pnpm-store')
      const installDepsIndex = script.indexOf('install_workspace_deps')
      expect(storeDirIndex).to.be.greaterThan(-1)
      expect(installDepsIndex).to.be.greaterThan(-1)
      expect(storeDirIndex).to.be.lessThan(installDepsIndex,
        'store-dir must be configured before install_workspace_deps runs')
    })
  })

  // ===========================================================================
  // Setup script — cache population
  // ===========================================================================
  describe('setup script cache population', () => {
    it('should check for cache directory at /tmp/pnpm-store-cache', () => {
      const script = generatePrltSetupScript()

      expect(script).to.include('/tmp/pnpm-store-cache')
    })

    it('should copy cache contents to writable store', () => {
      const script = generatePrltSetupScript()

      expect(script).to.include('cp -a /tmp/pnpm-store-cache/. /tmp/pnpm-store/')
    })

    it('should populate cache BEFORE install_workspace_deps', () => {
      const script = generatePrltSetupScript()

      const cachePopIndex = script.indexOf('cp -a /tmp/pnpm-store-cache')
      const installDepsIndex = script.indexOf('install_workspace_deps')
      expect(cachePopIndex).to.be.greaterThan(-1)
      expect(installDepsIndex).to.be.greaterThan(-1)
      expect(cachePopIndex).to.be.lessThan(installDepsIndex,
        'cache population must happen before install_workspace_deps')
    })

    it('should handle missing cache gracefully (fallback message)', () => {
      const script = generatePrltSetupScript()

      expect(script).to.include('No pnpm store cache found')
    })

    it('should create writable store directory before copying', () => {
      const script = generatePrltSetupScript()

      expect(script).to.include('mkdir -p /tmp/pnpm-store')
    })
  })
})
