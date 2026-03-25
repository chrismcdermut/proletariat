/**
 * CI Merge Check Regression Test — PRLT-1147
 *
 * Ensures the GitHub Actions test workflow includes a merge-check job that
 * fails when a PR has merge conflicts. Without this, PRs can show a green
 * checkmark while being unmergeable — misleading reviewers and automation.
 *
 * If this test fails, it means someone removed the merge-check job or
 * disconnected it from the ci-status gate.
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKFLOW_PATH = path.resolve(__dirname, '../../../../.github/workflows/test.yml')

describe('CI merge-check job (PRLT-1147)', () => {
  let workflowContent: string

  before(() => {
    workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf-8')
  })

  it('should have a merge-check job', () => {
    expect(workflowContent).to.include(
      'merge-check:',
      'Workflow must have a merge-check job'
    )
  })

  it('should only run merge-check on pull_request events', () => {
    // The merge-check job should be conditioned on pull_request
    const mergeCheckSection = workflowContent.split('merge-check:')[1]?.split(/\n  \w/)[0]
    expect(mergeCheckSection).to.not.be.undefined
    expect(mergeCheckSection).to.include(
      "github.event_name == 'pull_request'",
      'merge-check must only run on pull_request events'
    )
  })

  it('should check for CONFLICTING status and exit 1', () => {
    expect(workflowContent).to.include(
      'CONFLICTING',
      'merge-check must check for CONFLICTING mergeable status'
    )
    // Ensure it exits with failure on conflicts
    const mergeCheckSection = workflowContent.split('merge-check:')[1]?.split(/\n  [a-z]/)[0]
    expect(mergeCheckSection).to.include(
      'exit 1',
      'merge-check must exit 1 when PR has conflicts'
    )
  })

  it('should be included in ci-status needs', () => {
    // ci-status must depend on merge-check so conflicts block the status gate
    const ciStatusSection = workflowContent.split('ci-status:')[1]
    expect(ciStatusSection).to.not.be.undefined
    const needsMatch = ciStatusSection?.match(/needs:\s*\[([^\]]+)\]/)
    expect(needsMatch, 'ci-status must have a needs array').to.not.be.null
    expect(needsMatch![1]).to.include(
      'merge-check',
      'ci-status needs must include merge-check'
    )
  })

  it('should check merge-check result in ci-status verify step', () => {
    // The "Verify no failures" step must check merge-check.result
    const ciStatusSection = workflowContent.split('ci-status:')[1]
    expect(ciStatusSection).to.include(
      'needs.merge-check.result',
      'ci-status must check merge-check result in verify step'
    )
  })
})
