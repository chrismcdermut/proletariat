/**
 * CI Workflow Tier Regression Test — PRLT-1136
 *
 * Ensures the GitHub Actions test workflow runs the full test suite on PRs,
 * not just smoke tests. This prevents silent main breakage where tests only
 * fail post-merge because they weren't run on the PR.
 *
 * If this test fails, it means someone has changed the PR tier back to
 * smoke-only, which will allow untested code to merge into main.
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

  it('should set TIER="full" for pull_request events, not "smoke"', () => {
    // The PR tier assignment is in the else branch of the tier detection logic.
    // It must be "full" to prevent silent main breakage.
    // Match the pattern: else block sets TIER="full" (not "smoke")
    const prTierMatch = workflowContent.match(
      /else\s*\n\s*#.*pull_request.*\n\s*TIER="(\w+)"/
    )
    expect(prTierMatch, 'Could not find PR tier assignment in workflow').to.not.be.null
    expect(prTierMatch![1]).to.equal(
      'full',
      'PR tier must be "full" — smoke-only PRs caused silent main breakage (PRLT-1136)'
    )
  })

  it('should run full suite for both push and pull_request events', () => {
    // The early-exit block must handle both push and pull_request events.
    // This ensures PRs get all e2e shards, same as main pushes.
    expect(workflowContent).to.include(
      'github.event_name }}" == "push" || "${{ github.event_name }}" == "pull_request"',
      'Early-exit block must run full suite for both push and pull_request events'
    )
  })

  it('should include all 7 e2e shards for PRs', () => {
    // After the push || pull_request condition, the next e2e_shards line must include all shards
    const allShards = ['pmo', 'execution', 'agent-flows', 'json-mode', 'integrations', 'standalone', 'infrastructure']
    const pushPrBlock = workflowContent.split('push" || "${{ github.event_name }}" == "pull_request"')[1]
    expect(pushPrBlock, 'Could not find push/PR early-exit block').to.not.be.undefined

    // Extract the e2e_shards value from the block (before the next exit 0)
    const shardsMatch = pushPrBlock?.match(/e2e_shards=(\[.*?\])/)
    expect(shardsMatch, 'Could not find e2e_shards in push/PR block').to.not.be.null

    const shards = JSON.parse(shardsMatch![1].replace(/'/g, '"'))
    for (const shard of allShards) {
      expect(shards).to.include(shard, `Missing e2e shard: ${shard}`)
    }
  })
})
