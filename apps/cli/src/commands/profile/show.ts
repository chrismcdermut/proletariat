import { Args } from '@oclif/core';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class ProfileShow extends PMOCommand {
  static description = 'Show details of an agent profile';

  static examples = [
    '<%= config.bin %> <%= command.id %> frontend-specialist',
    '<%= config.bin %> <%= command.id %> retro-enabled --json',
  ];

  static args = {
    id: Args.string({
      description: 'Profile ID to show',
      required: true,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ProfileShow);
    const jsonMode = shouldOutputJson(flags);

    const profile = await this.storage.getProfile(args.id);

    if (!profile) {
      this.error(`Profile not found: ${args.id}`);
    }

    if (jsonMode) {
      this.log(JSON.stringify(profile, null, 2));
      return;
    }

    this.log(`\n${styles.emphasis(`Profile: ${profile.name}`)} ${styles.muted(`(${profile.id})`)}`);
    this.log('');

    if (profile.description) {
      this.log(`${styles.muted('Description:')} ${profile.description}`);
    }

    if (profile.repos?.length) {
      this.log(`${styles.muted('Repos:')} ${profile.repos.join(', ')}`);
    }

    if (profile.mcpServers?.length) {
      this.log(`${styles.muted('MCP Servers:')}`);
      for (const server of profile.mcpServers) {
        this.log(`  - ${server.name}: ${server.command} ${(server.args || []).join(' ')}`);
      }
    }

    if (profile.startHook) {
      this.log('');
      this.log(styles.muted('Start Hook:'));
      this.log('─'.repeat(40));
      this.log(profile.startHook);
      this.log('─'.repeat(40));
    }

    if (profile.endHook) {
      this.log('');
      this.log(styles.muted('End Hook:'));
      this.log('─'.repeat(40));
      this.log(profile.endHook);
      this.log('─'.repeat(40));
    }

    if (profile.systemPrompt) {
      this.log('');
      this.log(styles.muted('System Prompt:'));
      this.log('─'.repeat(40));
      this.log(profile.systemPrompt);
      this.log('─'.repeat(40));
    }

    this.log('');
  }
}
