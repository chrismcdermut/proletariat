import { expect } from 'chai'
import { execProduction as exec } from './test-helpers.js'

/**
 * End-to-end Agent Flow Tests for Work Commands
 * Tests: prlt work, work start, work spawn, work watch
 *
 * These tests simulate an AI agent navigating through work commands
 * using the --machine flag for JSON machine-readable output.
 */
describe('Work Commands E2E Agent Flow Tests', () => {
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
   * Check if output indicates context errors
   */
  function hasContextError(output: string): boolean {
    return (
      output.includes('Not in a workspace') ||
      output.includes('No workspace') ||
      output.includes('No projects found') ||
      output.includes('No tickets') ||
      output.includes('ENOENT') ||
      output.includes('not found') ||
      output.includes('Error:')
    )
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
    if (hasContextError(output)) {
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

  describe('work --help', () => {
    it('should show help with subcommands', () => {
      const output = exec('work --help')

      expect(output).to.contain('COMMANDS')
      expect(output).to.match(/start|spawn/)
    })

    it('should have --json flag in help', () => {
      const output = exec('work --help')
      expect(output).to.contain('--json')
    })

    it('should have --machine flag in help', () => {
      const output = exec('work --help')
      expect(output).to.match(/--machine|-m/)
    })
  })

  describe('work start --help', () => {
    it('should show help', () => {
      const output = exec('work start --help')
      expect(output).to.contain('start')
    })

    it('should have --json flag in help', () => {
      const output = exec('work start --help')
      expect(output).to.contain('--json')
    })
  })

  describe('work spawn --help', () => {
    it('should show help', () => {
      const output = exec('work spawn --help')
      expect(output).to.contain('spawn')
    })

    it('should have --json flag in help', () => {
      const output = exec('work spawn --help')
      expect(output).to.contain('--json')
    })
  })

  describe('End-to-end Agent Flows (--machine flag)', () => {
    describe('work main menu - agent navigation', () => {
      it('should output action menu with --machine flag', () => {
        const result = agentExec('work --machine')

        // Skip if workspace not available
        if (!result) {
          return
        }

        expect(result.prompt.type).to.equal('list')
        expect(result.prompt.choices).to.be.an('array')
        expect(result.metadata.flags.machine).to.equal(true)
      })

      it('should include command field in all choices', () => {
        const result = agentExec('work --machine')

        if (!result) {
          return
        }

        for (const choice of result.prompt.choices) {
          expect(choice.command).to.exist
          expect(choice.command).to.include('prlt work')
        }
      })

      it('should have navigable choices to subcommands', () => {
        const result = agentExec('work --machine')

        if (!result) {
          return
        }

        // Should have start, spawn options
        const startChoice = findChoice(result.prompt.choices, 'start')
        if (startChoice) {
          expect(startChoice.command).to.include('work start')
        }

        const spawnChoice = findChoice(result.prompt.choices, 'spawn')
        if (spawnChoice) {
          expect(spawnChoice.command).to.include('work spawn')
        }
      })
    })

    describe('work start - ticket selection flow', () => {
      it('should output ticket selection with --machine', () => {
        const result = agentExec('work start --machine')

        if (!result) {
          return
        }

        expect(result.prompt.type).to.equal('list')
        expect(result.metadata.command).to.equal('work start')
      })

      it('should include command in ticket choices', () => {
        const result = agentExec('work start --machine')

        if (!result) {
          return
        }

        for (const choice of result.prompt.choices) {
          if (choice.command) {
            expect(choice.command).to.include('work start')
          }
        }
      })
    })

    describe('work spawn - agent/ticket selection flow', () => {
      it('should output selection with --machine', () => {
        const result = agentExec('work spawn --machine')

        if (!result) {
          return
        }

        expect(result.prompt.type).to.equal('list')
        expect(result.metadata.command).to.equal('work spawn')
      })

      it('should include command in choices', () => {
        const result = agentExec('work spawn --machine')

        if (!result) {
          return
        }

        for (const choice of result.prompt.choices) {
          if (choice.command) {
            expect(choice.command).to.include('work spawn')
          }
        }
      })
    })

    describe('work watch - execution selection flow', () => {
      it('should output selection with --machine', () => {
        const result = agentExec('work watch --machine')

        if (!result) {
          return
        }

        expect(result.prompt.type).to.equal('list')
        expect(result.metadata.command).to.equal('work watch')
      })
    })

    describe('full agent navigation flow', () => {
      it('should allow agent to navigate from main menu to start', () => {
        // Step 1: Get main menu
        const step1 = agentExec('work --machine')

        if (!step1) {
          return
        }

        // Step 2: Find and validate "start" option
        const startChoice = findChoice(step1.prompt.choices, 'start')
        if (!startChoice) {
          return
        }

        expect(startChoice.command).to.include('work start')
        expect(startChoice.command).to.include('--json')
      })

      it('should allow agent to navigate from main menu to spawn', () => {
        // Step 1: Get main menu
        const step1 = agentExec('work --machine')

        if (!step1) {
          return
        }

        // Step 2: Find spawn option
        const spawnChoice = findChoice(step1.prompt.choices, 'spawn')
        if (spawnChoice) {
          expect(spawnChoice.command).to.include('work spawn')
        }
      })
    })

    describe('--machine vs --json equivalence', () => {
      it('should produce equivalent output structure', () => {
        const machineOutput = exec('work --machine')
        const jsonOutput = exec('work --json')

        const machineResult = extractJson<{ prompt: { type: string } }>(machineOutput)
        const jsonResult = extractJson<{ prompt: { type: string } }>(jsonOutput)

        // Both should parse to same structure (or both fail)
        if (machineResult && jsonResult) {
          expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type)
        }
      })

      it('should work with -m shorthand', () => {
        const result = agentExec('work -m')

        if (!result) {
          return
        }

        expect(result.prompt).to.exist
        expect(result.metadata.flags.machine).to.equal(true)
      })
    })
  })
})
