import { Args, Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { setInternalAction } from '../../services/action-context.js';

export default class WorkResolve extends PMOCommand {
  static description = 'Agent-assisted resolution of ambiguity questions on tickets (spawns interactive agent)';

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002',
    '<%= config.bin %> <%= command.id %>  # Interactive picker for needs-clarification tickets',
  ];

  static strict = false;

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID(s) to resolve - prompts with picker if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    force: Flags.boolean({
      char: 'f',
      description: 'Bypass action state guardrails',
      default: false,
    }),
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { flags, argv } = await this.parse(WorkResolve);
    const projectId = (flags as { project?: string }).project;

    const jsonMode = shouldOutputJson(flags);

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work resolve', flags));
        return
      }
      this.error(message);
    };

    // Collect ticket IDs from argv (supports multiple args)
    let ticketIds: string[] = (argv as string[]).filter(a => !a.startsWith('-'));

    if (ticketIds.length === 0) {
      // No tickets specified - show picker of needs-clarification tickets
      const allTickets = await this.storage.listTickets(projectId);
      const clarificationTickets = allTickets.filter(
        (t) =>
          t.labels.includes('needs-clarification') ||
          t.statusName?.toLowerCase() === 'needs clarification'
      );

      if (clarificationTickets.length === 0) {
        return handleError(
          'NO_TICKETS',
          'No tickets need clarification. Run "prlt work groom" to groom tickets first.'
        );
      }

      const selected = await this.selectFromList({
        message: 'Select ticket to resolve (agent-assisted):',
        items: clarificationTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) =>
          `prlt work resolve ${t.id}${projectId ? ` -P ${projectId}` : ''} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'work resolve' } : null,
      });

      if (!selected) {
        return;
      }
      ticketIds = [selected];
    }

    // Launch work start with resolve action for each ticket. The action is
    // passed through the internal action-context channel rather than an
    // `--action` CLI flag (PRLT-1316) so users can't bypass the verb layer.
    for (const ticketId of ticketIds) {
      this.log(styles.info(`\nLaunching agent-assisted resolve for ${styles.emphasis(ticketId)}...`));

      const workStartArgs = [ticketId];
      if (projectId) {
        workStartArgs.push('--project', projectId);
      }
      if (flags.force) {
        workStartArgs.push('--force');
      }
      if (jsonMode) {
        workStartArgs.push('--json');
      }

      setInternalAction('resolve');
      // eslint-disable-next-line no-await-in-loop
      await this.config.runCommand('work:start', workStartArgs);
    }
  }
}
