import { Command, Args } from '@oclif/core';
import { styles } from '../../lib/styles.js';
import { findPMO } from '../../lib/pmo/find-pmo.js';
import { getWorkspaceDbPath } from '../../lib/pmo/sync-manager.js';
import { findWorkspaceFromPMO } from '../../lib/pmo/hooks-integration.js';
import {
  loadAllHooks,
  saveHookToDatabase,
  Hook,
} from '../../lib/hooks/index.js';
import Database from 'better-sqlite3';

export default class HooksEnable extends Command {
  static description = 'Enable a hook';

  static examples = [
    '<%= config.bin %> <%= command.id %> auto_spawn_ready',
    '<%= config.bin %> <%= command.id %> log_ticket_created',
  ];

  static args = {
    hookId: Args.string({
      description: 'Hook ID to enable',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(HooksEnable);
    const hookId = args.hookId;

    // Find PMO and workspace
    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    const workspacePath = findWorkspaceFromPMO(pmoPath);
    const dbPath = getWorkspaceDbPath(pmoPath);

    // Load hooks
    let db: Database.Database;
    try {
      db = new Database(dbPath);
    } catch (error) {
      this.error('Could not open workspace database.');
    }

    const hooks = loadAllHooks(workspacePath, db);

    // Find the hook
    const hook = hooks.find(h => h.id === hookId);
    if (!hook) {
      db.close();
      this.error(`Hook not found: ${hookId}`);
    }

    if (hook.enabled) {
      db.close();
      this.log(styles.muted(`Hook "${hookId}" is already enabled.`));
      return;
    }

    // For YAML hooks, we need to save the enabled state to database
    // Database hooks override YAML hooks with the same ID
    const updatedHook: Hook = {
      ...hook,
      enabled: true,
      source: 'database',
      updatedAt: new Date(),
    };

    saveHookToDatabase(db, updatedHook);
    db.close();

    this.log(styles.success(`\n✅ Enabled hook: ${hookId}`));

    if (hook.source === 'yaml') {
      this.log('');
      this.log(styles.muted('Note: This override is stored in the database.'));
      this.log(styles.muted('To permanently enable, edit hooks.yaml directly.'));
    }
  }
}
