import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { findHQRoot } from '../../lib/workspace.js';
import { loadToolRegistry, addCliTool, ensureBuiltinTools } from '../../lib/tools/index.js';
import { detectAvailableTools } from '../../lib/tools/detect.js';
import { styles } from '../../lib/styles.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class ToolsDetect extends Command {
  static description = 'Auto-detect common CLI tools on the system and register them';

  static examples = [
    '<%= config.bin %> tools detect',
    '<%= config.bin %> tools detect --auto',
    '<%= config.bin %> tools detect --json',
  ];

  static flags = {
    auto: Flags.boolean({
      description: 'Automatically register all detected tools without prompting',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
    machine: Flags.boolean({
      char: 'm',
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ToolsDetect);

    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in a prlt workspace. Run `prlt new` or `prlt init` first.');
    }

    const jsonMode = shouldOutputJson(flags);
    const registry = ensureBuiltinTools(loadToolRegistry(hqPath));
    const existingCli = Object.keys(registry['cli-tools'] ?? {});

    const detected = detectAvailableTools();
    const availableTools = Object.entries(detected)
      .filter(([, entry]) => entry.available)
      .filter(([name]) => !existingCli.includes(name));

    if (jsonMode) {
      this.log(JSON.stringify({
        detected: Object.entries(detected).map(([name, entry]) => ({
          name,
          ...entry,
          alreadyRegistered: existingCli.includes(name),
        })),
        newAvailable: availableTools.map(([name]) => name),
      }, null, 2));

      if (flags.auto) {
        for (const [name, entry] of availableTools) {
          const { available: _, ...cleanEntry } = entry;
          addCliTool(hqPath, name, cleanEntry);
        }
        this.log(JSON.stringify({ registered: availableTools.map(([name]) => name) }, null, 2));
      }
      return;
    }

    this.log(`\n${styles.emphasis('CLI Tool Detection')}`);
    this.log('='.repeat(60));

    const allDetected = Object.entries(detected);

    for (const [name, entry] of allDetected) {
      const status = entry.available ? styles.success('found') : styles.muted('not found');
      const alreadyReg = existingCli.includes(name) ? styles.muted(' [already registered]') : '';
      const desc = entry.description ? ` - ${entry.description}` : '';
      this.log(`  ${status}  ${name}${styles.muted(desc)}${alreadyReg}`);
    }

    if (availableTools.length === 0) {
      this.log(styles.muted('\nNo new tools to register.\n'));
      return;
    }

    this.log('');

    if (flags.auto) {
      for (const [name, entry] of availableTools) {
        const { available: _, ...cleanEntry } = entry;
        addCliTool(hqPath, name, cleanEntry);
        this.log(styles.success(`  Registered: ${name}`));
      }
      this.log('');
      return;
    }

    // Prompt user to select which tools to register
    const { selectedTools } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedTools',
      message: 'Select tools to register:',
      choices: availableTools.map(([name, entry]) => ({
        name: `${name}${entry.description ? ` - ${entry.description}` : ''}`,
        value: name,
        checked: true,
      })),
    }]);

    if (selectedTools.length === 0) {
      this.log(styles.muted('\nNo tools selected.\n'));
      return;
    }

    for (const name of selectedTools) {
      const entry = detected[name];
      const { available: _, ...cleanEntry } = entry;
      addCliTool(hqPath, name, cleanEntry);
      this.log(styles.success(`  Registered: ${name}`));
    }

    this.log(`\n${styles.success(`${selectedTools.length} tool(s) registered.`)}\n`);
  }
}
