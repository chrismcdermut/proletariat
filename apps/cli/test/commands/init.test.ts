import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { runCommand } from '@oclif/test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root directory for the CLI - needed for @oclif/test to find commands
const root = path.resolve(__dirname, '../..');

/**
 * Tests for prlt init deprecation (PRLT-1076)
 *
 * prlt init is deprecated in favor of prlt new. It should:
 * - Show a deprecation warning
 * - Forward all flags/args to prlt new
 * - Be hidden from command listings
 * - Accept the same flags as prlt new
 */
describe('prlt init (deprecated)', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-test-'));
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('deprecation behavior (PRLT-1076)', () => {
    it('should be marked as hidden', async () => {
      const Init = (await import('../../src/commands/init.js')).default;
      expect(Init.hidden).to.be.true;
    });

    it('should have deprecation notice in description', async () => {
      const Init = (await import('../../src/commands/init.js')).default;
      expect(Init.description).to.contain('deprecated');
      expect(Init.description).to.contain('prlt new');
    });

    it('should show deprecation warning when run', () => {
      const binPath = path.resolve(root, 'bin', 'run.js');
      try {
        const output = execSync(
          `node ${binPath} init --json --name test-deprecation 2>&1`,
          { cwd: testDir, timeout: 15000 },
        ).toString();
        expect(output).to.contain('deprecated');
        expect(output).to.contain('prlt new');
      } catch (error: unknown) {
        const e = error as { stderr?: Buffer; stdout?: Buffer };
        const output = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
        // Even on error, the deprecation warning should appear
        expect(output).to.contain('deprecated');
      }
    });

    it('should forward to prlt new (JSON mode outputs new command prompt)', () => {
      const binPath = path.resolve(root, 'bin', 'run.js');
      try {
        const output = execSync(
          `node ${binPath} init --json 2>&1`,
          { cwd: testDir, timeout: 15000 },
        ).toString();
        // Should contain deprecation notice AND new command's JSON output
        expect(output).to.contain('deprecated');
        // The forwarded `new --json` command outputs a prompt for name
        expect(output).to.satisfy((s: string) =>
          s.includes('"name"') || s.includes('prompt') || s.includes('headquarters')
        );
      } catch (error: unknown) {
        const e = error as { stderr?: Buffer; stdout?: Buffer };
        const output = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
        expect(output).to.contain('deprecated');
      }
    });

    it('should accept the same flags as prlt new', async () => {
      const Init = (await import('../../src/commands/init.js')).default;
      const New = (await import('../../src/commands/new.js')).default;

      // Init should have all the flags that new has (for forwarding)
      const newFlagKeys = Object.keys(New.flags);
      const initFlagKeys = Object.keys(Init.flags);

      for (const flag of newFlagKeys) {
        expect(initFlagKeys).to.include(flag,
          `Init command is missing flag '${flag}' that exists on New command`);
      }
    });

    it('should point examples to prlt new', async () => {
      const Init = (await import('../../src/commands/init.js')).default;
      for (const example of Init.examples) {
        // Examples should reference `new`, not `init`
        expect(example).to.contain('new');
      }
    });
  });

  describe('unknown flag rejection (TKT-936)', () => {
    it('should reject unknown flags', () => {
      const binPath = path.resolve(root, 'bin', 'run.js');
      try {
        execSync(`node ${binPath} init --json --name test --unknown-flag value 2>&1`, {
          cwd: testDir,
          timeout: 10000,
        });
        expect.fail('Expected command to fail with unknown flag');
      } catch (error: unknown) {
        const e = error as { stderr?: Buffer; stdout?: Buffer; status?: number };
        const output = (e.stderr?.toString() || '') + (e.stdout?.toString() || '');
        expect(output).to.contain('Nonexistent flag');
      }
    });

    it('should reject unknown short flags', () => {
      const binPath = path.resolve(root, 'bin', 'run.js');
      try {
        execSync(`node ${binPath} init --json --name test -z value 2>&1`, {
          cwd: testDir,
          timeout: 10000,
        });
        expect.fail('Expected command to fail with unknown flag');
      } catch (error: unknown) {
        const e = error as { stderr?: Buffer; stdout?: Buffer; status?: number };
        const output = (e.stderr?.toString() || '') + (e.stdout?.toString() || '');
        expect(output).to.contain('Nonexistent flag');
      }
    });
  });
});
