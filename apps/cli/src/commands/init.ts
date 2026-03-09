import { Command } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs';
import {
  ensureMachineConfigDir,
  getMachineConfigDir,
  getMachineConfigPath,
  readMachineConfig,
  writeMachineConfig,
  getRegisteredHeadquarters,
} from '../lib/machine-config.js';
import { isValidHQ } from '../lib/workspace.js';
import { machineOutputFlags } from '../lib/pmo/index.js';
import { shouldOutputJson } from '../lib/prompt-json.js';

export default class Init extends Command {
  static description = 'Initialize machine-level Proletariat configuration (~/.proletariat)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);
    const jsonMode = shouldOutputJson(flags);

    // Step 1: Ensure machine config directory exists
    ensureMachineConfigDir();

    // Step 2: Ensure machine config file exists with valid structure
    const configPath = getMachineConfigPath();
    const config = readMachineConfig();

    const configExists = fs.existsSync(configPath);
    if (!configExists) {
      // Write fresh config if none exists
      writeMachineConfig(config);
    }

    // Step 3: Prune stale headquarters entries (paths that no longer exist)
    const originalCount = config.headquarters.length;
    config.headquarters = config.headquarters.filter(hq => {
      if (!fs.existsSync(hq.path)) return false;
      if (!isValidHQ(hq.path)) return false;
      return true;
    });
    const prunedCount = originalCount - config.headquarters.length;

    // Clear active HQ if it was pruned
    if (config.activeHeadquarters && !config.headquarters.some(hq => hq.path === config.activeHeadquarters)) {
      config.activeHeadquarters = null;
    }

    if (prunedCount > 0) {
      writeMachineConfig(config);
    }

    // Output results
    if (jsonMode) {
      this.outputJson({
        success: true,
        configDir: getMachineConfigDir(),
        configPath,
        headquarters: config.headquarters.length,
        prunedStaleEntries: prunedCount,
        activeHeadquarters: config.activeHeadquarters,
      });
    } else {
      console.log(chalk.green('Machine configuration initialized.'));
      console.log(chalk.gray(`  Config: ${configPath}`));
      console.log(chalk.gray(`  Registered HQs: ${config.headquarters.length}`));
      if (prunedCount > 0) {
        console.log(chalk.yellow(`  Pruned ${prunedCount} stale HQ entries`));
      }
      if (config.headquarters.length === 0) {
        console.log(chalk.blue('\nNo headquarters found. Create one with:'));
        console.log(chalk.yellow('  prlt new'));
      }
    }
  }

  private outputJson(data: Record<string, unknown>): void {
    console.log(JSON.stringify(data, null, 2));
  }
}
