/**
 * Regression test for PRLT-1267: Pin npm to a version that supports OIDC
 * trusted publishing.
 *
 * Bug: The publish workflow was pinned to npm@10.9.2 (PRLT-1266 fix), but
 * OIDC trusted publishing was introduced in npm 11.5.2. With an older npm,
 * the client cannot exchange the OIDC ID token for an npm-issued credential,
 * so it falls back to the placeholder NODE_AUTH_TOKEN that
 * actions/setup-node@v4 injects from the NPM_TOKEN repo secret. That secret
 * is expired/revoked, so `npm publish` fails with 404.
 *
 * Fix: Pin npm to 11.5.2 — the earliest 11.x release that supports OIDC
 * trusted publishing. We avoid newer 11.x versions because at least one
 * recent release ships with a broken `promise-retry` bundling that breaks
 * `npm install -g` on GitHub runners (the original PRLT-1266 incident).
 *
 * This test fails if anyone:
 *   - downgrades npm below 11.5.2 (loses OIDC support), or
 *   - reverts to a floating dist-tag like @latest (PRLT-1266 regression).
 */

import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// repo root: ../../../.. from apps/cli/test/unit/
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'npm-publish.yml')

// Minimum npm version that supports OIDC trusted publishing.
const MIN_OIDC_NPM_VERSION = { major: 11, minor: 5, patch: 2 }

interface WorkflowStep {
  name?: string
  run?: string
  uses?: string
  env?: Record<string, string>
}

interface WorkflowJob {
  steps?: WorkflowStep[]
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>
}

function parseSemver(v: string): { major: number; minor: number; patch: number } | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

function gte(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number }
): boolean {
  if (a.major !== b.major) return a.major > b.major
  if (a.minor !== b.minor) return a.minor > b.minor
  return a.patch >= b.patch
}

describe('PRLT-1267: npm-publish workflow pins npm to an OIDC-capable version', () => {
  let workflow: Workflow

  before(() => {
    expect(fs.existsSync(WORKFLOW_PATH), `expected workflow file at ${WORKFLOW_PATH}`).to.be.true
    const rawContents = fs.readFileSync(WORKFLOW_PATH, 'utf8')
    workflow = yaml.load(rawContents) as Workflow
  })

  it('pins npm to a version >= 11.5.2 in the OIDC step', () => {
    const publishJob = workflow.jobs?.publish
    expect(publishJob, 'expected a "publish" job in npm-publish.yml').to.exist

    const oidcStep = publishJob?.steps?.find(
      (s) => s.name === 'Update npm for OIDC trusted publishing'
    )
    expect(oidcStep, 'expected an "Update npm for OIDC trusted publishing" step').to.exist
    expect(oidcStep?.run, 'OIDC step must have a run command').to.exist

    const pinnedVersionPattern = /npm install -g npm@(\d+\.\d+\.\d+)/
    const match = oidcStep!.run!.match(pinnedVersionPattern)
    expect(
      match,
      `OIDC step must pin npm to a specific semver. Got: ${oidcStep!.run}`
    ).to.not.be.null

    const version = parseSemver(match![1])
    expect(version, `pinned npm version "${match![1]}" must be valid semver`).to.not.be.null
    expect(
      gte(version!, MIN_OIDC_NPM_VERSION),
      `pinned npm version ${match![1]} must be >= 11.5.2 ` +
        '(earliest npm release with OIDC trusted publishing support). ' +
        'Older versions cause publish to fall back to the revoked NPM_TOKEN secret.'
    ).to.equal(true)
  })

  it('still runs npm publish with --provenance for OIDC trusted publishing', () => {
    const publishJob = workflow.jobs?.publish
    const publishStep = publishJob?.steps?.find((s) => s.name === 'Publish to npm')
    expect(publishStep, 'expected a "Publish to npm" step').to.exist
    expect(publishStep?.run, 'Publish step must have a run command').to.exist
    expect(
      publishStep!.run,
      'Publish step must use --provenance for OIDC trusted publishing'
    ).to.include('--provenance')
  })
})
