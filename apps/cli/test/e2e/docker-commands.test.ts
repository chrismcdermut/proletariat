import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import Database from 'better-sqlite3'
import { execProduction as exec } from './test-helpers.js'

/** Database row type for agent_work queries */
interface AgentWorkRow {
  container_id: string | null
  environment: string
  status: string
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
    it('should show help with --help flag', () => {
      const output = exec('docker status --help')

      expect(output).to.contain('Check if Docker daemon is running')
      expect(output).to.contain('USAGE')
    })

    it('should report Docker status', () => {
      const output = exec('docker status')

      // Should contain status header
      expect(output).to.contain('Docker Status')

      // Should show either "Running" or "Not Running"
      const hasStatus = output.includes('Running') || output.includes('Not Running')
      expect(hasStatus).to.be.true
    })

    it('should indicate when Docker is not available', () => {
      // In test environment, Docker is typically not running
      const output = exec('docker status')

      // If Docker isn't running, should show appropriate message
      if (output.includes('Not Running')) {
        expect(output).to.contain('not available')
      }
    })
  })

  /**
   * prlt docker list
   * Note: These tests require a workspace. We test help and flag parsing,
   * and mark workspace-dependent tests appropriately.
   */
  describe('prlt docker list', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker list --help')

      expect(output).to.contain('Show Docker containers from agent_work table')
      expect(output).to.contain('--all')
      expect(output).to.contain('--running')
      expect(output).to.contain('USAGE')
    })

    it('should accept --all flag without unknown flag error', () => {
      const output = exec('docker list --all --help')

      // Should not error with --all flag in help context
      expect(output).to.not.contain('Unknown flag')
      expect(output).to.not.contain('Unexpected argument')
    })

    it('should accept --running flag without unknown flag error', () => {
      const output = exec('docker list --running --help')

      // Should not error with --running flag in help context
      expect(output).to.not.contain('Unknown flag')
      expect(output).to.not.contain('Unexpected argument')
    })

    // Tests that require workspace context - run in workspace or skip
    it('should handle missing workspace gracefully', () => {
      const output = exec('docker list')

      // When run outside workspace, should indicate workspace required
      // or if Docker isn't running, show that message
      const validOutput =
        output.includes('Not in a workspace') ||
        output.includes('Docker is not running') ||
        output.includes('Docker Containers') ||
        output.includes('No containers')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker clean
   * Note: These tests require a workspace. We test help and flag parsing,
   * and mark workspace-dependent tests appropriately.
   */
  describe('prlt docker clean', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker clean --help')

      expect(output).to.contain('Remove orphaned containers')
      expect(output).to.contain('--force')
      expect(output).to.contain('--dry-run')
      expect(output).to.contain('--all')
      expect(output).to.contain('USAGE')
    })

    it('should accept --dry-run flag without unknown flag error', () => {
      const output = exec('docker clean --dry-run --help')

      // Should not error with --dry-run flag
      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --all flag without unknown flag error', () => {
      const output = exec('docker clean --all --help')

      // Should not error with --all flag
      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --force flag without unknown flag error', () => {
      const output = exec('docker clean --force --help')

      // Should accept --force flag
      expect(output).to.not.contain('Unknown flag')
    })

    it('should handle missing workspace gracefully', () => {
      const output = exec('docker clean --force')

      // When run outside workspace, should indicate workspace required
      // or if Docker isn't running, show that message
      const validOutput =
        output.includes('Not in a workspace') ||
        output.includes('Docker is not running') ||
        output.includes('No orphaned containers') ||
        output.includes('Removed')
      expect(validOutput).to.be.true
    })

    it('should accept --json flag for JSON mode support', () => {
      const output = exec('docker clean --json --help')

      // Should show --json flag in help
      expect(output).to.contain('--json')
      expect(output).to.contain('JSON')
    })
  })

  /**
   * prlt docker logs
   */
  describe('prlt docker logs', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker logs --help')

      expect(output).to.contain('View logs from a container')
      expect(output).to.contain('--follow')
      expect(output).to.contain('--tail')
      expect(output).to.contain('USAGE')
    })

    it('should accept --follow flag without unknown flag error', () => {
      const output = exec('docker logs --follow --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --tail flag without unknown flag error', () => {
      const output = exec('docker logs --tail 50 --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should require a target argument', () => {
      const output = exec('docker logs')

      // Should indicate missing argument
      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        output.includes('Docker is not running')
      expect(validOutput).to.be.true
    })

    it('should accept execution ID format', () => {
      const output = exec('docker logs WORK-001')

      // Should process the command (may fail due to no Docker or no execution)
      const validOutput =
        output.includes('Docker is not running') ||
        output.includes('not found') ||
        output.includes('Logs for')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker stop
   */
  describe('prlt docker stop', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker stop --help')

      expect(output).to.contain('Stop a running container')
      expect(output).to.contain('--force')
      expect(output).to.contain('--time')
      expect(output).to.contain('USAGE')
    })

    it('should accept --force flag without unknown flag error', () => {
      const output = exec('docker stop --force --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --time flag without unknown flag error', () => {
      const output = exec('docker stop --time 30 --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should require a target argument', () => {
      const output = exec('docker stop')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        output.includes('Docker is not running')
      expect(validOutput).to.be.true
    })

    it('should accept --json flag for JSON mode support', () => {
      const output = exec('docker stop --json --help')

      // Should show --json flag in help
      expect(output).to.contain('--json')
      expect(output).to.contain('JSON')
    })
  })

  /**
   * prlt docker shell
   */
  describe('prlt docker shell', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker shell --help')

      expect(output).to.contain('Open a shell in a running container')
      expect(output).to.contain('--shell')
      expect(output).to.contain('--user')
      expect(output).to.contain('USAGE')
    })

    it('should accept --shell flag without unknown flag error', () => {
      const output = exec('docker shell --shell /bin/bash --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --user flag without unknown flag error', () => {
      const output = exec('docker shell --user root --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should require a target argument', () => {
      const output = exec('docker shell')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        output.includes('Docker is not running')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker restart
   */
  describe('prlt docker restart', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker restart --help')

      expect(output).to.contain('Restart a container')
      expect(output).to.contain('--force')
      expect(output).to.contain('--time')
      expect(output).to.contain('USAGE')
    })

    it('should accept --force flag without unknown flag error', () => {
      const output = exec('docker restart --force --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should require a target argument', () => {
      const output = exec('docker restart')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        output.includes('Docker is not running')
      expect(validOutput).to.be.true
    })

    it('should accept --json flag for JSON mode support', () => {
      const output = exec('docker restart --json --help')

      // Should show --json flag in help
      expect(output).to.contain('--json')
      expect(output).to.contain('JSON')
    })
  })

  /**
   * prlt docker start
   */
  describe('prlt docker start', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker start --help')

      expect(output).to.contain('Start a stopped container')
      expect(output).to.contain('USAGE')
    })

    it('should require a target argument', () => {
      const output = exec('docker start')

      const validOutput =
        output.includes('Missing required arg') ||
        output.includes('target') ||
        output.includes('Docker is not running')
      expect(validOutput).to.be.true
    })

    it('should accept execution ID format', () => {
      const output = exec('docker start WORK-001')

      // Should process the command (may fail due to no Docker or no execution)
      const validOutput =
        output.includes('Docker is not running') ||
        output.includes('not found') ||
        output.includes('Started') ||
        output.includes('already running') ||
        output.includes('Failed to start') ||
        output.includes('Start Container')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker sync
   */
  describe('prlt docker sync', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker sync --help')

      expect(output).to.contain('Sync container status from Docker into the database')
      expect(output).to.contain('USAGE')
    })

    it('should handle missing workspace gracefully', () => {
      const output = exec('docker sync')

      // When run outside workspace, should indicate workspace required
      // or if Docker isn't running, show that message
      const validOutput =
        output.includes('Not in a workspace') ||
        output.includes('Docker is not running') ||
        output.includes('Syncing Containers') ||
        output.includes('Sync complete')
      expect(validOutput).to.be.true
    })
  })

  /**
   * prlt docker prune
   */
  describe('prlt docker prune', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker prune --help')

      expect(output).to.contain('Remove unused Docker resources')
      expect(output).to.contain('--force')
      expect(output).to.contain('--dry-run')
      expect(output).to.contain('--all')
      expect(output).to.contain('--volumes')
      expect(output).to.contain('USAGE')
    })

    it('should accept --dry-run flag without unknown flag error', () => {
      const output = exec('docker prune --dry-run --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --all flag without unknown flag error', () => {
      const output = exec('docker prune --all --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should accept --volumes flag without unknown flag error', () => {
      const output = exec('docker prune --volumes --help')

      expect(output).to.not.contain('Unknown flag')
    })

    it('should handle Docker not running gracefully', () => {
      const output = exec('docker prune --force')

      const validOutput =
        output.includes('Docker is not running') ||
        output.includes('Docker Prune') ||
        output.includes('prune completed')
      expect(validOutput).to.be.true
    })

    it('should accept --json flag for JSON mode support', () => {
      const output = exec('docker prune --json --help')

      // Should show --json flag in help
      expect(output).to.contain('--json')
      expect(output).to.contain('JSON')
    })
  })

  /**
   * prlt docker (main menu)
   */
  describe('prlt docker', () => {
    it('should show help with --help flag', () => {
      const output = exec('docker --help')

      expect(output).to.contain('Manage Docker containers')
      // Subcommands are listed with their full names
      expect(output).to.contain('clean')
      expect(output).to.contain('list')
      expect(output).to.contain('COMMANDS')
    })

    it('should list available subcommands in examples', () => {
      const output = exec('docker --help')

      // Examples section shows full command syntax
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
   * These tests verify that docker commands output proper JSON when --json flag is used.
   * Note: These tests may be skipped if Docker is not running, since the commands
   * exit with an error before outputting JSON.
   */
  describe('JSON Mode Output', () => {
    /**
     * Helper to check if output indicates Docker/workspace errors
     */
    function hasDockerOrWorkspaceError(output: string): boolean {
      return (
        output.includes('Docker is not running') ||
        output.includes('docker: not found') ||
        output.includes('Docker check attempt') ||
        output.includes('Not in a workspace') ||
        output.includes('Could not find container') ||
        output.includes('does not exist')
      )
    }

    /**
     * Helper to safely parse JSON from command output.
     * Returns null if output contains error messages or no valid JSON.
     */
    function tryParsePromptJson(output: string): { prompt: Record<string, unknown>; metadata: Record<string, unknown> } | null {
      // Skip if Docker not running or workspace errors
      if (hasDockerOrWorkspaceError(output)) {
        return null
      }

      // Look for JSON that starts with {"prompt"
      const jsonMatch = output.match(/\{"prompt"[\s\S]*\}/)
      if (!jsonMatch) return null

      try {
        return JSON.parse(jsonMatch[0])
      } catch {
        return null
      }
    }

    it('prlt docker --json should output action menu as JSON', () => {
      const output = exec('docker --json')
      const json = tryParsePromptJson(output)

      // Skip test if Docker not available
      if (!json) {
        return
      }

      expect(json.prompt).to.exist
      expect(json.prompt.type).to.equal('list')
      expect(json.prompt.name).to.equal('action')
      expect(json.prompt.message).to.include('What would you like to do')
      expect(json.prompt.choices).to.be.an('array')
      expect((json.prompt.choices as unknown[]).length).to.be.greaterThan(0)

      // Each choice should have name, value, and command
      const statusChoice = (json.prompt.choices as Array<{ value: string; name: string; command: string }>).find(
        c => c.value === 'status'
      )
      expect(statusChoice).to.exist
      expect(statusChoice!.name).to.include('Docker status')
      expect(statusChoice!.command).to.include('prlt docker status')

      expect(json.metadata).to.exist
      expect(json.metadata.command).to.equal('docker')
    })

    it('prlt docker clean --json should output confirm prompt or error', () => {
      const output = exec('docker clean --json')
      const json = tryParsePromptJson(output)

      // If we get JSON, validate it
      if (json) {
        expect(json.prompt).to.exist
        expect(json.prompt.type).to.equal('list')
        expect(json.prompt.name).to.equal('confirmed')
        expect(json.prompt.choices).to.be.an('array')
        expect(json.metadata).to.exist
        expect(json.metadata.command).to.equal('docker clean')
      } else {
        // Should have an error message
        const hasError =
          output.includes('Docker is not running') ||
          output.includes('Not in a workspace')
        expect(hasError).to.be.true
      }
    })

    it('prlt docker prune --json should output confirm prompt or error', () => {
      const output = exec('docker prune --json')
      const json = tryParsePromptJson(output)

      // If we get JSON, validate it
      if (json) {
        expect(json.prompt).to.exist
        expect(json.prompt.type).to.equal('list')
        expect(json.prompt.name).to.equal('confirmed')
        expect(json.metadata).to.exist
        expect(json.metadata.command).to.equal('docker prune')
      } else {
        // Should have Docker error
        expect(hasDockerOrWorkspaceError(output)).to.be.true
      }
    })

    it('prlt docker stop <target> --json should output confirm prompt or error', () => {
      const output = exec('docker stop test-container --json')
      const json = tryParsePromptJson(output)

      // If we get JSON, validate it
      if (json) {
        expect(json.prompt).to.exist
        expect(json.prompt.type).to.equal('list')
        expect(json.prompt.name).to.equal('confirmed')
        expect(json.metadata).to.exist
        expect(json.metadata.command).to.equal('docker stop')
      } else {
        // Should have an error
        expect(hasDockerOrWorkspaceError(output)).to.be.true
      }
    })

    it('prlt docker restart <target> --json should output confirm prompt or error', () => {
      const output = exec('docker restart test-container --json')
      const json = tryParsePromptJson(output)

      // If we get JSON, validate it
      if (json) {
        expect(json.prompt).to.exist
        expect(json.prompt.type).to.equal('list')
        expect(json.prompt.name).to.equal('confirmed')
        expect(json.metadata).to.exist
        expect(json.metadata.command).to.equal('docker restart')
      } else {
        // Should have an error
        expect(hasDockerOrWorkspaceError(output)).to.be.true
      }
    })

    it('--force flag should skip confirmation prompt in JSON mode', () => {
      // With --force, should not output a prompt (goes straight to execution)
      const output = exec('docker clean --force --json')

      // If Docker not running, we get that message
      // If workspace not found, we get that error
      // If --force works, no prompt JSON is output
      const hasDockerError = output.includes('Docker is not running')
      const hasWorkspaceError = output.includes('Not in a workspace')
      const hasNoOrphans = output.includes('No orphaned containers')

      // Should NOT have a prompt JSON when --force is used
      const jsonMatch = output.match(/\{"prompt"/)
      if (!hasDockerError && !hasWorkspaceError && !hasNoOrphans) {
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

      // Query for executions with containers that are not in running/starting status
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

/**
 * End-to-end Agent Flow Tests (--machine flag)
 * These tests simulate an AI agent navigating through docker commands
 * using the JSON machine-readable output.
 */
describe('End-to-end Agent Flows (--machine flag)', () => {
  /**
   * Extract JSON from CLI output that may contain warnings.
   */
  function extractJson<T>(output: string): T | null {
    const lines = output.split('\n')
    let jsonStart = -1

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed.startsWith('{')) {
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
   * Helper to simulate agent flow: execute command, parse JSON
   */
  function agentExec(cmd: string): {
    prompt: {
      type: string
      name: string
      message: string
      choices: Array<{ name: string; value: string; command?: string }>
    }
    metadata: { command: string; flags: Record<string, unknown> }
  } | null {
    const output = exec(cmd)
    // Skip if Docker not running or workspace errors
    if (
      output.includes('Docker is not running') ||
      output.includes('Not in a workspace') ||
      output.includes('docker: not found')
    ) {
      return null
    }
    return extractJson(output)
  }

  /**
   * Helper to find a choice by partial name match
   */
  function findChoice(
    choices: Array<{ name: string; value: string; command?: string }>,
    pattern: string
  ): { name: string; value: string; command?: string } | undefined {
    return choices.find(c => c.name.toLowerCase().includes(pattern.toLowerCase()))
  }

  /**
   * Helper to execute the command from a choice (strips 'prlt ' prefix)
   */
  function execChoice(choice: { command?: string }): string {
    if (!choice.command) throw new Error('Choice has no command')
    return choice.command.replace('prlt ', '')
  }

  describe('docker main menu - agent navigation', () => {
    it('should output action menu with --machine flag', () => {
      const result = agentExec('docker --machine')

      // Skip if Docker/workspace not available
      if (!result) {
        return
      }

      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('action')
      expect(result.prompt.choices).to.be.an('array')
      expect(result.metadata.flags.machine).to.equal(true)
    })

    it('should include command field in all choices', () => {
      const result = agentExec('docker --machine')

      if (!result) {
        return
      }

      for (const choice of result.prompt.choices) {
        expect(choice.command).to.exist
        expect(choice.command).to.include('prlt docker')
      }
    })

    it('should have navigable choices to subcommands', () => {
      const result = agentExec('docker --machine')

      if (!result) {
        return
      }

      // Should have status, list, clean, prune options
      const statusChoice = findChoice(result.prompt.choices, 'status')
      expect(statusChoice).to.exist
      expect(statusChoice!.command).to.include('docker status')

      const listChoice = findChoice(result.prompt.choices, 'list')
      expect(listChoice).to.exist
      expect(listChoice!.command).to.include('docker list')
    })
  })

  describe('docker clean - agent confirmation flow', () => {
    it('should output confirmation prompt with --machine', () => {
      const result = agentExec('docker clean --machine')

      if (!result) {
        return
      }

      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('confirmed')
      expect(result.prompt.choices).to.be.an('array')

      // Should have Yes/No choices
      const yesChoice = findChoice(result.prompt.choices, 'yes')
      const noChoice = findChoice(result.prompt.choices, 'no')
      expect(yesChoice || noChoice).to.exist
    })

    it('should include command in confirmation choices', () => {
      const result = agentExec('docker clean --machine')

      if (!result) {
        return
      }

      for (const choice of result.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('docker clean')
        }
      }
    })
  })

  describe('docker prune - agent confirmation flow', () => {
    it('should output confirmation prompt with --machine', () => {
      const result = agentExec('docker prune --machine')

      if (!result) {
        return
      }

      expect(result.prompt.type).to.equal('list')
      expect(result.prompt.name).to.equal('confirmed')
      expect(result.metadata.command).to.equal('docker prune')
    })
  })

  describe('full agent navigation flow', () => {
    it('should allow agent to navigate from main menu to clean', () => {
      // Step 1: Get main menu
      const step1 = agentExec('docker --machine')

      if (!step1) {
        return
      }

      // Step 2: Find and select "clean" option
      const cleanChoice = findChoice(step1.prompt.choices, 'clean')
      if (!cleanChoice) {
        // Clean option might not be available
        return
      }

      expect(cleanChoice.command).to.include('docker clean')
      expect(cleanChoice.command).to.include('--json')

      // Step 3: Execute the clean command
      const cleanCmd = execChoice(cleanChoice)
      const step2 = agentExec(cleanCmd)

      if (!step2) {
        return
      }

      // Should get confirmation prompt
      expect(step2.prompt.type).to.equal('list')
      expect(step2.prompt.name).to.equal('confirmed')
    })

    it('should allow agent to navigate from main menu to status', () => {
      // Step 1: Get main menu
      const step1 = agentExec('docker --machine')

      if (!step1) {
        return
      }

      // Step 2: Find status option
      const statusChoice = findChoice(step1.prompt.choices, 'status')
      expect(statusChoice).to.exist
      expect(statusChoice!.command).to.include('docker status')
    })
  })

  describe('--machine vs --json equivalence', () => {
    it('should produce equivalent output structure', () => {
      const machineOutput = exec('docker --machine')
      const jsonOutput = exec('docker --json')

      const machineResult = extractJson<{ prompt: { type: string } }>(machineOutput)
      const jsonResult = extractJson<{ prompt: { type: string } }>(jsonOutput)

      // Both should parse to same structure (or both fail due to Docker)
      if (machineResult && jsonResult) {
        expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type)
      }
    })

    it('should work with -m shorthand', () => {
      const result = agentExec('docker -m')

      if (!result) {
        return
      }

      expect(result.prompt).to.exist
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

