/* eslint-disable max-nested-callbacks */
import { expect } from 'chai'
import { detectState } from '../../src/commands/session/health.js'

describe('Session Health Detection', () => {
  describe('detectState', () => {
    it('should return UNKNOWN for null content', () => {
      expect(detectState(null)).to.equal('UNKNOWN')
    })

    it('should return UNKNOWN for empty string', () => {
      expect(detectState('')).to.equal('UNKNOWN')
    })

    // =====================================================================
    // HUNG detection
    // =====================================================================
    describe('HUNG state', () => {
      it('should detect HUNG when pane shows "↓ 0 tokens"', () => {
        const pane = [
          '  some previous output',
          '  ↓ 0 tokens',
          '',
        ].join('\n')
        expect(detectState(pane)).to.equal('HUNG')
      })

      it('should detect HUNG when pane shows "0 tokens" without arrow', () => {
        const pane = [
          '  Tool result output here',
          '  0 tokens  |  2.5k context',
          '',
        ].join('\n')
        expect(detectState(pane)).to.equal('HUNG')
      })

      it('should detect HUNG from realistic stuck Claude Code output', () => {
        const pane = [
          '⏺ I\'ll now run the tests to verify.',
          '',
          '  $ cd /workspace && pnpm test',
          '',
          '  ↓ 0 tokens  |  12.4k context  |  3m 42s',
        ].join('\n')
        expect(detectState(pane)).to.equal('HUNG')
      })
    })

    // =====================================================================
    // WORKING detection
    // =====================================================================
    describe('WORKING state', () => {
      it('should detect WORKING when pane shows "esc to interrupt"', () => {
        const pane = [
          '⏺ Writing file src/index.ts',
          '',
          '  esc to interrupt',
        ].join('\n')
        expect(detectState(pane)).to.equal('WORKING')
      })

      it('should detect WORKING case-insensitively', () => {
        const pane = [
          'Processing...',
          'Esc to interrupt',
        ].join('\n')
        expect(detectState(pane)).to.equal('WORKING')
      })
    })

    // =====================================================================
    // DONE detection
    // =====================================================================
    describe('DONE state', () => {
      it('should detect DONE when pane shows "Agent work complete"', () => {
        const pane = [
          'All tasks completed.',
          'Agent work complete',
        ].join('\n')
        expect(detectState(pane)).to.equal('DONE')
      })

      it('should detect DONE when pane shows "work ready"', () => {
        const pane = [
          'PR created successfully.',
          'Work ready for review.',
        ].join('\n')
        expect(detectState(pane)).to.equal('DONE')
      })

      it('should detect DONE case-insensitively', () => {
        const pane = [
          'AGENT WORK COMPLETE',
        ].join('\n')
        expect(detectState(pane)).to.equal('DONE')
      })
    })

    // =====================================================================
    // IDLE detection
    // =====================================================================
    describe('IDLE state', () => {
      it('should detect IDLE when last line is a shell prompt ($)', () => {
        const pane = [
          'Last command output',
          'user@host:~/workspace$',
        ].join('\n')
        expect(detectState(pane)).to.equal('IDLE')
      })

      it('should detect IDLE when last line is a zsh prompt (❯)', () => {
        const pane = [
          'Last command output',
          '~/workspace ❯',
        ].join('\n')
        expect(detectState(pane)).to.equal('IDLE')
      })

      it('should detect IDLE with trailing space after prompt', () => {
        const pane = [
          'Output',
          'user@host:~$ ',
        ].join('\n')
        expect(detectState(pane)).to.equal('IDLE')
      })

      it('should detect IDLE when prompt has # (root)', () => {
        const pane = [
          'root@container:/workspace#',
        ].join('\n')
        expect(detectState(pane)).to.equal('IDLE')
      })

      it('should detect IDLE ignoring trailing empty lines', () => {
        const pane = [
          'user@host:~$',
          '',
          '',
        ].join('\n')
        expect(detectState(pane)).to.equal('IDLE')
      })
    })

    // =====================================================================
    // Priority ordering
    // =====================================================================
    describe('priority ordering', () => {
      it('should prioritize HUNG over WORKING when both patterns present', () => {
        const pane = [
          '  esc to interrupt',
          '  ↓ 0 tokens',
        ].join('\n')
        expect(detectState(pane)).to.equal('HUNG')
      })

      it('should prioritize HUNG over IDLE', () => {
        const pane = [
          '  0 tokens',
          'user@host:~$',
        ].join('\n')
        expect(detectState(pane)).to.equal('HUNG')
      })

      it('should prioritize WORKING over DONE', () => {
        const pane = [
          'Agent work complete',
          'New task started',
          'esc to interrupt',
        ].join('\n')
        expect(detectState(pane)).to.equal('WORKING')
      })
    })

    // =====================================================================
    // Edge cases
    // =====================================================================
    describe('edge cases', () => {
      it('should return UNKNOWN for unrecognized output', () => {
        const pane = [
          'Some random output',
          'that does not match any pattern',
        ].join('\n')
        expect(detectState(pane)).to.equal('UNKNOWN')
      })

      it('should handle very long pane content', () => {
        const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: output`)
        lines.push('  ↓ 0 tokens')
        expect(detectState(lines.join('\n'))).to.equal('HUNG')
      })

      it('should only check last 10 lines for patterns', () => {
        const lines = ['  ↓ 0 tokens']
        for (let i = 0; i < 15; i++) {
          lines.push(`Normal output line ${i}`)
        }
        expect(detectState(lines.join('\n'))).to.equal('UNKNOWN')
      })
    })
  })
})
