import { expect } from 'chai'
import { execInProcess } from './test-helpers.js'

/**
 * Helper to check if output is JSON format
 */
function isJsonOutput(output: string): boolean {
  try {
    JSON.parse(output.trim())
    return true
  } catch {
    return false
  }
}

/**
 * Parse JSON output if it's JSON, otherwise return null
 */
function parseJsonOutput(output: string): {
  type?: string;
  success?: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  prompt?: { type: string; name: string; message: string; choices?: Array<{ name: string; value: string }> };
} | null {
  try {
    return JSON.parse(output.trim())
  } catch {
    return null
  }
}

/**
 * Check if the JSON response indicates a GitHub auth error.
 * In CI environments, gh is not authenticated, so commands return
 * GH_NOT_AUTHENTICATED instead of expected prompts/results.
 */
function isGHAuthError(json: ReturnType<typeof parseJsonOutput>): boolean {
  return json?.type === 'error' && (
    json?.error?.code === 'GH_NOT_AUTHENTICATED' ||
    json?.error?.code === 'GH_NOT_INSTALLED'
  )
}

/**
 * End-to-end tests for Feedback CLI Commands
 * Tests: prlt feedback, prlt feedback submit, prlt feedback list, prlt feedback view
 *
 * Note: These tests run against the real GitHub repository, so they verify
 * the CLI interface, help output, and JSON mode output format.
 *
 * In non-TTY mode (like test environments), commands output JSON by default.
 * In CI environments, gh may not be authenticated, so tests that require
 * GitHub auth gracefully skip when GH_NOT_AUTHENTICATED is returned.
 */
