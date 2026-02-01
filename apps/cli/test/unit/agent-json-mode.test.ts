import { runCommand } from '@oclif/test';
import { expect } from 'chai';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root directory for the CLI - needed for @oclif/test to find commands
const root = path.resolve(__dirname, '../..');

/**
 * Unit tests for Agent Command JSON Mode (TKT-741)
 * Tests that agent commands properly support JSON mode output
 */
describe('Agent Command JSON Mode (TKT-741)', () => {

  describe('agent auth --json', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'auth', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output status as JSON');
    });
  });

  describe('agent discover --json', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'discover', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output discovery results as JSON');
    });
  });

  describe('agent shell --json', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'shell', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });
  });

  describe('agent status --json', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'status', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });
  });

  describe('agent visit --json', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'visit', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });
  });

  describe('agent login --json', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'login', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });
  });

  describe('agent restart --json', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'restart', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });
  });

  describe('agent rebuild --json', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'rebuild', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });
  });

  describe('agent list --json', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'list', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });
  });

  describe('agent --json (index)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });
  });
});
