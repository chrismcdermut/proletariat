import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Regression test for PRLT-1151: Runtime commands must not extend PMOCommand
 *
 * Commands that don't use PMO features (this.storage, this.pmoContext, etc.)
 * should extend PromptCommand instead of PMOCommand. Extending PMOCommand
 * unnecessarily means a corrupt or missing PMO database blocks commands
 * that have nothing to do with PMO.
 *
 * This test ensures commands don't accidentally regress back to PMOCommand.
 */
describe('Runtime PMO Independence (PRLT-1151)', () => {
  const commandsDir = path.join(__dirname, '../../src/commands');

  // These commands MUST NOT extend PMOCommand — they don't use PMO features.
  // If you need to add PMO features to one of these, remove it from this list
  // and add a comment explaining why it needs PMO.
  const mustNotExtendPMO: string[] = [
    'agent/cleanup.ts',
    'agent/gc.ts',
    'agent/index.ts',
    'agent/list.ts',
    'agent/remove.ts',
    'agent/staff/index.ts',
    'agent/staff/remove.ts',
    'agent/status.ts',
    'agent/visit.ts',
    'branch/list.ts',
    'branch/validate.ts',
    'branch/where.ts',
    'execution/config.ts',
    'execution/index.ts',
    'execution/list.ts',
    'execution/logs.ts',
    'execution/stop.ts',
    'execution/view.ts',
    'hook/export.ts',
    'hook/fire.ts',
    'hook/list.ts',
    'hook/preset.ts',
    'orchestrate/index.ts',
    'orchestrator/index.ts',
    'pr/checks.ts',
    'repo/add.ts',
    'repo/create.ts',
    'repo/fix-remotes.ts',
    'repo/index.ts',
    'repo/list.ts',
    'session/cleanup.ts',
    'session/create.ts',
    'session/exec.ts',
    'session/index.ts',
    'session/inspect.ts',
    'session/list.ts',
    'session/prune.ts',
    'session/report.ts',
    'session/restart.ts',
    'work/hooks/add.ts',
    'work/hooks/list.ts',
    'work/hooks/toggle.ts',
    'work/peek.ts',
    'work/stop.ts',
  ];

  for (const relPath of mustNotExtendPMO) {
    it(`${relPath} must not extend PMOCommand`, () => {
      const filePath = path.join(commandsDir, relPath);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Must NOT extend PMOCommand
      expect(content).to.not.match(
        /extends\s+PMOCommand/,
        `${relPath} extends PMOCommand but doesn't use PMO features. Use PromptCommand instead.`
      );

      // Must extend PromptCommand
      expect(content).to.match(
        /extends\s+PromptCommand/,
        `${relPath} should extend PromptCommand`
      );

      // Must not import PMOCommand
      expect(content).to.not.match(
        /import\s*\{[^}]*PMOCommand[^}]*\}/,
        `${relPath} imports PMOCommand but should only import PromptCommand`
      );
    });
  }
});
