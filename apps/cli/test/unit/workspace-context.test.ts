import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import {
  buildWorkspaceRepos,
  writeWorkspaceManifest,
  readWorkspaceManifest,
} from '../../src/lib/execution/context.js'
import type { WorkspaceManifest } from '../../src/lib/execution/types.js'

/**
 * Tests for workspace context utilities (PRLT-1088).
 * Covers workspace repo detection, manifest writing/reading, and prompt injection.
 */

describe('Workspace Context (PRLT-1088)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-workspace-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // =========================================================================
  // buildWorkspaceRepos
  // =========================================================================
  describe('buildWorkspaceRepos', () => {
    it('should return empty array when no worktrees', () => {
      const repos = buildWorkspaceRepos(tmpDir, [])
      expect(repos).to.deep.equal([])
    })

    it('should build repo info for a single repo', () => {
      // Create a fake git repo
      const repoDir = path.join(tmpDir, 'my-repo')
      fs.mkdirSync(repoDir)
      execSync('git init', { cwd: repoDir, stdio: 'pipe' })

      const repos = buildWorkspaceRepos(tmpDir, ['my-repo'])
      expect(repos).to.have.length(1)
      expect(repos[0].name).to.equal('my-repo')
      expect(repos[0].path).to.equal('/workspace/my-repo')
      expect(repos[0].primary).to.be.true
    })

    it('should mark first repo as primary by default', () => {
      const repo1 = path.join(tmpDir, 'repo1')
      const repo2 = path.join(tmpDir, 'repo2')
      fs.mkdirSync(repo1)
      fs.mkdirSync(repo2)
      execSync('git init', { cwd: repo1, stdio: 'pipe' })
      execSync('git init', { cwd: repo2, stdio: 'pipe' })

      const repos = buildWorkspaceRepos(tmpDir, ['repo1', 'repo2'])
      expect(repos).to.have.length(2)
      expect(repos[0].primary).to.be.true
      expect(repos[1].primary).to.be.false
    })

    it('should mark specified repo as primary', () => {
      const repo1 = path.join(tmpDir, 'repo1')
      const repo2 = path.join(tmpDir, 'repo2')
      fs.mkdirSync(repo1)
      fs.mkdirSync(repo2)
      execSync('git init', { cwd: repo1, stdio: 'pipe' })
      execSync('git init', { cwd: repo2, stdio: 'pipe' })

      const repos = buildWorkspaceRepos(tmpDir, ['repo1', 'repo2'], 'repo2')
      expect(repos[0].primary).to.be.false
      expect(repos[1].primary).to.be.true
    })

    it('should detect branch name', () => {
      const repoDir = path.join(tmpDir, 'my-repo')
      fs.mkdirSync(repoDir)
      execSync('git init', { cwd: repoDir, stdio: 'pipe' })
      // Configure git identity (required in CI where global config may not exist)
      execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' })
      execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' })
      // Make an initial commit so branch exists
      execSync('git commit --allow-empty -m "init"', { cwd: repoDir, stdio: 'pipe' })

      const repos = buildWorkspaceRepos(tmpDir, ['my-repo'])
      // Branch should be either 'main' or 'master' depending on git config
      expect(repos[0].branch).to.be.a('string')
      expect(repos[0].branch!.length).to.be.greaterThan(0)
    })
  })

  // =========================================================================
  // writeWorkspaceManifest / readWorkspaceManifest
  // =========================================================================
  describe('writeWorkspaceManifest / readWorkspaceManifest', () => {
    it('should write and read a manifest', () => {
      const manifest: WorkspaceManifest = {
        repos: [
          {
            name: 'proletariat',
            path: '/workspace/proletariat',
            remote: 'chrismcdermut/proletariat',
            branch: 'main',
            primary: true,
          },
        ],
        ticket: 'TKT-100',
        agent: 'test-agent',
        action: 'implement',
      }

      writeWorkspaceManifest(tmpDir, manifest)

      const read = readWorkspaceManifest(tmpDir)
      expect(read).to.deep.equal(manifest)
    })

    it('should write manifest as valid JSON', () => {
      const manifest: WorkspaceManifest = {
        repos: [],
        ticket: 'TKT-200',
        agent: 'agent-1',
      }

      writeWorkspaceManifest(tmpDir, manifest)

      const raw = fs.readFileSync(path.join(tmpDir, '.prlt-workspace.json'), 'utf-8')
      expect(() => JSON.parse(raw)).to.not.throw()
    })

    it('should return null when manifest does not exist', () => {
      const result = readWorkspaceManifest(tmpDir)
      expect(result).to.be.null
    })

    it('should return null for invalid JSON', () => {
      fs.writeFileSync(path.join(tmpDir, '.prlt-workspace.json'), 'not json')
      const result = readWorkspaceManifest(tmpDir)
      expect(result).to.be.null
    })

    it('should overwrite existing manifest', () => {
      const manifest1: WorkspaceManifest = {
        repos: [],
        ticket: 'TKT-1',
        agent: 'agent-1',
      }
      const manifest2: WorkspaceManifest = {
        repos: [{ name: 'repo', path: '/workspace/repo', primary: true }],
        ticket: 'TKT-2',
        agent: 'agent-2',
        action: 'review',
      }

      writeWorkspaceManifest(tmpDir, manifest1)
      writeWorkspaceManifest(tmpDir, manifest2)

      const read = readWorkspaceManifest(tmpDir)
      expect(read).to.deep.equal(manifest2)
    })
  })
})
