import { expect } from 'chai';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root directory for the CLI
const root = path.resolve(__dirname, '../..');

// Isolated env to prevent test commands from polluting production database
function getIsolatedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.PRLT_HQ_PATH;
  delete env.PRLT_PMO_PATH;
  delete env.PRLT_DATABASE_PATH;
  delete env.PRLT_CONFIG_PATH;
  delete env.DEVCONTAINER;
  delete env.PRLT_TEST_ENV;
  return env;
}

// Helper to run CLI commands directly and get stdout
function runCli(args: string[]): string {
  const binPath = path.join(root, 'bin', 'run.js');
  try {
    return execSync(`node ${binPath} ${args.join(' ')}`, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getIsolatedEnv(),
    });
  } catch (error: unknown) {
    return (error as { stdout?: string })?.stdout || '';
  }
}


/**
 * Tests for flag consistency across work commands
 * TKT-635: Audit CLI flags vs interactive prompts for consistency
 */
describe('Work Command Flag Consistency (TKT-635)', () => {
  // Cache help outputs for all commands
  const helpOutputs: Record<string, string> = {};

  before(() => {
    helpOutputs.start = runCli(['work', 'start', '--help']);
    helpOutputs.spawn = runCli(['work', 'spawn', '--help']);
    helpOutputs.revise = runCli(['work', 'revise', '--help']);
    helpOutputs.watch = runCli(['work', 'watch', '--help']);
  });

  describe('--display flag consistency (not --mode)', () => {
    it('work start uses --display', () => {
      expect(helpOutputs.start).to.contain('--display');
    });

    it('work spawn uses --display', () => {
      expect(helpOutputs.spawn).to.contain('--display');
      expect(helpOutputs.spawn).to.not.match(/--mode\b/);
    });

    it('work revise uses --display (not --mode)', () => {
      expect(helpOutputs.revise).to.contain('--display');
      expect(helpOutputs.revise).to.not.match(/--mode\b/);
    });

    it('work watch uses --display (not --mode)', () => {
      expect(helpOutputs.watch).to.contain('--display');
      expect(helpOutputs.watch).to.not.match(/--mode\b/);
    });
  });

  describe('--permission-mode flag consistency', () => {
    it('work start has --permission-mode', () => {
      expect(helpOutputs.start).to.contain('--permission-mode');
    });

    it('work spawn has --permission-mode', () => {
      expect(helpOutputs.spawn).to.contain('--permission-mode');
    });

    it('work revise has --permission-mode', () => {
      expect(helpOutputs.revise).to.contain('--permission-mode');
    });

    it('work watch has --permission-mode', () => {
      expect(helpOutputs.watch).to.contain('--permission-mode');
    });

    it('all commands with --permission-mode offer danger and safe options', () => {
      for (const cmd of ['start', 'spawn', 'revise', 'watch']) {
        expect(helpOutputs[cmd]).to.contain('danger');
        expect(helpOutputs[cmd]).to.contain('safe');
      }
    });
  });

  describe('--skip-permissions flag consistency', () => {
    it('work start has --skip-permissions', () => {
      expect(helpOutputs.start).to.contain('--skip-permissions');
    });

    it('work spawn has --skip-permissions', () => {
      expect(helpOutputs.spawn).to.contain('--skip-permissions');
    });

    it('work revise has --skip-permissions', () => {
      expect(helpOutputs.revise).to.contain('--skip-permissions');
    });

    it('work watch has --skip-permissions', () => {
      expect(helpOutputs.watch).to.contain('--skip-permissions');
    });
  });

  describe('--skip-permissions describes shorthand', () => {
    it('work revise --skip-permissions is described as shorthand', () => {
      expect(helpOutputs.revise).to.contain('shorthand');
    });

    it('work spawn --skip-permissions is described as shorthand', () => {
      expect(helpOutputs.spawn).to.contain('shorthand');
    });

    it('work watch --skip-permissions is described as shorthand', () => {
      expect(helpOutputs.watch).to.contain('shorthand');
    });
  });

  describe('--focus flag consistency', () => {
    it('work start has --focus', () => {
      expect(helpOutputs.start).to.contain('--focus');
    });

    it('work spawn has --focus', () => {
      expect(helpOutputs.spawn).to.contain('--focus');
    });

    it('work revise has --focus', () => {
      expect(helpOutputs.revise).to.contain('--focus');
    });
  });

  describe('--clone flag consistency', () => {
    it('work start has --clone', () => {
      expect(helpOutputs.start).to.contain('--clone');
    });

    it('work spawn has --clone', () => {
      expect(helpOutputs.spawn).to.contain('--clone');
    });

    it('work revise has --clone', () => {
      expect(helpOutputs.revise).to.contain('--clone');
    });
  });

  describe('--json flag consistency', () => {
    it('work start has --json', () => {
      expect(helpOutputs.start).to.contain('--json');
    });

    it('work spawn has --json', () => {
      expect(helpOutputs.spawn).to.contain('--json');
    });

    it('work revise has --json', () => {
      expect(helpOutputs.revise).to.contain('--json');
    });

    it('work watch has --json', () => {
      expect(helpOutputs.watch).to.contain('--json');
    });
  });

  describe('display mode options', () => {
    it('work revise offers terminal and background', () => {
      expect(helpOutputs.revise).to.contain('terminal');
      expect(helpOutputs.revise).to.contain('background');
    });

    it('work watch offers terminal and background', () => {
      expect(helpOutputs.watch).to.contain('terminal');
      expect(helpOutputs.watch).to.contain('background');
    });

    it('work start offers foreground, terminal, and background', () => {
      expect(helpOutputs.start).to.contain('foreground');
      expect(helpOutputs.start).to.contain('terminal');
      expect(helpOutputs.start).to.contain('background');
    });
  });
});
