import { Args } from '@oclif/core';
import chalk from 'chalk';
import { PromptCommand } from '../../lib/prompt-command.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { ensureBuiltinThemes } from '../../lib/themes.js';
import { getThemes, getAvailableThemeNames, setActiveTheme, getActiveTheme } from '../../lib/database/index.js';
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';

export default class ThemeSet extends PromptCommand {
  static description = 'Set the active theme for this workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> billionaires',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    theme: Args.string({
      description: 'Theme ID to set as active',
      required: false,
    }),
  };

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ThemeSet);
    const jsonMode = shouldOutputJson(flags);

    try {
      const workspaceInfo = getWorkspaceInfo();
      ensureBuiltinThemes(workspaceInfo.path);

      let themeId = args.theme;

      if (!themeId) {
        const themes = getThemes(workspaceInfo.path);
        const currentTheme = getActiveTheme(workspaceInfo.path);

        const resolver = new FlagResolver({
          commandName: 'theme set',
          baseCommand: 'prlt theme set',
          jsonMode,
          flags,
        });

        resolver.addPrompt({
          flagName: 'theme',
          type: 'list',
          message: 'Select theme for this workspace:',
          choices: () => themes.map(t => {
            const availableCount = getAvailableThemeNames(workspaceInfo.path, t.id).length;
            const isCurrent = currentTheme?.id === t.id;
            return {
              name: `${t.display_name} (${availableCount} available)${isCurrent ? ' [current]' : ''}`,
              value: t.id,
            };
          }),
        });

        const resolved = await resolver.resolve();
        themeId = (resolved as Record<string, unknown>).theme as string;
      }

      setActiveTheme(workspaceInfo.path, themeId!);

      const themes = getThemes(workspaceInfo.path);
      const theme = themes.find(t => t.id === themeId);

      this.log(chalk.green(`\n✓ Active theme set to: ${theme?.display_name || themeId}`));
      this.log(chalk.dim('  New agents will be selected from this theme.'));

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }
}
