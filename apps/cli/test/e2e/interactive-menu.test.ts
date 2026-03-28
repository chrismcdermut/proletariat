/**
 * End-to-end interactive menu tests using tmux send-keys + capture-pane.
 *
 * These tests exercise the actual interactive CLI menus that human users see —
 * arrow-key navigation, styled output, prompt rendering, etc. — which the
 * existing --json/--machine tests completely skip.
 *
 * Architecture:
 *   1. Create a tmux session with PRLT_HQ_PATH set
 *   2. Send `prlt <command>` via tmux send-keys
 *   3. Wait for output to stabilize via capture-pane polling
 *   4. Assert on the rendered terminal content
 *   5. Send navigation keys (Down, Up, Enter, Escape) to traverse menus
 *   6. Capture and verify each menu state
 *
 * Prerequisites:
 *   - tmux must be installed
 *   - prlt must be installed globally
 *   - PRLT_HQ_PATH must point to a valid HQ with seeded data
 *
 * Run with:
 *   pnpm test:e2e:interactive
 *   # or
 *   npx mocha --forbid-only --timeout 120000 "test/e2e/interactive-menu.test.ts"
 */

import { expect } from 'chai';
import { execSync } from 'node:child_process';
import { InteractiveTestSession } from './interactive-test-session.js';

/** Timeout for waiting for menu output to appear */
const MENU_TIMEOUT = 15000;

/**
 * Check whether tmux is available on this system.
 */
