import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { getWorkspaceInfo } from '../../../lib/agents/commands.js';
import { ensureBuiltinThemes } from '../../../lib/themes.js';
import { getThemes, getAvailableThemeNames } from '../../../lib/database/index.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js';

export default class Themes extends Command {
  static description = 'Manage agent naming themes';

  static examples = [
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> create greek-gods',
    '<%= config.bin %> <%= command.id %> add-names greek-gods zeus athena',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Themes);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Define choices once, use for both JSON and interactive modes
    // Each choice includes the full command for AI agents to execute
    const menuChoices = [
      { id: 'list', name: 'List themes', command: 'prlt agent themes list --format json' },
      { id: 'create', name: 'Create a new theme', command: 'prlt agent themes create --json' },
      { id: 'add-names', name: 'Add names to a theme', command: 'prlt agent themes add-names --json' },
      { id: 'cancel', name: 'Cancel', command: '' },
    ];
    const message = 'What would you like to do?';

    // In JSON mode, output menu prompt with commands for AI agents
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'action', message, menuChoices.map(c => ({
          name: c.name,
          value: c.id,
          command: c.command,
        }))),
        createMetadata('agent themes', flags)
      );
      return;
    }

    this.log(chalk.bold('\nAgent Themes'));
    this.log(chalk.dim('Optional themed name pools for your agents.\n'));

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message,
      choices: [
        ...menuChoices.slice(0, 3).map(c => ({ name: c.name, value: c.id })),
        new inquirer.Separator(),
        { name: menuChoices[3].name, value: menuChoices[3].id }
      ]
    }]);

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
          const { themeName } = await inquirer.prompt([{
            type: 'input',
            name: 'themeName',
            message: 'Theme name:',
            validate: (input: string) => {
              if (!input.trim()) return 'Theme name is required';
              return true;
            }
          }]);
          // Normalize: lowercase, spaces to dashes
          const normalized = themeName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          if (themeName.trim() !== normalized) {
            this.log(chalk.blue(`Normalized: ${themeName.trim()} → ${normalized}`));
          }
          const { default: CreateCommand } = await import('./create.js');
          const cmd = new CreateCommand([normalized], this.config);
          await cmd.run();

          // Prompt to add names immediately
          const { addNamesNow } = await inquirer.prompt([{
            type: 'list',
            name: 'addNamesNow',
            message: 'Add names to this theme now?',
            choices: [
              { name: 'Yes', value: true },
              { name: 'No', value: false },
            ],
          }]);

          if (addNamesNow) {
            const { names } = await inquirer.prompt([{
              type: 'input',
              name: 'names',
              message: 'Enter names (space-separated):',
              validate: (input: string) => input.trim() ? true : 'At least one name is required'
            }]);
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

          const { selectedTheme } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedTheme',
            message: 'Select theme to add names to:',
            choices: themeChoices
          }]);

          // If they want to create a new theme first
          if (selectedTheme === '__create_new__') {
            const { themeName } = await inquirer.prompt([{
              type: 'input',
              name: 'themeName',
              message: 'Theme name:',
              validate: (input: string) => {
                if (!input.trim()) return 'Theme name is required';
                return true;
              }
            }]);
            // Normalize: lowercase, spaces to dashes
            const normalizedTheme = themeName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            if (themeName.trim() !== normalizedTheme) {
              this.log(chalk.blue(`Normalized: ${themeName.trim()} → ${normalizedTheme}`));
            }
            const { default: CreateCommand } = await import('./create.js');
            const createCmd = new CreateCommand([normalizedTheme], this.config);
            await createCmd.run();

            // Now prompt for names to add to the new theme
            const { names } = await inquirer.prompt([{
              type: 'input',
              name: 'names',
              message: 'Names to add (space-separated):',
              validate: (input: string) => input.trim() ? true : 'At least one name is required'
            }]);
            const args = [normalizedTheme, ...names.trim().split(/\s+/)];
            const { default: AddNamesCommand } = await import('./add-names.js');
            const cmd = new AddNamesCommand(args, this.config);
            await cmd.run();
          } else {
            // Prompt for names to add
            const { names } = await inquirer.prompt([{
              type: 'input',
              name: 'names',
              message: 'Names to add (space-separated):',
              validate: (input: string) => input.trim() ? true : 'At least one name is required'
            }]);
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
