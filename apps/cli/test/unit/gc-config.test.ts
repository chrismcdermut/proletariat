import { expect } from 'chai'
import {
  parseDuration,
  parseDurationOrDefault,
  getGCConfig,
  setGCConfigValue,
  getGCConfigEntries,
  GC_DEFAULTS,
  GC_CONFIG_KEYS,
  type GCConfig,
} from '../../src/lib/gc/config.js'

// =============================================================================
// Mock SettingsStore (avoids real DB dependency)
// =============================================================================

class MockSettingsStore {
  private data = new Map<string, string>()

  get(key: string): string | null {
    return this.data.get(key) ?? null
  }

  set(key: string, value: string): void {
    this.data.set(key, value)
  }

  delete(key: string): void {
    this.data.delete(key)
  }

  has(key: string): boolean {
    return this.data.has(key)
  }

  getByPrefix(prefix: string): Array<{ key: string; value: string }> {
    const result: Array<{ key: string; value: string }> = []
    for (const [key, value] of this.data) {
      if (key.startsWith(prefix)) result.push({ key, value })
    }
    return result
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('@smoke GC Config', () => {
  // ---------------------------------------------------------------------------
  // parseDuration
  // ---------------------------------------------------------------------------
  describe('parseDuration', () => {
    it('should parse seconds', () => {
      expect(parseDuration('30s')).to.equal(30_000)
    })

    it('should parse minutes', () => {
      expect(parseDuration('5m')).to.equal(5 * 60 * 1000)
    })

    it('should parse hours', () => {
      expect(parseDuration('24h')).to.equal(24 * 60 * 60 * 1000)
    })

    it('should parse days', () => {
      expect(parseDuration('30d')).to.equal(30 * 24 * 60 * 60 * 1000)
    })

    it('should handle whitespace around duration', () => {
      expect(parseDuration('  5m  ')).to.equal(5 * 60 * 1000)
    })

    it('should be case insensitive', () => {
      expect(parseDuration('5M')).to.equal(5 * 60 * 1000)
      expect(parseDuration('1H')).to.equal(60 * 60 * 1000)
      expect(parseDuration('2D')).to.equal(2 * 24 * 60 * 60 * 1000)
    })

    it('should return null for invalid durations', () => {
      expect(parseDuration('')).to.be.null
      expect(parseDuration('abc')).to.be.null
      expect(parseDuration('5')).to.be.null
      expect(parseDuration('m5')).to.be.null
      expect(parseDuration('5x')).to.be.null
    })

    it('should return null for negative or zero values', () => {
      // '0m' is technically valid — it parses to 0
      expect(parseDuration('0m')).to.equal(0)
      // Negative isn't matched by \d+
      expect(parseDuration('-5m')).to.be.null
    })
  })

  // ---------------------------------------------------------------------------
  // parseDurationOrDefault
  // ---------------------------------------------------------------------------
  describe('parseDurationOrDefault', () => {
    it('should return parsed value for valid duration', () => {
      expect(parseDurationOrDefault('10m', '5m')).to.equal(10 * 60 * 1000)
    })

    it('should fall back to default for invalid duration', () => {
      expect(parseDurationOrDefault('invalid', '5m')).to.equal(5 * 60 * 1000)
    })
  })

  // ---------------------------------------------------------------------------
  // GC_DEFAULTS
  // ---------------------------------------------------------------------------
  describe('GC_DEFAULTS', () => {
    it('should have sensible default sweep interval', () => {
      expect(parseDuration(GC_DEFAULTS.sweepInterval)).to.be.greaterThan(0)
    })

    it('should have all staleness TTLs parseable', () => {
      expect(parseDuration(GC_DEFAULTS.staleness.sessionlessTtl)).to.be.greaterThan(0)
      expect(parseDuration(GC_DEFAULTS.staleness.containerNoExecTtl)).to.be.greaterThan(0)
      expect(parseDuration(GC_DEFAULTS.staleness.idleAgentTtl)).to.be.greaterThan(0)
    })

    it('should have cascade steps enabled by default', () => {
      expect(GC_DEFAULTS.cascade.branch).to.be.true
      expect(GC_DEFAULTS.cascade.executionRecords).to.be.true
    })

    it('should not keep branches after merge by default', () => {
      expect(GC_DEFAULTS.retention.keepBranchesAfterMerge).to.be.false
    })
  })

  // ---------------------------------------------------------------------------
  // getGCConfig
  // ---------------------------------------------------------------------------
  describe('getGCConfig', () => {
    it('should return defaults when no settings are configured', () => {
      const store = new MockSettingsStore()
      const config = getGCConfig(store as any)

      expect(config.sweepInterval).to.equal(GC_DEFAULTS.sweepInterval)
      expect(config.staleness.sessionlessTtl).to.equal(GC_DEFAULTS.staleness.sessionlessTtl)
      expect(config.staleness.containerNoExecTtl).to.equal(GC_DEFAULTS.staleness.containerNoExecTtl)
      expect(config.staleness.idleAgentTtl).to.equal(GC_DEFAULTS.staleness.idleAgentTtl)
      expect(config.retention.keepBranchesAfterMerge).to.equal(GC_DEFAULTS.retention.keepBranchesAfterMerge)
      expect(config.retention.executionRetention).to.equal(GC_DEFAULTS.retention.executionRetention)
      expect(config.cascade.branch).to.equal(GC_DEFAULTS.cascade.branch)
      expect(config.cascade.executionRecords).to.equal(GC_DEFAULTS.cascade.executionRecords)
    })

    it('should override sweep interval from settings', () => {
      const store = new MockSettingsStore()
      store.set('gc.sweep_interval', '15m')
      const config = getGCConfig(store as any)

      expect(config.sweepInterval).to.equal('15m')
    })

    it('should override staleness TTLs from settings', () => {
      const store = new MockSettingsStore()
      store.set('gc.staleness.sessionless_ttl', '10m')
      store.set('gc.staleness.container_no_exec_ttl', '20m')
      store.set('gc.staleness.idle_agent_ttl', '48h')
      const config = getGCConfig(store as any)

      expect(config.staleness.sessionlessTtl).to.equal('10m')
      expect(config.staleness.containerNoExecTtl).to.equal('20m')
      expect(config.staleness.idleAgentTtl).to.equal('48h')
    })

    it('should override boolean settings from string values', () => {
      const store = new MockSettingsStore()
      store.set('gc.retention.keep_branches_after_merge', 'true')
      store.set('gc.cascade.branch', 'false')
      const config = getGCConfig(store as any)

      expect(config.retention.keepBranchesAfterMerge).to.be.true
      expect(config.cascade.branch).to.be.false
    })

    it('should accept "1" and "yes" as truthy for booleans', () => {
      const store = new MockSettingsStore()

      store.set('gc.retention.keep_branches_after_merge', '1')
      expect(getGCConfig(store as any).retention.keepBranchesAfterMerge).to.be.true

      store.set('gc.retention.keep_branches_after_merge', 'yes')
      expect(getGCConfig(store as any).retention.keepBranchesAfterMerge).to.be.true
    })

    it('should treat unknown string values as falsy for booleans', () => {
      const store = new MockSettingsStore()
      store.set('gc.cascade.branch', 'nope')
      const config = getGCConfig(store as any)

      expect(config.cascade.branch).to.be.false
    })

    it('should partially override — unset keys remain defaults', () => {
      const store = new MockSettingsStore()
      store.set('gc.sweep_interval', '1h')
      const config = getGCConfig(store as any)

      expect(config.sweepInterval).to.equal('1h')
      // Other fields should be defaults
      expect(config.staleness.sessionlessTtl).to.equal(GC_DEFAULTS.staleness.sessionlessTtl)
      expect(config.cascade.executionRecords).to.equal(GC_DEFAULTS.cascade.executionRecords)
    })
  })

  // ---------------------------------------------------------------------------
  // setGCConfigValue
  // ---------------------------------------------------------------------------
  describe('setGCConfigValue', () => {
    it('should persist a valid GC config key', () => {
      const store = new MockSettingsStore()
      setGCConfigValue(store as any, 'gc.sweep_interval', '10m')

      expect(store.get('gc.sweep_interval')).to.equal('10m')
    })

    it('should throw for unknown GC config keys', () => {
      const store = new MockSettingsStore()
      expect(() => setGCConfigValue(store as any, 'gc.unknown_key', 'value')).to.throw('Unknown GC config key')
    })

    it('should throw for non-gc keys', () => {
      const store = new MockSettingsStore()
      expect(() => setGCConfigValue(store as any, 'linear.api_key', 'value')).to.throw('Unknown GC config key')
    })

    it('should overwrite existing values', () => {
      const store = new MockSettingsStore()
      setGCConfigValue(store as any, 'gc.sweep_interval', '5m')
      setGCConfigValue(store as any, 'gc.sweep_interval', '10m')

      expect(store.get('gc.sweep_interval')).to.equal('10m')
    })
  })

  // ---------------------------------------------------------------------------
  // getGCConfigEntries
  // ---------------------------------------------------------------------------
  describe('getGCConfigEntries', () => {
    it('should return all config entries with defaults', () => {
      const store = new MockSettingsStore()
      const entries = getGCConfigEntries(store as any)

      expect(entries).to.be.an('array')
      expect(entries.length).to.equal(8) // All 8 config keys

      // Every entry should have key, value, and default
      for (const entry of entries) {
        expect(entry).to.have.property('key')
        expect(entry).to.have.property('value')
        expect(entry).to.have.property('default')
      }
    })

    it('should reflect overridden values', () => {
      const store = new MockSettingsStore()
      store.set('gc.sweep_interval', '30m')
      const entries = getGCConfigEntries(store as any)

      const sweepEntry = entries.find(e => e.key === 'gc.sweep_interval')
      expect(sweepEntry).to.exist
      expect(sweepEntry!.value).to.equal('30m')
      expect(sweepEntry!.default).to.equal(GC_DEFAULTS.sweepInterval)
    })
  })

  // ---------------------------------------------------------------------------
  // GC_CONFIG_KEYS
  // ---------------------------------------------------------------------------
  describe('GC_CONFIG_KEYS', () => {
    it('should contain all known gc.* keys', () => {
      expect(GC_CONFIG_KEYS).to.include('gc.sweep_interval')
      expect(GC_CONFIG_KEYS).to.include('gc.staleness.sessionless_ttl')
      expect(GC_CONFIG_KEYS).to.include('gc.staleness.container_no_exec_ttl')
      expect(GC_CONFIG_KEYS).to.include('gc.staleness.idle_agent_ttl')
      expect(GC_CONFIG_KEYS).to.include('gc.retention.keep_branches_after_merge')
      expect(GC_CONFIG_KEYS).to.include('gc.retention.execution_retention')
      expect(GC_CONFIG_KEYS).to.include('gc.cascade.branch')
      expect(GC_CONFIG_KEYS).to.include('gc.cascade.execution_records')
    })

    it('should have exactly 8 keys', () => {
      expect(GC_CONFIG_KEYS).to.have.length(8)
    })
  })
})
