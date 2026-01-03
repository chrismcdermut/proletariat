import { Command } from '@oclif/core';
import chalk from 'chalk';
import {
  promptForWorkspaceType,
  promptForHQName,
  promptForHQSuffix,
  promptForHQLocation,
  promptForWorkspaceLocation,
  initializeHQ,
  createWorkspaceOnly,
  showNextSteps
} from '../lib/init/index.js';
import { promptForAgents } from '../lib/agents/index.js';
import { promptForRepositories } from '../lib/repos/index.js';
import { promptForPMOSetup } from '../lib/pmo/index.js';

export default class Init extends Command {
  static description = 'Initialize an HQ (headquarters) for managing repositories, agents, and projects';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    console.log(chalk.blue('🚀 Welcome to Proletariat...\n'));

    // Step 1: Choose workspace type
    const workspaceType = await promptForWorkspaceType();

    if (workspaceType === 'workspace-only') {
      // Simplified workspace-only flow
      console.log(chalk.blue('\n🔧 Setting up workspace...\n'));

      // Step 2: Choose location
      const workspacePath = await promptForWorkspaceLocation();

      // Step 3: Add agents
      const selectedAgents = await promptForAgents();

      // Create workspace
      await createWorkspaceOnly(selectedAgents, workspacePath);

      // Show next steps
      const options = { workspaceType, selectedAgents };
      await showNextSteps(options, workspacePath);

    } else {
      // Full HQ flow
      console.log(chalk.blue('\n🏢 Setting up workspace...\n'));

      // Step 2: Get HQ name
      const hqName = await promptForHQName();

      // Step 3: Ask about suffix
      const addSuffix = await promptForHQSuffix();

      // Step 4: Determine location
      const hqPath = await promptForHQLocation(hqName, addSuffix);

      // Step 5: Add agents
      const selectedAgents = await promptForAgents();

      // Step 6: Add repositories
      const repos = await promptForRepositories(process.cwd(), []);

      // Step 7: PMO setup (uses shared prompt from lib/pmo)
      // Pass hqPath so it can detect repos and offer location choices
      // Pass hqName so default board name is {hqname}-kanban
      const pmoSetup = await promptForPMOSetup(hqPath, hqName);

      // Create the options object
      const options = {
        workspaceType,
        hqName,
        hqPath,
        addSuffix,
        selectedAgents,
        repos,
        pmoSetup,
      };

      // Initialize the HQ
      await initializeHQ(options);

      // Show next steps
      await showNextSteps(options);
    }
  }
}