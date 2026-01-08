import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * End-to-end tests for Commit Command
 * Tests commit with various flags and options
 */
describe('Commit Command E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-e2e-'));
    process.chdir(testDir);

    // Initialize a git repo for testing
    execSync('git init', { stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { stdio: 'pipe' });
    execSync('git config user.name "Test User"', { stdio: 'pipe' });

    // Create initial commit so we have a branch
    fs.writeFileSync('README.md', '# Test Repo');
    execSync('git add .', { stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { stdio: 'pipe' });

    // Create a conventional branch with ticket ID for testing
    execSync('git checkout -b TKT-123/feat/chris/bezos/add-feature', { stdio: 'pipe' });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('prlt commit --formats', () => {
    it('should list all available commit formats', () => {
      const output = exec('commit --formats');

      expect(output).to.contain('conventional');
      expect(output).to.contain('full-context');
      expect(output).to.contain('ticket-first');
      expect(output).to.contain('with-agent');
      expect(output).to.contain('ticket-suffix');
      expect(output).to.contain('ticket-only');
      expect(output).to.contain('simple');
    });

    it('should show format descriptions', () => {
      const output = exec('commit --formats');

      expect(output).to.contain('Conventional commits');
      expect(output).to.contain('(default)');
    });
  });

  describe('prlt commit --dry-run', () => {
    it('should show what would be committed without committing', () => {
      // Create a change and stage it
      fs.writeFileSync('test.txt', 'test content');
      execSync('git add test.txt', { stdio: 'pipe' });

      const output = exec('commit --dry-run "add test file"');

      expect(output).to.contain('Dry run');
      expect(output).to.contain('feat(TKT-123): add test file');
      expect(output).to.contain('TKT-123');

      // Verify no commit was made
      const log = execSync('git log --oneline', { encoding: 'utf-8' });
      expect(log).to.not.contain('add test file');
    });

    it('should show format and type info in dry run', () => {
      fs.writeFileSync('test.txt', 'test content');
      execSync('git add test.txt', { stdio: 'pipe' });

      const output = exec('commit --dry-run "test message"');

      expect(output).to.contain('Format:');
      expect(output).to.contain('Type:');
      expect(output).to.contain('Ticket:');
    });
  });

  describe('prlt commit with message (non-interactive)', () => {
    it('should commit staged files with conventional format', () => {
      fs.writeFileSync('feature.ts', 'export const feature = true;');
      execSync('git add feature.ts', { stdio: 'pipe' });

      const output = exec('commit "add new feature"');

      expect(output).to.contain('Committed');
      expect(output).to.contain('feat(TKT-123): add new feature');

      // Verify commit was made
      const log = execSync('git log --oneline -1', { encoding: 'utf-8' });
      expect(log).to.contain('feat(TKT-123): add new feature');
    });

    it('should fail when no staged changes', () => {
      const output = exec('commit "no changes"');

      expect(output.toLowerCase()).to.contain('no staged changes');
    });
  });

  describe('prlt commit --all', () => {
    it('should stage all changes and commit', () => {
      // Create multiple files without staging
      fs.writeFileSync('file1.ts', 'content1');
      fs.writeFileSync('file2.ts', 'content2');

      const output = exec('commit --all "add multiple files"');

      expect(output).to.contain('Committed');

      // Verify all files were committed
      const log = execSync('git log --oneline -1', { encoding: 'utf-8' });
      expect(log).to.contain('add multiple files');

      // Verify working tree is clean
      const status = execSync('git status --porcelain', { encoding: 'utf-8' });
      expect(status.trim()).to.equal('');
    });
  });

  describe('prlt commit --stage', () => {
    it('should stage specific file and commit', () => {
      // Create multiple files
      fs.writeFileSync('stage-me.ts', 'staged content');
      fs.writeFileSync('leave-me.ts', 'unstaged content');

      const output = exec('commit -s stage-me.ts "add staged file"');

      expect(output).to.contain('Committed');

      // Verify only staged file was committed
      const log = execSync('git log --oneline -1', { encoding: 'utf-8' });
      expect(log).to.contain('add staged file');

      // Verify leave-me.ts is still untracked
      const status = execSync('git status --porcelain', { encoding: 'utf-8' });
      expect(status).to.contain('leave-me.ts');
    });

    it('should stage multiple files with multiple -s flags', () => {
      fs.writeFileSync('file1.ts', 'content1');
      fs.writeFileSync('file2.ts', 'content2');
      fs.writeFileSync('file3.ts', 'content3');

      const output = exec('commit -s file1.ts -s file2.ts "add two files"');

      expect(output).to.contain('Committed');

      // Verify file3.ts is still untracked
      const status = execSync('git status --porcelain', { encoding: 'utf-8' });
      expect(status).to.contain('file3.ts');
      expect(status).to.not.contain('file1.ts');
      expect(status).to.not.contain('file2.ts');
    });
  });

  describe('prlt commit --type', () => {
    it('should override commit type', () => {
      fs.writeFileSync('bugfix.ts', 'fixed bug');
      execSync('git add bugfix.ts', { stdio: 'pipe' });

      const output = exec('commit -t fix "resolve critical bug"');

      expect(output).to.contain('Committed');
      expect(output).to.contain('fix(TKT-123): resolve critical bug');

      const log = execSync('git log --oneline -1', { encoding: 'utf-8' });
      expect(log).to.contain('fix(TKT-123)');
    });

    it('should reject invalid commit types', () => {
      fs.writeFileSync('test.ts', 'content');
      execSync('git add test.ts', { stdio: 'pipe' });

      const output = exec('commit -t invalid "test message"');

      expect(output.toLowerCase()).to.contain('invalid commit type');
    });

    it('should accept all valid conventional commit types', () => {
      const validTypes = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];

      for (const type of validTypes) {
        // Reset to clean state
        execSync('git reset --hard HEAD', { stdio: 'pipe' });

        fs.writeFileSync(`${type}-file.ts`, `${type} content`);
        execSync(`git add ${type}-file.ts`, { stdio: 'pipe' });

        const output = exec(`commit -t ${type} "test ${type}"`);

        expect(output).to.contain('Committed');
        expect(output).to.contain(`${type}(TKT-123)`);
      }
    });
  });

  describe('prlt commit --ticket', () => {
    it('should override ticket ID from branch', () => {
      fs.writeFileSync('override.ts', 'content');
      execSync('git add override.ts', { stdio: 'pipe' });

      const output = exec('commit -T TKT-999 "custom ticket"');

      expect(output).to.contain('Committed');
      expect(output).to.contain('feat(TKT-999): custom ticket');

      const log = execSync('git log --oneline -1', { encoding: 'utf-8' });
      expect(log).to.contain('TKT-999');
      expect(log).to.not.contain('TKT-123');
    });
  });

  describe('prlt commit --format', () => {
    it('should use conventional format (default)', () => {
      fs.writeFileSync('format-test.ts', 'content');
      execSync('git add format-test.ts', { stdio: 'pipe' });

      const output = exec('commit -f conventional "test message"');

      expect(output).to.contain('feat(TKT-123): test message');
    });

    it('should use full-context format', () => {
      fs.writeFileSync('format-test.ts', 'content');
      execSync('git add format-test.ts', { stdio: 'pipe' });

      const output = exec('commit -f full-context "test message"');

      expect(output).to.contain('TKT-123/feat/bezos: test message');
    });

    it('should use ticket-first format', () => {
      fs.writeFileSync('format-test.ts', 'content');
      execSync('git add format-test.ts', { stdio: 'pipe' });

      const output = exec('commit -f ticket-first "test message"');

      expect(output).to.contain('TKT-123: feat: test message');
    });

    it('should use with-agent format', () => {
      fs.writeFileSync('format-test.ts', 'content');
      execSync('git add format-test.ts', { stdio: 'pipe' });

      const output = exec('commit -f with-agent "test message"');

      expect(output).to.contain('TKT-123/bezos: test message');
    });

    it('should use ticket-suffix format', () => {
      fs.writeFileSync('format-test.ts', 'content');
      execSync('git add format-test.ts', { stdio: 'pipe' });

      const output = exec('commit -f ticket-suffix "test message"');

      expect(output).to.contain('feat: test message [TKT-123]');
    });

    it('should use ticket-only format', () => {
      fs.writeFileSync('format-test.ts', 'content');
      execSync('git add format-test.ts', { stdio: 'pipe' });

      const output = exec('commit -f ticket-only "test message"');

      expect(output).to.contain('TKT-123: test message');
    });

    it('should use simple format (no ticket)', () => {
      fs.writeFileSync('format-test.ts', 'content');
      execSync('git add format-test.ts', { stdio: 'pipe' });

      const output = exec('commit -f simple "test message"');

      expect(output).to.contain('feat: test message');
    });
  });

  describe('prlt commit with combined flags', () => {
    it('should combine --all, --type, and --format', () => {
      fs.writeFileSync('combined.ts', 'combined test');

      const output = exec('commit -a -t fix -f ticket-suffix "combined flags test"');

      expect(output).to.contain('Committed');
      expect(output).to.contain('fix: combined flags test [TKT-123]');
    });

    it('should combine --stage, --ticket, and --type', () => {
      fs.writeFileSync('staged.ts', 'staged content');
      fs.writeFileSync('unstaged.ts', 'unstaged content');

      const output = exec('commit -s staged.ts -T TKT-555 -t docs "document feature"');

      expect(output).to.contain('Committed');
      expect(output).to.contain('docs(TKT-555): document feature');

      // Verify unstaged file remains
      const status = execSync('git status --porcelain', { encoding: 'utf-8' });
      expect(status).to.contain('unstaged.ts');
    });
  });

  describe('branch format edge cases', () => {
    it('should work with old-style branch format', () => {
      // Switch to old-style branch
      execSync('git checkout -b feat/chris/old-style-branch', { stdio: 'pipe' });

      fs.writeFileSync('old-style.ts', 'content');
      execSync('git add old-style.ts', { stdio: 'pipe' });

      // Should fail because branch doesn't match new format
      const output = exec('commit "test message"');

      expect(output).to.contain('Could not parse branch name');
    });

    it('should allow --ticket flag to bypass branch parsing for ticket ID', () => {
      // Even on a non-standard branch, --ticket should work
      execSync('git checkout -b TKT-001/feat/chris/agent/description', { stdio: 'pipe' });

      fs.writeFileSync('bypass.ts', 'content');
      execSync('git add bypass.ts', { stdio: 'pipe' });

      const output = exec('commit -T CUSTOM-001 "bypass branch ticket"');

      expect(output).to.contain('CUSTOM-001');
    });
  });
});

