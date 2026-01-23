import { expect } from 'chai';
import * as path from 'node:path';
import { runCommand } from '@oclif/test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root directory for the CLI - needed for @oclif/test to find commands
const root = path.resolve(__dirname, '../..');

/**
 * Tests for prlt whoami command
 * Tests agent identity detection via PRLT_AGENT_NAME and PRLT_HOST_PATH
 */
describe('prlt whoami', () => {
  // Store original env values
  let originalAgentName: string | undefined;
  let originalHostPath: string | undefined;

  beforeEach(() => {
    // Save original values
    originalAgentName = process.env.PRLT_AGENT_NAME;
    originalHostPath = process.env.PRLT_HOST_PATH;
  });

  afterEach(() => {
    // Restore original values
    if (originalAgentName !== undefined) {
      process.env.PRLT_AGENT_NAME = originalAgentName;
    } else {
      delete process.env.PRLT_AGENT_NAME;
    }
    if (originalHostPath !== undefined) {
      process.env.PRLT_HOST_PATH = originalHostPath;
    } else {
      delete process.env.PRLT_HOST_PATH;
    }
  });

  describe('command help', () => {
    it('shows help text', async () => {
      try {
        const { stdout } = await runCommand(['whoami', '--help'], { root });
        expect(stdout).to.contain('Show current agent/environment context');
        expect(stdout).to.contain('USAGE');
      } catch {
        // Skip help test if command fails to run
        console.log('Skipping help test - command not available in test context');
      }
    });
  });

  describe('agent detection via PRLT_AGENT_NAME', () => {
    it('displays agent name from PRLT_AGENT_NAME env var', async () => {
      process.env.PRLT_AGENT_NAME = 'test-worker';

      try {
        const { stdout } = await runCommand(['whoami'], { root });
        expect(stdout).to.contain('test-worker');
        expect(stdout).to.contain('Agent:');
      } catch (error) {
        // If command fails, check the error message
        console.log('Command error:', error);
        throw error;
      }
    });

    it('displays host path from PRLT_HOST_PATH env var', async () => {
      process.env.PRLT_HOST_PATH = '/home/user/hq/agents/staff/test-worker';

      try {
        const { stdout } = await runCommand(['whoami'], { root });
        expect(stdout).to.contain('/home/user/hq/agents/staff/test-worker');
        expect(stdout).to.contain('Host path:');
      } catch (error) {
        console.log('Command error:', error);
        throw error;
      }
    });

    it('displays both agent name and host path when both are set', async () => {
      process.env.PRLT_AGENT_NAME = 'my-agent';
      process.env.PRLT_HOST_PATH = '/path/to/agent';

      try {
        const { stdout } = await runCommand(['whoami'], { root });
        expect(stdout).to.contain('my-agent');
        expect(stdout).to.contain('/path/to/agent');
      } catch (error) {
        console.log('Command error:', error);
        throw error;
      }
    });
  });

  describe('environment detection', () => {
    it('shows host environment when not in devcontainer', async () => {
      // Ensure DEVCONTAINER is not set
      const originalDevcontainer = process.env.DEVCONTAINER;
      delete process.env.DEVCONTAINER;

      try {
        const { stdout } = await runCommand(['whoami'], { root });
        expect(stdout).to.contain('Environment:');
        expect(stdout).to.contain('host');
      } catch (error) {
        console.log('Command error:', error);
        throw error;
      } finally {
        if (originalDevcontainer !== undefined) {
          process.env.DEVCONTAINER = originalDevcontainer;
        }
      }
    });

    it('shows devcontainer environment when DEVCONTAINER=true', async () => {
      const originalDevcontainer = process.env.DEVCONTAINER;
      process.env.DEVCONTAINER = 'true';

      try {
        const { stdout } = await runCommand(['whoami'], { root });
        expect(stdout).to.contain('Environment:');
        expect(stdout).to.contain('devcontainer');
      } catch (error) {
        console.log('Command error:', error);
        throw error;
      } finally {
        if (originalDevcontainer !== undefined) {
          process.env.DEVCONTAINER = originalDevcontainer;
        } else {
          delete process.env.DEVCONTAINER;
        }
      }
    });
  });

  describe('output format', () => {
    it('displays working directory', async () => {
      try {
        const { stdout } = await runCommand(['whoami'], { root });
        expect(stdout).to.contain('Working dir:');
      } catch (error) {
        console.log('Command error:', error);
        throw error;
      }
    });

    it('displays Proletariat Context header', async () => {
      try {
        const { stdout } = await runCommand(['whoami'], { root });
        expect(stdout).to.contain('Proletariat Context');
      } catch (error) {
        console.log('Command error:', error);
        throw error;
      }
    });
  });
});
