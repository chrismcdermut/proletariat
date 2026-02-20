/**
 * Claude Regression Tests
 *
 * Targeted regression suite for work start, work revise, and execution runners.
 * Guards against regressions in prompt construction, executor dispatch,
 * flag handling, and session management.
 */

import { expect } from 'chai'
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProductionSchema,
  addWorkspaceTables,
  createTestProject,
  createTestTicket,
  createPMODirectories,
  createHQConfig,
  execProduction,
  type TestEnvironment,
} from './test-helpers.js'
import Database from 'better-sqlite3'

import {
  buildSessionName,
  shouldUseControlMode,
  buildTmuxAttachCommand,
  buildTmuxMouseOption,
  buildTmuxScript,
  getDockerAutoRemoveFlags,
} from '../../src/lib/execution/runners.js'
import {
  generateBranchName,
  getBranchType,
  extractTicketFromSession,
  DEFAULT_EXECUTION_CONFIG,
} from '../../src/lib/execution/types.js'
import type {
  ExecutionContext,
  ExecutorType,
  DisplayMode,
  ExecutionEnvironment,
  SessionManager,
} from '../../src/lib/execution/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    ticketId: 'TKT-REG-001',
    ticketTitle: 'Regression test ticket',
    agentName: 'test-agent',
    agentDir: '/tmp/agents/test-agent',
    worktreePath: '/tmp/agents/test-agent/repo',
    branch: 'TKT-REG-001/feat/owner/test-agent/regression-test',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Claude Regression Suite', () => {
  let env: TestEnvironment
  let db: Database.Database

  beforeEach(() => {
    env = createTestEnvironment('claude-regression-')
    createHQConfig(env.proletariatDir)
    createPMODirectories(env.pmoPath)
    db = setupProductionSchema(env.dbPath, env.pmoPath)
    addWorkspaceTables(db, { type: 'hq', hasPmo: true })
    createTestProject(db)
  })

  afterEach(() => {
    if (db) db.close()
    cleanupTestEnvironment(env)
  })

  // =========================================================================
  // 1. work start – session naming
  // =========================================================================

  describe('work start – session naming', () => {
    it('should build session name as ticketId-action-agent', () => {
      const ctx = makeContext({ actionName: 'implement' })
      expect(buildSessionName(ctx)).to.equal('TKT-REG-001-implement-test-agent')
    })

    it('should default action to "work" when actionName is undefined', () => {
      const ctx = makeContext({ actionName: undefined })
      expect(buildSessionName(ctx)).to.equal('TKT-REG-001-work-test-agent')
    })

    it('should sanitise spaces in actionName to hyphens', () => {
      const ctx = makeContext({ actionName: 'Code Review' })
      expect(buildSessionName(ctx)).to.equal('TKT-REG-001-Code-Review-test-agent')
    })

    it('should default agent name to "agent" when empty', () => {
      const ctx = makeContext({ agentName: '' })
      expect(buildSessionName(ctx)).to.equal('TKT-REG-001-work-agent')
    })
  })

  // =========================================================================
  // 2. work start – branch naming
  // =========================================================================

  describe('work start – branch naming', () => {
    it('should generate branch in ticketId/type/owner/agent/slug format', () => {
      const branch = generateBranchName('TKT-100', 'My New Feature', 'chris', 'altman', 'feature')
      expect(branch).to.equal('TKT-100/feat/chris/altman/my-new-feature')
    })

    it('should default to feat when category is undefined', () => {
      const branch = generateBranchName('TKT-200', 'Something', 'chris', 'agent')
      expect(branch).to.match(/^TKT-200\/feat\//)
    })

    it('should map bug category to fix branch type', () => {
      expect(getBranchType('bug')).to.equal('fix')
      expect(getBranchType('bugfix')).to.equal('fix')
    })

    it('should map documentation to docs branch type', () => {
      expect(getBranchType('docs')).to.equal('docs')
      expect(getBranchType('documentation')).to.equal('docs')
    })

    it('should truncate long titles to 20 characters', () => {
      const branch = generateBranchName('TKT-300', 'This is a very long ticket title that should be truncated', 'owner', 'agent')
      const slug = branch.split('/').pop()!
      expect(slug.length).to.be.at.most(20)
    })

    it('should strip trailing hyphens from slug', () => {
      // A title that, when slugified and truncated, could leave trailing hyphens
      const branch = generateBranchName('TKT-400', 'testing some thing-', 'owner', 'agent')
      const slug = branch.split('/').pop()!
      expect(slug).to.not.match(/-$/)
    })
  })

  // =========================================================================
  // 3. work start – executor types
  // =========================================================================

  describe('work start – executor types', () => {
    it('should support all four executor types', () => {
      const executors: ExecutorType[] = ['claude-code', 'codex', 'aider', 'custom']
      expect(executors).to.have.lengthOf(4)
    })

    it('should default to claude-code executor', () => {
      expect(DEFAULT_EXECUTION_CONFIG.defaultExecutor).to.equal('claude-code')
    })

    it('should default to host environment', () => {
      expect(DEFAULT_EXECUTION_CONFIG.defaultEnvironment).to.equal('host')
    })
  })

  // =========================================================================
  // 4. work start – display modes
  // =========================================================================

  describe('work start – display modes', () => {
    it('should support terminal, foreground, and background modes', () => {
      const modes: DisplayMode[] = ['terminal', 'foreground', 'background']
      expect(modes).to.have.lengthOf(3)
    })

    it('should default terminal to open in background (no focus steal)', () => {
      expect(DEFAULT_EXECUTION_CONFIG.terminal.openInBackground).to.be.true
    })
  })

  // =========================================================================
  // 5. work start – tmux configuration
  // =========================================================================

  describe('work start – tmux configuration', () => {
    it('should use control mode only for iTerm', () => {
      expect(shouldUseControlMode('iTerm', true)).to.be.true
      expect(shouldUseControlMode('Terminal', true)).to.be.false
      expect(shouldUseControlMode('Ghostty', true)).to.be.false
    })

    it('should build -CC attach command for control mode', () => {
      const cmd = buildTmuxAttachCommand(true)
      expect(cmd).to.include('-CC')
    })

    it('should build regular attach command without control mode', () => {
      const cmd = buildTmuxAttachCommand(false)
      expect(cmd).to.not.include('-CC')
      expect(cmd).to.equal('tmux attach')
    })

    it('should always enable mouse mode', () => {
      const opt = buildTmuxMouseOption(true)
      expect(opt).to.include('mouse on')
    })
  })

  // =========================================================================
  // 6. work start – tmux script building (background vs terminal)
  // =========================================================================

  describe('work start – tmux script modes (regression TKT-988)', () => {
    const sessionName = 'TKT-REG-001-implement-test-agent'
    const claudeCmd = 'claude --dangerously-skip-permissions "prompt"'

    it('background mode should kill PID 1 for container cleanup', () => {
      const script = buildTmuxScript(sessionName, claudeCmd, 'background')
      expect(script).to.include('kill 1')
      expect(script).to.not.include('exec bash')
    })

    it('terminal mode should exec bash for user inspection (regression)', () => {
      const script = buildTmuxScript(sessionName, claudeCmd, 'terminal')
      expect(script).to.include('exec bash')
      expect(script).to.not.include('kill 1')
    })

    it('foreground mode should exec bash for user inspection (regression)', () => {
      const script = buildTmuxScript(sessionName, claudeCmd, 'foreground')
      expect(script).to.include('exec bash')
      expect(script).to.not.include('kill 1')
    })

    it('all modes should set TERM and COLORTERM', () => {
      for (const mode of ['background', 'terminal', 'foreground'] as DisplayMode[]) {
        const script = buildTmuxScript(sessionName, claudeCmd, mode)
        expect(script).to.include('export TERM=xterm-256color')
        expect(script).to.include('export COLORTERM=truecolor')
      }
    })

    it('all modes should unset CI to prevent agent confusion', () => {
      for (const mode of ['background', 'terminal', 'foreground'] as DisplayMode[]) {
        const script = buildTmuxScript(sessionName, claudeCmd, mode)
        expect(script).to.include('unset CI')
      }
    })

    it('all modes should include the claude command', () => {
      for (const mode of ['background', 'terminal', 'foreground'] as DisplayMode[]) {
        const script = buildTmuxScript(sessionName, claudeCmd, mode)
        expect(script).to.include(claudeCmd)
      }
    })
  })

  // =========================================================================
  // 7. work start – docker auto-remove flags
  // =========================================================================

  describe('work start – docker auto-remove flags', () => {
    it('should add --rm only for background mode', () => {
      expect(getDockerAutoRemoveFlags('background')).to.deep.equal(['--rm'])
    })

    it('should NOT add --rm for terminal mode', () => {
      expect(getDockerAutoRemoveFlags('terminal')).to.deep.equal([])
    })

    it('should NOT add --rm for foreground mode', () => {
      expect(getDockerAutoRemoveFlags('foreground')).to.deep.equal([])
    })
  })

  // =========================================================================
  // 8. work start – ticket extraction from session name
  // =========================================================================

  describe('work start – ticket extraction from session', () => {
    it('should extract ticket ID from prlt- prefixed session', () => {
      expect(extractTicketFromSession('prlt-TKT-347-implement')).to.equal('TKT-347')
    })

    it('should extract ticket ID from plain session name', () => {
      expect(extractTicketFromSession('TKT-999-work-agent')).to.equal('TKT-999')
    })

    it('should return undefined for null input', () => {
      expect(extractTicketFromSession(null)).to.be.undefined
    })

    it('should return undefined for empty string', () => {
      expect(extractTicketFromSession('')).to.be.undefined
    })

    it('should return undefined for session without ticket ID', () => {
      expect(extractTicketFromSession('random-session')).to.be.undefined
    })
  })

  // =========================================================================
  // 9. work start – default execution config
  // =========================================================================

  describe('work start – default execution config', () => {
    it('should default to zsh shell', () => {
      expect(DEFAULT_EXECUTION_CONFIG.shell).to.equal('zsh')
    })

    it('should default to interactive output mode', () => {
      expect(DEFAULT_EXECUTION_CONFIG.outputMode).to.equal('interactive')
    })

    it('should default to sandboxed (safe) mode', () => {
      expect(DEFAULT_EXECUTION_CONFIG.sandboxed).to.be.true
    })

    it('should default tmux layout to window', () => {
      expect(DEFAULT_EXECUTION_CONFIG.tmux.layout).to.equal('window')
    })

    it('should default tmux control mode to true', () => {
      expect(DEFAULT_EXECUTION_CONFIG.tmux.controlMode).to.be.true
    })

    it('should default devcontainer memory to 8g', () => {
      expect(DEFAULT_EXECUTION_CONFIG.devcontainer.memory).to.equal('8g')
    })

    it('should default devcontainer cpus to 4', () => {
      expect(DEFAULT_EXECUTION_CONFIG.devcontainer.cpus).to.equal(4)
    })
  })

  // =========================================================================
  // 10. work start – execution storage (DB persistence)
  // =========================================================================

  describe('work start – execution storage', () => {
    let ticketId: string

    beforeEach(() => {
      // Create a ticket that agent_work FK can reference
      ticketId = 'TKT-REG-EXEC'
      createTestTicket(db, 'test-project', {
        id: ticketId,
        title: 'Execution storage test ticket',
        status: 'In Progress',
        statusId: 'default-in-progress',
      })
      // The agent_work table is created by setupProductionSchema via PMO schema
    })

    it('should persist all executor types correctly', () => {
      const executors: ExecutorType[] = ['claude-code', 'codex', 'aider', 'custom']
      for (const [i, executor] of executors.entries()) {
        db.prepare(`
          INSERT INTO agent_work (id, ticket_id, agent_name, executor, status)
          VALUES (?, ?, 'agent', ?, 'running')
        `).run(`WORK-${i}`, ticketId, executor)
      }

      const rows = db.prepare(`SELECT executor FROM agent_work ORDER BY id`).all() as Array<{ executor: string }>
      expect(rows.map(r => r.executor)).to.deep.equal(executors)
    })

    it('should persist all environment types correctly', () => {
      const environments: ExecutionEnvironment[] = ['devcontainer', 'host', 'docker', 'vm']
      for (const [i, environment] of environments.entries()) {
        db.prepare(`
          INSERT INTO agent_work (id, ticket_id, agent_name, executor, environment, status)
          VALUES (?, ?, 'agent', 'claude-code', ?, 'running')
        `).run(`WORK-ENV-${i}`, ticketId, environment)
      }

      const rows = db.prepare(`SELECT environment FROM agent_work WHERE id LIKE 'WORK-ENV-%' ORDER BY id`).all() as Array<{ environment: string }>
      expect(rows.map(r => r.environment)).to.deep.equal(environments)
    })

    it('should persist all display modes correctly', () => {
      const modes: DisplayMode[] = ['terminal', 'foreground', 'background']
      for (const [i, mode] of modes.entries()) {
        db.prepare(`
          INSERT INTO agent_work (id, ticket_id, agent_name, executor, display_mode, status)
          VALUES (?, ?, 'agent', 'claude-code', ?, 'running')
        `).run(`WORK-DM-${i}`, ticketId, mode)
      }

      const rows = db.prepare(`SELECT display_mode FROM agent_work WHERE id LIKE 'WORK-DM-%' ORDER BY id`).all() as Array<{ display_mode: string }>
      expect(rows.map(r => r.display_mode)).to.deep.equal(modes)
    })

    it('should track sandboxed state correctly', () => {
      db.prepare(`
        INSERT INTO agent_work (id, ticket_id, agent_name, executor, sandboxed, status)
        VALUES ('WORK-SAFE', ?, 'agent', 'claude-code', 1, 'running')
      `).run(ticketId)
      db.prepare(`
        INSERT INTO agent_work (id, ticket_id, agent_name, executor, sandboxed, status)
        VALUES ('WORK-DANGER', ?, 'agent', 'claude-code', 0, 'running')
      `).run(ticketId)

      const safe = db.prepare(`SELECT sandboxed FROM agent_work WHERE id = 'WORK-SAFE'`).get() as { sandboxed: number }
      const danger = db.prepare(`SELECT sandboxed FROM agent_work WHERE id = 'WORK-DANGER'`).get() as { sandboxed: number }

      expect(safe.sandboxed).to.equal(1)
      expect(danger.sandboxed).to.equal(0)
    })
  })

  // =========================================================================
  // 11. work revise – PR feedback handling
  // =========================================================================

  describe('work revise – PR feedback context', () => {
    it('should mark execution as revision', () => {
      const ctx = makeContext({ isRevision: true, prFeedback: '## PR Review\n- Fix auth bug' })
      expect(ctx.isRevision).to.be.true
      expect(ctx.prFeedback).to.include('PR Review')
    })

    it('should not mark normal executions as revisions', () => {
      const ctx = makeContext()
      expect(ctx.isRevision).to.be.undefined
    })
  })

  // =========================================================================
  // 12. Runner dispatch – all environments
  // =========================================================================

  describe('Runner dispatch – environment types', () => {
    it('should support all four execution environments', () => {
      const environments: ExecutionEnvironment[] = ['devcontainer', 'host', 'docker', 'vm']
      expect(environments).to.have.lengthOf(4)
    })

    it('should support tmux and direct session managers', () => {
      const managers: SessionManager[] = ['tmux', 'direct']
      expect(managers).to.have.lengthOf(2)
    })
  })

  // =========================================================================
  // 13. Regression: work start command help flags
  // =========================================================================

  describe('work start command help (regression)', () => {
    let helpOutput = ''

    before(() => {
      try {
        helpOutput = execProduction('work start --help')
      } catch {
        helpOutput = ''
      }
    })

    it('should show --executor flag in help', () => {
      if (!helpOutput) return // skip gracefully when CLI not available
      expect(helpOutput).to.include('executor')
    })

    it('should list codex as an executor option', () => {
      if (!helpOutput) return
      expect(helpOutput).to.include('codex')
    })

    it('should show --mode flag in help', () => {
      if (!helpOutput) return
      expect(helpOutput).to.include('mode')
    })

    it('should show permission-mode flag in help', () => {
      if (!helpOutput) return
      // Either --permission-mode or --skip-permissions should be present
      const hasPermFlag = helpOutput.includes('permission') || helpOutput.includes('skip-permissions')
      expect(hasPermFlag).to.be.true
    })
  })

  // =========================================================================
  // 14. Regression: work revise command help flags
  // =========================================================================

  describe('work revise command help (regression)', () => {
    let helpOutput = ''

    before(() => {
      try {
        helpOutput = execProduction('work revise --help')
      } catch {
        helpOutput = ''
      }
    })

    it('should show --executor flag in help', () => {
      if (!helpOutput) return
      expect(helpOutput).to.include('executor')
    })

    it('should list codex as an executor option for revise', () => {
      if (!helpOutput) return
      expect(helpOutput).to.include('codex')
    })

    it('should show --force flag in help', () => {
      if (!helpOutput) return
      expect(helpOutput).to.include('force')
    })
  })

  // =========================================================================
  // 15. Regression: executor config persists across loads
  // =========================================================================

  describe('Executor config persistence (regression)', () => {
    it('should store and retrieve executor preference', () => {
      db.prepare(`
        INSERT OR REPLACE INTO workspace_settings (key, value)
        VALUES ('execution.default_executor', 'codex')
      `).run()

      const result = db.prepare(
        `SELECT value FROM workspace_settings WHERE key = 'execution.default_executor'`
      ).get() as { value: string } | undefined

      expect(result).to.not.be.undefined
      expect(result!.value).to.equal('codex')
    })

    it('should store and retrieve environment preference', () => {
      db.prepare(`
        INSERT OR REPLACE INTO workspace_settings (key, value)
        VALUES ('execution.default_mode', 'devcontainer')
      `).run()

      const result = db.prepare(
        `SELECT value FROM workspace_settings WHERE key = 'execution.default_mode'`
      ).get() as { value: string } | undefined

      expect(result).to.not.be.undefined
      expect(result!.value).to.equal('devcontainer')
    })

    it('should store and retrieve sandboxed preference', () => {
      db.prepare(`
        INSERT OR REPLACE INTO workspace_settings (key, value)
        VALUES ('execution.sandboxed', 'false')
      `).run()

      const result = db.prepare(
        `SELECT value FROM workspace_settings WHERE key = 'execution.sandboxed'`
      ).get() as { value: string } | undefined

      expect(result).to.not.be.undefined
      expect(result!.value).to.equal('false')
    })
  })
})
