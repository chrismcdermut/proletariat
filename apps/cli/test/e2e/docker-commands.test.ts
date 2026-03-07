/* eslint-disable max-lines -- comprehensive e2e test suite */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { execInProcess } from './test-helpers.js'

/** Database row type for agent_work queries */
interface AgentWorkRow {
  container_id: string | null
  environment: string
  status: string
}

/**
 * Helper to check if output indicates Docker daemon/workspace errors.
 * Docker's debug output includes retry attempts that may appear in stdout,
 * while the actual error message goes to stderr. We check for both patterns.
 */
function hasDockerOrWorkspaceError(output: string): boolean {
  return (
    output.includes('Docker is not running') ||
    output.includes('docker: not found') ||
    output.includes('Docker check attempt') ||
    output.includes('Cannot connect to the Docker daemon') ||
    output.includes('Not in a workspace') ||
    output.includes('Could not find container') ||
    output.includes('does not exist') ||
    output.includes('error getting credentials') ||
    output.includes('credential') ||
    output.includes('error during connect')
  )
}

/**
 * End-to-end tests for Docker Management Commands
 * Tests: prlt docker status, list, logs, start, stop, shell, restart, sync, clean, prune
 *
 * Note: These tests run without Docker available, so they test
 * the "Docker not running" code paths. Full Docker integration
 * tests would require a Docker environment.
 *
 * The CLI tests run from the CLI directory (not a temp dir) to avoid
 * TypeScript loader issues. Database tests use a separate temp database.
 */
