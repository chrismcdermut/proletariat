import { expect } from 'chai'
import { execInProcess } from './test-helpers.js'

/**
 * End-to-end tests for Agent Management Commands
 * Tests: prlt agent, agent list, agent status, agent shell, agent visit, agent login
 *
 * Note: These tests run with or without a workspace. Commands that require
 * a workspace will gracefully handle the missing context.
 */
describe('Agent Commands E2E Tests', () => {
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
   * Check if output indicates workspace/context errors
   */
  function hasContextError(output: string): boolean {
    return (
      output.includes('Not in a workspace') ||
      output.includes('No agents found') ||
      output.includes('No workspace') ||
      output.includes('ENOENT') ||
      output.includes('not found')
    )
  }

  /**
   * Helper to simulate agent flow: execute command, parse JSON
   */
  async function agentExec(cmd: string): Promise<{
    prompt: {
      type: string
      name: string
      message: string
      choices: Array<{ name: string; value: string; command?: string }>
    }
    metadata: { command: string; flags: Record<string, unknown> }
  } | null> {
    const output = await execInProcess(cmd)
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

  describe('prlt agent --help', () => {
    it('should show help with subcommands', async () => {
      const output = await execInProcess('agent --help')

      expect(output).to.contain('Manage agents')
      expect(output).to.contain('COMMANDS')
      expect(output).to.contain('list')
      expect(output).to.contain('status')
      expect(output).to.contain('shell')
    })

    it('should have --json flag in help', async () => {
      const output = await execInProcess('agent --help')
      expect(output).to.contain('--json')
    })

    it('should have --machine flag in help', async () => {
      const output = await execInProcess('agent --help')
      expect(output).to.contain('--machine')
      expect(output).to.contain('-m')
    })
  })

  describe('prlt agent list --help', () => {
    it('should show help with flags', async () => {
      const output = await execInProcess('agent list --help')

      expect(output).to.contain('List')
      expect(output).to.contain('agents')
      expect(output).to.contain('--type')
    })

    it('should have machine output flags in help', async () => {
      const output = await execInProcess('agent list --help')
      // Uses pmoBaseFlags which has --machine
      expect(output).to.match(/--json|--machine/)
    })
  })

  describe('prlt agent status --help', () => {
    it('should show help', async () => {
      const output = await execInProcess('agent status --help')

      expect(output).to.contain('status')
      expect(output).to.contain('ARGUMENTS')
    })

    it('should have --json flag in help', async () => {
      const output = await execInProcess('agent status --help')
      expect(output).to.contain('--json')
    })
  })

  describe('prlt agent shell --help', () => {
    it('should show help', async () => {
      const output = await execInProcess('agent shell --help')

      expect(output).to.contain('shell')
      expect(output).to.contain('ARGUMENTS')
    })

    it('should have --json flag in help', async () => {
      const output = await execInProcess('agent shell --help')
      expect(output).to.contain('--json')
    })
  })

  describe('prlt agent visit --help', () => {
    it('should show help', async () => {
      const output = await execInProcess('agent visit --help')

      expect(output).to.contain('visit')
      expect(output).to.contain('ARGUMENTS')
    })

    it('should have --json flag in help', async () => {
      const output = await execInProcess('agent visit --help')
      expect(output).to.contain('--json')
    })
  })

  describe('prlt agent login --help', () => {
    it('should show help', async () => {
      const output = await execInProcess('agent login --help')

      expect(output).to.contain('login')
      expect(output).to.contain('ARGUMENTS')
    })

    it('should have --json flag in help', async () => {
      const output = await execInProcess('agent login --help')
      expect(output).to.contain('--json')
    })
  })

  /**
   * End-to-end Agent Flow Tests (--machine flag)
   * These tests simulate an AI agent navigating through agent commands
   * using the JSON machine-readable output.
   */
  describe('End-to-end Agent Flows (--machine flag)', () => {
    describe('agent main menu - agent navigation', () => {
      it('should output action menu with --machine flag', async () => {
        const result = await agentExec('agent --machine')

        // Skip if workspace not available
        if (!result) {
          return
        }

        expect(result.prompt.type).to.equal('list')
        expect(result.prompt.choices).to.be.an('array')
        expect(result.metadata.flags.machine).to.equal(true)
      })

      it('should include command field in non-cancel choices', async () => {
        const result = await agentExec('agent --machine')

        if (!result) {
          return
        }

        // Filter out cancel choice which has empty command
        const actionChoices = result.prompt.choices.filter(c => c.value !== 'cancel')
        for (const choice of actionChoices) {
          expect(choice.command).to.include('prlt agent')
        }
      })

      it('should have navigable choices to subcommands', async () => {
        const result = await agentExec('agent --machine')

        if (!result) {
          return
        }

        // Should have list, status options
        const listChoice = findChoice(result.prompt.choices, 'list')
        if (listChoice) {
          expect(listChoice.command).to.include('agent list')
        }

        const statusChoice = findChoice(result.prompt.choices, 'status')
        if (statusChoice) {
          expect(statusChoice.command).to.include('agent status')
        }
      })
    })

    describe('agent list - JSON output', () => {
      it('should output all agents grouped by type with --machine (no --type)', async () => {
        const output = await execInProcess('agent list --machine')

        if (hasContextError(output)) {
          return
        }

        const result = extractJson<{ staff: unknown[]; temp: unknown[] }>(output)

        if (!result) {
          return
        }

        // Should have staff and temp arrays (no redundant 'all' array)
        expect(result).to.have.property('staff')
        expect(result).to.have.property('temp')
        expect(result).to.not.have.property('all')
        expect(Array.isArray(result.staff)).to.equal(true)
        expect(Array.isArray(result.temp)).to.equal(true)
      })

      it('should work with --type flag to filter agents', async () => {
        // When --type is provided, it should filter to that type
        // This just verifies the command works with --type
        const output = await execInProcess('agent list --machine --type all')

        if (hasContextError(output)) {
          return
        }

        // Should output JSON or agent list, not throw an exception
        expect(output).to.not.include('command failed')
      })
    })

    describe('agent status - JSON output', () => {
      it('should output agent statuses with --machine', async () => {
        const output = await execInProcess('agent status --machine')

        if (hasContextError(output)) {
          return
        }

        const result = extractJson<{ type: string; result?: { agents: unknown[] }; prompt?: { type: string }; metadata: { command: string } }>(output)

        if (!result) {
          return
        }

        // agent status --machine returns all agents directly (no prompt)
        // when agents exist, or a prompt when the command needs selection
        expect(result.metadata.command).to.equal('agent status')
        if (result.type === 'success' && result.result) {
          expect(result.result).to.have.property('agents')
          expect(Array.isArray(result.result.agents)).to.equal(true)
        } else if (result.prompt) {
          expect(result.prompt.type).to.equal('list')
        }
      })

      it('should include agent data when agents exist', async () => {
        const output = await execInProcess('agent status --machine')

        if (hasContextError(output)) {
          return
        }

        const result = extractJson<{ type: string; result?: { agents: Array<{ name: string }> }; prompt?: { choices: Array<{ command?: string }> } }>(output)

        if (!result) {
          return
        }

        // When returning all agents directly, each agent should have a name
        if (result.type === 'success' && result.result?.agents) {
          for (const agent of result.result.agents) {
            expect(agent).to.have.property('name')
          }
        } else if (result.prompt?.choices) {
          for (const choice of result.prompt.choices) {
            if (choice.command) {
              expect(choice.command).to.include('agent status')
            }
          }
        }
      })
    })

    describe('agent shell - agent selection flow', () => {
      it('should output agent selection with --machine', async () => {
        const result = await agentExec('agent shell --machine')

        if (!result) {
          return
        }

        expect(result.prompt.type).to.equal('list')
        expect(result.metadata.command).to.equal('agent shell')
      })

      it('should include command in agent choices', async () => {
        const result = await agentExec('agent shell --machine')

        if (!result) {
          return
        }

        for (const choice of result.prompt.choices) {
          if (choice.command) {
            expect(choice.command).to.include('agent shell')
          }
        }
      })
    })

    describe('agent visit - agent selection flow', () => {
      it('should output agent selection with --machine', async () => {
        const result = await agentExec('agent visit --machine')

        if (!result) {
          return
        }

        expect(result.prompt.type).to.equal('list')
        expect(result.metadata.command).to.equal('agent visit')
      })

      it('should include command in agent choices', async () => {
        const result = await agentExec('agent visit --machine')

        if (!result) {
          return
        }

        for (const choice of result.prompt.choices) {
          if (choice.command) {
            expect(choice.command).to.include('agent visit')
          }
        }
      })
    })

    describe('agent login - agent selection flow', () => {
      it('should output agent selection with --machine', async () => {
        const result = await agentExec('agent login --machine')

        // Skip if no result or if it's an error response (e.g., Docker not running, no agents)
        if (!result || !result.prompt) {
          return
        }

        expect(result.prompt.type).to.equal('list')
        expect(result.metadata.command).to.equal('agent login')
      })

      it('should include command in agent choices', async () => {
        const result = await agentExec('agent login --machine')

        // Skip if no result or if it's an error response
        if (!result || !result.prompt) {
          return
        }

        for (const choice of result.prompt.choices) {
          if (choice.command) {
            expect(choice.command).to.include('agent login')
          }
        }
      })
    })

    describe('full agent navigation flow', () => {
      it('should allow agent to navigate from main menu to list', async () => {
        // Step 1: Get main menu
        const step1 = await agentExec('agent --machine')

        if (!step1) {
          return
        }

        // Step 2: Find and validate "list" option
        const listChoice = findChoice(step1.prompt.choices, 'list')
        if (!listChoice) {
          return
        }

        expect(listChoice.command).to.include('agent list')
        // Command uses --machine flag for JSON mode
        expect(listChoice.command).to.match(/--json|--machine/)
      })

      it('should allow agent to navigate from main menu to status', async () => {
        // Step 1: Get main menu
        const step1 = await agentExec('agent --machine')

        if (!step1) {
          return
        }

        // Step 2: Find status option
        const statusChoice = findChoice(step1.prompt.choices, 'status')
        if (statusChoice) {
          expect(statusChoice.command).to.include('agent status')
        }
      })
    })

    describe('--machine vs --json equivalence', () => {
      it('should produce equivalent output structure', async () => {
        const machineOutput = await execInProcess('agent --machine')
        const jsonOutput = await execInProcess('agent --json')

        const machineResult = extractJson<{ prompt: { type: string } }>(machineOutput)
        const jsonResult = extractJson<{ prompt: { type: string } }>(jsonOutput)

        // Both should parse to same structure (or both fail)
        if (machineResult && jsonResult) {
          expect(machineResult.prompt.type).to.equal(jsonResult.prompt.type)
        }
      })

      it('should work with -m shorthand', async () => {
        const result = await agentExec('agent -m')

        if (!result) {
          return
        }

        expect(result.prompt).to.exist
        expect(result.metadata.flags.machine).to.equal(true)
      })
    })
  })
})
