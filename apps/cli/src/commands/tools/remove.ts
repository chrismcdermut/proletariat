import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { findHQRoot } from '../../lib/workspace.js';
import { loadToolRegistry, removeTool, getAllToolNames, ensureBuiltinTools } from '../../lib/tools/index.js';
import { styles } from '../../lib/styles.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class ToolsRemove extends Command {
  static description = 'Remove a tool from the registry';

  static examples = [
    '<%= config.bin %> tools remove arcade',
    '<%= config.bin %> tools remove ffmpeg',
  ];

  static args = {
    name: Args.string({
      description: 'Name of the tool to remove',
      required: false,
    }),
  };

  static flags = {
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
    const { args, flags } = await this.parse(ToolsRemove);

    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in a prlt workspace. Run `prlt new` or `prlt init` first.');
    }

    const jsonMode = shouldOutputJson(flags);
    const registry = ensureBuiltinTools(loadToolRegistry(hqPath));

    let name = args.name;

    if (!name) {
      if (jsonMode) {
        this.error('Name argument is required in JSON mode');
      }

      const allNames = getAllToolNames(registry);
      const removableNames = allNames.filter(n => {
        const cliEntry = registry['cli-tools']?.[n];
        return !cliEntry?.builtin;
      });

      if (removableNames.length === 0) {
        this.log(styles.muted('\nNo removable tools registered.\n'));
        return;
      }

      const response = await inquirer.prompt([{
        type: 'list',
        name: 'name',
        message: 'Select tool to remove:',
        choices: [
          ...removableNames.map(n => {
            const isMcp = !!registry['mcp-servers']?.[n];
            return { name: `${n} (${isMcp ? 'MCP' : 'CLI'})`, value: n };
          }),
          { name: 'Cancel', value: null },
        ],
      }]);

      if (!response.name) return;
      name = response.name;
    }

    const result = removeTool(hqPath, name!);

    if (!result.removed) {
      const cliEntry = registry['cli-tools']?.[name!];
      if (cliEntry?.builtin) {
        if (jsonMode) {
          this.log(JSON.stringify({ success: false, error: `'${name}' is a built-in tool and cannot be removed` }, null, 2));
        } else {
          this.log(`\n${styles.error(`Cannot remove '${name}' — it is a built-in tool.`)}\n`);
        }
      } else {
        if (jsonMode) {
          this.log(JSON.stringify({ success: false, error: `Tool '${name}' not found` }, null, 2));
        } else {
          this.log(`\n${styles.error(`Tool '${name}' not found in registry.`)}\n`);
        }
      }
      return;
    }

    if (jsonMode) {
      this.log(JSON.stringify({ success: true, name, type: result.type }, null, 2));
    } else {
      this.log(`\n${styles.success(`Removed ${result.type === 'mcp' ? 'MCP server' : 'CLI tool'} '${name}'.`)}\n`);
    }
  }
}