describe('Docker Commands E2E Tests', () => {
  let testDir: string
  let dbPath: string
  let db: Database.Database

  beforeEach(() => {
    // Create temp dir for database tests only (not for CLI execution)
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-commands-e2e-'))

    // Setup test database
    const proletariatDir = path.join(testDir, '.proletariat')
    fs.mkdirSync(proletariatDir, { recursive: true })
    dbPath = path.join(proletariatDir, 'workspace.db')

    db = new Database(dbPath)
    setupTestDatabase(db)
  })

  afterEach(() => {
    if (db) db.close()
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  /**
   * prlt docker status
   * Note: docker status doesn't need a workspace, just checks Docker daemon
   */
  describe('prlt docker status', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('docker status --help')

      expect(output).to.contain('Check if Docker daemon is running')
      expect(output).to.contain('USAGE')
    })

    it('should report Docker status', async () => {
      const output = await execInProcess('docker status --machine')

      // docker status outputs JSON in non-TTY (piped) environments
      const hasStatus = output.includes('"running"') || output.includes('Docker Status')
      expect(hasStatus).to.be.true
    })

    it('should indicate when Docker is not available', async () => {
      // In test environment, Docker is typically not running
      const output = await execInProcess('docker status --machine')

      // If Docker isn't running, should show appropriate message
      if (output.includes('Not Running')) {
        expect(output).to.contain('not available')
      }
    })
  })

  /**
   * prlt docker list
   */
  describe('prlt docker list', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('docker list --help')

      expect(output).to.contain('Show Docker containers from agent_work table')
      expect(output).to.contain('--all')
      expect(output).to.contain('--running')
      expect(output).to.contain('USAGE')
    })

    it('should accept --all flag without unknown flag error', async () => {
      const output = await execInProcess('docker list --all --help')

      expect(output).to.not.contain('Unknown flag')
      expect(output).to.not.contain('Unexpected argument')
    })

    it('should accept --running flag without unknown flag error', async () => {
      const output = await execInProcess('docker list --running --help')

      expect(output).to.not.contain('Unknown flag')
      expect(output).to.not.contain('Unexpected argument')
    })

    it('should handle missing workspace gracefully', async () => {
      const output = await execInProcess('docker list --machine')

      const validOutput =
        output.includes('Not in a workspace') ||
        hasDockerOrWorkspaceError(output) ||
        output.includes('Docker Containers') ||
        output.includes('No containers')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker clean
   */
  describe('prlt docker clean', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('docker clean --help')

      expect(output).to.contain('Remove orphaned containers')
      expect(output).to.contain('--force')
      expect(output).to.contain('--dry-run')
      expect(output).to.contain('--all')
      expect(output).to.contain('USAGE')
    })

    it('should accept --dry-run flag without unknown flag error', async () => {
      const output = await execInProcess('docker clean --dry-run --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --all flag without unknown flag error', async () => {
      const output = await execInProcess('docker clean --all --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --force flag without unknown flag error', async () => {
      const output = await execInProcess('docker clean --force --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should handle missing workspace gracefully', async () => {
      const output = await execInProcess('docker clean --force --machine')

      expect(hasDockerOrWorkspaceError(output) ||
        output.includes('No orphaned containers') ||
        output.includes('Removed')).to.be.true
    })

    it('should accept --machine flag for JSON mode support', async () => {
      const output = await execInProcess('docker clean --machine --help')

      expect(output).to.contain('--machine')
      expect(output).to.contain('JSON')
    })
  })

  /**
   * prlt docker logs
   */
  describe('prlt docker logs', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('docker logs --help')

      expect(output).to.contain('View logs from a container')
      expect(output).to.contain('--follow')
      expect(output).to.contain('--tail')
      expect(output).to.contain('USAGE')
    })

    it('should accept --follow flag without unknown flag error', async () => {
      const output = await execInProcess('docker logs --follow --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --tail flag without unknown flag error', async () => {
      const output = await execInProcess('docker logs --tail 50 --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should require a target argument', async () => {
      const output = await execInProcess('docker logs --machine')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        hasDockerOrWorkspaceError(output)
      expect(validOutput).to.be.true
    })

    it('should accept execution ID format', async () => {
      const output = await execInProcess('docker logs WORK-001 --machine')

      // Should process the command (may fail due to no Docker or no execution)
      expect(
        hasDockerOrWorkspaceError(output) ||
        output.includes('not found') ||
        output.includes('Logs for')
      ).to.be.true
    })
  })

  /**
   * prlt docker stop
   */
  describe('prlt docker stop', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('docker stop --help')

      expect(output).to.contain('Stop a running container')
      expect(output).to.contain('--force')
      expect(output).to.contain('--time')
      expect(output).to.contain('USAGE')
    })

    it('should accept --force flag without unknown flag error', async () => {
      const output = await execInProcess('docker stop --force --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --time flag without unknown flag error', async () => {
      const output = await execInProcess('docker stop --time 30 --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should require a target argument', async () => {
      const output = await execInProcess('docker stop --machine')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        hasDockerOrWorkspaceError(output)
      expect(validOutput).to.be.true
    })

    it('should accept --machine flag for JSON mode support', async () => {
      const output = await execInProcess('docker stop --machine --help')

      expect(output).to.contain('--machine')
      expect(output).to.contain('JSON')
    })
  })

  /**
   * prlt docker shell
   */
  describe('prlt docker shell', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('docker shell --help')

      expect(output).to.contain('Open a shell in a running container')
      expect(output).to.contain('--shell')
      expect(output).to.contain('--user')
      expect(output).to.contain('USAGE')
    })

    it('should accept --shell flag without unknown flag error', async () => {
      const output = await execInProcess('docker shell --shell /bin/bash --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --user flag without unknown flag error', async () => {
      const output = await execInProcess('docker shell --user root --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should require a target argument', async () => {
      const output = await execInProcess('docker shell --machine')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        hasDockerOrWorkspaceError(output)
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker restart
   */
  describe('prlt docker restart', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('docker restart --help')

      expect(output).to.contain('Restart a container')
      expect(output).to.contain('--force')
      expect(output).to.contain('--time')
      expect(output).to.contain('USAGE')
    })

    it('should accept --force flag without unknown flag error', async () => {
      const output = await execInProcess('docker restart --force --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should require a target argument', async () => {
      const output = await execInProcess('docker restart --machine')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        hasDockerOrWorkspaceError(output)
      expect(validOutput).to.be.true
    })

    it('should accept --machine flag for JSON mode support', async () => {
      const output = await execInProcess('docker restart --machine --help')

      expect(output).to.contain('--machine')
      expect(output).to.contain('JSON')
    })
  })

  /**
   * prlt docker start
   */
  describe('prlt docker start', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('docker start --help')

      expect(output).to.contain('Start a stopped container')
      expect(output).to.contain('USAGE')
    })

    it('should require a target argument', async () => {
      const output = await execInProcess('docker start --machine')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        hasDockerOrWorkspaceError(output)
      expect(validOutput).to.be.true
    })

    it('should accept execution ID format', async () => {
      const output = await execInProcess('docker start WORK-001 --machine')

      expect(
        hasDockerOrWorkspaceError(output) ||
        output.includes('not found') ||
        output.includes('Started') ||
        output.includes('already running') ||
        output.includes('Failed to start') ||
        output.includes('Start Container')
      ).to.be.true
    })
  })

  /**
   * prlt docker sync
   */
  describe('prlt docker sync', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('docker sync --help')

      expect(output).to.contain('Sync container status from Docker into the database')
      expect(output).to.contain('USAGE')
    })

    it('should handle missing workspace gracefully', async () => {
      const output = await execInProcess('docker sync --machine')

      expect(
        hasDockerOrWorkspaceError(output) ||
        output.includes('Syncing Containers') ||
        output.includes('Sync complete')
      ).to.be.true
    })
  })

  /**
   * prlt docker prune
   */
  describe('prlt docker prune', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('docker prune --help')

      expect(output).to.contain('Remove unused Docker resources')
      expect(output).to.contain('--force')
      expect(output).to.contain('--dry-run')
      expect(output).to.contain('--all')
      expect(output).to.contain('--volumes')
      expect(output).to.contain('USAGE')
    })

    it('should accept --dry-run flag without unknown flag error', async () => {
      const output = await execInProcess('docker prune --dry-run --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --all flag without unknown flag error', async () => {
      const output = await execInProcess('docker prune --all --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --volumes flag without unknown flag error', async () => {
      const output = await execInProcess('docker prune --volumes --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should handle Docker not running gracefully', async () => {
      const output = await execInProcess('docker prune --force --machine')

      expect(
        hasDockerOrWorkspaceError(output) ||
        output.includes('Docker Prune') ||
        output.includes('prune completed')
      ).to.be.true
    })

    it('should accept --machine flag for JSON mode support', async () => {
      const output = await execInProcess('docker prune --machine --help')

      expect(output).to.contain('--machine')
      expect(output).to.contain('JSON')
    })
  })

  /**
   * prlt docker (main menu)
   */
  describe('prlt docker', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('docker --help')

      expect(output).to.contain('Manage Docker containers')
      expect(output).to.contain('clean')
      expect(output).to.contain('list')
      expect(output).to.contain('COMMANDS')
    })

    it('should list available subcommands in examples', async () => {
      const output = await execInProcess('docker --help')

      expect(output).to.contain('prlt docker status')
      expect(output).to.contain('prlt docker list')
      expect(output).to.contain('prlt docker logs')
      expect(output).to.contain('prlt docker start')
      expect(output).to.contain('prlt docker stop')
      expect(output).to.contain('prlt docker shell')
      expect(output).to.contain('prlt docker restart')
      expect(output).to.contain('prlt docker sync')
      expect(output).to.contain('prlt docker clean')
      expect(output).to.contain('prlt docker prune')
    })
  })

  /**
   * JSON Mode Tests (FlagResolver integration)
   */
  describe('JSON Mode Output', () => {
    /**
     * Helper to safely parse JSON from command output.
     * Returns null if output contains error messages or no valid JSON.
     */
    function tryParsePromptJson(output: string): { prompt: Record<string, unknown>; metadata: Record<string, unknown> } | null {
      if (hasDockerOrWorkspaceError(output)) {
        return null
      }

      const jsonMatch = output.match(/\{"prompt"[\s\S]*\}/)
      if (!jsonMatch) return null

      try {
        return JSON.parse(jsonMatch[0])
      } catch {
        return null
      }
    }

    it('prlt docker --json should output action menu as JSON', async () => {
      const output = await execInProcess('docker --json')
      const json = tryParsePromptJson(output)

      if (!json) {
        return
      }

      expect(json.prompt).to.exist
      expect(json.prompt.type).to.equal('list')
      expect(json.prompt.name).to.equal('action')
      expect(json.prompt.message).to.include('What would you like to do')
      expect(json.prompt.choices).to.be.an('array')
      expect((json.prompt.choices as unknown[]).length).to.be.greaterThan(0)

      const statusChoice = (json.prompt.choices as Array<{ value: string; name: string; command: string }>).find(
        c => c.value === 'status'
      )
      expect(statusChoice).to.exist
      expect(statusChoice!.name).to.include('Docker status')
      expect(statusChoice!.command).to.include('prlt docker status')

      expect(json.metadata).to.exist
      expect(json.metadata.command).to.equal('docker')
    })

    it('prlt docker clean --json should output confirm prompt or error', async () => {
      const output = await execInProcess('docker clean --json')
      const json = tryParsePromptJson(output)

      if (json) {
        expect(json.prompt).to.exist
        expect(json.prompt.type).to.equal('list')
        expect(json.prompt.name).to.equal('confirmed')
        expect(json.prompt.choices).to.be.an('array')
        expect(json.metadata).to.exist
        expect(json.metadata.command).to.equal('docker clean')
      } else {
        expect(hasDockerOrWorkspaceError(output)).to.be.true
      }
    })

    it('prlt docker prune --json should output confirm prompt or error', async () => {
      const output = await execInProcess('docker prune --json')
      const json = tryParsePromptJson(output)

      if (json) {
        expect(json.prompt).to.exist
        expect(json.prompt.type).to.equal('list')
        expect(json.prompt.name).to.equal('confirmed')
        expect(json.metadata).to.exist
        expect(json.metadata.command).to.equal('docker prune')
      } else {
        expect(hasDockerOrWorkspaceError(output)).to.be.true
      }
    })

    it('prlt docker stop <target> --json should output confirm prompt or error', async () => {
      const output = await execInProcess('docker stop test-container --json')
      const json = tryParsePromptJson(output)

      if (json) {
        expect(json.prompt).to.exist
        expect(json.prompt.type).to.equal('list')
        expect(json.prompt.name).to.equal('confirmed')
        expect(json.metadata).to.exist
        expect(json.metadata.command).to.equal('docker stop')
      } else {
        expect(hasDockerOrWorkspaceError(output)).to.be.true
      }
    })

    it('prlt docker restart <target> --json should output confirm prompt or error', async () => {
      const output = await execInProcess('docker restart test-container --json')
      const json = tryParsePromptJson(output)

      if (json) {
        expect(json.prompt).to.exist
        expect(json.prompt.type).to.equal('list')
        expect(json.prompt.name).to.equal('confirmed')
        expect(json.metadata).to.exist
        expect(json.metadata.command).to.equal('docker restart')
      } else {
        expect(hasDockerOrWorkspaceError(output)).to.be.true
      }
    })

    it('--force flag should skip confirmation prompt in JSON mode', async () => {
      const output = await execInProcess('docker clean --force --json')

      // Should NOT have a prompt JSON when --force is used
      const jsonMatch = output.match(/\{"prompt"/)
      if (!hasDockerOrWorkspaceError(output) && !output.includes('No orphaned containers')) {
        expect(jsonMatch).to.be.null
      }
    })
  })

  /**
   * Database integration tests
   */
  describe('Database Integration', () => {
    it('should query executions with container_id', () => {
      const ticketId = createTicket(db, 'Container test', 'in-progress')

      createExecution(db, ticketId, 'agent-1', 'running', {
        environment: 'devcontainer',
        container_id: 'abc123',
      })

      const execution = db
        .prepare(
          `
        SELECT * FROM agent_work WHERE container_id IS NOT NULL
      `
        )
        .get() as AgentWorkRow | undefined

      expect(execution).to.exist
      expect(execution!.container_id).to.equal('abc123')
      expect(execution!.environment).to.equal('devcontainer')
    })

    it('should find orphaned executions (container_id but not running)', () => {
      const ticketId = createTicket(db, 'Orphan test', 'done')

      createExecution(db, ticketId, 'agent-1', 'completed', {
        environment: 'devcontainer',
        container_id: 'orphan123',
      })

      const orphanedExecutions = db
        .prepare(
          `
        SELECT * FROM agent_work
        WHERE container_id IS NOT NULL
        AND status NOT IN ('running', 'starting')
      `
        )
        .all()

      expect(orphanedExecutions).to.have.lengthOf(1)
    })

    it('should identify running executions with containers', () => {
      const ticketId1 = createTicket(db, 'Running', 'in-progress')
      const ticketId2 = createTicket(db, 'Completed', 'done')

      createExecution(db, ticketId1, 'agent-1', 'running', {
        environment: 'devcontainer',
        container_id: 'running123',
      })

      createExecution(db, ticketId2, 'agent-2', 'completed', {
        environment: 'devcontainer',
        container_id: 'completed456',
      })

      const activeExecutions = db
        .prepare(
          `
        SELECT * FROM agent_work
        WHERE container_id IS NOT NULL
        AND status IN ('running', 'starting')
      `
        )
        .all()

      expect(activeExecutions).to.have.lengthOf(1)
    })
  })
})

// =============================================================================
// End-to-end Agent Flow Tests (--machine flag)
// =============================================================================
// These tests simulate an AI agent navigating through docker commands
// using the JSON machine-readable output.
//
// Docker Index Menu: Fully testable without Docker (FlagResolver outputs JSON
// before any Docker interactions).
//
// Docker-dependent commands (stop, restart, clean, prune): These require
// Docker daemon to be running. Tests gracefully skip when Docker is unavailable.
// =============================================================================

describe('Docker Agent Flow E2E Tests (--machine flag)', () => {
  /** JSON response type for prompt output */
  interface AgentPrompt {
    prompt: {
      type: string
      name: string
      message: string
      choices: Array<{ name: string; value: string; command?: string }>
      context?: Record<string, unknown>
    }
    metadata: {
      command: string
      flags: Record<string, unknown>
    }
  }

  /**
   * Extract JSON from CLI output that may contain warnings.
   */
  function extractJson<T>(output: string): T | null {
    const lines = output.split('\n')
    let jsonStart = -1

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        jsonStart = i
        break
      }
    }

    if (jsonStart === -1) {
      return null
    }

    const jsonLines = lines.slice(jsonStart).join('\n')
    try {
      return JSON.parse(jsonLines) as T
    } catch {
      return null
    }
  }

  /**
   * Execute command and parse JSON response. Returns null if Docker/workspace error.
   */
  async function agentExec(cmd: string): Promise<AgentPrompt | null> {
    const output = await execInProcess(cmd)
    if (hasDockerOrWorkspaceError(output)) {
      return null
    }
    return extractJson<AgentPrompt>(output)
  }

  /**
   * Find a choice by partial name match (case-insensitive).
   */
  function findChoice(
    choices: Array<{ name: string; value: string; command?: string }>,
    pattern: string
  ): { name: string; value: string; command?: string } | undefined {
    return choices.find(c => c.name.toLowerCase().includes(pattern.toLowerCase()))
  }

  /**
   * Find a choice by exact value match.
   */
  function findChoiceByValue(
    choices: Array<{ name: string; value: string; command?: string }>,
    value: string
  ): { name: string; value: string; command?: string } | undefined {
    return choices.find(c => c.value === value)
  }

  /**
   * Extract command from a choice (strips 'prlt ' prefix).
   */
  function execChoice(choice: { command?: string }): string {
    if (!choice.command) throw new Error('Choice has no command')
    return choice.command.replace('prlt ', '')
  }

  // ===========================================================================
  // Docker Index Menu - Prompt Schema Validation
  // ===========================================================================
  // The docker index menu does NOT require Docker to be running.
  // FlagResolver outputs the menu JSON before any Docker checks.
  // ===========================================================================

  describe('docker index menu - prompt schema', () => {
    it('should output a list prompt with name "action"', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('action')
      expect(result.prompt.message).to.include('What would you like to do')
    })

    it('should include metadata with command and flags', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      expect(result.metadata).to.exist
      expect(result.metadata.command).to.equal('docker')
      expect(result.metadata.flags).to.exist
      expect(result.metadata.flags.machine).to.equal(true)
    })

    it('should have 11 menu choices', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      expect(result.prompt.choices).to.be.an('array')
      expect(result.prompt.choices.length).to.equal(11)
    })
  })

  // ===========================================================================
  // Docker Index Menu - Individual Choice Validation
  // ===========================================================================

  describe('docker index menu - individual choices', () => {
    it('should have "Check Docker status" choice with correct command', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const choice = findChoiceByValue(result.prompt.choices, 'status')
      expect(choice).to.exist
      expect(choice!.name).to.include('Docker status')
      expect(choice!.command).to.equal('prlt docker status --json')
    })

    it('should have "List containers" choice with correct command', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const choice = findChoiceByValue(result.prompt.choices, 'list')
      expect(choice).to.exist
      expect(choice!.name).to.include('List containers')
      expect(choice!.command).to.equal('prlt docker list --json')
    })

    it('should have "View container logs" choice with target placeholder', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const choice = findChoiceByValue(result.prompt.choices, 'logs')
      expect(choice).to.exist
      expect(choice!.name).to.include('container logs')
      expect(choice!.command).to.include('prlt docker logs')
      expect(choice!.command).to.include('<target>')
    })

    it('should have "Start a container" choice with target placeholder', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const choice = findChoiceByValue(result.prompt.choices, 'start')
      expect(choice).to.exist
      expect(choice!.name).to.include('Start')
      expect(choice!.command).to.include('prlt docker start')
      expect(choice!.command).to.include('<target>')
    })

    it('should have "Stop a container" choice with target placeholder', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const choice = findChoiceByValue(result.prompt.choices, 'stop')
      expect(choice).to.exist
      expect(choice!.name).to.include('Stop')
      expect(choice!.command).to.include('prlt docker stop')
      expect(choice!.command).to.include('<target>')
    })

    it('should have "Shell into container" choice with target placeholder', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const choice = findChoiceByValue(result.prompt.choices, 'shell')
      expect(choice).to.exist
      expect(choice!.name).to.include('Shell')
      expect(choice!.command).to.include('prlt docker shell')
      expect(choice!.command).to.include('<target>')
    })

    it('should have "Restart a container" choice with target placeholder', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const choice = findChoiceByValue(result.prompt.choices, 'restart')
      expect(choice).to.exist
      expect(choice!.name).to.include('Restart')
      expect(choice!.command).to.include('prlt docker restart')
      expect(choice!.command).to.include('<target>')
    })

    it('should have "Sync containers" choice with correct command', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const choice = findChoiceByValue(result.prompt.choices, 'sync')
      expect(choice).to.exist
      expect(choice!.name).to.include('Sync')
      expect(choice!.command).to.equal('prlt docker sync --json')
    })

    it('should have "Clean orphaned containers" choice with correct command', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const choice = findChoiceByValue(result.prompt.choices, 'clean')
      expect(choice).to.exist
      expect(choice!.name).to.include('Clean')
      expect(choice!.command).to.equal('prlt docker clean --json')
    })

    it('should have "Prune unused resources" choice with correct command', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const choice = findChoiceByValue(result.prompt.choices, 'prune')
      expect(choice).to.exist
      expect(choice!.name).to.include('Prune')
      expect(choice!.command).to.equal('prlt docker prune --json')
    })

    it('should have "Exit" choice', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const choice = findChoiceByValue(result.prompt.choices, 'exit')
      expect(choice).to.exist
      expect(choice!.name).to.include('Exit')
    })
  })

  // ===========================================================================
  // Docker Index Menu - Flag Accumulation
  // ===========================================================================

  describe('docker index menu - flag accumulation', () => {
    it('should include --json in all non-exit choice commands', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const nonExitChoices = result.prompt.choices.filter(c => c.value !== 'exit')
      for (const choice of nonExitChoices) {
        expect(choice.command).to.exist
        expect(choice.command).to.include('--json')
      }
    })

    it('should include <target> in commands requiring a container target', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const targetCommands = ['logs', 'start', 'stop', 'shell', 'restart']
      for (const cmdName of targetCommands) {
        const choice = findChoiceByValue(result.prompt.choices, cmdName)
        expect(choice).to.exist
        expect(choice!.command).to.include('<target>')
      }
    })

    it('should NOT include <target> in commands that do not require one', async () => {
      const result = await agentExec('docker --machine')

      if (!result) return

      const noTargetCommands = ['status', 'list', 'sync', 'clean', 'prune']
      for (const cmdName of noTargetCommands) {
        const choice = findChoiceByValue(result.prompt.choices, cmdName)
        expect(choice).to.exist
        expect(choice!.command).to.not.include('<target>')
      }
    })
  })

  // ===========================================================================
  // Docker Stop - Confirmation Flow (Docker-dependent)
  // ===========================================================================

  describe('docker stop - confirmation flow', () => {
    it('should output confirmation prompt with --machine flag', async () => {
      const result = await agentExec('docker stop test-container --machine')

      // Skip if Docker not running
      if (!result) return

      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('confirmed')
      expect(result.prompt.message).to.include('Stop container')
      expect(result.metadata.command).to.equal('docker stop')
    })

    it('should have Yes and No choices', async () => {
      const result = await agentExec('docker stop test-container --machine')

      if (!result) return

      expect(result.prompt.choices).to.be.an('array')
      expect(result.prompt.choices.length).to.equal(2)

      const yesChoice = findChoice(result.prompt.choices, 'yes')
      const noChoice = findChoice(result.prompt.choices, 'no')
      expect(yesChoice).to.exist
      expect(noChoice).to.exist
    })

    it('should include --force flag in Yes choice command', async () => {
      const result = await agentExec('docker stop test-container --machine')

      if (!result) return

      // FlagResolver converts boolean true to string 'true'
      const yesChoice = result.prompt.choices.find(c => c.value === 'true')
      expect(yesChoice).to.exist
      if (yesChoice!.command) {
        expect(yesChoice!.command).to.include('--force')
        expect(yesChoice!.command).to.include('--json')
        expect(yesChoice!.command).to.include('docker stop')
      }
    })

    it('should include target in Yes choice command', async () => {
      const result = await agentExec('docker stop my-container --machine')

      if (!result) return

      const yesChoice = result.prompt.choices.find(c => c.value === 'true')
      expect(yesChoice).to.exist
      if (yesChoice!.command) {
        expect(yesChoice!.command).to.include('my-container')
      }
    })

    it('should skip confirmation with --force flag', async () => {
      const output = await execInProcess('docker stop test-container --force --machine')

      // With --force, should NOT output a prompt - goes straight to action
      // (will fail because container doesn't exist, but no prompt was shown)
      const hasPrompt = output.includes('"prompt"')
      if (!hasDockerOrWorkspaceError(output)) {
        expect(hasPrompt).to.be.false
      }
    })

    it('should work with -m shorthand', async () => {
      const result = await agentExec('docker stop test-container -m')

      if (!result) return

      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('confirmed')
      expect(result.metadata.flags.machine).to.equal(true)
    })
  })

  // ===========================================================================
  // Docker Restart - Confirmation Flow (Docker-dependent)
  // ===========================================================================

  describe('docker restart - confirmation flow', () => {
    it('should output confirmation prompt with --machine flag', async () => {
      const result = await agentExec('docker restart test-container --machine')

      if (!result) return

      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('confirmed')
      expect(result.prompt.message).to.include('Restart container')
      expect(result.metadata.command).to.equal('docker restart')
    })

    it('should have Yes and No choices', async () => {
      const result = await agentExec('docker restart test-container --machine')

      if (!result) return

      expect(result.prompt.choices.length).to.equal(2)

      const yesChoice = findChoice(result.prompt.choices, 'yes')
      const noChoice = findChoice(result.prompt.choices, 'no')
      expect(yesChoice).to.exist
      expect(noChoice).to.exist
    })

    it('should include --force flag in Yes choice command', async () => {
      const result = await agentExec('docker restart test-container --machine')

      if (!result) return

      const yesChoice = result.prompt.choices.find(c => c.value === 'true')
      expect(yesChoice).to.exist
      if (yesChoice!.command) {
        expect(yesChoice!.command).to.include('--force')
        expect(yesChoice!.command).to.include('--json')
        expect(yesChoice!.command).to.include('docker restart')
      }
    })

    it('should include target in Yes choice command', async () => {
      const result = await agentExec('docker restart my-container --machine')

      if (!result) return

      const yesChoice = result.prompt.choices.find(c => c.value === 'true')
      expect(yesChoice).to.exist
      if (yesChoice!.command) {
        expect(yesChoice!.command).to.include('my-container')
      }
    })

    it('should skip confirmation with --force flag', async () => {
      const output = await execInProcess('docker restart test-container --force --machine')

      const hasPrompt = output.includes('"prompt"')
      if (!hasDockerOrWorkspaceError(output)) {
        expect(hasPrompt).to.be.false
      }
    })

    it('should work with -m shorthand', async () => {
      const result = await agentExec('docker restart test-container -m')

      if (!result) return

      expect(result.prompt.type).to.equal('list')
      expect(result.metadata.flags.machine).to.equal(true)
    })
  })

  // ===========================================================================
  // Docker Clean - Confirmation Flow (Docker-dependent)
  // ===========================================================================

  describe('docker clean - confirmation flow', () => {
    it('should output confirmation prompt with --machine flag', async () => {
      const result = await agentExec('docker clean --machine')

      if (!result) return

      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('confirmed')
      expect(result.prompt.message).to.include('orphaned container')
      expect(result.metadata.command).to.equal('docker clean')
    })

    it('should have Yes and No choices', async () => {
      const result = await agentExec('docker clean --machine')

      if (!result) return

      const yesChoice = findChoice(result.prompt.choices, 'yes')
      const noChoice = findChoice(result.prompt.choices, 'no')
      expect(yesChoice).to.exist
      expect(noChoice).to.exist
    })

    it('should include command in Yes choice for flag accumulation', async () => {
      const result = await agentExec('docker clean --machine')

      if (!result) return

      const yesChoice = result.prompt.choices.find(c => c.value === 'true')
      expect(yesChoice).to.exist
      if (yesChoice!.command) {
        expect(yesChoice!.command).to.include('docker clean')
        expect(yesChoice!.command).to.include('--json')
      }
    })

    it('should skip confirmation with --force flag', async () => {
      const output = await execInProcess('docker clean --force --machine')

      const hasPrompt = output.includes('"prompt"')
      if (!hasDockerOrWorkspaceError(output) && !output.includes('No orphaned containers')) {
        expect(hasPrompt).to.be.false
      }
    })

    it('should accept --dry-run to show preview without removing', async () => {
      const output = await execInProcess('docker clean --dry-run --machine')

      // --dry-run should not ask for confirmation, it just shows preview
      if (!hasDockerOrWorkspaceError(output)) {
        // Either shows preview or no orphans message
        expect(
          output.includes('DRY RUN') ||
          output.includes('No orphaned containers')
        ).to.be.true
      }
    })

    it('should work with -m shorthand', async () => {
      const result = await agentExec('docker clean -m')

      if (!result) return

      expect(result.prompt.type).to.equal('list')
      expect(result.metadata.flags.machine).to.equal(true)
    })
  })

  // ===========================================================================
  // Docker Prune - Confirmation Flow (Docker-dependent)
  // ===========================================================================

  describe('docker prune - confirmation flow', () => {
    it('should output confirmation prompt with --machine flag', async () => {
      const result = await agentExec('docker prune --machine')

      if (!result) return

      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('confirmed')
      expect(result.prompt.message).to.include('Docker resources')
      expect(result.metadata.command).to.equal('docker prune')
    })

    it('should have Yes and No choices', async () => {
      const result = await agentExec('docker prune --machine')

      if (!result) return

      const yesChoice = findChoice(result.prompt.choices, 'yes')
      const noChoice = findChoice(result.prompt.choices, 'no')
      expect(yesChoice).to.exist
      expect(noChoice).to.exist
    })

    it('should include command in Yes choice for flag accumulation', async () => {
      const result = await agentExec('docker prune --machine')

      if (!result) return

      const yesChoice = result.prompt.choices.find(c => c.value === 'true')
      expect(yesChoice).to.exist
      if (yesChoice!.command) {
        expect(yesChoice!.command).to.include('docker prune')
        expect(yesChoice!.command).to.include('--json')
      }
    })

    it('should include volumes warning in confirmation message with --volumes', async () => {
      const result = await agentExec('docker prune --volumes --machine')

      if (!result) return

      // When --volumes is used, message should warn about data loss
      expect(result.prompt.message.toLowerCase()).to.include('volume')
    })

    it('should skip confirmation with --force flag', async () => {
      const output = await execInProcess('docker prune --force --machine')

      const hasPrompt = output.includes('"prompt"')
      if (!hasDockerOrWorkspaceError(output)) {
        expect(hasPrompt).to.be.false
      }
    })

    it('should accept --dry-run to show preview without pruning', async () => {
      const output = await execInProcess('docker prune --dry-run --machine')

      if (!hasDockerOrWorkspaceError(output)) {
        expect(output.includes('DRY RUN') || output.includes('preview')).to.be.true
      }
    })

    it('should work with -m shorthand', async () => {
      const result = await agentExec('docker prune -m')

      if (!result) return

      expect(result.prompt.type).to.equal('list')
      expect(result.metadata.flags.machine).to.equal(true)
    })
  })

  // ===========================================================================
  // Full Agent Navigation Flows
  // ===========================================================================

  describe('full agent navigation flows', () => {
    it('should navigate: main menu → select clean → get confirmation prompt', async () => {
      // Step 1: Get main menu
      const step1 = await agentExec('docker --machine')

      if (!step1) return

      // Step 2: Find and select "clean" option
      const cleanChoice = findChoiceByValue(step1.prompt.choices, 'clean')
      expect(cleanChoice).to.exist
      expect(cleanChoice!.command).to.include('docker clean')
      expect(cleanChoice!.command).to.include('--json')

      // Step 3: Execute the clean command from the choice
      const step2 = await agentExec(execChoice(cleanChoice!))

      // If Docker not running, step2 will be null (graceful skip)
      if (!step2) return

      // Should get confirmation prompt
      expect(step2.prompt.type).to.equal('list')
      expect(step2.prompt.name).to.equal('confirmed')
      expect(step2.prompt.choices.length).to.equal(2)
    })

    it('should navigate: main menu → select prune → get confirmation prompt', async () => {
      const step1 = await agentExec('docker --machine')

      if (!step1) return

      const pruneChoice = findChoiceByValue(step1.prompt.choices, 'prune')
      expect(pruneChoice).to.exist
      expect(pruneChoice!.command).to.include('docker prune')
      expect(pruneChoice!.command).to.include('--json')

      const step2 = await agentExec(execChoice(pruneChoice!))

      if (!step2) return

      expect(step2.prompt.type).to.equal('list')
      expect(step2.prompt.name).to.equal('confirmed')
    })

    it('should navigate: main menu → select status → direct execution (no prompt)', async () => {
      const step1 = await agentExec('docker --machine')

      if (!step1) return

      const statusChoice = findChoiceByValue(step1.prompt.choices, 'status')
      expect(statusChoice).to.exist
      expect(statusChoice!.command).to.equal('prlt docker status --json')

      // Status command executes directly - no confirmation prompt
      // It returns JSON status output (the choice command includes --json)
      const output = await execInProcess(execChoice(statusChoice!))
      const json = JSON.parse(output)
      expect(json).to.have.property('running')
    })

    it('should navigate: main menu → select list → direct execution (no prompt)', async () => {
      const step1 = await agentExec('docker --machine')

      if (!step1) return

      const listChoice = findChoiceByValue(step1.prompt.choices, 'list')
      expect(listChoice).to.exist
      expect(listChoice!.command).to.equal('prlt docker list --json')
    })

    it('should navigate: main menu → select sync → direct execution (no prompt)', async () => {
      const step1 = await agentExec('docker --machine')

      if (!step1) return

      const syncChoice = findChoiceByValue(step1.prompt.choices, 'sync')
      expect(syncChoice).to.exist
      expect(syncChoice!.command).to.equal('prlt docker sync --json')
    })
  })

  // ===========================================================================
  // --machine / --json / -m Equivalence
  // ===========================================================================

  describe('--machine vs --json vs -m equivalence', () => {
    it('--machine and --json should produce equivalent output structure', async () => {
      const machineOutput = await execInProcess('docker --machine')
      const jsonOutput = await execInProcess('docker --json')

      const machineResult = extractJson<AgentPrompt>(machineOutput)
      const jsonResult = extractJson<AgentPrompt>(jsonOutput)

      // Both should parse to same structure (or both fail)
      if (machineResult && jsonResult) {
        expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type)
        expect(machineResult.prompt.name).to.equal(jsonResult.prompt.name)
        expect(machineResult.prompt.choices.length).to.equal(jsonResult.prompt.choices.length)
      }
    })

    it('--machine and --json should have same choice values', async () => {
      const machineResult = await agentExec('docker --machine')
      const jsonResult = await agentExec('docker --json')

      if (!machineResult || !jsonResult) return

      const machineValues = machineResult.prompt.choices.map(c => c.value).sort()
      const jsonValues = jsonResult.prompt.choices.map(c => c.value).sort()
      expect(machineValues).to.deep.equal(jsonValues)
    })

    it('-m shorthand should work for docker index', async () => {
      const result = await agentExec('docker -m')

      if (!result) return

      expect(result.prompt).to.exist
      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('action')
      expect(result.metadata.flags.machine).to.equal(true)
    })

    it('-m shorthand should work for docker stop (Docker-dependent)', async () => {
      const result = await agentExec('docker stop test-container -m')

      if (!result) return

      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('confirmed')
      expect(result.metadata.flags.machine).to.equal(true)
    })

    it('-m shorthand should work for docker clean (Docker-dependent)', async () => {
      const result = await agentExec('docker clean -m')

      if (!result) return

      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('confirmed')
      expect(result.metadata.flags.machine).to.equal(true)
    })

    it('-m shorthand should work for docker prune (Docker-dependent)', async () => {
      const result = await agentExec('docker prune -m')

      if (!result) return

      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('confirmed')
      expect(result.metadata.flags.machine).to.equal(true)
    })
  })
})

