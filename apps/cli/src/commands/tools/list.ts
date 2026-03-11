import { Command, Flags } from '@oclif/core';
import { findHQRoot } from '../../lib/workspace.js';
import { loadToolRegistry, ensureBuiltinTools } from '../../lib/tools/index.js';
import { checkToolAvailability } from '../../lib/tools/detect.js';
import { styles } from '../../lib/styles.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class ToolsList extends Command {
  static description = 'List all registered MCP servers and CLI tools';

  static examples = [
    '<%= config.bin %> tools list',
    '<%= config.bin %> tools list --json',
  ];

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
    const { flags } = await this.parse(ToolsList);

    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in a prlt workspace. Run `prlt new` or `prlt init` first.');
    }

    const registry = ensureBuiltinTools(loadToolRegistry(hqPath));
    const mcpServers = registry['mcp-servers'] ?? {};
    const cliTools = registry['cli-tools'] ?? {};

    if (shouldOutputJson(flags)) {
      const result = {
        mcpServers: Object.entries(mcpServers).map(([name, entry]) => ({
          name,
          ...entry,
        })),
        cliTools: Object.entries(cliTools).map(([name, entry]) => ({
          name,
          ...entry,
          available: checkToolAvailability(entry),
        })),
      };
      this.log(JSON.stringify(result, null, 2));
      return;
    }

    const mcpCount = Object.keys(mcpServers).length;
    const cliCount = Object.keys(cliTools).length;

    if (mcpCount === 0 && cliCount === 0) {
      this.log(styles.muted('\nNo tools registered. Use `prlt tools add` or `prlt tools detect` to get started.\n'));
      return;
    }

    this.log(`\n${styles.emphasis('Tool Registry')}`);
    this.log('='.repeat(60));

    if (mcpCount > 0) {
      this.log(`\n${styles.emphasis('MCP Servers')} (${mcpCount})`);
      this.log('-'.repeat(40));
      for (const [name, entry] of Object.entries(mcpServers)) {
        const desc = entry.description ? ` - ${entry.description}` : '';
        const type = entry.url ? `url: ${entry.url}` : entry.command ? `cmd: ${entry.command}` : 'unconfigured';
        this.log(`  ${styles.emphasis(name)}${styles.muted(desc)}`);
        this.log(`    ${styles.muted(type)}`);
        if (entry.auth) {
          this.log(`    ${styles.muted(`auth: ${entry.auth}`)}`);
        }
      }
    }

    if (cliCount > 0) {
      this.log(`\n${styles.emphasis('CLI Tools')} (${cliCount})`);
      this.log('-'.repeat(40));
      for (const [name, entry] of Object.entries(cliTools)) {
        const available = checkToolAvailability(entry);
        const status = available ? styles.success('available') : styles.error('not found');
        const desc = entry.description ? ` - ${entry.description}` : '';
        const builtin = entry.builtin ? styles.muted(' [built-in]') : '';
        this.log(`  ${styles.emphasis(name)}${styles.muted(desc)}${builtin}`);
        this.log(`    ${status}`);
      }
    }

    this.log('');
  }
}
