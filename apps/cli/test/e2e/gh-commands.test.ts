import { expect } from 'chai'
import { execProduction as exec } from './test-helpers.js'

/**
 * End-to-end tests for GitHub CLI Commands
 * Tests: prlt gh, prlt gh status, prlt gh login, prlt gh token
 *
 * Note: These tests run without GitHub authentication, so they test
 * the CLI interface, help output, and graceful handling of
 * unauthenticated/uninstalled states. Full GitHub integration
 * tests would require a GitHub environment with authentication.
 *
 * The CLI tests run from the CLI directory to avoid TypeScript loader issues.
 */
describe('GitHub CLI Commands E2E Tests', () => {
  /**
   * prlt gh status
   * Shows GitHub CLI authentication status
   */
  describe('prlt gh status', () => {
    it('should show help with --help flag', () => {
      const output = exec('gh status --help')

      expect(output).to.contain('Check GitHub CLI status')
      expect(output).to.contain('USAGE')
    })

    it('should check GitHub CLI status', () => {
      const output = exec('gh status')

      // Should contain status check header
      expect(output).to.contain('Checking GitHub CLI status')

      // Should show one of the possible states:
      // - gh CLI not installed
      // - gh CLI installed
      // - gh CLI not authenticated
      // - Authenticated
      const hasValidStatus =
        output.includes('gh CLI not installed') ||
        output.includes('gh CLI installed') ||
        output.includes('not authenticated') ||
        output.includes('Authenticated')
      expect(hasValidStatus).to.be.true
    })

    it('should indicate when gh CLI is not installed', () => {
      const output = exec('gh status')

      // If gh is not installed, should provide installation instructions
      if (output.includes('not installed')) {
        expect(output).to.contain('brew install gh')
        expect(output).to.contain('https://cli.github.com/')
      }
    })

    it('should indicate authentication status when gh is installed', () => {
      const output = exec('gh status')

      // If gh is installed, should show authentication status
      if (output.includes('gh CLI installed')) {
        const hasAuthStatus =
          output.includes('Authenticated') ||
          output.includes('not authenticated')
        expect(hasAuthStatus).to.be.true
      }
    })

    it('should check GH_TOKEN status when authenticated', () => {
      const output = exec('gh status')

      // If authenticated, should show GH_TOKEN status
      if (output.includes('Authenticated')) {
        const hasTokenStatus =
          output.includes('GH_TOKEN available') ||
          output.includes('GH_TOKEN not set')
        expect(hasTokenStatus).to.be.true
      }
    })
  })

  /**
   * prlt gh login
   * Initiates GitHub login flow
   */
  describe('prlt gh login', () => {
    it('should show help with --help flag', () => {
      const output = exec('gh login --help')

      expect(output).to.contain('Login to GitHub CLI')
      expect(output).to.contain('USAGE')
    })

    it('should handle missing gh CLI gracefully', () => {
      const output = exec('gh login')

      // Should handle different states gracefully
      const validOutput =
        output.includes('gh CLI not installed') ||
        output.includes('Already authenticated') ||
        output.includes('Starting GitHub authentication') ||
        output.includes('brew install gh')
      expect(validOutput).to.be.true
    })

    it('should provide installation instructions when gh is not installed', () => {
      const output = exec('gh login')

      if (output.includes('not installed')) {
        expect(output).to.contain('brew install gh')
      }
    })

    it('should indicate when already authenticated', () => {
      const output = exec('gh login')

      // If already authenticated, should indicate and suggest how to re-auth
      if (output.includes('Already authenticated')) {
        expect(output).to.contain('gh auth login')
      }
    })
  })

  /**
   * prlt gh token
   * Displays/manages GitHub token for devcontainer PR creation
   */
  describe('prlt gh token', () => {
    it('should show help with --help flag', () => {
      const output = exec('gh token --help')

      expect(output).to.contain('GH_TOKEN setup')
      expect(output).to.contain('devcontainer')
      expect(output).to.contain('USAGE')
    })

    it('should handle missing gh CLI gracefully', () => {
      const output = exec('gh token')

      // Should handle different states gracefully
      const validOutput =
        output.includes('gh CLI not installed') ||
        output.includes('not authenticated') ||
        output.includes('GH_TOKEN') ||
        output.includes('brew install gh')
      expect(validOutput).to.be.true
    })

    it('should provide installation instructions when gh is not installed', () => {
      const output = exec('gh token')

      if (output.includes('not installed')) {
        expect(output).to.contain('brew install gh')
      }
    })

    it('should prompt for authentication when not authenticated', () => {
      const output = exec('gh token')

      if (output.includes('not authenticated')) {
        expect(output).to.contain('prlt gh login')
      }
    })

    it('should show GH_TOKEN setup instructions when authenticated but token not set', () => {
      const output = exec('gh token')

      // If authenticated but no GH_TOKEN, should show setup instructions
      if (output.includes('GH_TOKEN not set')) {
        // Should suggest shell profile setup
        const hasShellInstructions =
          output.includes('.zshrc') ||
          output.includes('.bashrc') ||
          output.includes('.profile') ||
          output.includes('export GH_TOKEN')
        expect(hasShellInstructions).to.be.true
      }
    })

    it('should indicate when GH_TOKEN is already set', () => {
      const output = exec('gh token')

      // If GH_TOKEN is set, should indicate success
      if (output.includes('GH_TOKEN is already set')) {
        expect(output).to.contain('devcontainers')
      }
    })
  })

  /**
   * prlt gh (main menu / interactive mode)
   * Tests the interactive menu when no subcommand is provided
   */
  describe('prlt gh', () => {
    it('should show help with --help flag', () => {
      const output = exec('gh --help')

      expect(output).to.contain('GitHub CLI setup')
      expect(output).to.contain('USAGE')
    })

    it('should list available subcommands in help', () => {
      const output = exec('gh --help')

      // Help should show subcommands or examples
      const hasSubcommands =
        output.includes('status') ||
        output.includes('login') ||
        output.includes('token') ||
        output.includes('COMMANDS')
      expect(hasSubcommands).to.be.true
    })

    it('should show examples in help', () => {
      const output = exec('gh --help')

      // Should have examples section
      const hasExamples =
        output.includes('EXAMPLES') ||
        output.includes('prlt gh status') ||
        output.includes('prlt gh login') ||
        output.includes('prlt gh token')
      expect(hasExamples).to.be.true
    })
  })

  /**
   * Tests for command delegation / menu choices
   * Note: Interactive mode cannot be tested directly in E2E tests
   * since it requires TTY input. These tests verify the subcommands
   * can be called directly.
   */
  describe('Command delegation', () => {
    it('should delegate to status command', () => {
      const output = exec('gh status')

      // Verify status command runs (not menu)
      expect(output).to.contain('Checking GitHub CLI status')
    })

    it('should delegate to login command', () => {
      const output = exec('gh login')

      // Verify login command runs (should show some state)
      const validOutput =
        output.includes('gh CLI not installed') ||
        output.includes('Already authenticated') ||
        output.includes('Starting GitHub authentication')
      expect(validOutput).to.be.true
    })

    it('should delegate to token command', () => {
      const output = exec('gh token')

      // Verify token command runs (should show some state)
      const validOutput =
        output.includes('gh CLI not installed') ||
        output.includes('not authenticated') ||
        output.includes('GH_TOKEN')
      expect(validOutput).to.be.true
    })
  })

  /**
   * Edge cases and error handling
   */
  describe('Error handling', () => {
    it('should handle unknown subcommand gracefully', () => {
      const output = exec('gh unknown-subcommand')

      // Should show error about unknown command or help
      const validOutput =
        output.includes('not found') ||
        output.includes('Unknown') ||
        output.includes('command not found') ||
        output.includes('USAGE') ||
        output.includes('COMMANDS')
      expect(validOutput).to.be.true
    })

    it('should accept --help flag on all subcommands', () => {
      const statusHelp = exec('gh status --help')
      const loginHelp = exec('gh login --help')
      const tokenHelp = exec('gh token --help')

      expect(statusHelp).to.contain('USAGE')
      expect(loginHelp).to.contain('USAGE')
      expect(tokenHelp).to.contain('USAGE')
    })
  })
})
