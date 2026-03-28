import { expect } from 'chai'
import { runPreflightChecks, formatPreflightReport } from '../../src/lib/execution/preflight.js'
import type { PreflightReport } from '../../src/lib/execution/preflight.js'

/**
 * PRLT-1132: Preflight validation for work start
 *
 * Tests the preflight check system that validates the environment
 * before spawning an agent. Used by --dry-run and failure diagnostics.
 */
describe('Preflight Validation (PRLT-1132)', () => {
  describe('runPreflightChecks', () => {
    it('reports ticket not found as error when ticket is null', () => {
      const report = runPreflightChecks({
        environment: 'host',
        executor: 'claude-code',
        db: null,
        ticket: null,
        agentDir: null,
      })

      expect(report.passed).to.equal(false)
      expect(report.errors).to.have.length.greaterThan(0)
      const ticketCheck = report.checks.find(c => c.name === 'ticket')
      expect(ticketCheck).to.exist
      expect(ticketCheck!.passed).to.equal(false)
      expect(ticketCheck!.message).to.equal('Ticket not found')
      expect(ticketCheck!.fix).to.contain('prlt ticket create')
    })

    it('reports ticket found when ticket is provided', () => {
      const report = runPreflightChecks({
        environment: 'host',
        executor: 'claude-code',
        db: null,
        ticket: { id: 'TKT-001', title: 'Test ticket' },
        agentDir: null,
      })

      const ticketCheck = report.checks.find(c => c.name === 'ticket')
      expect(ticketCheck).to.exist
      expect(ticketCheck!.passed).to.equal(true)
      expect(ticketCheck!.message).to.contain('TKT-001')
      expect(ticketCheck!.message).to.contain('Test ticket')
    })

    it('skips Docker check for host environment', () => {
      const report = runPreflightChecks({
        environment: 'host',
        executor: 'claude-code',
        db: null,
        ticket: { id: 'TKT-001', title: 'Test' },
        agentDir: null,
      })

      const dockerCheck = report.checks.find(c => c.name === 'docker')
      expect(dockerCheck).to.exist
      expect(dockerCheck!.passed).to.equal(true)
      expect(dockerCheck!.message).to.contain('Skipped')
    })

    it('skips credential check for host environment', () => {
      const report = runPreflightChecks({
        environment: 'host',
        executor: 'claude-code',
        db: null,
        ticket: { id: 'TKT-001', title: 'Test' },
        agentDir: null,
      })

      const credCheck = report.checks.find(c => c.name === 'credentials')
      expect(credCheck).to.exist
      expect(credCheck!.passed).to.equal(true)
    })

    it('skips credential check for non-claude executors', () => {
      const report = runPreflightChecks({
        environment: 'devcontainer',
        executor: 'codex',
        db: null,
        ticket: { id: 'TKT-001', title: 'Test' },
        agentDir: null,
      })

      const credCheck = report.checks.find(c => c.name === 'credentials')
      expect(credCheck).to.exist
      expect(credCheck!.passed).to.equal(true)
      expect(credCheck!.message).to.contain('not applicable')
    })

    it('runs all expected checks', () => {
      const report = runPreflightChecks({
        environment: 'host',
        executor: 'claude-code',
        db: null,
        ticket: { id: 'TKT-001', title: 'Test' },
        agentDir: null,
      })

      const checkNames = report.checks.map(c => c.name)
      expect(checkNames).to.include('docker')
      expect(checkNames).to.include('devcontainer')
      expect(checkNames).to.include('credentials')
      expect(checkNames).to.include('github-token')
      expect(checkNames).to.include('gh-cli')
      expect(checkNames).to.include('ticket')
      expect(checkNames).to.include('agent-dir')
    })

    it('separates errors from warnings in report', () => {
      // With a null ticket (error) and host environment (most checks pass)
      const report = runPreflightChecks({
        environment: 'host',
        executor: 'claude-code',
        db: null,
        ticket: null,
        agentDir: null,
      })

      expect(report.errors).to.be.an('array')
      expect(report.warnings).to.be.an('array')
      // ticket not found should be in errors
      expect(report.errors.some(e => e.name === 'ticket')).to.equal(true)
      // errors should not be in warnings
      expect(report.warnings.some(w => w.name === 'ticket')).to.equal(false)
    })

    it('passed is true when no errors exist (host env with ticket)', () => {
      const report = runPreflightChecks({
        environment: 'host',
        executor: 'claude-code',
        db: null,
        ticket: { id: 'TKT-001', title: 'Test' },
        agentDir: null,
      })

      // Host environment skips Docker/credential checks that might fail
      // Only gh-cli check might fail, but it's a warning not an error
      expect(report.passed).to.equal(true)
    })

    it('passed is false when errors exist', () => {
      const report = runPreflightChecks({
        environment: 'host',
        executor: 'claude-code',
        db: null,
        ticket: null, // This causes an error
        agentDir: null,
      })

      expect(report.passed).to.equal(false)
    })
  })

  describe('formatPreflightReport', () => {
    it('formats passing checks with checkmark', () => {
      const report: PreflightReport = {
        passed: true,
        checks: [{
          name: 'ticket',
          label: 'Ticket',
          passed: true,
          severity: 'error',
          message: 'Found: TKT-001 — Test',
        }],
        errors: [],
        warnings: [],
      }

      const output = formatPreflightReport(report)
      expect(output).to.contain('✓')
      expect(output).to.contain('Ticket')
      expect(output).to.contain('TKT-001')
    })

    it('formats failing error checks with X', () => {
      const report: PreflightReport = {
        passed: false,
        checks: [{
          name: 'docker',
          label: 'Docker daemon',
          passed: false,
          severity: 'error',
          message: 'Docker daemon is not running',
          fix: 'Start Docker Desktop',
        }],
        errors: [{
          name: 'docker',
          label: 'Docker daemon',
          passed: false,
          severity: 'error',
          message: 'Docker daemon is not running',
          fix: 'Start Docker Desktop',
        }],
        warnings: [],
      }

      const output = formatPreflightReport(report)
      expect(output).to.contain('✗')
      expect(output).to.contain('Docker daemon')
      expect(output).to.contain('not running')
      expect(output).to.contain('Fix:')
      expect(output).to.contain('Start Docker Desktop')
    })

    it('formats warnings with warning symbol', () => {
      const report: PreflightReport = {
        passed: true,
        checks: [{
          name: 'gh-cli',
          label: 'GitHub CLI (gh)',
          passed: false,
          severity: 'warning',
          message: 'GitHub CLI not installed',
          fix: 'Install gh',
        }],
        errors: [],
        warnings: [{
          name: 'gh-cli',
          label: 'GitHub CLI (gh)',
          passed: false,
          severity: 'warning',
          message: 'GitHub CLI not installed',
          fix: 'Install gh',
        }],
      }

      const output = formatPreflightReport(report)
      expect(output).to.contain('⚠')
      expect(output).to.contain('GitHub CLI')
    })

    it('includes fix suggestions for failed checks', () => {
      const report: PreflightReport = {
        passed: false,
        checks: [{
          name: 'ticket',
          label: 'Ticket',
          passed: false,
          severity: 'error',
          message: 'Ticket not found',
          fix: 'Create a ticket first with `prlt ticket create`',
        }],
        errors: [{
          name: 'ticket',
          label: 'Ticket',
          passed: false,
          severity: 'error',
          message: 'Ticket not found',
          fix: 'Create a ticket first with `prlt ticket create`',
        }],
        warnings: [],
      }

      const output = formatPreflightReport(report)
      expect(output).to.contain('Fix:')
      expect(output).to.contain('prlt ticket create')
    })

    it('does not include fix line for passing checks', () => {
      const report: PreflightReport = {
        passed: true,
        checks: [{
          name: 'ticket',
          label: 'Ticket',
          passed: true,
          severity: 'error',
          message: 'Found: TKT-001',
        }],
        errors: [],
        warnings: [],
      }

      const output = formatPreflightReport(report)
      expect(output).not.to.contain('Fix:')
    })
  })
})
