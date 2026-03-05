import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import {
  generateDevcontainerJson,
  generateDockerfile,
  generateFirewallScript,
  generatePrltSetupScript,
  createDevcontainerConfig,
  hasDevcontainerConfig,
  DevcontainerOptions,
} from '../../src/lib/execution/devcontainer.js'

import {
  getGitIdentity,
} from '../../src/lib/pr/index.js'

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

    it('should include PRLT_REGISTRY in containerEnv (TKT-954)', () => {
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      expect(result.containerEnv).to.have.property('PRLT_REGISTRY', 'npm')
    })

    it('should include PRLT_VERSION in containerEnv for npm channel (TKT-954)', () => {
      const options = makeOptions()
      const result = generateDevcontainerJson(options)

      expect(result.containerEnv).to.have.property('PRLT_VERSION', 'latest')
    })

    it('should include specific PRLT_VERSION when channel specifies a version (TKT-954)', () => {
      const options = makeOptions({ prltChannel: 'npm:1.2.3' })
      const result = generateDevcontainerJson(options)

      expect(result.containerEnv).to.have.property('PRLT_VERSION', '1.2.3')
    })

    it('should not include PRLT_VERSION for mount channel (TKT-954)', () => {
      const options = makeOptions({ prltChannel: 'mount' })
      const result = generateDevcontainerJson(options)

      expect(result.containerEnv).to.not.have.property('PRLT_VERSION')
    })
  })

  describe('generateDockerfile', () => {
    const makeOptions = (overrides: Partial<DevcontainerOptions> = {}): DevcontainerOptions => ({
      agentName: 'test-agent',
      agentDir: '/path/to/agent',
      ...overrides,
    })

    it('should use node:22 base image', () => {
      const options = makeOptions()
      const result = generateDockerfile(options)

      expect(result).to.include('FROM node:22')
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

  describe('git identity in devcontainer (TKT-934)', () => {
    const makeOptions = (overrides: Partial<DevcontainerOptions> = {}): DevcontainerOptions => ({
      agentName: 'test-agent',
      agentDir: '/path/to/agents/staff/test-agent',
      ...overrides,
    })

    describe('generateDevcontainerJson', () => {
      it('should include PRLT_GIT_USER_NAME when gitUserName is provided', () => {
        const options = makeOptions({ gitUserName: 'John Doe' })
        const result = generateDevcontainerJson(options)

        expect(result.containerEnv).to.have.property('PRLT_GIT_USER_NAME', 'John Doe')
      })

      it('should include PRLT_GIT_USER_EMAIL when gitUserEmail is provided', () => {
        const options = makeOptions({ gitUserEmail: 'john@example.com' })
        const result = generateDevcontainerJson(options)

        expect(result.containerEnv).to.have.property('PRLT_GIT_USER_EMAIL', 'john@example.com')
      })

      it('should not include PRLT_GIT_USER_NAME when gitUserName is not provided', () => {
        const options = makeOptions()
        const result = generateDevcontainerJson(options)

        expect(result.containerEnv).to.not.have.property('PRLT_GIT_USER_NAME')
      })

      it('should not include PRLT_GIT_USER_EMAIL when gitUserEmail is not provided', () => {
        const options = makeOptions()
        const result = generateDevcontainerJson(options)

        expect(result.containerEnv).to.not.have.property('PRLT_GIT_USER_EMAIL')
      })

      it('should include both git identity env vars when both are provided', () => {
        const options = makeOptions({
          gitUserName: 'Jane Smith',
          gitUserEmail: 'jane@example.com',
        })
        const result = generateDevcontainerJson(options)

        expect(result.containerEnv).to.have.property('PRLT_GIT_USER_NAME', 'Jane Smith')
        expect(result.containerEnv).to.have.property('PRLT_GIT_USER_EMAIL', 'jane@example.com')
      })
    })

    describe('generatePrltSetupScript', () => {
      it('should contain configure_git_identity function', () => {
        const script = generatePrltSetupScript()

        expect(script).to.include('configure_git_identity')
      })

      it('should reference PRLT_GIT_USER_NAME env var', () => {
        const script = generatePrltSetupScript()

        expect(script).to.include('PRLT_GIT_USER_NAME')
      })

      it('should reference PRLT_GIT_USER_EMAIL env var', () => {
        const script = generatePrltSetupScript()

        expect(script).to.include('PRLT_GIT_USER_EMAIL')
      })

      it('should configure git config --global user.name', () => {
        const script = generatePrltSetupScript()

        expect(script).to.include('git config --global user.name')
      })

      it('should configure git config --global user.email', () => {
        const script = generatePrltSetupScript()

        expect(script).to.include('git config --global user.email')
      })

      it('should include warning when identity cannot be determined', () => {
        const script = generatePrltSetupScript()

        expect(script).to.include('Warning: Could not determine git identity')
      })

      it('should have gh api user fallback detection', () => {
        const script = generatePrltSetupScript()

        expect(script).to.include('gh api user')
      })

      it('should have repo git config fallback detection', () => {
        const script = generatePrltSetupScript()

        expect(script).to.include('/usr/bin/git -C "$repo_dir" config user.name')
        expect(script).to.include('/usr/bin/git -C "$repo_dir" config user.email')
      })

      it('should check for prlt version updates at startup (TKT-954)', () => {
        const script = generatePrltSetupScript()

        expect(script).to.include('PRLT_VERSION')
        expect(script).to.include('npm view "@proletariat/cli@')
        expect(script).to.include('npm install -g "@proletariat/cli@')
      })

      it('should compare installed version with target version (TKT-954)', () => {
        const script = generatePrltSetupScript()

        expect(script).to.include('CURRENT_VERSION')
        expect(script).to.include('TARGET_VERSION')
        expect(script).to.include('Updating prlt from')
      })

      it('should handle pinned versions in update check (TKT-954)', () => {
        const script = generatePrltSetupScript()

        // Should handle both tag-based (latest/dev/next) and pinned versions
        expect(script).to.include('"$DESIRED_VERSION" = "latest"')
        expect(script).to.include('"$DESIRED_VERSION" = "dev"')
        expect(script).to.include('TARGET_VERSION="$DESIRED_VERSION"')
      })

      it('should log up-to-date message when no update needed (TKT-954)', () => {
        const script = generatePrltSetupScript()

        expect(script).to.include('is up to date')
      })
    })

    describe('createDevcontainerConfig with git identity', () => {
      let testDir: string

      beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcontainer-git-test-'))
      })

      afterEach(() => {
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true })
        }
      })

      it('should include git identity env vars in devcontainer.json', () => {
        const options: DevcontainerOptions = {
          agentName: 'test-agent',
          agentDir: testDir,
          gitUserName: 'Test User',
          gitUserEmail: 'test@example.com',
        }

        createDevcontainerConfig(options)

        const jsonContent = fs.readFileSync(
          path.join(testDir, '.devcontainer', 'devcontainer.json'),
          'utf-8'
        )
        const config = JSON.parse(jsonContent)
        expect(config.containerEnv.PRLT_GIT_USER_NAME).to.equal('Test User')
        expect(config.containerEnv.PRLT_GIT_USER_EMAIL).to.equal('test@example.com')
      })

      it('should include git identity configuration in setup-prlt.sh', () => {
        const options: DevcontainerOptions = {
          agentName: 'test-agent',
          agentDir: testDir,
        }

        createDevcontainerConfig(options)

        const setupScript = fs.readFileSync(
          path.join(testDir, '.devcontainer', 'setup-prlt.sh'),
          'utf-8'
        )
        expect(setupScript).to.include('configure_git_identity')
        expect(setupScript).to.include('git config --global user.name')
        expect(setupScript).to.include('git config --global user.email')
      })
    })
  })

  describe('getGitIdentity', () => {
    it('should return an object with name and email properties', () => {
      const identity = getGitIdentity()

      expect(identity).to.have.property('name')
      expect(identity).to.have.property('email')
    })

    it('should return string or null for name', () => {
      const identity = getGitIdentity()

      expect(identity.name === null || typeof identity.name === 'string').to.be.true
    })

    it('should return string or null for email', () => {
      const identity = getGitIdentity()

      expect(identity.email === null || typeof identity.email === 'string').to.be.true
    })
  })

  // =============================================================================
  // TKT-1005: Codex executor support in devcontainer
  // =============================================================================

  describe('Codex executor support (TKT-1005)', () => {
    const makeOptions = (overrides: Partial<DevcontainerOptions> = {}): DevcontainerOptions => ({
      agentName: 'test-agent',
      agentDir: '/path/to/agents/staff/test-agent',
      ...overrides,
    })

    describe('generateDevcontainerJson', () => {
      it('should include claude-credentials mount for claude-code executor', () => {
        const options = makeOptions({ executor: 'claude-code' })
        const result = generateDevcontainerJson(options)

        const credentialMount = result.mounts.find(m => m.includes('claude-credentials'))
        expect(credentialMount).to.exist
      })

      it('should include claude-credentials mount when executor is not specified (default)', () => {
        const options = makeOptions()
        const result = generateDevcontainerJson(options)

        const credentialMount = result.mounts.find(m => m.includes('claude-credentials'))
        expect(credentialMount).to.exist
      })

      it('should NOT include claude-credentials mount for codex executor', () => {
        const options = makeOptions({ executor: 'codex' })
        const result = generateDevcontainerJson(options)

        const credentialMount = result.mounts.find(m => m.includes('claude-credentials'))
        expect(credentialMount).to.not.exist
      })

    })

    describe('generateDockerfile', () => {
      it('should install Claude Code for default executor', () => {
        const options = makeOptions()
        const result = generateDockerfile(options)

        expect(result).to.include('@anthropic-ai/claude-code')
      })

      it('should install Codex CLI when executor is codex', () => {
        const options = makeOptions({ executor: 'codex' })
        const result = generateDockerfile(options)

        expect(result).to.include('@openai/codex')
      })

      it('should still install Claude Code even when executor is codex', () => {
        // Claude Code is always installed as it provides infrastructure
        const options = makeOptions({ executor: 'codex' })
        const result = generateDockerfile(options)

        expect(result).to.include('@anthropic-ai/claude-code')
      })

      it('should NOT install Codex when executor is claude-code', () => {
        const options = makeOptions({ executor: 'claude-code' })
        const result = generateDockerfile(options)

        expect(result).to.not.include('@openai/codex')
      })
    })

    describe('generateFirewallScript', () => {
      it('should include api.anthropic.com for default executor', () => {
        const script = generateFirewallScript()

        expect(script).to.include('api.anthropic.com')
      })

      it('should include api.openai.com for codex executor', () => {
        const script = generateFirewallScript('codex')

        expect(script).to.include('api.openai.com')
      })

      it('should NOT include api.openai.com for claude-code executor', () => {
        const script = generateFirewallScript('claude-code')

        expect(script).to.not.include('api.openai.com')
      })

      it('should still include api.anthropic.com for codex executor', () => {
        // Anthropic domains always whitelisted (Claude Code may be installed alongside)
        const script = generateFirewallScript('codex')

        expect(script).to.include('api.anthropic.com')
      })

      it('should include runtime extra allowlist domain handling', () => {
        const script = generateFirewallScript('codex')

        expect(script).to.include('PRLT_EXTRA_ALLOWLIST_DOMAINS')
      })

      it('should include additional user-configured domains', () => {
        const script = generateFirewallScript('codex', ['api.staging.example.com', 'foo.bar'])

        expect(script).to.include('add_domain "api.staging.example.com"')
        expect(script).to.include('add_domain "foo.bar"')
      })
    })

    describe('createDevcontainerConfig with codex executor', () => {
      let testDir: string

      beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcontainer-codex-test-'))
      })

      afterEach(() => {
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true })
        }
      })

      it('should create all devcontainer files for codex executor', () => {
        const options: DevcontainerOptions = {
          agentName: 'codex-agent',
          agentDir: testDir,
          executor: 'codex',
        }

        createDevcontainerConfig(options)

        expect(fs.existsSync(path.join(testDir, '.devcontainer', 'devcontainer.json'))).to.be.true
        expect(fs.existsSync(path.join(testDir, '.devcontainer', 'Dockerfile'))).to.be.true
        expect(fs.existsSync(path.join(testDir, '.devcontainer', 'init-firewall.sh'))).to.be.true
        expect(fs.existsSync(path.join(testDir, '.devcontainer', 'setup-prlt.sh'))).to.be.true
      })

      it('should include Codex install in Dockerfile for codex executor', () => {
        const options: DevcontainerOptions = {
          agentName: 'codex-agent',
          agentDir: testDir,
          executor: 'codex',
        }

        createDevcontainerConfig(options)

        const dockerfile = fs.readFileSync(
          path.join(testDir, '.devcontainer', 'Dockerfile'),
          'utf-8'
        )
        expect(dockerfile).to.include('@openai/codex')
      })

      it('should include OpenAI domains in firewall for codex executor', () => {
        const options: DevcontainerOptions = {
          agentName: 'codex-agent',
          agentDir: testDir,
          executor: 'codex',
        }

        createDevcontainerConfig(options)

        const firewall = fs.readFileSync(
          path.join(testDir, '.devcontainer', 'init-firewall.sh'),
          'utf-8'
        )
        expect(firewall).to.include('api.openai.com')
      })

      it('should NOT include claude-credentials mount in devcontainer.json for codex executor', () => {
        const options: DevcontainerOptions = {
          agentName: 'codex-agent',
          agentDir: testDir,
          executor: 'codex',
        }

        createDevcontainerConfig(options)

        const jsonContent = fs.readFileSync(
          path.join(testDir, '.devcontainer', 'devcontainer.json'),
          'utf-8'
        )
        const config = JSON.parse(jsonContent)
        const credentialMount = config.mounts.find((m: string) => m.includes('claude-credentials'))
        expect(credentialMount).to.not.exist
      })
    })
  })
})
