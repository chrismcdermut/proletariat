import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import {
  generateDevcontainerJson,
  generateDockerfile,
  createDevcontainerConfig,
  hasDevcontainerConfig,
  DevcontainerOptions,
} from '../../src/lib/execution/devcontainer.js'

/**
 * Unit tests for devcontainer generation
 */
describe('Devcontainer', () => {
  describe('generateDevcontainerJson', () => {
    const makeOptions = (overrides: Partial<DevcontainerOptions> = {}): DevcontainerOptions => ({
      agentName: 'test-agent',
      agentDir: '/path/to/agents/staff/test-agent',
      ...overrides,
    })

    it('should include PRLT_AGENT_NAME in containerEnv', () => {
      const options = makeOptions({ agentName: 'my-agent' })
      const result = generateDevcontainerJson(options)

      expect(result.containerEnv).to.have.property('PRLT_AGENT_NAME', 'my-agent')
    })

    it('should include PRLT_HOST_PATH in containerEnv', () => {
      const options = makeOptions({ agentDir: '/home/user/hq/agents/staff/worker-1' })
      const result = generateDevcontainerJson(options)

      expect(result.containerEnv).to.have.property('PRLT_HOST_PATH', '/home/user/hq/agents/staff/worker-1')
    })

    it('should include PRLT_HQ_PATH in containerEnv', () => {
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      expect(result.containerEnv).to.have.property('PRLT_HQ_PATH', '/hq')
    })

    it('should set container name based on agent name', () => {
      const options = makeOptions({ agentName: 'worker-bee' })
      const result = generateDevcontainerJson(options)

      expect(result.name).to.equal('Agent: worker-bee')
    })

    it('should include DEVCONTAINER env var', () => {
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      expect(result.containerEnv).to.have.property('DEVCONTAINER', 'true')
    })

    it('should include GitHub token env vars', () => {
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      expect(result.containerEnv).to.have.property('GH_TOKEN')
      expect(result.containerEnv).to.have.property('GITHUB_TOKEN')
    })

    it('should include workspace mount', () => {
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      // Mount includes consistency=cached for TKT-801
      expect(result.mounts).to.include('source=${localWorkspaceFolder},target=/workspace,type=bind,consistency=cached')
    })

    it('should set workspaceFolder to /workspace', () => {
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      expect(result.workspaceFolder).to.equal('/workspace')
    })

    it('should use default memory from config', () => {
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      // Should have memory in runArgs
      const memoryArg = result.runArgs.find(arg => arg.startsWith('--memory='))
      expect(memoryArg).to.exist
    })

    it('should override memory when specified in options', () => {
      const options = makeOptions({ memory: '16g' })
      const result = generateDevcontainerJson(options)

      expect(result.runArgs).to.include('--memory=16g')
    })

    it('should override cpus when specified in options', () => {
      const options = makeOptions({ cpus: 8 })
      const result = generateDevcontainerJson(options)

      expect(result.runArgs).to.include('--cpus=8')
    })

    it('should include repo worktree mounts when specified', () => {
      const options = makeOptions({ repoWorktrees: ['my-repo', 'other-repo'] })
      const result = generateDevcontainerJson(options)

      const repoMounts = result.mounts.filter(m => m.includes('/hq/repos/'))
      expect(repoMounts).to.have.length(2)
      expect(repoMounts.some(m => m.includes('my-repo'))).to.be.true
      expect(repoMounts.some(m => m.includes('other-repo'))).to.be.true
    })

    it('should include claude-code extension', () => {
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      expect(result.customizations.vscode.extensions).to.include('anthropic.claude-code')
    })

    it('should set remoteUser to node', () => {
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      expect(result.remoteUser).to.equal('node')
    })

    it('should add NET_ADMIN and NET_RAW capabilities', () => {
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      expect(result.capAdd).to.include('NET_ADMIN')
      expect(result.capAdd).to.include('NET_RAW')
    })
  })

  describe('generateDockerfile', () => {
    const makeOptions = (overrides: Partial<DevcontainerOptions> = {}): DevcontainerOptions => ({
      agentName: 'test-agent',
      agentDir: '/path/to/agent',
      ...overrides,
    })

    it('should use node:20 base image', () => {
      const options = makeOptions()
      const result = generateDockerfile(options)

      expect(result).to.include('FROM node:20')
    })

    it('should set DEVCONTAINER env var', () => {
      const options = makeOptions()
      const result = generateDockerfile(options)

      expect(result).to.include('ENV DEVCONTAINER=true')
    })

    it('should install Claude Code', () => {
      const options = makeOptions()
      const result = generateDockerfile(options)

      expect(result).to.include('@anthropic-ai/claude-code')
    })

    it('should install prlt CLI', () => {
      const options = makeOptions()
      const result = generateDockerfile(options)

      expect(result).to.include('@proletariat/cli')
    })

    it('should use default timezone when not specified', () => {
      const options = makeOptions()
      const result = generateDockerfile(options)

      expect(result).to.include('America/Los_Angeles')
    })

    it('should use custom timezone when specified', () => {
      const options = makeOptions({ timezone: 'Europe/London' })
      const result = generateDockerfile(options)

      expect(result).to.include('Europe/London')
    })

    it('should copy firewall and setup scripts', () => {
      const options = makeOptions()
      const result = generateDockerfile(options)

      expect(result).to.include('COPY init-firewall.sh')
      expect(result).to.include('COPY setup-prlt.sh')
    })

    it('should set workdir to /workspace', () => {
      const options = makeOptions()
      const result = generateDockerfile(options)

      expect(result).to.include('WORKDIR /workspace')
    })
  })

  describe('createDevcontainerConfig', () => {
    let testDir: string

    beforeEach(() => {
      // Create a temporary directory for testing
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcontainer-test-'))
    })

    afterEach(() => {
      // Clean up the temporary directory
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true })
      }
    })

    it('should create .devcontainer directory', () => {
      const options: DevcontainerOptions = {
        agentName: 'test-agent',
        agentDir: testDir,
      }

      createDevcontainerConfig(options)

      const devcontainerDir = path.join(testDir, '.devcontainer')
      expect(fs.existsSync(devcontainerDir)).to.be.true
    })

    it('should create devcontainer.json file', () => {
      const options: DevcontainerOptions = {
        agentName: 'test-agent',
        agentDir: testDir,
      }

      createDevcontainerConfig(options)

      const devcontainerJson = path.join(testDir, '.devcontainer', 'devcontainer.json')
      expect(fs.existsSync(devcontainerJson)).to.be.true
    })

    it('should create Dockerfile', () => {
      const options: DevcontainerOptions = {
        agentName: 'test-agent',
        agentDir: testDir,
      }

      createDevcontainerConfig(options)

      const dockerfile = path.join(testDir, '.devcontainer', 'Dockerfile')
      expect(fs.existsSync(dockerfile)).to.be.true
    })

    it('should create init-firewall.sh script', () => {
      const options: DevcontainerOptions = {
        agentName: 'test-agent',
        agentDir: testDir,
      }

      createDevcontainerConfig(options)

      const firewallScript = path.join(testDir, '.devcontainer', 'init-firewall.sh')
      expect(fs.existsSync(firewallScript)).to.be.true
    })

    it('should create setup-prlt.sh script', () => {
      const options: DevcontainerOptions = {
        agentName: 'test-agent',
        agentDir: testDir,
      }

      createDevcontainerConfig(options)

      const setupScript = path.join(testDir, '.devcontainer', 'setup-prlt.sh')
      expect(fs.existsSync(setupScript)).to.be.true
    })

    it('should work with no repoWorktrees specified (TKT-795 fix)', () => {
      // This test verifies the fix for TKT-795: devcontainer config should be
      // created even when no repos are specified (e.g., placeholder agents)
      const options: DevcontainerOptions = {
        agentName: 'placeholder-agent',
        agentDir: testDir,
        // No repoWorktrees specified
      }

      createDevcontainerConfig(options)

      // Verify all required files are created
      expect(fs.existsSync(path.join(testDir, '.devcontainer', 'devcontainer.json'))).to.be.true
      expect(fs.existsSync(path.join(testDir, '.devcontainer', 'Dockerfile'))).to.be.true
      expect(fs.existsSync(path.join(testDir, '.devcontainer', 'init-firewall.sh'))).to.be.true
      expect(fs.existsSync(path.join(testDir, '.devcontainer', 'setup-prlt.sh'))).to.be.true

      // Verify devcontainer.json has valid content
      const jsonContent = fs.readFileSync(
        path.join(testDir, '.devcontainer', 'devcontainer.json'),
        'utf-8'
      )
      const config = JSON.parse(jsonContent)
      expect(config.name).to.equal('Agent: placeholder-agent')
    })

    it('should work with clone mount mode', () => {
      const options: DevcontainerOptions = {
        agentName: 'clone-agent',
        agentDir: testDir,
        mountMode: 'clone',
      }

      createDevcontainerConfig(options)

      const jsonContent = fs.readFileSync(
        path.join(testDir, '.devcontainer', 'devcontainer.json'),
        'utf-8'
      )
      const config = JSON.parse(jsonContent)
      expect(config.containerEnv.PRLT_MOUNT_MODE).to.equal('clone')
    })

    it('should work with worktree mount mode', () => {
      const options: DevcontainerOptions = {
        agentName: 'worktree-agent',
        agentDir: testDir,
        mountMode: 'worktree',
        repoWorktrees: ['repo1', 'repo2'],
      }

      createDevcontainerConfig(options)

      const jsonContent = fs.readFileSync(
        path.join(testDir, '.devcontainer', 'devcontainer.json'),
        'utf-8'
      )
      const config = JSON.parse(jsonContent)
      expect(config.containerEnv.PRLT_MOUNT_MODE).to.equal('worktree')

      // Should have repo mounts
      const repoMounts = config.mounts.filter((m: string) => m.includes('/hq/repos/'))
      expect(repoMounts).to.have.length(2)
    })
  })

  describe('hasDevcontainerConfig', () => {
    let testDir: string

    beforeEach(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcontainer-test-'))
    })

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true })
      }
    })

    it('should return false when no .devcontainer directory exists', () => {
      expect(hasDevcontainerConfig(testDir)).to.be.false
    })

    it('should return false when .devcontainer exists but no devcontainer.json', () => {
      const devcontainerDir = path.join(testDir, '.devcontainer')
      fs.mkdirSync(devcontainerDir, { recursive: true })
      fs.writeFileSync(path.join(devcontainerDir, 'Dockerfile'), 'FROM node:20')

      expect(hasDevcontainerConfig(testDir)).to.be.false
    })

    it('should return true when devcontainer.json exists', () => {
      const options: DevcontainerOptions = {
        agentName: 'test-agent',
        agentDir: testDir,
      }

      createDevcontainerConfig(options)

      expect(hasDevcontainerConfig(testDir)).to.be.true
    })
  })
})
