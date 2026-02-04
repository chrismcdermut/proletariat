import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Unit tests for PMO Status Commands FlagResolver migration
 *
 * These tests verify that the status command files have been properly migrated
 * to use the FlagResolver pattern for JSON mode support.
 *
 * Note: Full E2E tests require the CLI to be built and command discovery to work.
 * These are skipped in environments where that's not available.
 */
describe('PMO Status Commands FlagResolver Migration Tests', () => {
  const commandsPath = path.join(process.cwd(), 'src/commands/status');

  describe('FlagResolver usage verification', () => {
    it('status/move.ts should use FlagResolver', () => {
      const filePath = path.join(commandsPath, 'move.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should import FlagResolver
      expect(content).to.include("import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js'");
      // Should use FlagResolver
      expect(content).to.include('new FlagResolver');
      // Should add prompts
      expect(content).to.include('resolver.addPrompt');
      // Should resolve
      expect(content).to.include('resolver.resolve()');
      // Should NOT import inquirer (handled by FlagResolver)
      expect(content).to.not.include("from 'inquirer'");
    });

    it('status/update.ts should use FlagResolver', () => {
      const filePath = path.join(commandsPath, 'update.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should import FlagResolver
      expect(content).to.include("import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js'");
      // Should use FlagResolver
      expect(content).to.include('new FlagResolver');
      // Should add prompts
      expect(content).to.include('resolver.addPrompt');
      // Should NOT import inquirer (handled by FlagResolver)
      expect(content).to.not.include("from 'inquirer'");
    });

    it('status/create.ts should use FlagResolver', () => {
      const filePath = path.join(commandsPath, 'create.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should import FlagResolver
      expect(content).to.include("import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js'");
      // Should use FlagResolver
      expect(content).to.include('new FlagResolver');
      // Should add prompts
      expect(content).to.include('resolver.addPrompt');
      // Should NOT import inquirer (handled by FlagResolver)
      expect(content).to.not.include("from 'inquirer'");
    });

    it('status/delete.ts should use FlagResolver', () => {
      const filePath = path.join(commandsPath, 'delete.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should import FlagResolver
      expect(content).to.include("import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js'");
      // Should use FlagResolver
      expect(content).to.include('new FlagResolver');
      // Should add prompts for confirmation
      expect(content).to.include('resolver.addPrompt');
      // Should use list type instead of confirm (per CLAUDE.md guidelines)
      expect(content).to.include("type: 'list'");
    });

    it('status/index.ts should use FlagResolver', () => {
      const filePath = path.join(commandsPath, 'index.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should import FlagResolver
      expect(content).to.include("import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js'");
      // Should use FlagResolver for menu
      expect(content).to.include('new FlagResolver');
      // Should add menu prompt
      expect(content).to.include('resolver.addPrompt');
    });

    it('status/list.ts should have jsonMode in requireProject', () => {
      const filePath = path.join(commandsPath, 'list.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should have jsonMode in requireProject (list has no prompts)
      expect(content).to.include('jsonMode: jsonMode ?');
      expect(content).to.include("commandName: 'status list'");
      // Should import shouldOutputJson
      expect(content).to.include('shouldOutputJson');
    });
  });

  describe('Import cleanup verification', () => {
    it('status/move.ts should not import unused prompt-json functions', () => {
      const filePath = path.join(commandsPath, 'move.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should NOT import buildPromptConfig (not needed with FlagResolver)
      expect(content).to.not.include('buildPromptConfig');
      // Should NOT import outputPromptAsJson (handled by FlagResolver)
      expect(content).to.not.include('outputPromptAsJson');
    });

    it('status/create.ts should not import form-related functions', () => {
      const filePath = path.join(commandsPath, 'create.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should NOT import buildFormPromptConfig
      expect(content).to.not.include('buildFormPromptConfig');
      // Should NOT import FormField type
      expect(content).to.not.include('FormField');
    });

    it('status/update.ts should not import form-related functions', () => {
      const filePath = path.join(commandsPath, 'update.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Should NOT import buildFormPromptConfig
      expect(content).to.not.include('buildFormPromptConfig');
      // Should NOT import FormField type
      expect(content).to.not.include('FormField');
    });
  });

  describe('Choice command verification', () => {
    it('status/move.ts should include command field in choices', () => {
      const filePath = path.join(commandsPath, 'move.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Each choice should have a command for AI agents
      expect(content).to.include('command: `prlt status move');
    });

    it('status/update.ts should include command field in choices', () => {
      const filePath = path.join(commandsPath, 'update.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Each choice should have a command for AI agents
      expect(content).to.include('command: `prlt status update');
    });

    it('status/create.ts should include command field in choices', () => {
      const filePath = path.join(commandsPath, 'create.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Each choice should have a command for AI agents
      expect(content).to.include('command: `prlt status create');
    });

    it('status/delete.ts should include command field in choices', () => {
      const filePath = path.join(commandsPath, 'delete.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Each choice should have a command for AI agents
      expect(content).to.include('command: `prlt status delete');
    });

    it('status/index.ts should include command field in menu choices', () => {
      const filePath = path.join(commandsPath, 'index.ts');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Menu choices should have commands for AI agents
      expect(content).to.include("command: 'prlt status");
    });
  });
});