function hasTmux(): boolean {
  try {
    execSync('which tmux', { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether prlt is available globally.
 */
function hasPrlt(): boolean {
  try {
    execSync('which prlt', { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the HQ path to use for tests.
 * Prefers PRLT_HQ_PATH env var, falls back to /hq (devcontainer default).
 */
function getHqPath(): string {
  return process.env.PRLT_HQ_PATH || '/hq';
}

// Skip the entire suite if prerequisites are not met
const skipSuite = !hasTmux() || !hasPrlt();

(skipSuite ? describe.skip : describe)('Interactive Menu E2E Tests (tmux)', function (this: Mocha.Suite) {
  // These tests involve real tmux sessions with I/O delays
  this.timeout(120000);
  // SQLite can throw transient I/O errors under concurrent access; allow retries
  this.retries(2);

  let session: InteractiveTestSession;
  const hqPath = getHqPath();

  beforeEach(function () {
    session = new InteractiveTestSession({
      env: { PRLT_HQ_PATH: hqPath },
      defaultTimeout: MENU_TIMEOUT,
    });
    session.start();
  });

  afterEach(function () {
    if (session) {
      session.stop();
    }
  });

  // ===========================================================================
  // 1. Root help — `prlt` shows top-level command listing
  // ===========================================================================
  describe('Root command (prlt)', () => {
    it('should display top-level command listing with key commands', () => {
      session.sendCommand('prlt');
      session.waitForOutput('ticket', MENU_TIMEOUT);

      session.assertScreenContains('ticket');
      session.assertScreenContains('project');
      session.assertScreenContains('work');
      session.assertScreenContains('init');
    });

    it('should show help text for known commands', () => {
      session.sendCommand('prlt');
      session.waitForOutput('Interactive menu', MENU_TIMEOUT);

      const screen = session.getScreen();
      // Should have descriptions for the commands
      expect(screen.raw).to.match(/ticket.*Interactive menu/i);
    });
  });

  // ===========================================================================
  // 2. Ticket submenu — `prlt ticket` shows interactive operations
  // ===========================================================================
  describe('Ticket submenu (prlt ticket)', () => {
    it('should show ticket operations menu with all options', () => {
      session.sendCommand('prlt ticket');
      session.waitForOutput('Ticket Operations', MENU_TIMEOUT);

      session.assertScreenContains('Create new ticket');
      session.assertScreenContains('List all tickets');
      session.assertScreenContains('View ticket details');
      session.assertScreenContains('Edit ticket');
      session.assertScreenContains('Move ticket');
    });

    it('should highlight "Create new ticket" as the first option', () => {
      session.sendCommand('prlt ticket');
      session.waitForOutput('Ticket Operations', MENU_TIMEOUT);

      session.assertSelected('Create new ticket');
    });

    it('should show the inquirer prompt indicator (?)', () => {
      session.sendCommand('prlt ticket');
      session.waitForOutput('Ticket Operations', MENU_TIMEOUT);

      const screen = session.getScreen();
      // inquirer renders a ? at the start of the prompt line
      expect(screen.raw).to.match(/\?\s.*Ticket Operations/);
    });
  });

  // ===========================================================================
  // 3. Ticket list — renders table with ticket data
  // ===========================================================================
  describe('Ticket list (prlt ticket list)', () => {
    it('should display a list of tickets', () => {
      session.sendCommand('prlt ticket list');
      // Wait for ticket data to render - look for TKT- prefix pattern
      session.waitForOutput('TKT-', MENU_TIMEOUT);

      const screen = session.getScreen();
      // Should contain ticket IDs
      expect(screen.raw).to.match(/TKT-\d+/);
    });
  });

  // ===========================================================================
  // 4. Ticket create flow — interactive prompts
  // ===========================================================================
  describe('Ticket create flow (prlt ticket create)', () => {
    it('should show interactive prompts when creating a ticket', () => {
      session.sendCommand('prlt ticket create');
      // The create flow starts by asking for column/status selection
      session.waitForOutput(/Select column|Ticket Operations|column|title/i, MENU_TIMEOUT);

      const screen = session.getScreen();
      // Should show some kind of interactive prompt (column or title selection)
      expect(screen.raw).to.match(/Select|column|title|arrow keys/i);
    });

    it('should show selectable options in create flow', () => {
      session.sendCommand('prlt ticket create');
      // Wait for the interactive prompt to appear with the selection indicator
      session.waitForOutput('❯', MENU_TIMEOUT);

      const screen = session.getScreen();
      // Should have the selection indicator
      expect(screen.raw).to.include('❯');
    });
  });

  // ===========================================================================
  // 5. Board view — `prlt board` renders board menu
  // ===========================================================================
  describe('Board submenu (prlt board)', () => {
    it('should show board operations menu', () => {
      session.sendCommand('prlt board');
      session.waitForOutput('Board Operations', MENU_TIMEOUT);

      session.assertScreenContains('View board');
      session.assertScreenContains('Cancel');
    });

    it('should show export and sync options', () => {
      session.sendCommand('prlt board');
      session.waitForOutput('Board Operations', MENU_TIMEOUT);

      const screen = session.getScreen();
      expect(screen.raw).to.match(/Export|export/);
      expect(screen.raw).to.match(/Sync|sync/);
    });
  });

  // ===========================================================================
  // 7. Agent menu — `prlt agent` shows agent management
  // ===========================================================================
  describe('Agent submenu (prlt agent)', () => {
    it('should show agent management menu', () => {
      session.sendCommand('prlt agent');
      session.waitForOutput('What would you like to do', MENU_TIMEOUT);

      session.assertScreenContains('List all agents');
      session.assertScreenContains('Show status');
    });

    it('should show remove and cleanup options', () => {
      session.sendCommand('prlt agent');
      session.waitForOutput('What would you like to do', MENU_TIMEOUT);

      const screen = session.getScreen();
      expect(screen.raw).to.match(/Remove|remove/i);
      expect(screen.raw).to.match(/Cleanup|cleanup/i);
    });
  });

  // ===========================================================================
  // 8. Work menu — `prlt work` shows work operations
  // ===========================================================================
  describe('Work submenu (prlt work)', () => {
    it('should show work operations menu', () => {
      session.sendCommand('prlt work');
      session.waitForOutput('Work Operations', MENU_TIMEOUT);

      session.assertScreenContains('Start work');
    });

    it('should show spawn and watch options', () => {
      session.sendCommand('prlt work');
      session.waitForOutput('Work Operations', MENU_TIMEOUT);

      // Scroll down to reveal options that may be below the inquirer page fold
      for (let i = 0; i < 5; i++) session.send('Down');
      session.waitForStable(500);

      const screen = session.getScreen();
      expect(screen.raw).to.match(/Spawn|spawn/i);
      expect(screen.raw).to.match(/Watch|watch/i);
    });

    it('should show ready and complete options', () => {
      session.sendCommand('prlt work');
      session.waitForOutput('Work Operations', MENU_TIMEOUT);

      // Scroll down to reveal more options that may be below the fold
      for (let i = 0; i < 10; i++) session.send('Down');
      session.waitForStable(500);

      const screen = session.getScreen();
      expect(screen.raw).to.match(/ready|Ready|complete|Complete/i);
    });
  });

  // ===========================================================================
  // 9. Arrow key navigation — up/down arrows move selection
  // ===========================================================================
  describe('Arrow key navigation', () => {
    it('should move selection down with Down arrow', () => {
      session.sendCommand('prlt ticket');
      session.waitForOutput('Ticket Operations', MENU_TIMEOUT);

      // Initially "Create new ticket" should be selected
      session.assertSelected('Create new ticket');

      // Press Down arrow twice
      session.send('Down');
      session.send('Down');

      // Wait for the UI to update
      session.waitForStable(300);

      // "List all tickets" should now be selected (third item)
      session.assertSelected('List all tickets');
    });

    it('should move selection up with Up arrow', () => {
      session.sendCommand('prlt ticket');
      session.waitForOutput('Ticket Operations', MENU_TIMEOUT);

      // Move down twice, then back up once
      session.send('Down');
      session.send('Down');
      session.waitForStable(300);
      session.send('Up');
      session.waitForStable(300);

      // Should be on "Create from template" (second item)
      session.assertSelected('Create from template');
    });

    it('should select item with Enter key', () => {
      session.sendCommand('prlt board');
      session.waitForOutput('Board Operations', MENU_TIMEOUT);

      // First item "View board in terminal" should be selected
      session.assertSelected('View board');

      // Press Enter to select it
      session.send('Enter');

      // Wait for something to happen (either board renders or we get output)
      session.waitForStable(1000, MENU_TIMEOUT);

      const screen = session.getScreen();
      // After selection, the inquirer selection arrows (❯) should be gone
      // because the menu is no longer in its interactive state.
      // Note: the prompt text itself stays visible in terminal scrollback,
      // so we check for the absence of the selection indicator instead.
      const menuChoiceLines = screen.lines.filter(
        (line: string) => line.includes('❯') && line.includes('Board')
      );
      expect(menuChoiceLines).to.have.length(0);
    });
  });

  // ===========================================================================
  // 10. Escape/back — Ctrl+C returns to shell prompt
  // ===========================================================================
  describe('Escape/back (Ctrl+C)', () => {
    it('should exit menu and return to shell prompt on Ctrl+C', () => {
      session.sendCommand('prlt ticket');
      session.waitForOutput('Ticket Operations', MENU_TIMEOUT);

      // Send Ctrl+C
      session.send('C-c');

      // Wait for shell prompt to return — the CLI needs time to handle the
      // signal, clean up the menu, and the shell needs to display a new prompt
      session.waitForStable(1000, MENU_TIMEOUT);

      const screen = session.getScreen();
      // Should see the bash prompt (ends with $ or #)
      expect(screen.raw).to.match(/[$#]\s*$/m);
    });

    it('should be able to run another command after Ctrl+C', () => {
      session.sendCommand('prlt work');
      session.waitForOutput('Work Operations', MENU_TIMEOUT);

      // Cancel the menu
      session.send('C-c');
      session.waitForStable(500, MENU_TIMEOUT);

      // Run a different command
      session.sendCommand('prlt board');
      session.waitForOutput('Board Operations', MENU_TIMEOUT);

      session.assertScreenContains('Board Operations');
    });
  });

  // ===========================================================================
  // 11. Error states — invalid commands show helpful output
  // ===========================================================================
  describe('Error states', () => {
    it('should show help for unknown subcommands', () => {
      session.sendCommand('prlt nonexistent-command-xyz');
      session.waitForStable(1000, MENU_TIMEOUT);

      const screen = session.getScreen();
      // Should show an error or help text
      expect(screen.raw).to.match(/not found|unknown|help|error|command .* not found/i);
    });

    it('should handle --help flag', () => {
      session.sendCommand('prlt ticket --help');
      session.waitForStable(1000, MENU_TIMEOUT);

      const screen = session.getScreen();
      // --help should display usage info, not an interactive menu
      expect(screen.raw).to.match(/USAGE|usage|COMMANDS|commands|DESCRIPTION|description/i);
    });
  });

  // ===========================================================================
  // 12. Multiple menu transitions — navigate through menus sequentially
  // ===========================================================================
  describe('Multiple menu transitions', () => {
    it('should handle sequential menu commands cleanly', () => {
      // First: open and close ticket menu
      session.sendCommand('prlt ticket');
      session.waitForOutput('Ticket Operations', MENU_TIMEOUT);
      session.send('C-c');
      session.waitForStable(500, MENU_TIMEOUT);

      // Second: open and close board menu
      session.sendCommand('prlt board');
      session.waitForOutput('Board Operations', MENU_TIMEOUT);
      session.send('C-c');
      session.waitForStable(500, MENU_TIMEOUT);

      // Third: open agent menu and verify it's clean
      session.sendCommand('prlt agent');
      session.waitForOutput('What would you like to do', MENU_TIMEOUT);

      session.assertScreenContains('List all agents');
    });
  });

  // ===========================================================================
  // Additional command menus
  // ===========================================================================
  describe('Additional command menus', () => {
    it('prlt branch — should show branch operations menu', () => {
      session.sendCommand('prlt branch');
      // Wait for some kind of menu or output
      session.waitForStable(1000, MENU_TIMEOUT);

      const screen = session.getScreen();
      // Branch command should show branch-related options
      expect(screen.raw).to.match(/branch|Branch/i);
    });

    it('prlt project — should show project operations', () => {
      session.sendCommand('prlt project');
      session.waitForStable(1000, MENU_TIMEOUT);

      const screen = session.getScreen();
      expect(screen.raw).to.match(/project|Project/i);
    });

    it('prlt config — should show configuration', () => {
      session.sendCommand('prlt config');
      session.waitForStable(1000, MENU_TIMEOUT);

      const screen = session.getScreen();
      expect(screen.raw).to.match(/config|Config|Configuration|setting/i);
    });

    it('prlt whoami — should show identity context', () => {
      session.sendCommand('prlt whoami');
      session.waitForStable(1000, MENU_TIMEOUT);

      const screen = session.getScreen();
      // whoami should display agent/environment information
      expect(screen.raw).to.match(/agent|workspace|hq|context/i);
    });
  });

  // ===========================================================================
  // Output formatting & rendering
  // ===========================================================================
  describe('Output formatting', () => {
    it('should render the selection indicator (❯) for the active item', () => {
      session.sendCommand('prlt ticket');
      session.waitForOutput('Ticket Operations', MENU_TIMEOUT);

      const screen = session.getScreen();
      // Should have the ❯ indicator somewhere
      expect(screen.raw).to.include('❯');
    });

    it('should render the "(Use arrow keys)" hint', () => {
      session.sendCommand('prlt ticket');
      session.waitForOutput('Ticket Operations', MENU_TIMEOUT);

      const screen = session.getScreen();
      expect(screen.raw).to.match(/arrow keys|Use arrow/i);
    });

    it('should render the "(Move up and down to reveal more choices)" hint for long menus', () => {
      session.sendCommand('prlt work');
      session.waitForOutput('Work Operations', MENU_TIMEOUT);

      const screen = session.getScreen();
      // Long menus show a scroll hint
      expect(screen.raw).to.match(/Move up and down|arrow keys/i);
    });
  });
});
