import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { styles } from '../../lib/styles.js';
import { findPMO } from '../../lib/pmo/find-pmo.js';
import { findWorkspaceFromPMO } from '../../lib/pmo/hooks-integration.js';
import { ensureHooksYamlExists, generateHooksTemplate } from '../../lib/hooks/index.js';

export default class HooksInit extends Command {
  static description = 'Create a hooks.yaml template file';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
  ];

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing hooks.yaml',
    }),
    print: Flags.boolean({
      description: 'Print template to stdout instead of creating file',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(HooksInit);

    // Print mode
    if (flags.print) {
      this.log(generateHooksTemplate());
      return;
    }

    // Find PMO and workspace
    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    const workspacePath = findWorkspaceFromPMO(pmoPath);
    const hooksPath = path.join(workspacePath, '.proletariat', 'hooks.yaml');

    // Check if file exists
    if (fs.existsSync(hooksPath) && !flags.force) {
      this.error(`hooks.yaml already exists at ${hooksPath}. Use --force to overwrite.`);
    }

    // Ensure directory exists
    const dir = path.dirname(hooksPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write template
    fs.writeFileSync(hooksPath, generateHooksTemplate());

    this.log(styles.success(`\n✅ Created hooks.yaml at ${hooksPath}`));
    this.log('');
    this.log(styles.muted('Edit the file to configure your hooks.'));
    this.log(styles.muted('See documentation for available events, conditions, and actions.'));
    this.log('');
    this.log(styles.muted('Available events:'));
    this.log(styles.muted('  - ticket.created, ticket.moved, ticket.updated'));
    this.log(styles.muted('  - ticket.status_changed, ticket.deleted, ticket.completed'));
    this.log(styles.muted('  - epic.created, epic.updated, epic.status_changed, epic.deleted'));
    this.log(styles.muted('  - work.started, work.completed'));
    this.log('');
    this.log(styles.muted('Available actions:'));
    this.log(styles.muted('  - spawn_agent: Auto-spawn agent to work on ticket'));
    this.log(styles.muted('  - shell: Run a shell command'));
    this.log(styles.muted('  - log: Log a message'));
    this.log(styles.muted('  - webhook: Send HTTP request'));
  }
}
