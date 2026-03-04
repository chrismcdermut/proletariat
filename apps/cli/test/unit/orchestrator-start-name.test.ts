import { expect } from 'chai'
import {
  buildOrchestratorSessionName,
  resolveOrchestratorName,
  buildOrchestratorAttachCommand,
  extractOrchestratorNameFromSession,
  collectReservedOrchestratorNames,
  buildAvailableOrchestratorNames,
  findGlobalOrchestratorNameConflict,
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

  describe('extractOrchestratorNameFromSession', () => {
    it('extracts name for matching HQ session', () => {
      expect(extractOrchestratorNameFromSession('prlt-orchestrator-proletariat-main', 'proletariat')).to.equal('main')
    })

    it('returns null for different HQ session', () => {
      expect(extractOrchestratorNameFromSession('prlt-orchestrator-other-main', 'proletariat')).to.equal(null)
    })
  })

  describe('collectReservedOrchestratorNames', () => {
    it('includes normalized agent and orchestrator names', () => {
      const reserved = collectReservedOrchestratorNames(
        ['Altman', 'blue-khosla'],
        ['prlt-orchestrator-proletariat-main', 'prlt-orchestrator-proletariat-ops'],
        'proletariat',
      )

      expect(Array.from(reserved).sort()).to.deep.equal(['altman', 'blue-khosla', 'main', 'ops'])
    })
  })

  describe('buildAvailableOrchestratorNames', () => {
    it('starts from main when no names are reserved', () => {
      expect(buildAvailableOrchestratorNames(new Set())).to.deep.equal(['main'])
    })

    it('suggests incremented names from reserved set', () => {
      const names = buildAvailableOrchestratorNames(new Set(['main', 'ops', 'altman']), 4)
      expect(names).to.deep.equal(['main-2', 'altman-2', 'main-3', 'ops-2'])
    })
  })

  describe('findGlobalOrchestratorNameConflict', () => {
    it('returns normalized conflicting name when reserved', () => {
      expect(findGlobalOrchestratorNameConflict(' Altman ', new Set(['altman']))).to.equal('altman')
    })

    it('returns null when name is available', () => {
      expect(findGlobalOrchestratorNameConflict('ops', new Set(['main', 'altman']))).to.equal(null)
    })
  })
})
