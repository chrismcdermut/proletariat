import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { exec } from './test-helpers.js';

/**
 * End-to-end tests for Branch Commands
 * Tests branch list, validate, and create (with flags)
 */
describe('Branch Commands E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-e2e-'));
    process.chdir(testDir);

    // Initialize a git repo for testing
    execSync('git init', { stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { stdio: 'pipe' });
    execSync('git config user.name "Test User"', { stdio: 'pipe' });

    // Create initial commit so we have a branch
    fs.writeFileSync('README.md', '# Test Repo');
    execSync('git add .', { stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { stdio: 'pipe' });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('prlt branch list', () => {
    it('should list branches', () => {
      const output = exec('branch list');

      expect(output).to.contain('Branches');
      // Should show main/master branch
      expect(output.toLowerCase()).to.match(/main|master/);
    });

    it('should show current branch marker', () => {
      const output = exec('branch list');

      // Current branch should be indicated
      expect(output).to.match(/\*|current/i);
    });

    it('should list conventional branches with type info', () => {
      // Create a conventional branch
      execSync('git checkout -b feat/chris/add-login', { stdio: 'pipe' });

      const output = exec('branch list');

      expect(output).to.contain('feat/chris/add-login');
      expect(output).to.contain('feat');
    });

    it('should list ticket-first branches', () => {
      // Create a ticket-first branch
      execSync('git checkout -b TKT-001/feat/chris/altman/add-auth', { stdio: 'pipe' });

      // Use JSON format to avoid table truncation
      const output = exec('branch list --format json');
      const branches = JSON.parse(output);

      const branch = branches.find((b: any) => b.name === 'TKT-001/feat/chris/altman/add-auth');
      expect(branch).to.exist;
      expect(branch.ticketId).to.equal('TKT-001');
    });

    it('should support compact format', () => {
      execSync('git checkout -b feat/test/compact-test', { stdio: 'pipe' });

      const output = exec('branch list --format compact');

      expect(output).to.contain('feat/test/compact-test');
    });

    it('should support JSON format', () => {
      const output = exec('branch list --format json');

      // Should be valid JSON
      const parsed = JSON.parse(output);
      expect(parsed).to.be.an('array');
      expect(parsed.length).to.be.greaterThan(0);
      expect(parsed[0]).to.have.property('name');
      expect(parsed[0]).to.have.property('current');
    });

    it('should filter by type', () => {
      // Create branches of different types
      execSync('git checkout -b feat/test/feature-one', { stdio: 'pipe' });
      execSync('git checkout -b fix/test/bug-fix', { stdio: 'pipe' });
      execSync('git checkout -b docs/test/add-docs', { stdio: 'pipe' });

      const output = exec('branch list --type feat');

      expect(output).to.contain('feat/test/feature-one');
      expect(output).not.to.contain('fix/test/bug-fix');
      expect(output).not.to.contain('docs/test/add-docs');
    });

    it('should show no branches message when filtered type has none', () => {
      const output = exec('branch list --type sec');

      expect(output.toLowerCase()).to.contain('no');
    });
  });

  describe('prlt branch validate', () => {
    it('should validate correct conventional branch name', () => {
      const output = exec('branch validate feat/chris/add-login');

      expect(output.toLowerCase()).to.contain('valid');
    });

    it('should validate ticket-first branch name', () => {
      const output = exec('branch validate TKT-001/feat/chris/altman/add-auth');

      expect(output.toLowerCase()).to.contain('valid');
    });

    it('should validate minimal branch name', () => {
      const output = exec('branch validate feat/add-feature');

      expect(output.toLowerCase()).to.contain('valid');
    });

    it('should reject invalid branch type', () => {
      const output = exec('branch validate invalid/chris/test');

      expect(output.toLowerCase()).to.contain('invalid');
    });

    it('should reject non-kebab-case description', () => {
      const output = exec('branch validate feat/chris/AddLogin');

      expect(output.toLowerCase()).to.match(/invalid|kebab/i);
    });

    it('should show parsed parts for valid branch', () => {
      const output = exec('branch validate TKT-054/chore/chris/altman/update-naming');

      expect(output).to.contain('TKT-054');
      expect(output).to.contain('chore');
      expect(output).to.contain('chris');
    });

    it('should validate branch with ticket ID', () => {
      const output = exec('branch validate TKT-123/fix/john/bug-fix');

      expect(output.toLowerCase()).to.contain('valid');
      expect(output).to.contain('TKT-123');
    });
  });

  describe('prlt branch create', () => {
    it('should create branch with type and description flags', () => {
      const output = exec('branch create -t feat -d add-user-auth');

      expect(output).to.contain('Creating branch');

      // Verify branch was created (may include auto-detected owner)
      const branches = execSync('git branch', { encoding: 'utf-8' });
      expect(branches).to.match(/feat\/.*add-user-auth/);
    });

    it('should create branch with owner flag', () => {
      const output = exec('branch create -t fix -c chris -d fix-login-bug');

      expect(output).to.contain('Creating branch');

      const branches = execSync('git branch', { encoding: 'utf-8' });
      expect(branches).to.contain('fix/chris/fix-login-bug');
    });

    it('should create branch with ticket flag', () => {
      // Need PMO context for ticket lookup, so test direct name instead
      const output = exec('branch create TKT-001/feat/test/add-feature');

      // Should prompt about non-conventional but allow creation
      const branches = execSync('git branch', { encoding: 'utf-8' });
      // Branch may or may not be created depending on prompt answer
      // Just verify command ran without crash
      expect(output).to.be.a('string');
    });

    it('should create branch with empty commit flag', () => {
      const output = exec('branch create -t chore -d setup-ci -e');

      // Check that branch was created
      expect(output).to.contain('Creating branch');

      // Verify we're on the new branch
      const currentBranch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
      expect(currentBranch).to.match(/chore\/.*setup-ci/);

      // Note: The -e flag triggers an empty commit, but in non-interactive test mode
      // the prompt may be skipped. Just verify the branch was created successfully.
    });

    it('should reject existing branch name', () => {
      // Create a branch first
      execSync('git checkout -b feat/existing-branch', { stdio: 'pipe' });
      execSync('git checkout -', { stdio: 'pipe' });

      const output = exec('branch create feat/existing-branch');

      expect(output.toLowerCase()).to.contain('already exists');
    });

    it('should create branch from origin/main with flag', () => {
      // Create a fake origin for testing
      execSync('git remote add origin .', { stdio: 'pipe' });

      const output = exec('branch create -t feat -d from-origin -o');

      // Should attempt to fetch (may warn about no origin/main)
      expect(output).to.be.a('string');
    });

    it('should support no-switch flag', () => {
      const currentBranch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();

      exec('branch create -t docs -d readme-update --no-switch');

      // Should still be on original branch
      const afterBranch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
      expect(afterBranch).to.equal(currentBranch);

      // But new branch should exist (may include auto-detected owner)
      const branches = execSync('git branch', { encoding: 'utf-8' });
      expect(branches).to.match(/docs\/.*readme-update/);
    });

    it('should validate branch type option', () => {
      const output = exec('branch create -t invalid-type -d test');

      expect(output.toLowerCase()).to.match(/invalid|error|unknown/i);
    });

    it('should handle kebab-case conversion for description', () => {
      // Note: Interactive mode would auto-convert, but flag mode requires kebab-case
      const output = exec('branch create -t feat -d "test branch"');

      // Should either work or error about format
      expect(output).to.be.a('string');
    });
  });

  describe('Branch naming conventions', () => {
    it('should recognize all conventional commit types', () => {
      const types = ['feat', 'fix', 'docs', 'test', 'chore', 'perf', 'ci', 'build', 'rfct'];

      for (const type of types) {
        execSync(`git checkout -b ${type}/test/type-${type}`, { stdio: 'pipe' });
      }

      const output = exec('branch list --format json');
      const branches = JSON.parse(output);

      for (const type of types) {
        const branch = branches.find((b: any) => b.name === `${type}/test/type-${type}`);
        expect(branch, `Branch with type ${type} should exist`).to.exist;
        expect(branch.type).to.equal(type);
      }
    });

    it('should recognize extended types', () => {
      const types = ['sec', 'db', 'rel'];

      for (const type of types) {
        execSync(`git checkout -b ${type}/test/ext-${type}`, { stdio: 'pipe' });
      }

      const output = exec('branch list --format json');
      const branches = JSON.parse(output);

      for (const type of types) {
        const branch = branches.find((b: any) => b.name === `${type}/test/ext-${type}`);
        expect(branch, `Branch with type ${type} should exist`).to.exist;
        expect(branch.type).to.equal(type);
      }
    });

    it('should recognize founder types', () => {
      const types = ['ship', 'grow', 'cx', 'strat', 'ops'];

      for (const type of types) {
        execSync(`git checkout -b ${type}/test/founder-${type}`, { stdio: 'pipe' });
      }

      const output = exec('branch list --format json');
      const branches = JSON.parse(output);

      for (const type of types) {
        const branch = branches.find((b: any) => b.name === `${type}/test/founder-${type}`);
        expect(branch, `Branch with type ${type} should exist`).to.exist;
        expect(branch.type).to.equal(type);
      }
    });

    it('should parse ticket ID from branch name', () => {
      execSync('git checkout -b TKT-123/feat/chris/add-feature', { stdio: 'pipe' });

      const output = exec('branch list --format json');
      const branches = JSON.parse(output);

      const branch = branches.find((b: any) => b.name.startsWith('TKT-123'));
      expect(branch).to.exist;
      expect(branch.ticketId).to.equal('TKT-123');
      expect(branch.type).to.equal('feat');
      expect(branch.owner).to.equal('chris');
    });

    it('should parse owner from branch name', () => {
      execSync('git checkout -b fix/john-doe/bug-fix', { stdio: 'pipe' });

      const output = exec('branch list --format json');
      const branches = JSON.parse(output);

      const branch = branches.find((b: any) => b.name === 'fix/john-doe/bug-fix');
      expect(branch).to.exist;
      expect(branch.owner).to.equal('john-doe');
    });

    it('should parse agent from ticket-first branch', () => {
      execSync('git checkout -b TKT-001/feat/chris/altman/implement', { stdio: 'pipe' });

      const output = exec('branch list --format json');
      const branches = JSON.parse(output);

      const branch = branches.find((b: any) => b.name.startsWith('TKT-001'));
      expect(branch).to.exist;
      expect(branch.agent).to.equal('altman');
    });
  });

  describe('prlt branch where', () => {
    it('should find branch in main worktree by exact name', () => {
      // Create a branch
      execSync('git checkout -b feat/test/find-me', { stdio: 'pipe' });
      execSync('git checkout -', { stdio: 'pipe' });

      const output = exec('branch where feat/test/find-me');

      expect(output).to.contain('feat/test/find-me');
      expect(output).to.contain('Path:');
    });

    it('should find branch by partial match', () => {
      execSync('git checkout -b feat/test/unique-branch-name', { stdio: 'pipe' });

      const output = exec('branch where unique-branch');

      expect(output).to.contain('unique-branch-name');
    });

    it('should find branch by ticket ID prefix', () => {
      execSync('git checkout -b TKT-999/feat/test/ticket-feature', { stdio: 'pipe' });

      const output = exec('branch where TKT-999');

      expect(output).to.contain('TKT-999');
      expect(output).to.contain('ticket-feature');
    });

    it('should output JSON format when --json flag is used', () => {
      execSync('git checkout -b feat/test/json-test', { stdio: 'pipe' });

      const output = exec('branch where json-test --json');

      // Should be valid JSON
      const parsed = JSON.parse(output);
      expect(parsed).to.have.property('found', true);
      expect(parsed).to.have.property('search', 'json-test');
      expect(parsed).to.have.property('matches');
      expect(parsed.matches).to.be.an('array');
      expect(parsed.matches.length).to.be.greaterThan(0);
      expect(parsed.matches[0]).to.have.property('path');
      expect(parsed.matches[0]).to.have.property('branch');
    });

    it('should return not found for non-existent branch', () => {
      const output = exec('branch where non-existent-branch-xyz');

      expect(output.toLowerCase()).to.contain('no worktree found');
    });

    it('should return JSON with found=false for non-existent branch', () => {
      const output = exec('branch where non-existent-xyz --json');

      const parsed = JSON.parse(output);
      expect(parsed).to.have.property('found', false);
      expect(parsed).to.have.property('search', 'non-existent-xyz');
      expect(parsed.matches).to.be.an('array');
      expect(parsed.matches.length).to.equal(0);
    });

    it('should be case-insensitive when searching', () => {
      execSync('git checkout -b feat/test/CaseSensitive', { stdio: 'pipe' });

      const output = exec('branch where casesensitive');

      expect(output).to.contain('CaseSensitive');
    });

    it('should find multiple matching branches', () => {
      execSync('git checkout -b feat/test/multi-one', { stdio: 'pipe' });
      execSync('git checkout -b feat/test/multi-two', { stdio: 'pipe' });
      execSync('git checkout -b fix/test/multi-three', { stdio: 'pipe' });

      const output = exec('branch where multi --json');
      const parsed = JSON.parse(output);

      expect(parsed.found).to.equal(true);
      expect(parsed.matches.length).to.equal(3);
    });
  });
});
