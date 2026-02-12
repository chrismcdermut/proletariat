import { Flags } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { AgentProfile } from '../../lib/pmo/types.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class ProfileList extends PMOCommand {
  static description = 'List available agent profiles';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output as JSON',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ProfileList);

    const profiles = await this.storage.listProfiles();

    if (shouldOutputJson(flags)) {
      this.log(JSON.stringify(profiles, null, 2));
      return;
    }

    if (profiles.length === 0) {
      this.log(styles.muted('\nNo profiles found.'));
      this.log(styles.muted('Create one with: prlt profile create'));
      return;
    }

    this.log(`\n${styles.emphasis('Agent Profiles')}`);
    this.log('═'.repeat(60));

    for (const profile of profiles) {
      this.printProfile(profile);
    }

    this.log('');
    this.log(styles.muted('Use a profile:   prlt work spawn TKT-001 --profile <id>'));
    this.log(styles.muted('View details:    prlt profile show <id>'));
    this.log('');
  }

  private printProfile(profile: AgentProfile): void {
    this.log(`\n  ${styles.emphasis(profile.name)} ${styles.muted(`(${profile.id})`)}`);
    if (profile.description) {
      this.log(`    ${styles.muted(profile.description)}`);
    }

    const details: string[] = [];
    if (profile.startHook) details.push('start hook');
    if (profile.endHook) details.push('end hook');
    if (profile.systemPrompt) details.push('system prompt');
    if (profile.repos?.length) details.push(`repos: ${profile.repos.join(', ')}`);
    if (profile.mcpServers?.length) details.push(`${profile.mcpServers.length} MCP server(s)`);

    if (details.length > 0) {
      this.log(`    ${styles.muted(details.join(' | '))}`);
    }
  }
}
