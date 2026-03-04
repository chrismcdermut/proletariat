import { expect } from 'chai'
import {
  buildOrchestratorSessionName,
  resolveOrchestratorName,
  buildOrchestratorAttachCommand,
} from '../../src/commands/orchestrator/start.js'

describe('orchestrator start name handling', () => {
  describe('resolveOrchestratorName', () => {
    it('defaults to main when omitted', () => {
      expect(resolveOrchestratorName(undefined)).to.equal('main')
    })

    it('defaults to main when empty or whitespace', () => {
      expect(resolveOrchestratorName('')).to.equal('main')
      expect(resolveOrchestratorName('   ')).to.equal('main')
    })

    it('preserves non-empty names', () => {
      expect(resolveOrchestratorName('ops')).to.equal('ops')
      expect(resolveOrchestratorName('  support  ')).to.equal('support')
    })
  })

  describe('buildOrchestratorSessionName', () => {
    it('builds HQ-scoped session for main', () => {
      expect(buildOrchestratorSessionName('proletariat', 'main')).to.equal('prlt-orchestrator-proletariat-main')
    })

    it('builds HQ-scoped session for named orchestrator', () => {
      expect(buildOrchestratorSessionName('proletariat', 'ops')).to.equal('prlt-orchestrator-proletariat-ops')
    })
  })

  describe('buildOrchestratorAttachCommand', () => {
    it('uses default attach command for main', () => {
      expect(buildOrchestratorAttachCommand('main')).to.equal('prlt orchestrator attach')
    })

    it('includes --name for non-main sessions', () => {
      expect(buildOrchestratorAttachCommand('ops')).to.equal('prlt orchestrator attach --name ops')
    })
  })
})
