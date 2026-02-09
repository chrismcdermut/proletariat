import { expect } from 'chai';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Unit tests for Agent Temp Cleanup Command (TKT-796)
 * Tests that agent temp cleanup only shows temp agents, not staff agents
 */
describe('Agent Temp Cleanup (TKT-796)', () => {
  const cleanupPath = path.resolve(__dirname, '../../src/commands/agent/cleanup.ts');

  describe('interactive mode filters staff agents', () => {
    it('should NOT include staff agents section in interactive mode', () => {
      const content = fs.readFileSync(cleanupPath, 'utf-8');

      // Verify the staff agents section is NOT present
      expect(content).to.not.include('── Staff Agents');
      expect(content).to.not.include("staffAgents.length > 0");
    });

    it('should only filter for ephemeral agents in interactive mode', () => {
      const content = fs.readFileSync(cleanupPath, 'utf-8');

      // Verify temp agents filter exists
      expect(content).to.include("a.type === 'ephemeral'");

      // Verify the temp-only filtering comment exists
      expect(content).to.include('Get temp (ephemeral) agents only');
    });

    it('should show "No temp agents" message when only staff agents exist', () => {
      const content = fs.readFileSync(cleanupPath, 'utf-8');

      // Verify the NO_TEMP_AGENTS error code exists for proper handling
      expect(content).to.include("'NO_TEMP_AGENTS'");
      expect(content).to.include('No temp agents to clean up');
    });

    it('should have select message that specifies temp agents', () => {
      const content = fs.readFileSync(cleanupPath, 'utf-8');

      // Verify the prompt message explicitly says "temp agents"
      expect(content).to.include('Select temp agents to clean up');
    });
  });

  describe('--all flag filters for ephemeral only', () => {
    it('should filter for ephemeral type when using --all flag', () => {
      const content = fs.readFileSync(cleanupPath, 'utf-8');

      // Verify --all flag still only selects ephemeral agents
      expect(content).to.include("a.type === 'ephemeral' && a.status === 'active'");
    });
  });

  describe('--temp flag uses getCleanableAgents', () => {
    it('should use getCleanableAgents helper for --temp flag', () => {
      const content = fs.readFileSync(cleanupPath, 'utf-8');

      // Verify --temp flag uses the helper function which filters for ephemeral
      expect(content).to.include('getCleanableAgents(workspaceInfo, true)');
    });
  });

  describe('agent selection choices structure', () => {
    it('should have All temp agents option', () => {
      const content = fs.readFileSync(cleanupPath, 'utf-8');

      // Verify "All temp agents" option exists
      expect(content).to.include('All temp agents');
      expect(content).to.include("value: '__all_temp__'");
    });

    it('should have Cancel option', () => {
      const content = fs.readFileSync(cleanupPath, 'utf-8');

      // Verify Cancel option exists
      expect(content).to.include("value: '__cancel__'");
    });

    it('should have Temp Agents separator', () => {
      const content = fs.readFileSync(cleanupPath, 'utf-8');

      // Verify Temp Agents separator exists
      expect(content).to.include('── Temp Agents');
    });

    it('should NOT have Staff Agents separator', () => {
      const content = fs.readFileSync(cleanupPath, 'utf-8');

      // Verify Staff Agents separator does NOT exist
      expect(content).to.not.include('── Staff Agents');
    });
  });

  describe('does not define staffAgents variable', () => {
    it('should not have staffAgents variable definition', () => {
      const content = fs.readFileSync(cleanupPath, 'utf-8');

      // Verify staffAgents variable is not defined
      expect(content).to.not.include('const staffAgents');
      expect(content).to.not.include('let staffAgents');
    });
  });
});
