import { expect } from 'chai'

import {
  generateDevcontainerJson,
  generateDockerfile,
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

      expect(result.mounts).to.include('source=${localWorkspaceFolder},target=/workspace,type=bind')
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
})
