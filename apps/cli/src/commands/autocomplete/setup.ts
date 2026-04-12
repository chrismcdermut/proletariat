import { Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import chalk from 'chalk';
import { PromptCommand } from '../../lib/prompt-command.js';
import { machineOutputFlags } from '../../lib/pmo/base-command.js';
import {
  isAgentMode,
  outputPromptAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

type ShellType = 'zsh' | 'bash' | 'powershell' | 'unknown';

const SUPPORTED_SHELLS: Array<'zsh' | 'bash' | 'powershell'> = ['zsh', 'bash', 'powershell'];

export default class AutocompleteSetup extends PromptCommand {
  static description = 'Auto-detect shell and set up autocomplete';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --install',
    '<%= config.bin %> <%= command.id %> --shell zsh',
    '<%= config.bin %> <%= command.id %> --shell zsh --install --machine',
  ];

  static flags = {
    ...machineOutputFlags,
    install: Flags.boolean({
      char: 'i',
      description: 'Automatically install to shell config file',
      default: false,
    }),
    shell: Flags.string({
      char: 's',
      description: 'Override shell detection (zsh, bash, powershell)',
      options: ['zsh', 'bash', 'powershell'],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AutocompleteSetup);
    const jsonMode = isAgentMode(flags);
    const jsonModeConfig = jsonMode ? { flags, commandName: 'autocomplete setup' } : null;

    // If --shell flag provided, skip detection and proceed directly
    if (flags.shell) {
      const shell = flags.shell as ShellType;

      if (jsonModeConfig) {
        // JSON mode with --shell: perform action and output success
        return this.handleJsonModeWithShell(shell, flags.install, jsonModeConfig);
      }

      // Interactive mode with --shell: original behavior
      this.log(chalk.cyan(`Shell: ${shell}`));
      this.log('');

      const { configFile, snippet } = this.getShellConfig(shell);
      if (flags.install) {
        await this.installAutocomplete(shell, configFile, snippet);
      } else {
        this.showInstructions(shell, configFile, snippet);
      }
      return;
    }

    // No --shell flag: detect shell
    const detectedShell = this.detectShell();

    // JSON mode without --shell: always output shell selection prompt
    if (jsonModeConfig) {
      const choices = SUPPORTED_SHELLS.map(s => ({
        name: s === detectedShell ? `${s} (detected)` : s,
        value: s,
        command: `prlt autocomplete setup --shell ${s} --install --machine`,
      }));

      outputPromptAsJson(
        {
          type: 'list',
          name: 'shell',
          message: 'Select shell for autocomplete setup:',
          choices,
          default: detectedShell !== 'unknown' ? detectedShell : undefined,
        },
        createMetadata(jsonModeConfig.commandName, jsonModeConfig.flags)
      );
      return;
    }

    // Interactive mode without --shell
    if (detectedShell === 'unknown') {
      // Shell not detected: prompt user to select
      const { selectedShell } = await this.prompt<{ selectedShell: string }>([{
        type: 'list',
        name: 'selectedShell',
        message: 'Could not detect shell. Select your shell:',
        choices: SUPPORTED_SHELLS.map(s => ({ name: s, value: s })),
      }], null);

      this.log('');
      const shell = selectedShell as ShellType;
      const { configFile, snippet } = this.getShellConfig(shell);
      if (flags.install) {
        await this.installAutocomplete(shell, configFile, snippet);
      } else {
        this.showInstructions(shell, configFile, snippet);
      }
      return;
    }

    // Shell detected: proceed with original behavior
    this.log(chalk.cyan(`Detected shell: ${detectedShell}`));
    this.log('');

    const { configFile, snippet } = this.getShellConfig(detectedShell);
    if (flags.install) {
      await this.installAutocomplete(detectedShell, configFile, snippet);
    } else {
      this.showInstructions(detectedShell, configFile, snippet);
    }
  }

  /**
   * Handle JSON mode when --shell flag is provided.
   * Performs the install if requested and outputs success JSON.
   */
  private async handleJsonModeWithShell(
    shell: ShellType,
    install: boolean,
    jsonModeConfig: { flags: Record<string, unknown>; commandName: string }
  ): Promise<void> {
    const { configFile, snippet } = this.getShellConfig(shell);

    if (install) {
      const result = await this.doInstallQuiet(shell, configFile, snippet);
      outputSuccessAsJson(
        { shell, configFile, snippet, ...result },
        createMetadata(jsonModeConfig.commandName, jsonModeConfig.flags)
      );
      return;
    }

    // No --install: output config info as success
    outputSuccessAsJson(
      {
        shell,
        configFile,
        snippet,
        installed: false,
        installCommand: `prlt autocomplete setup --shell ${shell} --install`,
      },
      createMetadata(jsonModeConfig.commandName, jsonModeConfig.flags)
    );
    
  }

  /**
   * Perform the actual install without logging (for JSON mode).
   */
  private async doInstallQuiet(
    shell: ShellType,
    configFile: string,
    snippet: string
  ): Promise<{ installed: boolean; alreadyConfigured: boolean }> {
    const configExists = fs.existsSync(configFile);
    if (configExists) {
      const content = fs.readFileSync(configFile, 'utf-8');
      if (content.includes('prlt autocomplete')) {
        return { installed: false, alreadyConfigured: true };
      }
    }

    const configDir = path.dirname(configFile);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const addition = `\n# Proletariat CLI autocomplete\n${snippet}\n`;
    fs.appendFileSync(configFile, addition);

    try {
      await this.config.runCommand('autocomplete', [shell, '--refresh-cache']);
    } catch {
      // Ignore refresh cache errors
    }

    return { installed: true, alreadyConfigured: false };
  }

  private detectShell(): ShellType {
    // Check for PowerShell first (works on all platforms)
    if (process.env.PSModulePath) {
      return 'powershell';
    }

    // Check $SHELL environment variable (Unix/macOS)
    const shellEnv = process.env.SHELL || '';

    if (shellEnv.includes('zsh')) {
      return 'zsh';
    }
    if (shellEnv.includes('bash')) {
      return 'bash';
    }

    // Check $0 or parent process on Windows
    if (process.platform === 'win32') {
      const comspec = process.env.COMSPEC || '';
      if (comspec.toLowerCase().includes('powershell')) {
        return 'powershell';
      }
    }

    // Default based on platform
    if (process.platform === 'darwin') {
      return 'zsh'; // macOS default since Catalina
    }

    return 'unknown';
  }

  private getShellConfig(shell: ShellType): { configFile: string; snippet: string } {
    const home = os.homedir();

    switch (shell) {
      case 'zsh':
        return {
          configFile: path.join(home, '.zshrc'),
          snippet: 'eval "$(prlt autocomplete:script zsh)"',
        };
      case 'bash':
        // Use .bashrc on Linux, .bash_profile on macOS
        const bashConfig = process.platform === 'darwin'
          ? path.join(home, '.bash_profile')
          : path.join(home, '.bashrc');
        return {
          configFile: bashConfig,
          snippet: 'eval "$(prlt autocomplete:script bash)"',
        };
      case 'powershell':
        // PowerShell profile location varies
        const psProfile = process.env.PROFILE ||
          path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
        return {
          configFile: psProfile,
          snippet: 'prlt autocomplete:script powershell | Out-String | Invoke-Expression',
        };
      default:
        return { configFile: '', snippet: '' };
    }
  }

  private showInstructions(shell: ShellType, configFile: string, snippet: string): void {
    this.log(chalk.bold('To enable autocomplete, add this to your shell config:'));
    this.log('');
    this.log(chalk.dim(`  # File: ${configFile}`));
    this.log(chalk.green(`  ${snippet}`));
    this.log('');
    this.log(chalk.dim('Then restart your shell or run:'));

    if (shell === 'powershell') {
      this.log(chalk.cyan(`  . $PROFILE`));
    } else {
      this.log(chalk.cyan(`  source ${configFile}`));
    }

    this.log('');
    this.log(chalk.dim('Or run with --install to add automatically:'));
    this.log(chalk.cyan('  prlt autocomplete setup --install'));
  }

  private async installAutocomplete(
    shell: ShellType,
    configFile: string,
    snippet: string
  ): Promise<void> {
    // Check if config file exists
    const configExists = fs.existsSync(configFile);

    if (configExists) {
      // Check if already installed
      const content = fs.readFileSync(configFile, 'utf-8');
      if (content.includes('prlt autocomplete')) {
        this.log(chalk.yellow('Autocomplete already configured in ' + configFile));
        return;
      }
    }

    // Create directory if needed (for PowerShell profile)
    const configDir = path.dirname(configFile);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Append to config file
    const addition = `\n# Proletariat CLI autocomplete\n${snippet}\n`;
    fs.appendFileSync(configFile, addition);

    this.log(chalk.green(`✅ Autocomplete installed to ${configFile}`));
    this.log('');
    this.log(chalk.dim('Restart your shell or run:'));

    if (shell === 'powershell') {
      this.log(chalk.cyan(`  . $PROFILE`));
    } else {
      this.log(chalk.cyan(`  source ${configFile}`));
    }

    // Also refresh the autocomplete cache
    this.log('');
    this.log(chalk.dim('Refreshing autocomplete cache...'));

    try {
      await this.config.runCommand('autocomplete', [shell, '--refresh-cache']);
      this.log(chalk.green('✅ Autocomplete cache refreshed'));
    } catch {
      this.log(chalk.dim('Run "prlt autocomplete --refresh-cache" to update completions'));
    }
  }
}
