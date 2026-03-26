/**
 * CI Workflow Tier Regression Test — PRLT-1136
 *
 * Validates the test workflow structure:
 * - push to main: full suite (all shards)
 * - pull_request: smoke tier (fast feedback)
 * - workflow_dispatch: user choice
 *
 * Also validates that the e2e shard list is complete for full-suite runs.
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKFLOW_PATH = path.resolve(__dirname, '../../../../.github/workflows/test.yml')

describe('CI workflow test tiers (PRLT-1136)', () => {
  let workflowContent: string

  before(() => {
    workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf-8')
  })

  it('should exist at .github/workflows/test.yml', () => {
    expect(fs.existsSync(WORKFLOW_PATH)).to.be.true
  })

  it('should set TIER="full" for push events', () => {
    // Push to main must always run full suite
    const pushTierMatch = workflowContent.match(
      /github\.event_name.*==.*push.*\n\s*TIER="(\w+)"/
    )
    expect(pushTierMatch, 'Could not find push tier assignment in workflow').to.not.be.null
    expect(pushTierMatch![1]).to.equal(
      'full',
      'Push tier must be "full" — main branch must always run the complete test suite'
    )
  })

  it('should set TIER="smoke" for pull_request events', () => {
    // PRs use smoke tier for fast feedback
    const prTierMatch = workflowContent.match(
      /pull_request.*\n\s*TIER="(\w+)"/
    )
    expect(prTierMatch, 'Could not find PR tier assignment in workflow').to.not.be.null
    expect(prTierMatch![1]).to.equal(
      'smoke',
      'PR tier must be "smoke" for fast feedback'
    )
  })

  it('should run full e2e suite on push to main', () => {
    // The push block must set scope=full and include all shards
    // Match the pattern: push event → scope=full → e2e_shards=[...]
    const pushScopeMatch = workflowContent.match(
      /event_name.*==.*push.*\n\s*echo "run_tests=true".*\n\s*echo "scope=full".*\n\s*echo "reason=.*\n\s*echo 'e2e_shards=(\[.*?\])'/
    )
    expect(pushScopeMatch, 'Could not find push early-exit block with e2e_shards').to.not.be.null

    const shards = JSON.parse(pushScopeMatch![1].replace(/'/g, '"'))
    const expectedShards = ['execution', 'agent-flows', 'json-mode', 'integrations', 'standalone', 'infrastructure']
    for (const shard of expectedShards) {
      expect(shards).to.include(shard, `Missing e2e shard: ${shard}`)
    }
  })

  it('should include all expected e2e shards in full-suite runs', () => {
    // The full suite shard list appears in multiple places (push, dispatch, core changes)
    // Just verify the expected shards appear somewhere in the workflow
    const expectedShards = ['execution', 'agent-flows', 'json-mode', 'integrations', 'standalone', 'infrastructure']
    for (const shard of expectedShards) {
      expect(workflowContent).to.include(
        shard,
        `Expected shard "${shard}" to appear in workflow file`
      )
    }
  })
})