// Helper function to run CLI commands
function exec(cmd: string): string {
  try {
    const binPath = path.join(__dirname, '../../bin/run.js');
    // Capture both stdout and stderr, then filter stderr noise
    const result = execSync(`node ${binPath} ${cmd} 2>&1`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });
    return filterOutput(result);
  } catch (error: any) {
    const stdout = error.stdout || '';
    const stderr = error.stderr || '';
    // Return filtered output from either stream
    const combined = stdout + stderr;
    const filtered = filterOutput(combined);
    return filtered || error.message;
  }
}

// Filter out oclif warnings and noise from stderr
function filterOutput(output: string): string {
  return output.split('\n').filter((line: string) =>
    !line.includes('[ERR_UNKNOWN_FILE_EXTENSION]') &&
    !line.includes('Warning:') &&
    !line.includes('module: @oclif') &&
    !line.includes('task: findCommand') &&
    !line.includes('plugin: @chrismcdermut') &&
    !line.includes('root: /') &&
    !line.includes('code: ERR_') &&
    !line.includes('message: Unknown file extension') &&
    !line.includes('See more details with DEBUG') &&
    !line.includes('node --trace-warnings') &&
    !line.includes('node --trace-deprecation') &&
    !line.includes('ExperimentalWarning') &&
    !line.includes('DeprecationWarning') &&
    !line.includes('(Use `node') &&
    line.trim() !== ''
  ).join('\n');
}
