import { Flags, Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

export default class SpecView extends PMOCommand {
  static description = 'View a spec and its linked tickets';

  static examples = [
    '<%= config.bin %> <%= command.id %> user-authentication',
    '<%= config.bin %> <%= command.id %> --spec api-design',
  ];

  static args = {
    spec: Args.string({
      description: 'Spec ID',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    spec: Flags.string({
      char: 's',
      description: 'Spec ID',
    }),
    full: Flags.boolean({
      char: 'f',
      description: 'Show all spec sections',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecView);
    // This command requires project context for listing linked tickets
    const projectId = await this.requireProject();

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('spec view', flags));
        this.exit(1);
      }
      this.error(message);
    };

    // Get spec ID
    let specId = args.spec || flags.spec;
    if (!specId) {
      const specs = await this.storage.listSpecs();
      if (specs.length === 0) {
        return handleError('NO_SPECS', 'No specs found. Create one first with: prlt spec create');
      }

      const selected = await this.selectFromList({
        message: 'Select spec to view:',
        items: specs,
        getName: (s) => `${s.title} [${s.status}]${s.type ? ` (${s.type})` : ''}`,
        getValue: (s) => s.id,
        getCommand: (s) => `prlt spec view ${s.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'spec view' } : null,
      });

      if (!selected) {
        return;
      }
      specId = selected;
    }

    // Get the spec
    const spec = await this.storage.getSpec(specId!);
    if (!spec) {
      this.error(`Spec not found: ${specId}`);
    }

    // Get linked tickets
    const tickets = await this.storage.getTicketsForSpec(projectId, spec.id);

    // Get dependencies
    const dependencies = await this.storage.getSpecDependencies(spec.id);
    const dependents = await this.storage.getSpecDependents(spec.id);

    // Display spec info
    this.log(styles.title(`\n📄 ${spec.title}`));
    this.log(styles.muted('═'.repeat(60)));
    this.log(styles.muted(`ID: ${spec.id}`));
    this.log(styles.muted(`Status: ${spec.status}`));
    if (spec.type) this.log(styles.muted(`Type: ${spec.type}`));
    if (spec.tags && spec.tags.length > 0) {
      this.log(styles.muted(`Tags: ${spec.tags.join(', ')}`));
    }
    this.log(styles.muted(`Created: ${spec.createdAt.toLocaleDateString()}`));
    this.log(styles.muted(`Updated: ${spec.updatedAt.toLocaleDateString()}`));

    // Problem
    if (spec.problem) {
      this.log(styles.emphasis('\n## Problem'));
      this.log(spec.problem);
    }

    // Solution
    if (spec.solution) {
      this.log(styles.emphasis('\n## Solution'));
      this.log(spec.solution);
    }

    // Decisions (always show)
    if (spec.decisions) {
      this.log(styles.emphasis('\n## Decisions'));
      this.log(spec.decisions);
    }

    // Show more sections if --full
    if (flags.full) {
      if (spec.notNow) {
        this.log(styles.emphasis('\n## Not Now'));
        this.log(spec.notNow);
      }
      if (spec.uiUx) {
        this.log(styles.emphasis('\n## UI/UX'));
        this.log(spec.uiUx);
      }
      if (spec.acceptanceCriteria) {
        this.log(styles.emphasis('\n## Acceptance Criteria'));
        this.log(spec.acceptanceCriteria);
      }
      if (spec.openQuestions) {
        this.log(styles.emphasis('\n## Open Questions'));
        this.log(spec.openQuestions);
      }
      if (spec.requirementsFunctional) {
        this.log(styles.emphasis('\n## Functional Requirements'));
        this.log(spec.requirementsFunctional);
      }
      if (spec.requirementsTechnical) {
        this.log(styles.emphasis('\n## Technical Requirements'));
        this.log(spec.requirementsTechnical);
      }
      if (spec.context) {
        this.log(styles.emphasis('\n## Context'));
        this.log(spec.context);
      }
    }

    // Dependencies
    if (dependencies.length > 0) {
      this.log(styles.emphasis(`\n📦 Depends On (${dependencies.length}):`));
      for (const dep of dependencies) {
        this.log(`  ${styles.code(dep.id)}: ${dep.title} [${dep.status}]`);
      }
    }

    if (dependents.length > 0) {
      this.log(styles.emphasis(`\n📦 Depended On By (${dependents.length}):`));
      for (const dep of dependents) {
        this.log(`  ${styles.code(dep.id)}: ${dep.title} [${dep.status}]`);
      }
    }

    // Linked tickets
    if (tickets.length > 0) {
      this.log(styles.emphasis(`\n🎫 Linked Tickets (${tickets.length}):`));
      for (const ticket of tickets) {
        this.log(`  ${styles.code(ticket.id)}: ${ticket.title} [${ticket.status}]`);
      }
    } else {
      this.log(styles.muted('\n🎫 No linked tickets'));
    }

    this.log(styles.muted('\n' + '═'.repeat(60)));
    if (!flags.full) {
      this.log(styles.muted('Use --full to see all sections'));
    }
  }
}