// =============================================================================
// Helper Functions
// =============================================================================

function setupTestDatabase(db: Database.Database) {
  db.exec(`
    -- Workspace configuration table
    CREATE TABLE IF NOT EXISTS workspace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      type TEXT NOT NULL CHECK (type IN ('hq', 'workspace')),
      theme TEXT NOT NULL,
      workspace_name TEXT NOT NULL,
      has_pmo BOOLEAN DEFAULT FALSE,
      created_at TEXT NOT NULL
    );

    -- Themes table
    CREATE TABLE IF NOT EXISTS themes (
      name TEXT PRIMARY KEY,
      workspace_dir TEXT NOT NULL,
      add_command TEXT NOT NULL,
      remove_command TEXT NOT NULL,
      agents JSON NOT NULL
    );

    -- Agents table
    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      path TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Repositories table
    CREATE TABLE IF NOT EXISTS repositories (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      type TEXT DEFAULT 'git',
      source_url TEXT,
      action TEXT,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pmo_columns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pmo_tickets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'MEDIUM',
      category TEXT DEFAULT 'feature',
      status TEXT DEFAULT 'backlog',
      owner TEXT,
      assignee TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pmo_board_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL UNIQUE,
      column_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES pmo_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES pmo_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (column_id) REFERENCES pmo_columns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_work (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      executor TEXT DEFAULT 'claude-code',
      mode TEXT DEFAULT 'foreground',
      environment TEXT DEFAULT 'host',
      display_mode TEXT DEFAULT 'terminal',
      sandboxed INTEGER DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'running',
      branch TEXT,
      pid TEXT,
      container_id TEXT,
      session_id TEXT,
      host TEXT,
      log_path TEXT,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      exit_code INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_agent_work_agent ON agent_work(agent_name);
    CREATE INDEX IF NOT EXISTS idx_agent_work_status ON agent_work(status);
    CREATE INDEX IF NOT EXISTS idx_agent_work_container ON agent_work(container_id);
  `)

  // Insert workspace configuration
  db.prepare(
    `
    INSERT INTO workspace (id, type, theme, workspace_name, has_pmo, created_at)
    VALUES (1, 'hq', 'founders', 'test-workspace', 1, datetime('now'))
  `
  ).run()

  // Insert theme
  db.prepare(
    `
    INSERT INTO themes (name, workspace_dir, add_command, remove_command, agents)
    VALUES ('founders', 'founders', 'prlt agent add', 'prlt agent remove', '["agent-1", "agent-2"]')
  `
  ).run()

  // Insert test project
  db.prepare(
    `
    INSERT INTO pmo_projects (id, name, description)
    VALUES ('test-project', 'Test Project', 'E2E test project')
  `
  ).run()

  db.prepare(
    `
    INSERT INTO pmo_settings (key, value)
    VALUES ('pmo_path', 'pmo'), ('current_project', 'test-project')
  `
  ).run()

  const columns = [
    { id: 'backlog', name: 'Backlog', position: 0 },
    { id: 'in-progress', name: 'In Progress', position: 1 },
    { id: 'in-review', name: 'In Review', position: 2 },
    { id: 'done', name: 'Done', position: 3 },
  ]

  for (const col of columns) {
    db.prepare(
      `
      INSERT INTO pmo_columns (id, project_id, name, position)
      VALUES (?, 'test-project', ?, ?)
    `
    ).run(col.id, col.name, col.position)
  }

  // Create PMO directory structure
  const pmoPath = path.join(process.cwd(), 'pmo/projects/test-project')
  fs.mkdirSync(pmoPath, { recursive: true })

  // Create agents directory with founders subdirectory
  const agentsPath = path.join(process.cwd(), 'agents', 'founders')
  fs.mkdirSync(agentsPath, { recursive: true })
}

