import { Command, Flags } from '@oclif/core';
import * as path from 'path';
import { styles } from '../../lib/styles.js';
import { findPMO } from '../../lib/pmo/find-pmo.js';
import { getWorkspaceDbPath } from '../../lib/pmo/sync-manager.js';
import { findWorkspaceFromPMO } from '../../lib/pmo/hooks-integration.js';
import { loadAllHooks, Hook } from '../../lib/hooks/index.js';
import Database from 'better-sqlite3';

export default class HooksList extends Command {
  static description = 'List all registered hooks';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --event ticket.moved',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    event: Flags.string({
      char: 'e',
      description: 'Filter by event type',
    }),
    enabled: Flags.boolean({
      description: 'Only show enabled hooks',
    }),
    disabled: Flags.boolean({
      description: 'Only show disabled hooks',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(HooksList);

    // Find PMO and workspace
    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    const workspacePath = findWorkspaceFromPMO(pmoPath);
    const dbPath = getWorkspaceDbPath(pmoPath);

    // Load hooks
    let db: Database.Database | undefined;
    try {
      db = new Database(dbPath);
    } catch {
      // Database not available
    }

    const hooks = loadAllHooks(workspacePath, db);
    db?.close();

    // Apply filters
    let filteredHooks = hooks;

    if (flags.event) {
      filteredHooks = filteredHooks.filter(h => h.event === flags.event);
    }

    if (flags.enabled) {
      filteredHooks = filteredHooks.filter(h => h.enabled);
    }

    if (flags.disabled) {
      filteredHooks = filteredHooks.filter(h => !h.enabled);
    }

    // Output
    if (flags.json) {
      this.log(JSON.stringify(filteredHooks, null, 2));
      return;
    }

    if (filteredHooks.length === 0) {
      this.log(styles.muted('No hooks found.'));
      this.log('');
      this.log(styles.muted('Create hooks.yaml with: prlt hooks init'));
      return;
    }

    this.log(styles.header(`\nRegistered Hooks (${filteredHooks.length})`));
    this.log('');

    for (const hook of filteredHooks) {
      this.printHook(hook);
    }
  }

  private printHook(hook: Hook): void {
    const status = hook.enabled
      ? styles.success('●')
      : styles.muted('○');

    const source = hook.source === 'yaml'
      ? styles.muted('[yaml]')
      : styles.muted('[db]');

    this.log(`${status} ${styles.emphasis(hook.name)} ${source}`);
    this.log(`  Event: ${styles.info(hook.event)}`);

    if (hook.description) {
      this.log(`  ${styles.muted(hook.description)}`);
    }

    // Show conditions
    if (hook.conditions && hook.conditions.length > 0) {
      this.log(`  Conditions:`);
      for (const cond of hook.conditions) {
        this.log(`    - ${cond.field} ${cond.operator} ${JSON.stringify(cond.value)}`);
      }
    }

    // Show actions
    this.log(`  Actions:`);
    for (const action of hook.actions) {
      this.log(`    - ${action.type}${this.formatActionDetails(action)}`);
    }

    if (hook.priority !== undefined) {
      this.log(`  Priority: ${hook.priority}`);
    }

    if (hook.projectId) {
      this.log(`  Project: ${hook.projectId}`);
    }

    this.log('');
  }

  private formatActionDetails(action: Hook['actions'][0]): string {
    switch (action.type) {
      case 'spawn_agent':
        const parts: string[] = [];
        if (action.strategy) parts.push(`strategy=${action.strategy}`);
        if (action.agent) parts.push(`agent=${action.agent}`);
        if (action.limit) parts.push(`limit=${action.limit}`);
        return parts.length > 0 ? ` (${parts.join(', ')})` : '';

      case 'shell':
        return ` "${action.command}"`;

      case 'log':
        return ` "${action.message}"`;

      case 'webhook':
        return ` ${action.method || 'POST'} ${action.url}`;

      default:
        return '';
    }
  }
}
