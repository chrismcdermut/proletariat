import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { machineOutputFlags } from '../lib/pmo/index.js';

export default class Init extends Command {
  static description = 'Initialize a new headquarters (deprecated — use `prlt new` instead)';

  static examples = [
    '<%= config.bin %> new',
  ];

  static hidden = true;

  // Accept the same flags as `new` so forwarding works correctly
  static flags = {
    ...machineOutputFlags,
    name: Flags.string({
      description: 'HQ name',
      char: 'n',
    }),
    path: Flags.string({
      description: 'HQ path (defaults to ./{name}-hq)',
      char: 'p',
    }),
    agents: Flags.string({
      description: 'Comma-separated list of agent names',
      char: 'a',
    }),
    repos: Flags.string({
      description: 'Comma-separated list of repository paths to clone/move',
      char: 'r',
    }),
    pmo: Flags.boolean({
      description: 'Include PMO (Project Management Org)',
      default: true,
      allowNo: true,
    }),
    setup: Flags.string({
      description: 'Setup method for agent-driven onboarding (claude-code, codex, or manual)',
      options: ['claude-code', 'codex', 'manual'],
    }),
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(Init);

    console.log(chalk.yellow('`prlt init` is deprecated. Use `prlt new` instead.\n'));

    // Build args for forwarding to `new`
    const newArgs = ['new'];
    for (const [key, value] of Object.entries(flags)) {
      if (value === undefined) continue;
      if (typeof value === 'boolean') {
        if (value) {
          newArgs.push(`--${key}`);
        } else {
          newArgs.push(`--no-${key}`);
        }
      } else {
        newArgs.push(`--${key}`, String(value));
      }
    }
    // Forward positional args
    for (const arg of (argv as string[])) {
      newArgs.push(arg);
    }

    const { run } = await import('@oclif/core');
    await run(newArgs, this.config);
  }
}
