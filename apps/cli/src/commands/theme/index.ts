
import inquirer from 'inquirer';
import chalk from 'chalk';
import { PromptCommand } from '../../lib/prompt-command.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { ensureBuiltinThemes } from '../../lib/themes.js';
import { getThemes, getAvailableThemeNames } from '../../lib/database/index.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';

export default class Theme extends PromptCommand {
  static description = 'Manage agent naming themes';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> create greek-gods',
    '<%= config.bin %> <%= command.id %> add-names greek-gods zeus athena',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Theme);
    const jsonMode = shouldOutputJson(flags);

    const menuChoices = [
      { name: 'List themes', value: 'list', command: 'prlt theme list --format json' },
      { name: 'Create a new theme', value: 'create', command: 'prlt theme create --machine' },
      { name: 'Add names to a theme', value: 'add-names', command: 'prlt theme add-names --machine' },
      { name: 'Cancel', value: 'cancel', command: '' },
    ];

    const resolver = new FlagResolver({
      commandName: 'theme',
      baseCommand: 'prlt theme',
      jsonMode,
      flags,
    });

    resolver.addPrompt({
      flagName: 'action',
      type: 'list',
      message: 'What would you like to do?',
      choices: () => menuChoices,
      skipAutoCommand: true,
    });

    if (!jsonMode) {
      this.log(chalk.bold('\nAgent Themes'));
      this.log(chalk.dim('Optional themed name pools for your agents.\n'));
    }

    const resolved = await resolver.resolve();
    const action = (resolved as Record<string, unknown>).action as string;

    if (action === 'cancel') {
      this.log(chalk.dim('Cancelled.'));
      return;
    }

    try {
      switch (action) {
        case 'list': {
          const { default: ListCommand } = await import('./list.js');
          const cmd = new ListCommand([], this.config);
          await cmd.run();
          break;
        }
        case 'create': {
          // Prompt for theme name interactively
          const { themeName } = await this.prompt<{ themeName: string }>([{
            type: 'input',
            name: 'themeName',
            message: 'Theme name:',
            validate: (input: unknown) => {
              if (!(input as string).trim()) return 'Theme name is required';
              return true;
            }
          }], null);
          // Normalize: lowercase, spaces to dashes
          const normalized = themeName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          if (themeName.trim() !== normalized) {
            this.log(chalk.blue(`Normalized: ${themeName.trim()} → ${normalized}`));
          }
          const { default: CreateCommand } = await import('./create.js');
          const cmd = new CreateCommand([normalized], this.config);
          await cmd.run();

          // Prompt to add names immediately
          const { addNamesNow } = await this.prompt<{ addNamesNow: boolean }>([{
            type: 'list',
            name: 'addNamesNow',
            message: 'Add names to this theme now?',
            choices: [
              { name: 'Yes', value: true },
              { name: 'No', value: false },
            ],
          }], null);

          if (addNamesNow) {
            const { names } = await this.prompt<{ names: string }>([{
              type: 'input',
              name: 'names',
              message: 'Enter names (space-separated):',
              validate: (input: unknown) => (input as string).trim() ? true : 'At least one name is required'
            }], null);
            const args = [normalized, ...names.trim().split(/\s+/)];
            const { default: AddNamesCommand } = await import('./add-names.js');
            const addCmd = new AddNamesCommand(args, this.config);
            await addCmd.run();
          }
          break;
        }
        case 'add-names': {
          // Get available themes and show a selection list
          const workspaceInfo = getWorkspaceInfo();
          ensureBuiltinThemes(workspaceInfo.path);
          const themes = getThemes(workspaceInfo.path);

          if (themes.length === 0) {
            this.log(chalk.yellow('No themes found. Create one first.'));
            return;
          }

          // Build choices with theme info
          const themeChoices = themes.map(t => {
            const availableNames = getAvailableThemeNames(workspaceInfo.path, t.id);
            const builtinTag = t.builtin ? chalk.dim(' [built-in]') : '';
            return {
              name: `${t.display_name}${builtinTag} ${chalk.dim(`(${availableNames.length} names available)`)}`,
              value: t.id
            };
          });

          // Add option to create new theme (using type assertion for mixed array)
          (themeChoices as Array<{ name: string; value: string } | inquirer.Separator>).push(new inquirer.Separator());
          themeChoices.push({ name: chalk.green('+ Create new theme'), value: '__create_new__' });

          const { selectedTheme } = await this.prompt<{ selectedTheme: string }>([{
            type: 'list',
            name: 'selectedTheme',
            message: 'Select theme to add names to:',
            choices: themeChoices
          }], null);

          // If they want to create a new theme first
          if (selectedTheme === '__create_new__') {
            const { themeName } = await this.prompt<{ themeName: string }>([{
              type: 'input',
              name: 'themeName',
              message: 'Theme name:',
              validate: (input: unknown) => {
                if (!(input as string).trim()) return 'Theme name is required';
                return true;
              }
            }], null);
            // Normalize: lowercase, spaces to dashes
            const normalizedTheme = themeName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            if (themeName.trim() !== normalizedTheme) {
              this.log(chalk.blue(`Normalized: ${themeName.trim()} → ${normalizedTheme}`));
            }
            const { default: CreateCommand } = await import('./create.js');
            const createCmd = new CreateCommand([normalizedTheme], this.config);
            await createCmd.run();

            // Now prompt for names to add to the new theme
            const { names } = await this.prompt<{ names: string }>([{
              type: 'input',
              name: 'names',
              message: 'Names to add (space-separated):',
              validate: (input: unknown) => (input as string).trim() ? true : 'At least one name is required'
            }], null);
            const args = [normalizedTheme, ...names.trim().split(/\s+/)];
            const { default: AddNamesCommand } = await import('./add-names.js');
            const cmd = new AddNamesCommand(args, this.config);
            await cmd.run();
          } else {
            // Prompt for names to add
            const { names } = await this.prompt<{ names: string }>([{
              type: 'input',
              name: 'names',
              message: 'Names to add (space-separated):',
              validate: (input: unknown) => (input as string).trim() ? true : 'At least one name is required'
            }], null);
            const args = [selectedTheme, ...names.trim().split(/\s+/)];
            const { default: AddNamesCommand } = await import('./add-names.js');
            const cmd = new AddNamesCommand(args, this.config);
            await cmd.run();
          }
          break;
        }
        default:
          this.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
