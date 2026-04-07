/**
 * Regression test for PRLT-1266: Pin npm version in publish workflow.
 *
 * Bug: `npm install -g npm@latest` in .github/workflows/npm-publish.yml line 24
 * was failing on the GitHub runner because the latest npm release was missing
 * the `promise-retry` module. This blocked all auto-publishes since 2026-04-06.
 *
 * Fix: Pin npm to a known-good version (10.9.2) instead of pulling @latest.
 *
 * This test fails if anyone reverts the pin back to `npm@latest` (or any
 * other floating tag like `@next`, `@beta`).
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

interface WorkflowStep {
  name?: string
  run?: string
  uses?: string
}

interface WorkflowJob {
  steps?: WorkflowStep[]
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>
}

describe('PRLT-1266: npm-publish workflow pins npm version', () => {
  let workflow: Workflow
  let rawContents: string

  before(() => {
    expect(fs.existsSync(WORKFLOW_PATH), `expected workflow file at ${WORKFLOW_PATH}`).to.be.true
    rawContents = fs.readFileSync(WORKFLOW_PATH, 'utf8')
    workflow = yaml.load(rawContents) as Workflow
  })

  it('does not install npm@latest (the broken floating tag)', () => {
    expect(rawContents).to.not.include(
      'npm install -g npm@latest',
      'npm@latest is broken on GitHub runners — pin to a specific version (see PRLT-1266)'
    )
  })

  it('does not install npm with any floating tag (@next, @beta, etc.)', () => {
    // Match `npm install -g npm@<tag>` where tag is non-numeric (i.e. a dist-tag, not a version).
    const floatingTagPattern = /npm install -g npm@(?!\d)[a-z]+/i
    expect(floatingTagPattern.test(rawContents)).to.equal(
      false,
      'do not use npm dist-tags like @latest/@next/@beta — pin to a specific version'
    )
  })

  it('pins npm to a specific semver version in the OIDC step', () => {
    const publishJob = workflow.jobs?.publish
    expect(publishJob, 'expected a "publish" job in npm-publish.yml').to.exist

    const oidcStep = publishJob?.steps?.find(
      (s) => s.name === 'Update npm for OIDC trusted publishing'
    )
    expect(oidcStep, 'expected an "Update npm for OIDC trusted publishing" step').to.exist
    expect(oidcStep?.run, 'OIDC step must have a run command').to.exist

    // Must be `npm install -g npm@X.Y.Z` with a numeric semver
    const pinnedVersionPattern = /npm install -g npm@(\d+\.\d+\.\d+)/
    const match = oidcStep!.run!.match(pinnedVersionPattern)
    expect(match, `OIDC step run command must pin npm to a semver: got ${oidcStep!.run}`).to.not.be
      .null
  })
})
