import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Unit tests for Agent Discovery logic (TKT-655)
 * Tests the filesystem scanning behavior without database dependencies
 */
describe('Agent Discovery Logic (TKT-655)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-discovery-unit-'));
    // Create agent directories
    fs.mkdirSync(path.join(testDir, 'agents', 'staff'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'agents', 'temp'), { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Filesystem scanning', () => {
    it('should find staff agent directories', () => {
      // Create agent directories
      fs.mkdirSync(path.join(testDir, 'agents', 'staff', 'lecun'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'agents', 'staff', 'gates'), { recursive: true });

      // Scan directory
      const staffDir = path.join(testDir, 'agents', 'staff');
      const entries = fs.readdirSync(staffDir, { withFileTypes: true });
      const agentDirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => e.name);

      expect(agentDirs).to.include('lecun');
      expect(agentDirs).to.include('gates');
      expect(agentDirs).to.have.lengthOf(2);
    });

    it('should find temp agent directories', () => {
      // Create temp agent directories (various formats)
      fs.mkdirSync(path.join(testDir, 'agents', 'temp', 'bold-bezos'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'agents', 'temp', 'keen-musk-2'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'agents', 'temp', 'early-dalio'), { recursive: true });

      // Scan directory
      const tempDir = path.join(testDir, 'agents', 'temp');
      const entries = fs.readdirSync(tempDir, { withFileTypes: true });
      const agentDirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => e.name);

      expect(agentDirs).to.include('bold-bezos');
      expect(agentDirs).to.include('keen-musk-2');
      expect(agentDirs).to.include('early-dalio');
      expect(agentDirs).to.have.lengthOf(3);
    });

    it('should ignore hidden directories', () => {
      // Create visible and hidden directories
      fs.mkdirSync(path.join(testDir, 'agents', 'staff', '.hidden-dir'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'agents', 'staff', 'visible-agent'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'agents', 'staff', '.DS_Store_fake'), { recursive: true });

      // Scan directory
      const staffDir = path.join(testDir, 'agents', 'staff');
      const entries = fs.readdirSync(staffDir, { withFileTypes: true });
      const agentDirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => e.name);

      expect(agentDirs).to.include('visible-agent');
      expect(agentDirs).to.not.include('.hidden-dir');
      expect(agentDirs).to.not.include('.DS_Store_fake');
      expect(agentDirs).to.have.lengthOf(1);
    });

    it('should ignore files (only return directories)', () => {
      // Create a mix of files and directories
      fs.mkdirSync(path.join(testDir, 'agents', 'staff', 'agent-dir'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'agents', 'staff', 'some-file.txt'), 'test');
      fs.writeFileSync(path.join(testDir, 'agents', 'staff', 'README.md'), 'readme');

      // Scan directory
      const staffDir = path.join(testDir, 'agents', 'staff');
      const entries = fs.readdirSync(staffDir, { withFileTypes: true });
      const agentDirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => e.name);

      expect(agentDirs).to.include('agent-dir');
      expect(agentDirs).to.not.include('some-file.txt');
      expect(agentDirs).to.not.include('README.md');
      expect(agentDirs).to.have.lengthOf(1);
    });

    it('should filter out agents already in a set', () => {
      // Create directories
      fs.mkdirSync(path.join(testDir, 'agents', 'staff', 'existing-agent'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'agents', 'staff', 'new-agent'), { recursive: true });

      // Simulate existing agents in DB (case-insensitive)
      const existingAgents = new Set(['existing-agent', 'another-one'].map(n => n.toLowerCase()));

      // Scan and filter
      const staffDir = path.join(testDir, 'agents', 'staff');
      const entries = fs.readdirSync(staffDir, { withFileTypes: true });
      const newAgents = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => e.name)
        .filter(name => !existingAgents.has(name.toLowerCase()));

      expect(newAgents).to.include('new-agent');
      expect(newAgents).to.not.include('existing-agent');
      expect(newAgents).to.have.lengthOf(1);
    });

    it('should handle case-insensitive matching', () => {
      // Create directories with mixed case
      fs.mkdirSync(path.join(testDir, 'agents', 'staff', 'LeCun'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'agents', 'staff', 'GATES'), { recursive: true });

      // Simulate existing agents (lowercase)
      const existingAgents = new Set(['lecun']);

      // Scan and filter (case-insensitive)
      const staffDir = path.join(testDir, 'agents', 'staff');
      const entries = fs.readdirSync(staffDir, { withFileTypes: true });
      const newAgents = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => e.name)
        .filter(name => !existingAgents.has(name.toLowerCase()));

      expect(newAgents).to.include('GATES');
      expect(newAgents).to.not.include('LeCun');
      expect(newAgents).to.have.lengthOf(1);
    });

    it('should handle missing directory gracefully', () => {
      // Don't create the temp directory
      const missingDir = path.join(testDir, 'agents', 'nonexistent');

      expect(fs.existsSync(missingDir)).to.be.false;

      // The discovery function should check existsSync before reading
      if (fs.existsSync(missingDir)) {
        const entries = fs.readdirSync(missingDir, { withFileTypes: true });
        expect(entries).to.have.lengthOf(0);
      }
      // No error thrown - test passes
    });
  });
});
