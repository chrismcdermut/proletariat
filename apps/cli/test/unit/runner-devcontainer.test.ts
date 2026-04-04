import { expect } from 'chai'
import { buildDevcontainerCommand } from '../../src/lib/execution/runners/devcontainer.js'
import type { ExecutionContext, ExecutorType, PermissionMode, OutputMode, DisplayMode } from '../../src/lib/execution/types.js'

/**
 * Smoke tests for devcontainer runner — command string generation and environment setup.
 * TKT-140: Close coverage gaps in execution runner modules.
 */

const makeContext = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
  ticketId: 'TKT-600',
  ticketTitle: 'Devcontainer test',
  agentName: 'dc-agent',
  agentDir: '/tmp/agent',
  worktreePath: '/tmp/agent/repo',
  branch: 'TKT-600/test',
  ...overrides,
})

describe('Devcontainer Runner (TKT-140)', () => {
  describe('buildDevcontainerCommand', () => {
    const promptFile = '/workspace/repo/.prlt-prompt.txt'
    const containerId = 'abc123def456'

    // =========================================================================
    // Claude Code executor
    // =========================================================================
    describe('claude-code executor', () => {
      it('should generate docker exec command with claude', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId)
        expect(cmd).to.include('docker exec')
        expect(cmd).to.include(containerId)
        expect(cmd).to.include('claude')
      })

      it('should include --permission-mode bypassPermissions by default', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId)
        expect(cmd).to.include('--permission-mode bypassPermissions')
      })

      it('should include --dangerously-skip-permissions in danger mode', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId, 'interactive', 'danger')
        expect(cmd).to.include('--dangerously-skip-permissions')
      })

      it('should NOT include --dangerously-skip-permissions in safe mode', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId, 'interactive', 'safe')
        expect(cmd).to.not.include('--dangerously-skip-permissions')
      })

      it('should always include -p flag for container agents (PRLT-1240)', () => {
        // -p (print) mode skips all onboarding prompts and exits cleanly
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId, 'interactive')
        expect(cmd).to.include('-p ')
      })

      it('should include -p flag regardless of output mode', () => {
        const cmdPrint = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId, 'print')
        const cmdInteractive = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId, 'interactive')
        expect(cmdPrint).to.include('-p ')
        expect(cmdInteractive).to.include('-p ')
      })

      it('should include --disallowedTools EnterPlanMode for background display', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId, 'interactive', 'safe', 'background')
        expect(cmd).to.include('--disallowedTools EnterPlanMode')
      })

      it('should NOT include --disallowedTools for terminal display', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId, 'interactive', 'safe', 'terminal')
        expect(cmd).to.not.include('--disallowedTools')
      })

      it('should include --effort high always', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId)
        expect(cmd).to.include('--effort high')
      })

      it('should read prompt from file with $(cat ...)', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId)
        expect(cmd).to.include(`$(cat ${promptFile})`)
      })

      it('should include -- separator before prompt argument', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId)
        expect(cmd).to.include('-- "$(cat')
      })

      it('should include --mcp-config when provided', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId, 'interactive', 'safe', 'terminal', '/workspace/.mcp.json')
        expect(cmd).to.include('--mcp-config /workspace/.mcp.json')
      })

      it('should NOT include --mcp-config when not provided', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId)
        expect(cmd).to.not.include('--mcp-config')
      })

      it('should cleanup prompt file after execution', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId)
        expect(cmd).to.include(`rm -f ${promptFile}`)
      })
    })

    // =========================================================================
    // PRLT-1240: -p flag always present + background-specific flags
    // =========================================================================
    describe('background display mode (PRLT-1119, PRLT-1240)', () => {
      it('should include -p flag and --disallowedTools for background display', () => {
        const cmd = buildDevcontainerCommand(
          makeContext(), 'claude-code', promptFile, containerId,
          'print', 'danger', 'background'
        )
        expect(cmd).to.include('-p ')
        expect(cmd).to.include('--disallowedTools EnterPlanMode')
      })

      it('should NOT include -it flags for background display', () => {
        const cmd = buildDevcontainerCommand(
          makeContext(), 'claude-code', promptFile, containerId,
          'print', 'danger', 'background'
        )
        expect(cmd).to.not.include('-it')
      })

      it('should still include -p flag for background even in safe permission mode', () => {
        const cmd = buildDevcontainerCommand(
          makeContext(), 'claude-code', promptFile, containerId,
          'print', 'safe', 'background'
        )
        expect(cmd).to.include('-p ')
      })
    })

    // =========================================================================
    // Codex executor
    // =========================================================================
    describe('codex executor', () => {
      it('should generate codex command', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'codex', promptFile, containerId, 'interactive', 'danger', 'background')
        expect(cmd).to.include('codex')
      })

      it('should NOT include Claude-specific flags for codex', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'codex', promptFile, containerId, 'interactive', 'danger', 'background')
        expect(cmd).to.not.include('--permission-mode bypassPermissions')
        expect(cmd).to.not.include('--dangerously-skip-permissions')
      })

      it('should include --yolo in danger mode', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'codex', promptFile, containerId, 'interactive', 'danger', 'background')
        expect(cmd).to.include('--yolo')
      })
    })

    // =========================================================================
    // Custom executor
    // =========================================================================
    describe('custom executor', () => {
      it('should generate echo fallback command', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'custom', promptFile, containerId)
        expect(cmd).to.include('echo')
      })
    })

    // =========================================================================
    // TTY and cd behavior
    // =========================================================================
    describe('tty and directory', () => {
      it('should include -it flags for terminal display mode', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId, 'interactive', 'safe', 'terminal')
        expect(cmd).to.include('-it ')
      })

      it('should NOT include -it flags for background display mode', () => {
        const cmd = buildDevcontainerCommand(makeContext(), 'claude-code', promptFile, containerId, 'interactive', 'safe', 'background')
        expect(cmd).to.not.include('-it')
      })

      it('should cd to relative workspace path when worktree is subdirectory of agentDir', () => {
        const ctx = makeContext({ agentDir: '/tmp/agent', worktreePath: '/tmp/agent/myrepo' })
        const cmd = buildDevcontainerCommand(ctx, 'claude-code', promptFile, containerId)
        expect(cmd).to.include('cd /workspace/myrepo')
      })

      it('should NOT cd when worktree IS the agentDir', () => {
        const ctx = makeContext({ agentDir: '/tmp/agent', worktreePath: '/tmp/agent' })
        const cmd = buildDevcontainerCommand(ctx, 'claude-code', promptFile, containerId)
        expect(cmd).to.not.include('cd /workspace/')
      })
    })
  })
})
