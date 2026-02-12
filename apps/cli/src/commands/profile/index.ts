import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { AgentProfile } from '../../lib/pmo/types.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class Profile extends PMOCommand {
  static description = 'Interactive menu for agent profile operations';

  static aliases = ['profiles'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Profile);

    const jsonMode = shouldOutputJson(flags);

    const menuChoices = [
      { id: 'list', name: 'List all profiles', command: 'prlt profile list --machine' },
      { id: 'show', name: 'View profile details', command: 'prlt profile show --machine' },
      { id: 'create', name: 'Create new profile', command: 'prlt profile create --machine' },
      { id: 'edit', name: 'Edit profile', command: 'prlt profile edit --machine' },
      { id: 'delete', name: 'Delete profile', command: 'prlt profile delete --machine' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'Agent Profiles - What would you like to do?';

    const action = await this.selectFromList({
      message,
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'profile' } : null,
    });

    if (action === 'cancel' || !action) {
      return;
    }

    switch (action) {
      case 'list':
        await this.config.runCommand('profile:list', []);
        break;
      case 'show': {
        const profileId = await this.selectProfile('Select profile to view:');
        if (profileId) {
          await this.config.runCommand('profile:show', [profileId]);
        }
        break;
      }
      case 'create':
        await this.config.runCommand('profile:create', []);
        break;
      case 'edit': {
        const profileId = await this.selectProfile('Select profile to edit:');
        if (profileId) {
          await this.config.runCommand('profile:edit', [profileId]);
        }
        break;
      }
      case 'delete': {
        const profileId = await this.selectProfile('Select profile to delete:');
        if (profileId) {
          await this.config.runCommand('profile:delete', [profileId]);
        }
        break;
      }
    }
  }

  private async selectProfile(message: string): Promise<string | null> {
    const profiles = await this.storage.listProfiles();

    if (profiles.length === 0) {
      this.log('No profiles found. Create one with: prlt profile create');
      return null;
    }

    const { selected } = await this.prompt<{ selected: string }>([{
      type: 'list',
      name: 'selected',
      message,
      choices: [
        ...profiles.map(p => ({
          name: `${p.name} (${p.id})`,
          value: p.id,
        })),
        new inquirer.Separator(),
        { name: 'Cancel', value: null },
      ],
    }], null);

    return selected;
  }
}
