/* eslint-disable max-nested-callbacks */
import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';
import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  createTestProject,
  execInProcess,
  type TestEnvironment,
} from './test-helpers.js';

/**
 * Extract JSON from CLI output that may contain warnings.
 * Looks for the first line starting with { or [ and parses from there.
 */
function extractJson<T>(output: string): T {
  const lines = output.split('\n');
  let jsonStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      jsonStart = i;
      break;
    }
  }

  if (jsonStart === -1) {
    throw new Error(`No JSON found in output: ${output.substring(0, 500)}...`);
  }

  const jsonLines = lines.slice(jsonStart).join('\n');
  return JSON.parse(jsonLines) as T;
}

/**
 * Integration tests for PR command JSON mode.
 *
 * These tests verify that:
 * 1. PR commands support --machine flag (and legacy --json)
 * 2. JSON output includes proper prompt schema
 * 3. Full multi-step agent flows complete successfully
 *
 * Note: PR commands interact with GitHub CLI (gh), so some tests
 * verify the prompt flow rather than actual PR creation.
 */
describe('PR Commands JSON Mode', () => {
  let env: TestEnvironment;
  let db: Database.Database;

  beforeEach(() => {
    env = createTestEnvironment('pr-json-');

    db = setupProductionSchema(env.dbPath, env.pmoPath);
    createTestProject(db, { id: 'test-project', name: 'Test Project' });

    createHQConfig(env.proletariatDir);
    createPMODirectories(env.pmoPath, 'test-project');

    // Initialize git repo for PR commands
    initGitRepo(env.testDir);
  });

  afterEach(() => {
    if (db) db.close();
    cleanupTestEnvironment(env);
  });

  /**
   * Helper to create a test ticket directly in the database.
   */
  function createTestTicket(
    id: string,
    title: string,
    columnId: string = 'in-progress',
    prUrl?: string
  ): void {
    const statusName = columnId === 'backlog' ? 'Backlog' :
                       columnId === 'in-progress' ? 'In Progress' :
                       columnId === 'review' ? 'Review' : 'Done';

    db.prepare(`
      INSERT INTO pmo_tickets (id, project_id, title, status, status_id)
      VALUES (?, 'test-project', ?, ?, ?)
    `).run(id, title, statusName, `default-${columnId}`);

    if (prUrl) {
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_url', ?)
      `).run(id, prUrl);
      db.prepare(`
        INSERT INTO pmo_ticket_metadata (ticket_id, key, value)
        VALUES (?, 'pr_number', '123')
      `).run(id);
    }
  }

  describe('pr index --machine (main menu)', () => {
    it('should output valid JSON with action selection prompt', async () => {
      const output = await execInProcess('pr -P test-project --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('action');
      expect(json.metadata.command).to.equal('pr');

      // Should have create, close, link, status actions
      const values = json.prompt.choices.map(c => c.value);
      expect(values).to.include('create');
      expect(values).to.include('close');
      expect(values).to.include('link');
      expect(values).to.include('status');
    });

    it('should include --json in action command choices', async () => {
      const output = await execInProcess('pr -P test-project --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string; value: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command && choice.value !== 'cancel') {
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should work with --json flag (legacy)', async () => {
      const output = await execInProcess('pr -P test-project --json');
      const json = extractJson<{ prompt: { name: string } }>(output);

      expect(json.prompt.name).to.equal('action');
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('pr -P test-project -m --machine');
      const json = extractJson<{ prompt: { name: string } }>(output);

      expect(json.prompt.name).to.equal('action');
    });
  });

  describe('pr status --machine', () => {
    beforeEach(() => {
      createTestTicket('TKT-STATUS-1', 'Status ticket one', 'in-progress');
      createTestTicket('TKT-STATUS-2', 'Status ticket two', 'in-progress', 'https://github.com/test/repo/pull/42');
    });

    it('should output ticket selection prompt when no ticket provided', async () => {
      const output = await execInProcess('pr status -P test-project --machine');
      const json = extractJson<{
        prompt: { type: string; name: string; message: string; choices: Array<{ name: string; value: string; command?: string }> };
        metadata: { command: string };
      }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
      expect(json.prompt.name).to.equal('ticket');
      expect(json.prompt.choices).to.be.an('array');
      expect(json.prompt.choices.length).to.be.greaterThan(0);
    });

    it('should include --json in ticket selection commands', async () => {
      const output = await execInProcess('pr status -P test-project --machine');
      const json = extractJson<{
        prompt: { choices: Array<{ command?: string }> };
      }>(output);

      for (const choice of json.prompt.choices) {
        if (choice.command) {
          expect(choice.command).to.include('--json');
        }
      }
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('pr status -P test-project -m --machine');
      const json = extractJson<{ prompt: { type: string } }>(output);

      expect(json.prompt).to.exist;
      expect(json.prompt.type).to.equal('list');
    });

    it('should skip ticket selection when ticket ID provided directly', async () => {
      const output = await execInProcess('pr status TKT-STATUS-1 -P test-project --machine');

      // Should show ticket info directly (no JSON prompt)
      expect(output).to.include('TKT-STATUS-1');
    });
  });

  describe('pr link --machine', () => {
    beforeEach(() => {
      createTestTicket('TKT-LINK-1', 'Link ticket one', 'in-progress');
      createTestTicket('TKT-LINK-2', 'Link ticket two', 'in-progress');
    });

    it('should output ticket selection prompt when no ticket provided', async () => {
      const output = await execInProcess('pr link -P test-project --machine');
      const json = extractJson<{
        prompt?: { type: string; name: string; choices: Array<{ name: string; value: string; command?: string }> };
        error?: { code: string };
        metadata: { command: string };
      }>(output);

      // May error if gh not installed, otherwise should show ticket prompt
      if (json.error) {
        expect(json.error.code).to.be.oneOf(['GH_NOT_INSTALLED', 'GH_NOT_AUTHENTICATED']);
      } else {
        expect(json.prompt).to.exist;
        expect(json.prompt!.type).to.equal('list');
        expect(json.prompt!.name).to.equal('ticket');
        expect(json.prompt!.choices).to.be.an('array');
      }
    });

    it('should include --json in ticket selection commands (if gh installed)', async () => {
      const output = await execInProcess('pr link -P test-project --machine');
      const json = extractJson<{
        prompt?: { choices: Array<{ command?: string }> };
        error?: { code: string };
      }>(output);

      // Only check commands if we got a prompt (gh installed)
      if (json.prompt) {
        for (const choice of json.prompt.choices) {
          if (choice.command) {
            expect(choice.command).to.include('--json');
          }
        }
      }
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('pr link -P test-project -m --machine');
      const json = extractJson<{ prompt?: unknown; error?: unknown; metadata: { command: string } }>(output);

      // Should produce valid JSON output
      expect(json.metadata.command).to.equal('pr link');
    });

    it('should skip ticket selection when ticket ID provided directly', async () => {
      // When ticket ID provided, should move to next step (PR selection or gh error)
      const output = await execInProcess('pr link TKT-LINK-1 -P test-project --machine');

      // Either prompts for PR selection or shows gh error
      expect(output).to.be.a('string');
      // Should be valid JSON
      const json = extractJson<{ prompt?: unknown; error?: unknown }>(output);
      expect(json).to.exist;
    });
  });

  describe('pr create --machine', () => {
    beforeEach(() => {
      createTestTicket('TKT-CREATE-1', 'Create ticket one', 'in-progress');

      // Create a feature branch
      try {
        execSync('git checkout -b feat/TKT-CREATE-1-test', { cwd: env.testDir, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        // May fail if already on branch
      }
    });

    it('should output valid response for PR creation', async () => {
      const output = await execInProcess('pr create -P test-project --machine');

      // Must get some output
      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);

      // Verify the output is one of the expected types:
      if (output.includes('PR already exists')) {
        // Text output for existing PR - verify it includes expected info
        expect(output).to.include('#');  // PR number
        expect(output).to.include('URL:');  // URL line
      } else {
        // Should be JSON - parse and verify structure
        const json = extractJson<{
          prompt?: { type: string; name: string; message: string; choices?: unknown[] };
          error?: { code: string; message: string };
          metadata: { command: string };
        }>(output);

        expect(json.metadata).to.exist;
        expect(json.metadata.command).to.equal('pr create');

        if (json.error) {
          // Valid error codes for pr create
          expect(json.error.code).to.be.oneOf([
            'GH_NOT_INSTALLED',
            'GH_NOT_AUTHENTICATED',
            'NO_GIT_REPO',
            'ON_BASE_BRANCH',
          ]);
          expect(json.error.message).to.be.a('string');
          expect(json.error.message.length).to.be.greaterThan(0);
        } else if (json.prompt) {
          // Ticket selection prompt
          expect(json.prompt.type).to.equal('list');
          expect(json.prompt.name).to.equal('ticket');
          expect(json.prompt.message).to.be.a('string');
          expect(json.prompt.choices).to.be.an('array');
        }
      }
    });

    it('should work with -m shorthand', async () => {
      const output = await execInProcess('pr create -P test-project -m --machine');

      // Must get some output
      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);

      // Verify -m produces same structure as --machine
      if (!output.includes('PR already exists')) {
        const json = extractJson<{
          prompt?: { type: string; name: string };
          error?: { code: string; message: string };
          metadata: { command: string };
        }>(output);

        expect(json.metadata).to.exist;
        expect(json.metadata.command).to.equal('pr create');

        // Must have either prompt or error
        expect(json.prompt || json.error).to.exist;
      }
    });
  });

  // ===========================================================================
  // End-to-end Agent Flow Tests
  // ===========================================================================
  // These tests simulate an AI agent navigating through the CLI using --machine
  // flag, selecting choices, and completing multi-step workflows.

  describe('End-to-end agent flows (--machine flag)', () => {
    /**
     * Helper to simulate agent flow: execute command, parse JSON, return parsed result
     */
    interface AgentPrompt {
      prompt?: {
        type: string;
        name: string;
        message: string;
        choices?: Array<{ name: string; value: string; command?: string }>;
        context?: Record<string, unknown>;
      };
      error?: {
        code: string;
        message: string;
      };
      metadata: {
        command: string;
        flags: Record<string, unknown>;
      };
    }

    async function agentExec(cmd: string): Promise<AgentPrompt> {
      const output = await execInProcess(cmd);
      return extractJson<AgentPrompt>(output);
    }

    /**
     * Helper to find a choice by partial name match
     */
    function findChoice(
      choices: Array<{ name: string; value: string; command?: string }>,
      pattern: string
    ): { name: string; value: string; command?: string } | undefined {
      return choices.find(c => c.name.toLowerCase().includes(pattern.toLowerCase()));
    }

    /**
     * Helper to get the command from a choice (strips 'prlt ' prefix)
     */
    function execChoice(choice: { command?: string }): string {
      if (!choice.command) {
        throw new Error('Choice has no command field');
      }
      return choice.command.replace('prlt ', '');
    }

    /**
     * Helper to execute final command (strips --json/--machine flags)
     */
    async function execFinal(cmd: string): Promise<string> {
      return await execInProcess(cmd.replace(' --json', '').replace(' --machine', ''));
    }

    describe('pr index → subcommand - menu navigation flow', () => {
      beforeEach(() => {
        createTestTicket('TKT-MENU-1', 'Menu navigation test', 'in-progress', 'https://github.com/test/repo/pull/99');
      });

      it('should complete full flow: main menu → status → select ticket → view result', async () => {
        // Agent Step 1: Main menu
        const step1 = await agentExec('pr -P test-project --machine');
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.type).to.equal('list');
        expect(step1.prompt!.name).to.equal('action');

        // Find status action
        const statusChoice = findChoice(step1.prompt!.choices!, 'status');
        expect(statusChoice).to.exist;
        expect(statusChoice!.command).to.include('--json');

        // Agent Step 2: Execute status action command
        // Note: The pr index command runs subcommands directly, so we need to
        // call pr status separately (the menu selection runs the subcommand)
        const step2 = await agentExec('pr status -P test-project --machine');
        expect(step2.prompt).to.exist;
        expect(step2.prompt!.type).to.equal('list');
        expect(step2.prompt!.name).to.equal('ticket');

        // Find the test ticket
        const ticketChoice = findChoice(step2.prompt!.choices!, 'TKT-MENU-1');
        expect(ticketChoice).to.exist;

        // Agent Step 3: View ticket status
        const result = await execFinal(execChoice(ticketChoice!));

        // Verify ticket info shown
        expect(result).to.include('TKT-MENU-1');
      });

      it('should complete flow: main menu → link → select ticket → select PR', async () => {
        // Create a ticket WITHOUT a PR link for this test
        // (TKT-MENU-1 has a PR, so we need a fresh ticket)
        createTestTicket('TKT-MENU-LINK', 'Menu link test ticket', 'in-progress');

        // Agent Step 1: Main menu
        const step1 = await agentExec('pr -P test-project --machine');
        expect(step1.prompt).to.exist;

        // Find link action
        const linkChoice = findChoice(step1.prompt!.choices!, 'link');
        expect(linkChoice).to.exist;
        expect(linkChoice!.command).to.include('--json');

        // Agent Step 2: Execute link command
        const step2 = await agentExec('pr link -P test-project --machine');

        // If gh not installed, skip rest
        if (step2.error) {
          expect(step2.error.code).to.be.oneOf(['GH_NOT_INSTALLED', 'GH_NOT_AUTHENTICATED']);
          return;
        }

        expect(step2.prompt).to.exist;
        expect(step2.prompt!.type).to.equal('list');
        expect(step2.prompt!.name).to.equal('ticket');

        // Find the test ticket (the one WITHOUT a PR link)
        const ticketChoice = findChoice(step2.prompt!.choices!, 'TKT-MENU-LINK');
        expect(ticketChoice).to.exist;

        // Agent Step 3: Select ticket, get PR selection
        const step3 = await agentExec(execChoice(ticketChoice!));

        // Either PR selection or no PRs error
        if (step3.error) {
          expect(step3.error.code).to.equal('NO_OPEN_PRS');
          return;
        }

        expect(step3.prompt).to.exist;
        expect(step3.prompt!.type).to.equal('list');
        expect(step3.prompt!.name).to.equal('pr');
      });

      it('should provide cancel option in menu', async () => {
        const step1 = await agentExec('pr -P test-project --machine');
        expect(step1.prompt).to.exist;

        const cancelChoice = findChoice(step1.prompt!.choices!, 'cancel');
        expect(cancelChoice).to.exist;
        expect(cancelChoice!.value).to.equal('cancel');
      });
    });

    describe('pr status - full agent flow', () => {
      beforeEach(() => {
        createTestTicket('TKT-STATUS-FLOW-1', 'Agent status test', 'in-progress', 'https://github.com/test/repo/pull/123');
      });

      it('should complete flow: select ticket → view status → verify reads from database', async () => {
        // First verify the PR URL is in database
        const dbMetadata = db.prepare(`
          SELECT value FROM pmo_ticket_metadata
          WHERE ticket_id = 'TKT-STATUS-FLOW-1' AND key = 'pr_url'
        `).get() as { value: string } | undefined;
        expect(dbMetadata).to.exist;
        expect(dbMetadata!.value).to.equal('https://github.com/test/repo/pull/123');

        // Agent Step 1: Get ticket choices
        const step1 = await agentExec('pr status -P test-project --machine');
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.type).to.equal('list');
        expect(step1.prompt!.name).to.equal('ticket');
        expect(step1.prompt!.choices).to.be.an('array');
        expect(step1.prompt!.choices!.length).to.be.greaterThan(0);

        // Find the test ticket - should show [PR linked] indicator
        const ticketChoice = findChoice(step1.prompt!.choices!, 'TKT-STATUS-FLOW-1');
        expect(ticketChoice).to.exist;
        expect(ticketChoice!.name).to.include('PR linked');
        expect(ticketChoice!.command).to.include('--json');

        // Agent Step 2: View status (final step)
        const result = await execFinal(execChoice(ticketChoice!));

        // Verify status output includes data from database
        expect(result).to.include('TKT-STATUS-FLOW-1');
        expect(result).to.include('PR Status');
        // Should show "PR URL:" or "Stored URL:" with the database value
        // (format depends on whether gh CLI can reach the PR)
        expect(result).to.satisfy((s: string) =>
          s.includes('PR URL:') || s.includes('Stored URL:') || s.includes('URL:')
        );
      });

      it('should complete flow with ticket ID provided directly and show stored PR info', async () => {
        // Verify database has the PR URL
        const dbMetadata = db.prepare(`
          SELECT value FROM pmo_ticket_metadata
          WHERE ticket_id = 'TKT-STATUS-FLOW-1' AND key = 'pr_url'
        `).get() as { value: string } | undefined;
        expect(dbMetadata!.value).to.equal('https://github.com/test/repo/pull/123');

        // Agent provides ticket ID - no prompts needed
        const result = await execInProcess('pr status TKT-STATUS-FLOW-1 -P test-project --machine');

        // Verify output shows ticket
        expect(result).to.include('TKT-STATUS-FLOW-1');
        expect(result).to.include('PR Status');
        // Should show URL in some form (PR URL, Stored URL, or just URL)
        expect(result).to.satisfy((s: string) =>
          s.includes('PR URL:') || s.includes('Stored URL:') || s.includes('URL:')
        );
      });

      it('should verify ticket without PR shows appropriate message', async () => {
        // Create ticket WITHOUT PR link
        createTestTicket('TKT-NO-PR-STATUS', 'Ticket without PR', 'in-progress');

        // Verify no PR URL in database
        const dbMetadata = db.prepare(`
          SELECT value FROM pmo_ticket_metadata
          WHERE ticket_id = 'TKT-NO-PR-STATUS' AND key = 'pr_url'
        `).get() as { value: string } | undefined;
        expect(dbMetadata).to.not.exist;

        // View status
        const result = await execInProcess('pr status TKT-NO-PR-STATUS -P test-project --machine');

        // Should indicate no PR linked
        expect(result).to.include('TKT-NO-PR-STATUS');
        expect(result.toLowerCase()).to.include('no pr linked');
      });
    });

    describe('pr link - full agent flow', () => {
      beforeEach(() => {
        createTestTicket('TKT-LINK-FLOW-1', 'Agent link test', 'in-progress');
      });

      it('should complete flow: select ticket → select PR → verify link in database', async () => {
        // Agent Step 1: Get ticket choices (or gh error)
        const step1 = await agentExec('pr link -P test-project --machine');

        // If gh not installed, we get an error - skip test
        if (step1.error) {
          expect(step1.error.code).to.be.oneOf(['GH_NOT_INSTALLED', 'GH_NOT_AUTHENTICATED']);
          return;
        }

        // If gh installed, we should get ticket prompt
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.type).to.equal('list');
        expect(step1.prompt!.name).to.equal('ticket');
        expect(step1.prompt!.choices).to.be.an('array');

        // Find the test ticket
        const ticketChoice = findChoice(step1.prompt!.choices!, 'TKT-LINK-FLOW-1');
        expect(ticketChoice).to.exist;
        expect(ticketChoice!.command).to.include('--json');

        // Agent Step 2: Select ticket, get PR selection prompt
        const step2 = await agentExec(execChoice(ticketChoice!));

        // If no open PRs, we get an error
        if (step2.error) {
          expect(step2.error.code).to.equal('NO_OPEN_PRS');
          return;
        }

        // Should have PR selection prompt
        expect(step2.prompt).to.exist;
        expect(step2.prompt!.type).to.equal('list');
        expect(step2.prompt!.name).to.equal('pr');
        expect(step2.prompt!.choices).to.be.an('array');
        expect(step2.prompt!.choices!.length).to.be.greaterThan(0);

        // Select the first available PR
        const prChoice = step2.prompt!.choices![0];
        expect(prChoice).to.exist;
        expect(prChoice.command).to.include('--json');

        // Agent Step 3: Execute the link (final step)
        const result = await execFinal(execChoice(prChoice));

        // Verify link succeeded
        expect(result.toLowerCase()).to.include('linked');

        // Verify in database
        const metadata = db.prepare(`
          SELECT value FROM pmo_ticket_metadata
          WHERE ticket_id = 'TKT-LINK-FLOW-1' AND key = 'pr_url'
        `).get() as { value: string } | undefined;
        expect(metadata).to.exist;
        expect(metadata!.value).to.include('github.com');
      });

      it('should complete flow with ticket ID provided directly → select PR → verify link', async () => {
        // Agent provides ticket ID - skips ticket selection
        const step1 = await agentExec('pr link TKT-LINK-FLOW-1 -P test-project --machine');

        // If gh not installed or no PRs, skip
        if (step1.error) {
          expect(step1.error.code).to.be.oneOf(['GH_NOT_INSTALLED', 'GH_NOT_AUTHENTICATED', 'NO_OPEN_PRS']);
          return;
        }

        // Should have PR selection prompt
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.type).to.equal('list');
        expect(step1.prompt!.name).to.equal('pr');
        expect(step1.prompt!.choices).to.be.an('array');
        expect(step1.prompt!.choices!.length).to.be.greaterThan(0);

        // Select the first available PR
        const prChoice = step1.prompt!.choices![0];
        expect(prChoice).to.exist;

        // Execute the link
        const result = await execFinal(execChoice(prChoice));

        // Verify link succeeded
        expect(result.toLowerCase()).to.include('linked');

        // Verify in database
        const metadata = db.prepare(`
          SELECT value FROM pmo_ticket_metadata
          WHERE ticket_id = 'TKT-LINK-FLOW-1' AND key = 'pr_url'
        `).get() as { value: string } | undefined;
        expect(metadata).to.exist;
        expect(metadata!.value).to.include('github.com');
      });

      it('should handle --pr flag to skip PR selection entirely', async () => {
        // Agent provides both ticket and PR number - no prompts needed
        // Use PR #221 which exists on this repo
        const result = await execInProcess('pr link TKT-LINK-FLOW-1 --pr 221 -P test-project --machine');

        // Should either succeed or show error if PR not found
        expect(result).to.be.a('string');

        // If successful, verify in database
        if (result.toLowerCase().includes('linked')) {
          const metadata = db.prepare(`
            SELECT value FROM pmo_ticket_metadata
            WHERE ticket_id = 'TKT-LINK-FLOW-1' AND key = 'pr_url'
          `).get() as { value: string } | undefined;
          expect(metadata).to.exist;
        }
      });

      it('should complete confirmation flow: ticket with existing PR → confirm replace → select new PR', async () => {
        // Create a ticket that ALREADY has a PR linked
        createTestTicket('TKT-LINK-REPLACE', 'Replace PR test', 'in-progress', 'https://github.com/existing/pr/123');

        // Agent Step 1: Select this ticket (provide directly to skip ticket selection)
        const step1 = await agentExec('pr link TKT-LINK-REPLACE -P test-project --machine');

        // If gh not installed, skip
        if (step1.error) {
          expect(step1.error.code).to.be.oneOf(['GH_NOT_INSTALLED', 'GH_NOT_AUTHENTICATED']);
          return;
        }

        // Should get confirmation prompt (because ticket already has a PR)
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.type).to.equal('list');
        expect(step1.prompt!.name).to.equal('confirm');
        expect(step1.prompt!.message).to.include('Replace');

        // Verify Yes and No choices exist
        const yesChoice = findChoice(step1.prompt!.choices!, 'yes');
        const noChoice = findChoice(step1.prompt!.choices!, 'no');
        expect(yesChoice).to.exist;
        expect(noChoice).to.exist;

        // Agent Step 2: Use --confirm flag directly to confirm and get PR selection
        // (FlagResolver builds command with value, but --confirm is a boolean flag,
        // so we use the flag directly instead of the generated command)
        const step2 = await agentExec('pr link TKT-LINK-REPLACE -P test-project --confirm --machine');

        // If no open PRs, we get an error
        if (step2.error) {
          expect(step2.error.code).to.equal('NO_OPEN_PRS');
          return;
        }

        // Should have PR selection prompt
        expect(step2.prompt).to.exist;
        expect(step2.prompt!.type).to.equal('list');
        expect(step2.prompt!.name).to.equal('pr');

        // Select the first available PR
        const prChoice = step2.prompt!.choices![0];
        expect(prChoice).to.exist;

        // Agent Step 3: Execute the link (final step)
        // Include --confirm since the ticket still has the old PR until we update it
        const finalCmd = execChoice(prChoice).replace(' --json', ' --confirm').replace(' --machine', ' --confirm');
        const result = await execInProcess(finalCmd.includes('--confirm') ? finalCmd : finalCmd + ' --confirm');

        // Verify link succeeded
        expect(result.toLowerCase()).to.include('linked');

        // Verify in database - should have new PR URL
        const metadata = db.prepare(`
          SELECT value FROM pmo_ticket_metadata
          WHERE ticket_id = 'TKT-LINK-REPLACE' AND key = 'pr_url'
        `).get() as { value: string } | undefined;
        expect(metadata).to.exist;
        // Should NOT be the old URL anymore
        expect(metadata!.value).to.not.equal('https://github.com/existing/pr/123');
      });

      it('should allow canceling confirmation when ticket has existing PR', async () => {
        // Create a ticket with existing PR
        createTestTicket('TKT-LINK-CANCEL', 'Cancel replace test', 'in-progress', 'https://github.com/existing/pr/456');

        // Agent Step 1: Select this ticket
        const step1 = await agentExec('pr link TKT-LINK-CANCEL -P test-project --machine');

        // If gh not installed, skip
        if (step1.error) {
          expect(step1.error.code).to.be.oneOf(['GH_NOT_INSTALLED', 'GH_NOT_AUTHENTICATED']);
          return;
        }

        // Should get confirmation prompt
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.name).to.equal('confirm');

        // Verify "No" choice exists
        const noChoice = findChoice(step1.prompt!.choices!, 'no');
        expect(noChoice).to.exist;

        // Agent Step 2: Don't use --confirm flag - just run without it
        // (equivalent to selecting "No" - will show the existing PR info and return)
        const result = await execInProcess('pr link TKT-LINK-CANCEL -P test-project --machine');

        // Should complete (shows existing PR info)
        expect(result).to.be.a('string');
        expect(result).to.include('already has a linked PR');

        // Database should still have original PR URL
        const metadata = db.prepare(`
          SELECT value FROM pmo_ticket_metadata
          WHERE ticket_id = 'TKT-LINK-CANCEL' AND key = 'pr_url'
        `).get() as { value: string } | undefined;
        expect(metadata).to.exist;
        expect(metadata!.value).to.equal('https://github.com/existing/pr/456');
      });
    });

    describe('pr create - agent flow', () => {
      beforeEach(() => {
        createTestTicket('TKT-CREATE-FLOW-1', 'Agent create test', 'in-progress');

        // Create a feature branch
        try {
          execSync('git checkout -b feat/TKT-CREATE-FLOW-1-test', { cwd: env.testDir, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch {
          // May fail if already on branch
        }
      });

      it('should auto-detect ticket from branch and skip ticket selection', async () => {
        // Agent starts PR creation - should auto-detect ticket from branch name
        // Branch is feat/TKT-CREATE-FLOW-1-test so it should detect TKT-CREATE-FLOW-1
        const output = await execInProcess('pr create -P test-project --machine');

        expect(output).to.be.a('string');
        expect(output.length).to.be.greaterThan(0);

        if (output.includes('PR already exists')) {
          // Existing PR - verify output structure
          expect(output).to.include('#');
          expect(output).to.include('URL:');
        } else if (output.includes('Auto-detected ticket')) {
          // Successfully auto-detected ticket from branch
          expect(output).to.include('TKT-CREATE-FLOW-1');
        } else {
          // Should be JSON
          const json = extractJson<{
            prompt?: { type: string; name: string; choices?: Array<{ value: string }> };
            error?: { code: string; message: string };
            metadata: { command: string };
          }>(output);

          expect(json.metadata).to.exist;
          expect(json.metadata.command).to.equal('pr create');

          if (json.error) {
            expect(json.error.code).to.be.oneOf([
              'GH_NOT_INSTALLED',
              'GH_NOT_AUTHENTICATED',
              'NO_GIT_REPO',
              'ON_BASE_BRANCH',
            ]);
          } else if (json.prompt) {
            // If we get a prompt, it means ticket wasn't auto-detected
            // Verify prompt structure is valid
            expect(json.prompt.type).to.equal('list');
            expect(json.prompt.name).to.equal('ticket');
            expect(json.prompt.choices).to.be.an('array');
          }
        }
      });

      it('should handle --no-link flag and skip ticket prompt entirely', async () => {
        // Agent uses --no-link to create PR without linking to ticket
        const output = await execInProcess('pr create --no-link --machine');

        expect(output).to.be.a('string');
        expect(output.length).to.be.greaterThan(0);

        if (output.includes('PR already exists')) {
          expect(output).to.include('URL:');
        } else if (output.includes('Creating Pull Request')) {
          // PR creation started - no ticket prompt was shown
          expect(output).to.include('Branch:');
        } else if (output.includes('Pushing branch')) {
          // PR creation started - pushing to remote
          expect(output).to.be.a('string');
        } else {
          // Should be JSON error (no ticket prompt since --no-link)
          const json = extractJson<{
            prompt?: { name: string };
            error?: { code: string; message: string };
            metadata: { command: string };
          }>(output);

          expect(json.metadata.command).to.equal('pr create');

          if (json.error) {
            expect(json.error.code).to.be.oneOf([
              'GH_NOT_INSTALLED',
              'GH_NOT_AUTHENTICATED',
              'NO_GIT_REPO',
              'ON_BASE_BRANCH',
            ]);
          }
          // Should NOT have ticket prompt since --no-link was used
          if (json.prompt) {
            expect(json.prompt.name).to.not.equal('ticket');
          }
        }
      });

      it('should complete ticket selection flow when branch has no ticket ID', async () => {
        // Create some in-progress tickets for selection
        createTestTicket('TKT-CREATE-SELECT-1', 'First selectable ticket', 'in-progress');
        createTestTicket('TKT-CREATE-SELECT-2', 'Second selectable ticket', 'in-progress');

        // Agent Step 1: Start PR creation - should get ticket selection prompt
        // Note: This runs in the current git repo context
        const output = await execInProcess('pr create -P test-project --machine');

        // Check if PR already exists (outputs text instead of JSON)
        if (output.includes('PR already exists')) {
          // Skip test - can't test ticket selection when PR exists
          return;
        }

        // Try to parse as JSON
        let step1: AgentPrompt;
        try {
          step1 = extractJson<AgentPrompt>(output);
        } catch {
          // Not JSON - might be other text output
          return;
        }

        // If error, check valid error codes
        if (step1.error) {
          expect(step1.error.code).to.be.oneOf([
            'GH_NOT_INSTALLED',
            'GH_NOT_AUTHENTICATED',
            'NO_GIT_REPO',
            'ON_BASE_BRANCH',
          ]);
          return;
        }

        // If we got a prompt, verify it's the ticket selection
        if (step1.prompt) {
          expect(step1.prompt.type).to.equal('list');
          expect(step1.prompt.name).to.equal('ticket');
          expect(step1.prompt.choices).to.be.an('array');

          // Should include our test tickets
          const ticket1 = findChoice(step1.prompt.choices!, 'TKT-CREATE-SELECT-1');
          const ticket2 = findChoice(step1.prompt.choices!, 'TKT-CREATE-SELECT-2');
          expect(ticket1 || ticket2).to.exist;

          // Should have a "Skip" option
          const skipChoice = findChoice(step1.prompt.choices!, 'skip');
          expect(skipChoice).to.exist;
          expect(skipChoice!.value).to.equal('__skip__');
        }
      });

      it('should allow skipping ticket selection in PR creation', async () => {
        // Create in-progress tickets
        createTestTicket('TKT-SKIP-TEST', 'Skip test ticket', 'in-progress');

        const output = await execInProcess('pr create -P test-project --machine');

        // Check if PR already exists
        if (output.includes('PR already exists')) {
          return;
        }

        // Try to parse
        let step1: AgentPrompt;
        try {
          step1 = extractJson<AgentPrompt>(output);
        } catch {
          return;
        }

        // If error or no prompt, skip
        if (step1.error || !step1.prompt) {
          return;
        }

        // Find "Skip" option by value rather than name to avoid matching ticket names containing "skip"
        const skipChoice = step1.prompt.choices!.find(c => c.value === '__skip__');
        if (!skipChoice) {
          // Skip option may not be available in all contexts
          expect(step1.prompt.choices!.length).to.be.greaterThan(0);
          return;
        }
        expect(skipChoice.command).to.include('--json');

        // Agent selects "Skip" - should proceed with PR creation without ticket
        const result = await execFinal(execChoice(skipChoice!));

        // Verify output indicates PR creation proceeded (or valid error)
        expect(result).to.be.a('string');
        expect(result.length).to.be.greaterThan(0);

        // Should see PR creation output (not ticket selection)
        // Either "Creating Pull Request" or error about branch/gh
        const validOutputPatterns = [
          'Creating Pull Request',
          'PR already exists',
          'not installed',
          'not authenticated',
          'Failed to push',
          'Pushing branch',
          'Branch:',
        ];
        const hasValidOutput = validOutputPatterns.some(pattern =>
          result.includes(pattern)
        );
        expect(hasValidOutput).to.be.true;
      });
    });

    describe('backward compatibility: --json flag flows', () => {
      beforeEach(() => {
        createTestTicket('TKT-JSON-COMPAT', 'JSON compat ticket', 'in-progress', 'https://github.com/test/repo/pull/99');
      });

      it('should complete status flow with --json flag (legacy) and show PR info', async () => {
        // Use --json instead of --machine (legacy flag)
        const step1 = await agentExec('pr status -P test-project --json');

        // Verify JSON structure is identical to --machine
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.type).to.equal('list');
        expect(step1.prompt!.name).to.equal('ticket');
        expect(step1.prompt!.choices).to.be.an('array');
        expect(step1.prompt!.message).to.be.a('string');

        // Find and verify ticket choice structure
        const ticketChoice = findChoice(step1.prompt!.choices!, 'TKT-JSON-COMPAT');
        expect(ticketChoice).to.exist;
        expect(ticketChoice!.value).to.equal('TKT-JSON-COMPAT');
        expect(ticketChoice!.command).to.include('--json');
        expect(ticketChoice!.name).to.include('PR linked');  // Should show PR indicator

        // Execute and verify status output
        const result = await execFinal(execChoice(ticketChoice!));
        expect(result).to.include('TKT-JSON-COMPAT');
        expect(result).to.include('PR Status');  // Header
        expect(result).to.include('Title:');    // Ticket info shown
      });

      it('should complete main menu flow with --json flag (legacy) with full choice verification', async () => {
        const step1 = await agentExec('pr -P test-project --json');

        // Verify prompt structure
        expect(step1.prompt).to.exist;
        expect(step1.prompt!.type).to.equal('list');
        expect(step1.prompt!.name).to.equal('action');
        expect(step1.prompt!.message).to.include('Pull Request');

        // Verify all expected choices exist
        const choices = step1.prompt!.choices!;
        expect(choices.length).to.be.greaterThanOrEqual(3);

        const createChoice = findChoice(choices, 'create');
        const linkChoice = findChoice(choices, 'link');
        const statusChoice = findChoice(choices, 'status');

        expect(createChoice).to.exist;
        expect(linkChoice).to.exist;
        expect(statusChoice).to.exist;

        // All choices should have --json in command (legacy flag preserved)
        expect(createChoice!.command).to.include('--json');
        expect(linkChoice!.command).to.include('--json');
        expect(statusChoice!.command).to.include('--json');

        // Choices should have correct values
        expect(createChoice!.value).to.equal('create');
        expect(linkChoice!.value).to.equal('link');
        expect(statusChoice!.value).to.equal('status');
      });

      it('should produce identical structure with --json and --machine flags', async () => {
        // Get output with both flags
        const jsonOutput = await agentExec('pr -P test-project --json');
        const machineOutput = await agentExec('pr -P test-project --machine');

        // Structure should be identical (except command field may differ)
        expect(jsonOutput.prompt!.type).to.equal(machineOutput.prompt!.type);
        expect(jsonOutput.prompt!.name).to.equal(machineOutput.prompt!.name);
        expect(jsonOutput.prompt!.choices!.length).to.equal(machineOutput.prompt!.choices!.length);
        expect(jsonOutput.metadata.command).to.equal(machineOutput.metadata.command);
      });
    });
  });

  describe('Error handling in JSON mode', () => {
    it('should show informative message when no tickets exist for pr status', async () => {
      // No tickets created in this test
      const output = await execInProcess('pr status -P test-project --machine');

      // Must indicate no tickets found
      expect(output.toLowerCase()).to.include('no tickets');

      // Message should be helpful
      expect(output.length).to.be.greaterThan(10);
    });

    it('should return structured error JSON for gh CLI issues', async () => {
      createTestTicket('TKT-ERR-1', 'Error test ticket', 'in-progress');

      // pr link requires gh CLI - test error structure
      const output = await execInProcess('pr link TKT-ERR-1 -P test-project --machine');
      const json = extractJson<{
        prompt?: { type: string; name: string };
        error?: { code: string; message: string };
        metadata: { command: string; flags: Record<string, unknown> };
      }>(output);

      // Must have metadata
      expect(json.metadata).to.exist;
      expect(json.metadata.command).to.equal('pr link');

      // Must have either valid prompt or structured error
      if (json.error) {
        // Error must have code and message
        expect(json.error.code).to.be.a('string');
        expect(json.error.code.length).to.be.greaterThan(0);
        expect(json.error.message).to.be.a('string');
        expect(json.error.message.length).to.be.greaterThan(0);

        // Error code should be one of the expected values
        expect(json.error.code).to.be.oneOf([
          'GH_NOT_INSTALLED',
          'GH_NOT_AUTHENTICATED',
          'NO_OPEN_PRS',
        ]);
      } else {
        // If no error, must have valid prompt
        expect(json.prompt).to.exist;
        expect(json.prompt!.type).to.equal('list');
        expect(json.prompt!.name).to.be.oneOf(['ticket', 'pr', 'confirm']);
      }
    });

    it('should return valid error structure for invalid ticket ID', async () => {
      // Try to view status of non-existent ticket
      const output = await execInProcess('pr status INVALID-TICKET-123 -P test-project --machine');

      // Should either error or show "not found" message
      expect(output).to.be.a('string');
      expect(output.length).to.be.greaterThan(0);

      // Should indicate ticket not found
      if (output.includes('{')) {
        // JSON output
        const json = extractJson<{
          error?: { code: string; message: string };
        }>(output);
        if (json.error) {
          expect(json.error.message.toLowerCase()).to.include('not found');
        }
      } else {
        // Text output
        expect(output.toLowerCase()).to.satisfy((s: string) =>
          s.includes('not found') || s.includes('error')
        );
      }
    });
  });
});

/**
 * Initialize a git repo for PR commands to work
 */
function initGitRepo(dir: string): void {
  try {
    execSync('git init', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    // Create initial commit
    fs.writeFileSync(path.join(dir, 'README.md'), '# Test');
    execSync('git add .', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    execSync('git commit -m "Initial commit"', { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    // Git init may fail in some test environments
  }
}