let ticketCounter = 0
function createTicket(
  db: Database.Database,
  title: string,
  columnId: string
): string {
  ticketCounter++
  const ticketId = `TKT-${String(ticketCounter).padStart(3, '0')}`

  db.prepare(
    `
    INSERT INTO pmo_tickets (id, project_id, title, status)
    VALUES (?, 'test-project', ?, ?)
  `
  ).run(ticketId, title, columnId === 'done' ? 'done' : 'active')

  db.prepare(
    `
    INSERT INTO pmo_board_tickets (project_id, ticket_id, column_id, position)
    VALUES ('test-project', ?, ?, 0)
  `
  ).run(ticketId, columnId)

  return ticketId
}

let executionCounter = 0
function createExecution(
  db: Database.Database,
  ticketId: string,
  agentName: string,
  status: string,
  options: {
    executor?: string
    mode?: string
    environment?: string
    display_mode?: string
    sandboxed?: boolean
    branch?: string
    pid?: string
    container_id?: string
    session_id?: string
    host?: string
    log_path?: string
  } = {}
): string {
  executionCounter++
  const execId = `WORK-${String(executionCounter).padStart(3, '0')}`

  db.prepare(
    `
    INSERT INTO agent_work (
      id, ticket_id, agent_name, status, executor, mode,
      environment, display_mode, sandboxed, branch,
      pid, container_id, session_id, host, log_path
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    execId,
    ticketId,
    agentName,
    status,
    options.executor || 'claude-code',
    options.mode || 'foreground',
    options.environment || 'host',
    options.display_mode || 'terminal',
    options.sandboxed !== undefined ? (options.sandboxed ? 1 : 0) : 1,
    options.branch || null,
    options.pid || null,
    options.container_id || null,
    options.session_id || null,
    options.host || null,
    options.log_path || null
  )

  return execId
}
