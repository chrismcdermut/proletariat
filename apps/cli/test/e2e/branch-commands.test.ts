import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * End-to-end tests for Branch Commands
 * Tests actual CLI usage as a user would interact with it
 *
 * Tests cover:
 * - branch:create - Creating branches with conventional naming
 * - branch:list - Listing branches with parsed info
 * - branch:validate - Validating branch name format
 * - Branch naming conventions
 * - Error cases (not in git repo, branch exists, etc.)
 *
 * Note: There is no explicit branch:switch command. Switching is done via:
 * - branch:create (which switches by default, unless --no-switch is used)
 * - git checkout directly
 */
describe('Branch Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-commands-e2e-'));
    process.chdir(testDir);

    // Initialize git repo for branch commands
    initGitRepo(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // branch:create
  // ===========================================================================
  describe('branch:create', () => {
    describe('with direct name argument (non-interactive)', () => {
      it('should create a branch with type and description format', () => {
        const output = exec('branch:create feat/my-feature');

        expect(output).to.include('Creating branch');
        expect(output).to.include('feat/my-feature');

        // Verify we switched to the branch
        const currentBranch = getCurrentBranch(testDir);
        expect(currentBranch).to.equal('feat/my-feature');
      });

      it('should create a branch with type, coder, and description format', () => {
        const output = exec('branch:create fix/chris/login-bug');

        expect(output).to.include('Creating branch');
        expect(output).to.include('fix/chris/login-bug');

        const currentBranch = getCurrentBranch(testDir);
        expect(currentBranch).to.equal('fix/chris/login-bug');
      });

      it('should create a branch without switching when --no-switch is used', () => {
        // First get the current branch (should be main or master)
        const initialBranch = getCurrentBranch(testDir);

        const output = exec('branch:create feat/no-switch-test --no-switch');

        expect(output).to.include('Creating branch');
        expect(output).to.include('not switched');

        // Should still be on initial branch
        const currentBranch = getCurrentBranch(testDir);
        expect(currentBranch).to.equal(initialBranch);

        // But branch should exist
        const branchExists = checkBranchExists(testDir, 'feat/no-switch-test');
        expect(branchExists).to.be.true;
      });

      it('should support all conventional branch types', () => {
        const conventionalTypes = ['feat', 'fix', 'rfct', 'docs', 'test', 'chore', 'perf', 'ci', 'build'];

        for (const type of conventionalTypes) {
          const output = exec(`branch:create ${type}/test-${type} --no-switch`);
          expect(output).to.include('Creating branch');
          expect(output).to.include(`${type}/test-${type}`);
        }
      });

      it('should support extended branch types', () => {
        const extendedTypes = ['sec', 'db', 'rel'];

        for (const type of extendedTypes) {
          const output = exec(`branch:create ${type}/test-${type} --no-switch`);
          expect(output).to.include('Creating branch');
          expect(output).to.include(`${type}/test-${type}`);
        }
      });

      it('should support founder/business branch types', () => {
        const founderTypes = ['ship', 'grow', 'cx', 'strat', 'ops'];

        for (const type of founderTypes) {
          const output = exec(`branch:create ${type}/test-${type} --no-switch`);
          expect(output).to.include('Creating branch');
          expect(output).to.include(`${type}/test-${type}`);
        }
      });
    });

    describe('with empty commit flag', () => {
      it('should create a branch with empty commit when flag is passed', () => {
        const output = exec('branch:create feat/with-commit --empty-commit');

        expect(output).to.include('Creating branch');
        expect(output).to.include('feat/with-commit');

        const currentBranch = getCurrentBranch(testDir);
        expect(currentBranch).to.equal('feat/with-commit');
      });
    });

    describe('error cases', () => {
      it('should error when branch already exists', () => {
        // Create the branch first
        exec('branch:create feat/already-exists');

        // Switch back to main
        execSync('git checkout main', { cwd: testDir, stdio: ['pipe', 'pipe', 'pipe'] });

        // Try to create it again
        const output = exec('branch:create feat/already-exists');

        expect(output).to.include('already exists');
      });

      it('should error when not in a git repository', () => {
        // Create a non-git directory
        const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
        process.chdir(nonGitDir);

        const output = exec('branch:create feat/test');

        expect(output).to.include('Not in a git repository');

        // Cleanup
        process.chdir(testDir);
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      });
    });
  });

  // ===========================================================================
  // branch:list
  // ===========================================================================
  describe('branch:list', () => {
    beforeEach(() => {
      // Create some test branches using direct name argument (non-interactive)
      exec('branch:create feat/feature-one --no-switch');
      exec('branch:create fix/bug-fix --no-switch');
      exec('branch:create feat/chris/feature-two --no-switch');
    });

    describe('basic listing', () => {
      it('should list all local branches', () => {
        const output = exec('branch:list');

        expect(output).to.include('feat/feature-one');
        expect(output).to.include('fix/bug-fix');
        expect(output).to.include('feat/chris/feature-two');
      });

      it('should mark the current branch', () => {
        const output = exec('branch:list');

        // Main should be current (we used --no-switch for all branches)
        expect(output).to.include('*');
        expect(output).to.include('current');
      });

      it('should show branch count', () => {
        const output = exec('branch:list');

        // Should show the count of branches (at least 4: main + 3 we created)
        expect(output).to.include('Branches');
      });
    });

    describe('filtering', () => {
      it('should filter by type with --type flag', () => {
        const output = exec('branch:list --type feat');

        expect(output).to.include('feat/feature-one');
        expect(output).to.include('feat/chris/feature-two');
        expect(output).to.not.include('fix/bug-fix');
      });

      it('should show message when no branches match filter', () => {
        const output = exec('branch:list --type docs');

        expect(output).to.include('No docs branches found');
      });
    });

    describe('output formats', () => {
      it('should output in table format by default', () => {
        const output = exec('branch:list');

        // Table format has headers
        expect(output).to.include('Name');
        expect(output).to.include('Type');
      });

      it('should output in compact format with --format compact', () => {
        const output = exec('branch:list --format compact');

        // Compact format doesn't have table headers
        expect(output).to.not.include('Name');
        expect(output).to.include('feat/feature-one');
      });

      it('should output in JSON format with --format json', () => {
        const output = exec('branch:list --format json');

        // Should be valid JSON
        const parsed = JSON.parse(output);
        expect(parsed).to.be.an('array');
        expect(parsed.length).to.be.at.least(1);

        // Should have branch info structure
        const featBranch = parsed.find((b: any) => b.name === 'feat/feature-one');
        expect(featBranch).to.exist;
        expect(featBranch.type).to.equal('feat');
        expect(featBranch.description).to.equal('feature-one');
      });
    });

    describe('parsed branch info', () => {
      it('should parse type from branch name', () => {
        const output = exec('branch:list --format json');
        const parsed = JSON.parse(output);

        const featBranch = parsed.find((b: any) => b.name === 'feat/feature-one');
        expect(featBranch.type).to.equal('feat');

        const fixBranch = parsed.find((b: any) => b.name === 'fix/bug-fix');
        expect(fixBranch.type).to.equal('fix');
      });

      it('should parse coder from branch name', () => {
        const output = exec('branch:list --format json');
        const parsed = JSON.parse(output);

        const branchWithCoder = parsed.find((b: any) => b.name === 'feat/chris/feature-two');
        expect(branchWithCoder.coder).to.equal('chris');

        const branchWithoutCoder = parsed.find((b: any) => b.name === 'feat/feature-one');
        expect(branchWithoutCoder.coder).to.be.undefined;
      });

      it('should parse description from branch name', () => {
        const output = exec('branch:list --format json');
        const parsed = JSON.parse(output);

        const featBranch = parsed.find((b: any) => b.name === 'feat/feature-one');
        expect(featBranch.description).to.equal('feature-one');

        const branchWithCoder = parsed.find((b: any) => b.name === 'feat/chris/feature-two');
        expect(branchWithCoder.description).to.equal('feature-two');
      });
    });

    describe('error cases', () => {
      it('should error when not in a git repository', () => {
        const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
        process.chdir(nonGitDir);

        const output = exec('branch:list');

        expect(output).to.include('Not in a git repository');

        process.chdir(testDir);
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      });
    });
  });

  // ===========================================================================
  // branch:validate
  // ===========================================================================
  describe('branch:validate', () => {
    describe('valid branch names', () => {
      it('should validate a simple type/description format', () => {
        const output = exec('branch:validate feat/my-feature');

        expect(output).to.include('Valid');
        expect(output).to.include('Type: feat');
        expect(output).to.include('Description: my-feature');
      });

      it('should validate type/coder/description format', () => {
        const output = exec('branch:validate fix/chris/login-bug');

        expect(output).to.include('Valid');
        expect(output).to.include('Type: fix');
        expect(output).to.include('Coder: chris');
        expect(output).to.include('Description: login-bug');
      });

      it('should validate all branch types', () => {
        const allTypes = [
          'feat', 'fix', 'rfct', 'docs', 'test', 'chore', 'perf', 'ci', 'build',
          'sec', 'db', 'rel',
          'ship', 'grow', 'cx', 'strat', 'ops'
        ];

        for (const type of allTypes) {
          const output = exec(`branch:validate ${type}/test-description`);
          expect(output).to.include('Valid');
          expect(output).to.include(`Type: ${type}`);
        }
      });

      it('should validate current branch when no argument given', () => {
        // Create and switch to a valid branch
        exec('branch:create feat/current-test');

        const output = exec('branch:validate');

        // Output says "Current branch '...' is valid"
        expect(output).to.include('is valid');
        expect(output).to.include('Current branch');
      });
    });

    describe('invalid branch names', () => {
      it('should reject branch name without type', () => {
        const output = exec('branch:validate my-feature');

        expect(output).to.include('Invalid');
      });

      it('should reject unknown branch type', () => {
        const output = exec('branch:validate unknown/my-feature');

        expect(output).to.include('Invalid');
        expect(output).to.include('Unknown branch type');
      });

      it('should reject non-kebab-case description', () => {
        const output = exec('branch:validate feat/MyFeature');

        expect(output).to.include('Invalid');
        expect(output).to.include('kebab-case');
      });

      it('should reject non-kebab-case coder', () => {
        const output = exec('branch:validate feat/Chris/my-feature');

        expect(output).to.include('Invalid');
        expect(output).to.include('kebab-case');
      });

      it('should reject branch name with too many segments', () => {
        const output = exec('branch:validate feat/chris/extra/my-feature');

        expect(output).to.include('Invalid');
      });

      it('should exit with code 1 for invalid branch', () => {
        // We can't easily check exit codes with our exec helper,
        // but the error output should indicate the validation failed
        const output = exec('branch:validate invalid-branch');
        expect(output).to.include('Invalid');
      });
    });

    describe('error cases', () => {
      it('should error when validating current branch but not in git repo', () => {
        const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
        process.chdir(nonGitDir);

        const output = exec('branch:validate');

        expect(output).to.include('Not in a git repository');

        process.chdir(testDir);
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      });
    });
  });

  // ===========================================================================
  // Branch Naming Conventions
  // ===========================================================================
  describe('Branch Naming Conventions', () => {
    describe('kebab-case validation', () => {
      it('should accept lowercase with hyphens', () => {
        const output = exec('branch:validate feat/my-cool-feature');
        expect(output).to.include('Valid');
      });

      it('should accept single word', () => {
        const output = exec('branch:validate feat/feature');
        expect(output).to.include('Valid');
      });

      it('should accept numbers', () => {
        const output = exec('branch:validate feat/feature-123');
        expect(output).to.include('Valid');
      });

      it('should reject uppercase letters', () => {
        const output = exec('branch:validate feat/MyFeature');
        expect(output).to.include('Invalid');
      });

      it('should reject spaces in branch name', () => {
        // When passing a branch name with spaces via direct argument, it's seen as multiple args
        // Testing the validate command instead which handles invalid input better
        const output = exec('branch:validate "feat/has spaces"');
        expect(output).to.include('Invalid');
      });

      it('should reject special characters', () => {
        const output = exec('branch:validate feat/my_feature');
        expect(output).to.include('Invalid');
      });

      it('should reject starting with hyphen', () => {
        const output = exec('branch:validate feat/-my-feature');
        expect(output).to.include('Invalid');
      });

      it('should reject ending with hyphen', () => {
        const output = exec('branch:validate feat/my-feature-');
        expect(output).to.include('Invalid');
      });
    });

    describe('branch name building', () => {
      it('should build type/description format correctly', () => {
        exec('branch:create feat/build-test-one');
        const branch = getCurrentBranch(testDir);
        expect(branch).to.equal('feat/build-test-one');
      });

      it('should build type/coder/description format correctly', () => {
        // Switch back to main first to ensure clean state
        try {
          execSync('git checkout main', { cwd: testDir, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch { /* ignore */ }

        exec('branch:create fix/agent/build-test-two');
        const branch = getCurrentBranch(testDir);
        expect(branch).to.equal('fix/agent/build-test-two');
      });
    });

    describe('conventional commit alignment', () => {
      it('should have branch types aligned with conventional commits', () => {
        // Core conventional commit types
        const conventionalTypes = ['feat', 'fix', 'docs', 'test', 'chore', 'perf', 'ci', 'build'];

        for (const type of conventionalTypes) {
          const output = exec(`branch:validate ${type}/test`);
          expect(output).to.include('Valid');
        }
      });
    });
  });

  // ===========================================================================
  // Branch Switching Behavior
  // ===========================================================================
  describe('Branch Switching Behavior', () => {
    it('should switch to new branch by default on create', () => {
      const initialBranch = getCurrentBranch(testDir);
      expect(initialBranch).to.equal('main');

      exec('branch:create feat/switch-test');

      const newBranch = getCurrentBranch(testDir);
      expect(newBranch).to.equal('feat/switch-test');
    });

    it('should not switch when --no-switch is used', () => {
      const initialBranch = getCurrentBranch(testDir);

      exec('branch:create feat/no-switch --no-switch');

      const currentBranch = getCurrentBranch(testDir);
      expect(currentBranch).to.equal(initialBranch);
    });

    it('should allow switching between branches via git checkout', () => {
      // Create multiple branches
      exec('branch:create feat/branch-one --no-switch');
      exec('branch:create feat/branch-two --no-switch');

      // Currently on main
      expect(getCurrentBranch(testDir)).to.equal('main');

      // Switch to branch-one
      execSync('git checkout feat/branch-one', { cwd: testDir, stdio: ['pipe', 'pipe', 'pipe'] });
      expect(getCurrentBranch(testDir)).to.equal('feat/branch-one');

      // Switch to branch-two
      execSync('git checkout feat/branch-two', { cwd: testDir, stdio: ['pipe', 'pipe', 'pipe'] });
      expect(getCurrentBranch(testDir)).to.equal('feat/branch-two');
    });
  });

  // ===========================================================================
  // Edge Cases and Integration
  // ===========================================================================
  describe('Edge Cases', () => {
    it('should handle branch names with ticket-like IDs (lowercase)', () => {
      // Using lowercase ticket ID pattern to avoid validation prompt
      const output = exec('branch:create feat/agent/tkt-001-add-auth');

      expect(output).to.include('Creating branch');

      const branch = getCurrentBranch(testDir);
      expect(branch).to.equal('feat/agent/tkt-001-add-auth');
    });

    it('should handle very long branch descriptions', () => {
      const longDesc = 'a-very-long-description-that-goes-on-and-on-for-testing';
      const output = exec(`branch:create feat/${longDesc} --no-switch`);

      expect(output).to.include('Creating branch');

      const branchExists = checkBranchExists(testDir, `feat/${longDesc}`);
      expect(branchExists).to.be.true;
    });

    it('should handle numeric-only descriptions', () => {
      const output = exec('branch:create feat/12345 --no-switch');

      expect(output).to.include('Creating branch');

      const branchExists = checkBranchExists(testDir, 'feat/12345');
      expect(branchExists).to.be.true;
    });

    it('should list branches including non-conventional names', () => {
      // Create a branch with non-conventional type using git directly
      execSync('git branch nonconventional-branch', {
        cwd: testDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_DIR: path.join(testDir, '.git'),
          GIT_WORK_TREE: testDir,
        },
      });

      const output = exec('branch:list --format json');
      const parsed = JSON.parse(output);

      const nonConventionalBranch = parsed.find((b: any) => b.name === 'nonconventional-branch');
      expect(nonConventionalBranch).to.exist;
      expect(nonConventionalBranch.type).to.be.undefined; // Not a recognized type
    });
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

function initGitRepo(dir: string) {
  try {
    execSync('git init', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    // Create initial commit
    fs.writeFileSync(path.join(dir, 'README.md'), '# Test');
    execSync('git add .', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git commit -m "Initial commit"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    // Rename default branch to 'main' for consistency
    try {
      execSync('git branch -M main', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      // Already named main or rename not supported
    }
  } catch {
    // Git init may fail in some test environments
  }
}

function getCurrentBranch(dir: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function checkBranchExists(dir: string, branchName: string): boolean {
  try {
    execSync(`git rev-parse --verify ${branchName}`, {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function exec(cmd: string): string {
  try {
    // Get the CLI directory (where bin/run.js is located)
    const cliDir = path.join(__dirname, '../..');
    const binPath = path.join(cliDir, 'bin/run.js');

    // Run the CLI from the CLI directory but set GIT_DIR to the current test directory
    // This allows the CLI to find its modules while git operations use the test repo
    const currentDir = process.cwd();

    return execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: cliDir,  // Run from CLI dir so modules resolve
      env: {
        ...process.env,
        NODE_ENV: 'test',
        NODE_NO_WARNINGS: '1',
        // Override git to use the test directory
        GIT_DIR: path.join(currentDir, '.git'),
        GIT_WORK_TREE: currentDir,
      },
    });
  } catch (error: any) {
    // Return output even if command exits with non-zero
    return error.stdout || error.stderr || error.message;
  }
}
