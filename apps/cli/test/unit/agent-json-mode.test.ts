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
 * Tests that agent commands properly support JSON mode output via agentPrompt
 */
describe('Agent Command JSON Mode (TKT-741)', () => {

  describe('agent auth', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'auth', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output status as JSON');
    });

    it('should have --check flag for status checking', async () => {
      const { stdout } = await runCommand(['agent', 'auth', '--help'], { root });
      expect(stdout).to.include('--check');
    });
  });

  describe('agent discover', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'discover', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output discovery results as JSON');
    });

    it('should have --dry-run flag', async () => {
      const { stdout } = await runCommand(['agent', 'discover', '--help'], { root });
      expect(stdout).to.include('--dry-run');
    });
  });

  describe('agent shell (agentPrompt migration)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'shell', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });

    it('should accept agent name as argument', async () => {
      const { stdout } = await runCommand(['agent', 'shell', '--help'], { root });
      expect(stdout).to.include('ARGUMENTS');
      expect(stdout).to.match(/name/i);
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'shell', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent status (agentPrompt migration)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'status', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });

    it('should accept agent name as argument', async () => {
      const { stdout } = await runCommand(['agent', 'status', '--help'], { root });
      expect(stdout).to.include('ARGUMENTS');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'status', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent visit (agentPrompt migration)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'visit', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });

    it('should accept agent name as argument', async () => {
      const { stdout } = await runCommand(['agent', 'visit', '--help'], { root });
      expect(stdout).to.include('ARGUMENTS');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'visit', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent login (agentPrompt migration)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'login', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });

    it('should accept agent name as argument', async () => {
      const { stdout } = await runCommand(['agent', 'login', '--help'], { root });
      expect(stdout).to.include('ARGUMENTS');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'login', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent list (agentPrompt migration)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'list', '--help'], { root });
      expect(stdout).to.include('--json');
      // Uses pmoBaseFlags so check for either description pattern
      expect(stdout).to.match(/Output.*JSON/);
    });

    it('should have --type flag for filtering', async () => {
      const { stdout } = await runCommand(['agent', 'list', '--help'], { root });
      expect(stdout).to.include('--type');
      expect(stdout).to.include('staff');
      expect(stdout).to.include('temp');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'list', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent restart (already using selectFromList)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'restart', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'restart', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent rebuild (already using selectFromList)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', 'rebuild', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });

    it('should have --no-cache flag', async () => {
      const { stdout } = await runCommand(['agent', 'rebuild', '--help'], { root });
      expect(stdout).to.include('--no-cache');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', 'rebuild', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });

  describe('agent index (agentPrompt migration)', () => {
    it('should have --json flag in help', async () => {
      const { stdout } = await runCommand(['agent', '--help'], { root });
      expect(stdout).to.include('--json');
      expect(stdout).to.include('Output prompt configuration as JSON');
    });

    it('should list all subcommands', async () => {
      const { stdout } = await runCommand(['agent', '--help'], { root });
      expect(stdout).to.include('COMMANDS');
      // Check for key subcommands
      expect(stdout).to.include('list');
      expect(stdout).to.include('status');
      expect(stdout).to.include('shell');
    });

    it('should extend PMOCommand (has -P/--project flag)', async () => {
      const { stdout } = await runCommand(['agent', '--help'], { root });
      expect(stdout).to.include('-P');
      expect(stdout).to.include('--project');
    });
  });
});

/**
 * Unit tests for agentPrompt choice structure
 * Verifies that choices include the required 'command' field for JSON mode
 */
describe('Agent Command Choice Structure', () => {
  // These tests verify the contract that agentPrompt choices must have command fields
  // The actual JSON output testing requires a workspace context

  describe('agentPrompt contract', () => {
    it('agent index choices should include command field in code', async () => {
      // This is a static analysis test - verify the source code includes command fields
      const fs = await import('node:fs');
      const indexPath = path.resolve(__dirname, '../../src/commands/agent/index.ts');
      const content = fs.readFileSync(indexPath, 'utf-8');

      // Verify choices have command field with --machine flag
      expect(content).to.include("command: 'prlt agent list --machine'");
      expect(content).to.include("command: 'prlt agent status --machine'");
      expect(content).to.include("command: 'prlt agent shell --machine'");
    });

    it('agent shell choices should include command field in code', async () => {
      const fs = await import('node:fs');
      const shellPath = path.resolve(__dirname, '../../src/commands/agent/shell.ts');
      const content = fs.readFileSync(shellPath, 'utf-8');

      // Verify agent selection choices have command field with --machine flag
      expect(content).to.include('command: `prlt agent shell ${agent.name} --machine`');
    });

    it('agent status choices should include command field in code', async () => {
      const fs = await import('node:fs');
      const statusPath = path.resolve(__dirname, '../../src/commands/agent/status.ts');
      const content = fs.readFileSync(statusPath, 'utf-8');

      // Verify choices have command field with --machine flag
      expect(content).to.include('command: `prlt agent status ${agent.name} --machine`');
    });

    it('agent visit choices should include command field in code', async () => {
      const fs = await import('node:fs');
      const visitPath = path.resolve(__dirname, '../../src/commands/agent/visit.ts');
      const content = fs.readFileSync(visitPath, 'utf-8');

      // Verify choices have command field with --machine flag
      expect(content).to.include('command: `prlt agent visit ${agent.name} --machine`');
    });

    it('agent login choices should include command field in code', async () => {
      const fs = await import('node:fs');
      const loginPath = path.resolve(__dirname, '../../src/commands/agent/login.ts');
      const content = fs.readFileSync(loginPath, 'utf-8');

      // Verify choices have command field with --machine flag
      expect(content).to.include('command: `prlt agent login ${agent.name} --machine`');
    });

    it('agent list choices should include command field in code', async () => {
      const fs = await import('node:fs');
      const listPath = path.resolve(__dirname, '../../src/commands/agent/list.ts');
      const content = fs.readFileSync(listPath, 'utf-8');

      // Verify choices have command field with --machine flag
      expect(content).to.include("command: 'prlt agent list --type all --machine'");
      expect(content).to.include("command: 'prlt agent list --type staff --machine'");
      expect(content).to.include("command: 'prlt agent list --type temp --machine'");
    });
  });

  describe('agentPrompt usage pattern', () => {
    it('migrated files should use this.prompt instead of inquirer.prompt', async () => {
      const fs = await import('node:fs');

      const filesToCheck = [
        '../../src/commands/agent/index.ts',
        '../../src/commands/agent/shell.ts',
        '../../src/commands/agent/status.ts',
        '../../src/commands/agent/visit.ts',
        '../../src/commands/agent/login.ts',
        '../../src/commands/agent/list.ts',
      ];

      for (const file of filesToCheck) {
        const filePath = path.resolve(__dirname, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Should use this.prompt
        expect(content, `${file} should use this.prompt`).to.include('this.prompt');

        // Should NOT have standalone inquirer.prompt calls (but may import inquirer for Separator)
        const promptCalls = content.match(/await\s+inquirer\.prompt\(/g) || [];
        expect(promptCalls.length, `${file} should not use inquirer.prompt directly`).to.equal(0);
      }
    });

    it('migrated files should pass agentConfig to prompt', async () => {
      const fs = await import('node:fs');

      const filesToCheck = [
        '../../src/commands/agent/index.ts',
        '../../src/commands/agent/shell.ts',
        '../../src/commands/agent/status.ts',
        '../../src/commands/agent/visit.ts',
        '../../src/commands/agent/login.ts',
        '../../src/commands/agent/list.ts',
      ];

      for (const file of filesToCheck) {
        const filePath = path.resolve(__dirname, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Should define agentConfig
        expect(content, `${file} should define agentConfig`).to.include('agentConfig');

        // Should pass agentConfig to prompt (or null for interactive-only prompts)
        expect(content, `${file} should pass agentConfig to prompt`).to.match(
          /this\.prompt.*\],\s*(agentConfig|null)\)/s
        );
      }
    });
  });
});
