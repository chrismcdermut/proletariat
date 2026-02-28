import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class LabelIndex extends PMOCommand {
  static description = 'Manage labels and label groups';

  static aliases = ['labels'];

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> label list',
    '<%= config.bin %> label create my-label',
    '<%= config.bin %> label group list',
  ];

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(LabelIndex);
    const jsonMode = shouldOutputJson(flags);

    const menuChoices = [
      { id: 'list', name: 'List all labels', command: 'prlt label list' },
      { id: 'create', name: 'Create new label', command: 'prlt label create' },
      { id: 'delete', name: 'Delete label', command: 'prlt label delete' },
      { id: 'groups', name: 'List label groups', command: 'prlt label group list' },
      { id: 'create-group', name: 'Create label group', command: 'prlt label group create' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];

    const action = await this.selectFromList({
      message: 'Labels - What would you like to do?',
      items: menuChoices,
      getName: (c) => c.name,
      getValue: (c) => c.id,
      getCommand: (c) => c.command,
      jsonMode: jsonMode ? { flags, commandName: 'label' } : null,
    });

    if (action === 'cancel' || !action) {
      return;
    }

    switch (action) {
      case 'list':
        await this.config.runCommand('label:list');
        break;
      case 'create':
        await this.config.runCommand('label:create');
        break;
      case 'delete':
        await this.config.runCommand('label:delete');
        break;
      case 'groups':
        await this.config.runCommand('label:group:list');
        break;
      case 'create-group':
        await this.config.runCommand('label:group:create');
        break;
    }
  }
}
