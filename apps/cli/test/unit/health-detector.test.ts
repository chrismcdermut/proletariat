import { expect } from 'chai'
import {
  detectState,
  countByState,
  formatHealthSummary,
  type AgentHealthState,
} from '../../src/lib/session/health-detector.js'

describe('Health Detector (shared module)', () => {
  // detectState is already tested in session-health.test.ts via re-export.
  // Here we verify the module is importable and test the new aggregation functions.

  describe('detectState (from shared module)', () => {
    it('should return UNKNOWN for null content', () => {
      expect(detectState(null)).to.equal('UNKNOWN')
    })

    it('should detect WORKING state', () => {
      expect(detectState('processing\nesc to interrupt')).to.equal('WORKING')
    })

    it('should detect HUNG state', () => {
      expect(detectState('stuck\n0 tokens')).to.equal('HUNG')
    })

    it('should detect DONE state', () => {
      expect(detectState('Agent work complete')).to.equal('DONE')
    })

    it('should detect IDLE state', () => {
      expect(detectState('user@host:~$')).to.equal('IDLE')
    })
  })

  describe('countByState', () => {
    it('should count empty array', () => {
      const counts = countByState([])
      expect(counts.total).to.equal(0)
      expect(counts.working).to.equal(0)
      expect(counts.idle).to.equal(0)
      expect(counts.hung).to.equal(0)
      expect(counts.done).to.equal(0)
      expect(counts.unknown).to.equal(0)
    })

    it('should count single state', () => {
      const counts = countByState(['WORKING'])
      expect(counts.total).to.equal(1)
      expect(counts.working).to.equal(1)
    })

    it('should count mixed states', () => {
      const states: AgentHealthState[] = [
        'WORKING', 'WORKING', 'WORKING',
        'IDLE', 'IDLE', 'IDLE', 'IDLE',
        'HUNG',
        'DONE', 'DONE',
        'UNKNOWN',
      ]
      const counts = countByState(states)
      expect(counts.total).to.equal(11)
      expect(counts.working).to.equal(3)
      expect(counts.idle).to.equal(4)
      expect(counts.hung).to.equal(1)
      expect(counts.done).to.equal(2)
      expect(counts.unknown).to.equal(1)
    })

    it('should count all same state', () => {
      const states: AgentHealthState[] = Array(50).fill('IDLE')
      const counts = countByState(states)
      expect(counts.total).to.equal(50)
      expect(counts.idle).to.equal(50)
      expect(counts.working).to.equal(0)
    })
  })

  describe('formatHealthSummary', () => {
    it('should return "0 agents" for empty counts', () => {
      const result = formatHealthSummary({
        total: 0, working: 0, idle: 0, hung: 0, done: 0, unknown: 0,
      })
      expect(result).to.equal('0 agents')
    })

    it('should show only non-zero counts', () => {
      const result = formatHealthSummary({
        total: 50, working: 3, idle: 47, hung: 0, done: 0, unknown: 0,
      })
      expect(result).to.equal('3 working, 47 idle')
    })

    it('should order: working, hung, idle, done, unknown', () => {
      const result = formatHealthSummary({
        total: 5, working: 1, hung: 1, idle: 1, done: 1, unknown: 1,
      })
      expect(result).to.equal('1 working, 1 hung, 1 idle, 1 done, 1 unknown')
    })

    it('should handle ticket scenario: 3 working, 47 idle', () => {
      const result = formatHealthSummary({
        total: 50, working: 3, idle: 47, hung: 0, done: 0, unknown: 0,
      })
      expect(result).to.include('3 working')
      expect(result).to.include('47 idle')
      expect(result).not.to.include('hung')
    })

    it('should show single category', () => {
      const result = formatHealthSummary({
        total: 10, working: 0, idle: 0, hung: 10, done: 0, unknown: 0,
      })
      expect(result).to.equal('10 hung')
    })
  })
})
