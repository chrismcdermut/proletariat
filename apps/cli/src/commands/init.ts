import { Command } from '@oclif/core';
import chalk from 'chalk';
import {
  promptForHQName,
  promptForHQSuffix,
  promptForHQLocation,
  initializeHQ,
  showNextSteps
} from '../lib/init/index.js';
import { promptForAgentsWithTheme } from '../lib/agents/index.js';
import { promptForRepositories } from '../lib/repos/index.js';
import { promptForPMOSetup } from '../lib/pmo/index.js';

export default class Init extends Command {
  static description = 'Initialize an HQ (headquarters) for managing repositories, agents, and projects';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    console.log(chalk.blue('🚀 Welcome to Proletariat...\n'));
    console.log(chalk.blue('🏢 Setting up your headquarters...\n'));

    // Step 1: Get HQ name
    const hqName = await promptForHQName();

    // Step 2: Ask about suffix
    const addSuffix = await promptForHQSuffix();

    // Step 3: Determine location
    const hqPath = await promptForHQLocation(hqName, addSuffix);

    // Step 4: Add agents (with theme options)
    const agentResult = await promptForAgentsWithTheme();

    // Step 5: Add repositories
    const repos = await promptForRepositories(process.cwd(), []);

    // Step 6: PMO setup (uses shared prompt from lib/pmo)
    // Pass hqPath so it can detect repos and offer location choices
    // Pass hqName so default board name is {hqname}-kanban
    const pmoSetup = await promptForPMOSetup(hqPath, hqName);

    // Create the options object
    const options = {
      workspaceType: 'hq' as const,
      hqName,
      hqPath,
      addSuffix,
      selectedAgents: agentResult.agents,
      repos,
      pmoSetup,
      themeId: agentResult.themeId,
      customTheme: agentResult.customTheme,
    };

    // Initialize the HQ
    await initializeHQ(options);

    // Show next steps
    await showNextSteps(options);
  }
}