import { expect } from 'chai'
import * as os from 'node:os'
import {
  buildSrtCommand,
  isSrtInstalled,
} from '../../src/lib/execution/runners/sandbox.js'
import type { ExecutionContext, ExecutionConfig } from '../../src/lib/execution/types.js'
import { DEFAULT_EXECUTION_CONFIG } from '../../src/lib/execution/types.js'

/**
 * Smoke tests for the sandbox runner — srt command generation and environment setup.
 * TKT-140: Close coverage gaps in execution runner modules.
 */

const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
  ticketId: 'TKT-777',
  ticketTitle: 'Sandbox test',
  agentName: 'sandbox-agent',
  agentDir: '/tmp/agent',
  worktreePath: '/tmp/worktree',
  branch: 'TKT-777/test',
  ...overrides,
})

describe('Sandbox Runner (TKT-140)', () => {
  // =========================================================================
  // isSrtInstalled
  // =========================================================================
  describe('isSrtInstalled', () => {
    it('should return a boolean', () => {
      expect(isSrtInstalled()).to.be.a('boolean')
    })

    it('should not throw', () => {
      expect(() => isSrtInstalled()).to.not.throw()
    })
  })

  // =========================================================================
  // buildSrtCommand
  // =========================================================================
  describe('buildSrtCommand', () => {
    const config: ExecutionConfig = {
      ...DEFAULT_EXECUTION_CONFIG,
      sandbox: {
        allowReadPaths: ['/usr/share/data'],
        allowWritePaths: ['/tmp/output'],
        networkDomains: ['github.com', 'api.anthropic.com'],
        fallbackToHost: true,
      },
      firewall: {
        allowlistDomains: ['registry.npmjs.org'],
      },
    }

    it('should start with "srt"', () => {
      const cmd = buildSrtCommand('bash -c "echo hello"', makeContext(), config)
      expect(cmd).to.match(/^srt /)
    })

    it('should include --fs-write for worktree path', () => {
      const cmd = buildSrtCommand('echo', makeContext(), config)
      expect(cmd).to.include('--fs-write=/tmp/worktree')
    })

    it('should include --fs-write for agent dir when different from worktree', () => {
      const ctx = makeContext({ agentDir: '/tmp/different-agent', worktreePath: '/tmp/worktree' })
      const cmd = buildSrtCommand('echo', ctx, config)
      expect(cmd).to.include('--fs-write=/tmp/different-agent')
    })

    it('should NOT include agent dir when same as worktree', () => {
      const ctx = makeContext({ agentDir: '/tmp/worktree', worktreePath: '/tmp/worktree' })
      const cmd = buildSrtCommand('echo', ctx, config)
      // Should only appear once (for worktree)
      const matches = cmd.match(/--fs-write=\/tmp\/worktree/g)
      expect(matches).to.have.lengthOf(1)
    })

    it('should include --fs-write for HQ scripts directory', () => {
      const ctx = makeContext({ hqPath: '/workspace/hq' })
      const cmd = buildSrtCommand('echo', ctx, config)
      expect(cmd).to.include('--fs-write=/workspace/hq/.proletariat/scripts')
    })

    it('should include --fs-read for configured read paths', () => {
      const cmd = buildSrtCommand('echo', makeContext(), config)
      expect(cmd).to.include('--fs-read=/usr/share/data')
    })

    it('should include --fs-write for configured write paths', () => {
      const cmd = buildSrtCommand('echo', makeContext(), config)
      expect(cmd).to.include('--fs-write=/tmp/output')
    })

    it('should include --fs-write for temp directory', () => {
      const cmd = buildSrtCommand('echo', makeContext(), config)
      expect(cmd).to.include(`--fs-write=${os.tmpdir()}`)
    })

    it('should include --net-allow for sandbox network domains', () => {
      const cmd = buildSrtCommand('echo', makeContext(), config)
      expect(cmd).to.include('--net-allow=github.com')
      expect(cmd).to.include('--net-allow=api.anthropic.com')
    })

    it('should merge firewall allowlist domains with sandbox domains', () => {
      const cmd = buildSrtCommand('echo', makeContext(), config)
      expect(cmd).to.include('--net-allow=registry.npmjs.org')
    })

    it('should deduplicate domains that appear in both lists', () => {
      const dupConfig: ExecutionConfig = {
        ...config,
        sandbox: { ...config.sandbox, networkDomains: ['github.com'] },
        firewall: { allowlistDomains: ['github.com'] },
      }
      const cmd = buildSrtCommand('echo', makeContext(), dupConfig)
      const matches = cmd.match(/--net-allow=github\.com/g)
      expect(matches).to.have.lengthOf(1)
    })

    it('should include -- separator before inner command', () => {
      const cmd = buildSrtCommand('bash -c "echo hello"', makeContext(), config)
      expect(cmd).to.include('-- bash -c "echo hello"')
    })

    it('should place inner command at the end', () => {
      const inner = 'my-command --flag value'
      const cmd = buildSrtCommand(inner, makeContext(), config)
      expect(cmd).to.match(new RegExp(`-- ${inner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    })
  })
})
