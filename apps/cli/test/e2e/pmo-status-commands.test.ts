import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Unit tests for PMO Status Commands JSON mode migration
 *
 * These tests verify that the status command files have been properly migrated
 * to use the agentPrompt pattern (selectFromList, requireProject with jsonMode).
 *
 * Note: Full E2E tests require the CLI to be built and command discovery to work.
 * These are skipped in environments where that's not available.
 */
describe('PMO Status Commands Migration Tests', () => {
  const commandsPath = path.join(process.cwd(), 'src/commands/status');

  describe('Code structure verification', () => {
    it('status/move.ts should use selectFromList instead of direct outputPromptAsJson', () => {
      const filePath = path.join(commandsPath, 'move.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should use selectFromList
      expect(content).to.include('selectFromList');
      // Should not use outputPromptAsJson directly for prompts (only for errors)
      expect(content).to.not.include('outputPromptAsJson');
      // Should have jsonMode in requireProject
      expect(content).to.include('jsonMode: jsonMode ?');
      expect(content).to.include("commandName: 'status move'");
    });

    it('status/update.ts should use selectFromList instead of direct outputPromptAsJson', () => {
      const filePath = path.join(commandsPath, 'update.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should use selectFromList for status selection
      expect(content).to.include('selectFromList');
      // Should have jsonMode in requireProject
      expect(content).to.include('jsonMode: jsonMode ?');
      expect(content).to.include("commandName: 'status update'");
    });

    it('status/create.ts should have jsonMode in requireProject', () => {
      const filePath = path.join(commandsPath, 'create.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should have jsonMode in requireProject
      expect(content).to.include('jsonMode: jsonMode ?');
      expect(content).to.include("commandName: 'status create'");
    });

    it('status/list.ts should have jsonMode in requireProject', () => {
      const filePath = path.join(commandsPath, 'list.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should have jsonMode in requireProject
      expect(content).to.include('jsonMode: jsonMode ?');
      expect(content).to.include("commandName: 'status list'");
      // Should import shouldOutputJson
      expect(content).to.include('shouldOutputJson');
    });

    it('status/delete.ts should have proper JSON mode handling', () => {
      const filePath = path.join(commandsPath, 'delete.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should use shouldOutputJson
      expect(content).to.include('shouldOutputJson');
      // Should handle errors in JSON mode
      expect(content).to.include('outputErrorAsJson');
      // Should output confirmation prompt as JSON
      expect(content).to.include('outputPromptAsJson');
    });

    it('status/index.ts should use selectFromList for menu', () => {
      const filePath = path.join(commandsPath, 'index.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should use selectFromList for the menu
      expect(content).to.include('selectFromList');
      // Should have jsonMode
      expect(content).to.include('jsonMode: jsonMode ?');
    });
  });

  describe('Import verification', () => {
    it('status/move.ts should not import unused functions', () => {
      const filePath = path.join(commandsPath, 'move.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should NOT import buildPromptConfig (not needed with selectFromList)
      expect(content).to.not.include('buildPromptConfig');
      // Should NOT import outputPromptAsJson (handled by selectFromList)
      expect(content).to.not.include('outputPromptAsJson');
      // Should NOT import inquirer (handled by selectFromList)
      expect(content).to.not.include("from 'inquirer'");
    });

    it('status/update.ts should not import buildPromptConfig', () => {
      const filePath = path.join(commandsPath, 'update.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should NOT import buildPromptConfig (not needed for list prompts)
      expect(content).to.not.include('buildPromptConfig');
    });
  });
});

