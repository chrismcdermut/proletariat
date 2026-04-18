import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * PRLT-1341: Catch-all devcontainer image installs prlt via npm and auto-updates on boot.
 *
 * Validates that:
 * - The static Dockerfile uses npm (not Homebrew) to install prlt
 * - The catch-all devcontainer configs include a postStartCommand for boot updates
 * - The CI workflow rebuilds the image on every npm publish
 */
describe('Catch-all devcontainer image (PRLT-1341)', () => {
  const repoRoot = path.resolve(__dirname, '../../../..')

  describe('docker/catchall/Dockerfile', () => {
    let dockerfile: string

    before(() => {
      const dockerfilePath = path.join(repoRoot, 'docker/catchall/Dockerfile')
      dockerfile = fs.readFileSync(dockerfilePath, 'utf-8')
    })

    it('should install prlt via npm', () => {
      expect(dockerfile).to.include('npm install -g @proletariat/cli@latest')
    })

    it('should NOT use Homebrew to install packages', () => {
      expect(dockerfile).to.not.include('brew install')
      expect(dockerfile).to.not.include('brew tap')
    })

    it('should use node:22 base image', () => {
      expect(dockerfile).to.include('FROM node:22')
    })

    it('should install Claude Code', () => {
      expect(dockerfile).to.include('@anthropic-ai/claude-code')
    })

    it('should install system dependencies (git, tmux, etc.)', () => {
      expect(dockerfile).to.include('git')
      expect(dockerfile).to.include('tmux')
    })

    it('should configure npm global directory for node user', () => {
      expect(dockerfile).to.include('NPM_CONFIG_PREFIX=/home/node/.npm-global')
    })
  })

  describe('catch-all devcontainer config (claude command)', () => {
    let claudeCommandSource: string

    before(() => {
      const claudePath = path.join(repoRoot, 'apps/cli/src/commands/claude/index.ts')
      claudeCommandSource = fs.readFileSync(claudePath, 'utf-8')
    })

    it('should reference the GHCR catch-all image', () => {
      expect(claudeCommandSource).to.include('ghcr.io/chrismcdermut/proletariat-claude:latest')
    })

    it('should include postStartCommand to update prlt on boot', () => {
      expect(claudeCommandSource).to.include('postStartCommand')
      expect(claudeCommandSource).to.include('npm install -g @proletariat/cli@latest')
    })
  })

  describe('catch-all devcontainer config (qa command)', () => {
    let qaCommandSource: string

    before(() => {
      const qaPath = path.join(repoRoot, 'apps/cli/src/commands/qa/index.ts')
      qaCommandSource = fs.readFileSync(qaPath, 'utf-8')
    })

    it('should reference the GHCR catch-all image', () => {
      expect(qaCommandSource).to.include('ghcr.io/chrismcdermut/proletariat-claude:latest')
    })

    it('should include postStartCommand to update prlt on boot', () => {
      expect(qaCommandSource).to.include('postStartCommand')
      expect(qaCommandSource).to.include('npm install -g @proletariat/cli@latest')
    })
  })

  describe('CI workflow (.github/workflows/build-devcontainer.yml)', () => {
    let workflow: string

    before(() => {
      const workflowPath = path.join(repoRoot, '.github/workflows/build-devcontainer.yml')
      workflow = fs.readFileSync(workflowPath, 'utf-8')
    })

    it('should trigger on publish workflow completion', () => {
      expect(workflow).to.include('workflows: ["publish"]')
      expect(workflow).to.include('types: [completed]')
    })

    it('should support manual dispatch', () => {
      expect(workflow).to.include('workflow_dispatch')
    })

    it('should build from docker/catchall context', () => {
      expect(workflow).to.include('context: docker/catchall')
    })

    it('should push to ghcr.io/chrismcdermut/proletariat-claude', () => {
      expect(workflow).to.include('ghcr.io/chrismcdermut/proletariat-claude:latest')
    })

    it('should tag with both latest and version number', () => {
      expect(workflow).to.include('proletariat-claude:latest')
      expect(workflow).to.include('proletariat-claude:${{ steps.version.outputs.version }}')
    })

    it('should wait for npm CDN propagation', () => {
      expect(workflow).to.include('Wait for npm CDN propagation')
      expect(workflow).to.include('sleep 90')
    })

    it('should only run when publish workflow succeeds', () => {
      expect(workflow).to.include('github.event.workflow_run.conclusion == \'success\'')
    })
  })
})
