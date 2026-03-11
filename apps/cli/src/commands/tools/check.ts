import { Command, Flags } from '@oclif/core';
import { findHQRoot } from '../../lib/workspace.js';
import { loadToolRegistry, ensureBuiltinTools, checkRegisteredTools } from '../../lib/tools/index.js';
import { styles } from '../../lib/styles.js';
import { shouldOutputJson } from '../../lib/prompt-json.js';

export default class ToolsCheck extends Command {
  static description = 'Verify all registered tools are available and healthy';

  static examples = [
    '<%= config.bin %> tools check',
    '<%= config.bin %> tools check --json',
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
    const { flags } = await this.parse(ToolsCheck);

    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in a prlt workspace. Run `prlt new` or `prlt init` first.');
    }

    const jsonMode = shouldOutputJson(flags);
    const registry = ensureBuiltinTools(loadToolRegistry(hqPath));

    const results = checkRegisteredTools(
      registry['mcp-servers'] ?? {},
      registry['cli-tools'] ?? {},
    );

    if (jsonMode) {
      this.log(JSON.stringify({ results }, null, 2));
      return;
    }

    if (results.length === 0) {
      this.log(styles.muted('\nNo tools registered. Use `prlt tools add` or `prlt tools detect` to get started.\n'));
      return;
    }

    this.log(`\n${styles.emphasis('Tool Health Check')}`);
    this.log('='.repeat(60));

    let okCount = 0;
    let missingCount = 0;
    let unknownCount = 0;

    for (const result of results) {
      const typeLabel = result.type === 'mcp' ? 'MCP' : 'CLI';
      let statusIcon: string;
      switch (result.status) {
        case 'ok':
          statusIcon = styles.success('OK');
          okCount++;
          break;
        case 'missing':
          statusIcon = styles.error('MISSING');
          missingCount++;
          break;
        default:
          statusIcon = styles.warning('UNKNOWN');
          unknownCount++;
      }

      this.log(`  ${statusIcon}  ${result.name} ${styles.muted(`(${typeLabel})`)}`);
      if (result.detail) {
        this.log(`       ${styles.muted(result.detail)}`);
      }
    }

    this.log('');
    this.log(`${styles.emphasis('Summary:')} ${okCount} ok, ${missingCount} missing, ${unknownCount} unknown`);
    this.log('');
  }
}