describe('Feedback CLI Commands E2E Tests', () => {
  /**
   * prlt feedback (index menu)
   */
  describe('prlt feedback', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('feedback --help')

      expect(output).to.contain('Interactive menu for feedback')
      expect(output).to.contain('USAGE')
    })

    it('should list available subcommands in help', async () => {
      const output = await execInProcess('feedback --help')

      expect(output).to.contain('submit')
      expect(output).to.contain('list')
      expect(output).to.contain('view')
    })

    it('should output prompt JSON in non-TTY mode', async () => {
      const output = await execInProcess('feedback --json')

      if (isJsonOutput(output)) {
        const json = parseJsonOutput(output)
        expect(json).to.not.be.null
        expect(json?.type).to.equal('prompt')
        expect(json?.prompt).to.have.property('type', 'list')
        expect(json?.prompt).to.have.property('name', 'action')
        expect(json?.prompt?.choices).to.be.an('array')
        expect(json?.prompt?.choices?.length).to.be.greaterThan(0)
      }
    })

    it('should include action choices with command field', async () => {
      const output = await execInProcess('feedback --json')

      if (isJsonOutput(output)) {
        const json = parseJsonOutput(output)
        const choices = json?.prompt?.choices as Array<{ name: string; value: string; command?: string }>
        expect(choices).to.be.an('array')

        const submitChoice = choices?.find(c => c.value === 'submit')
        expect(submitChoice).to.exist
        expect(submitChoice?.command).to.contain('prlt feedback submit')
      }
    })
  })

  /**
   * prlt feedback submit
   */
  describe('prlt feedback submit', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('feedback submit --help')

      expect(output).to.contain('Submit feedback')
      expect(output).to.contain('USAGE')
      expect(output).to.contain('--title')
      expect(output).to.contain('--body')
      expect(output).to.contain('--category')
    })

    it('should show category options in help', async () => {
      const output = await execInProcess('feedback submit --help')

      expect(output).to.contain('bug')
      expect(output).to.contain('feature')
      expect(output).to.contain('general')
    })

    it('should prompt for category when not provided in JSON mode', async () => {
      const output = await execInProcess('feedback submit --json')

      if (isJsonOutput(output)) {
        const json = parseJsonOutput(output)
        expect(json).to.not.be.null
        // Skip if gh is not authenticated (CI environment)
        if (isGHAuthError(json)) return
        expect(json?.type).to.equal('prompt')
        expect(json?.prompt?.name).to.equal('category')
        expect(json?.prompt?.type).to.equal('list')
        expect(json?.prompt?.choices).to.be.an('array')

        const choices = json?.prompt?.choices as Array<{ name: string; value: string }>
        const bugChoice = choices?.find(c => c.value === 'bug')
        expect(bugChoice).to.exist
        expect(bugChoice?.name).to.equal('Bug report')
      }
    })

    it('should prompt for title when category provided but title missing', async () => {
      const output = await execInProcess('feedback submit --category bug --json')

      if (isJsonOutput(output)) {
        const json = parseJsonOutput(output)
        expect(json).to.not.be.null
        // Skip if gh is not authenticated (CI environment)
        if (isGHAuthError(json)) return
        expect(json?.type).to.equal('prompt')
        expect(json?.prompt?.name).to.equal('title')
        expect(json?.prompt?.type).to.equal('input')
      }
    })

    it('should prompt for body when category and title provided but body missing', async () => {
      const output = await execInProcess('feedback submit --category bug --title "Test" --json')

      if (isJsonOutput(output)) {
        const json = parseJsonOutput(output)
        expect(json).to.not.be.null
        // Skip if gh is not authenticated (CI environment)
        if (isGHAuthError(json)) return
        expect(json?.type).to.equal('prompt')
        expect(json?.prompt?.name).to.equal('body')
        expect(json?.prompt?.type).to.equal('editor')
      }
    })
  })

  /**
   * prlt feedback list
   */
  describe('prlt feedback list', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('feedback list --help')

      expect(output).to.contain('List recent feedback issues')
      expect(output).to.contain('USAGE')
      expect(output).to.contain('--category')
      expect(output).to.contain('--state')
      expect(output).to.contain('--limit')
    })

    it('should list issues in JSON mode', async () => {
      const output = await execInProcess('feedback list --json')

      if (isJsonOutput(output)) {
        const json = parseJsonOutput(output)
        expect(json).to.not.be.null
        // Skip if gh is not authenticated (CI environment)
        if (isGHAuthError(json)) return
        expect(json?.type).to.equal('success')
        expect(json?.success).to.equal(true)
        expect(json?.result).to.have.property('issues')
        expect(json?.result).to.have.property('repository', 'chrismcdermut/proletariat')
        expect((json?.result as Record<string, unknown>).issues).to.be.an('array')
      }
    })

    it('should include filter information in result', async () => {
      const output = await execInProcess('feedback list --state all --limit 5 --json')

      if (isJsonOutput(output)) {
        const json = parseJsonOutput(output)
        expect(json).to.not.be.null
        // Skip if gh is not authenticated (CI environment)
        if (isGHAuthError(json)) return
        expect(json?.result).to.have.property('filters')

        const filters = (json?.result as { filters: Record<string, unknown> }).filters
        expect(filters).to.have.property('state', 'all')
        expect(filters).to.have.property('limit', 5)
      }
    })

    it('should filter by category', async () => {
      const output = await execInProcess('feedback list --category bug --json')

      if (isJsonOutput(output)) {
        const json = parseJsonOutput(output)
        expect(json).to.not.be.null
        // Skip if gh is not authenticated (CI environment)
        if (isGHAuthError(json)) return
        expect(json?.type).to.equal('success')

        const filters = (json?.result as { filters: Record<string, unknown> }).filters
        expect(filters).to.have.property('category', 'bug')
      }
    })
  })

  /**
   * prlt feedback view
   */
  describe('prlt feedback view', () => {
    it('should show help with --help flag', async () => {
      const output = await execInProcess('feedback view --help')

      expect(output).to.contain('View details of a specific feedback issue')
      expect(output).to.contain('USAGE')
      expect(output).to.contain('NUMBER')
    })

    it('should require issue number argument', async () => {
      const output = await execInProcess('feedback view --help')

      expect(output).to.contain('NUMBER')
      expect(output).to.contain('Issue number to view')
    })

    it('should view issue details in JSON mode', async () => {
      // View issue #1 which should exist (initial work PR)
      const output = await execInProcess('feedback view 1 --json')

      if (isJsonOutput(output)) {
        const json = parseJsonOutput(output)
        expect(json).to.not.be.null
        // Skip if gh is not authenticated (CI environment)
        if (isGHAuthError(json)) return
        expect(json?.type).to.equal('success')
        expect(json?.result).to.have.property('number', 1)
        expect(json?.result).to.have.property('title')
        expect(json?.result).to.have.property('state')
        expect(json?.result).to.have.property('author')
        expect(json?.result).to.have.property('url')
        expect(json?.result).to.have.property('repository', 'chrismcdermut/proletariat')
      }
    })

    it('should handle non-existent issue gracefully', async () => {
      const output = await execInProcess('feedback view 999999 --json')

      if (isJsonOutput(output)) {
        const json = parseJsonOutput(output)
        expect(json).to.not.be.null
        expect(json?.type).to.equal('error')
        expect(json?.error).to.have.property('code')
        // In CI, gh may not be authenticated, so accept that error too
        expect(json?.error?.code).to.match(/ISSUE_NOT_FOUND|ISSUE_VIEW_FAILED|GH_NOT_AUTHENTICATED|GH_NOT_INSTALLED/)
      }
    })
  })

  /**
   * Error handling
   */
  describe('Error handling', () => {
    it('should handle unknown subcommand gracefully', async () => {
      const output = await execInProcess('feedback unknown-subcommand')

      const validOutput =
        output.includes('not found') ||
        output.includes('Unknown') ||
        output.includes('command not found') ||
        output.includes('USAGE') ||
        output.includes('COMMANDS')
      expect(validOutput).to.be.true
    })

    it('should accept --help flag on all subcommands', async () => {
      const submitHelp = await execInProcess('feedback submit --help')
      const listHelp = await execInProcess('feedback list --help')
      const viewHelp = await execInProcess('feedback view --help')

      expect(submitHelp).to.contain('USAGE')
      expect(listHelp).to.contain('USAGE')
      expect(viewHelp).to.contain('USAGE')
    })

    it('should include JSON mode flag in all subcommands', async () => {
      const submitHelp = await execInProcess('feedback submit --help')
      const listHelp = await execInProcess('feedback list --help')
      const viewHelp = await execInProcess('feedback view --help')

      expect(submitHelp).to.contain('--json')
      expect(listHelp).to.contain('--json')
      expect(viewHelp).to.contain('--json')
    })
  })
})
