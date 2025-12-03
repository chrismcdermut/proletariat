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
import { promptForTheme } from '../lib/themes/index.js';

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

      // Step 2: Choose theme
      const theme = await promptForTheme();

      // Step 3: Choose location
      const workspacePath = await promptForWorkspaceLocation(theme);

      // Step 4: Add agents
      const selectedAgents = await promptForAgents(theme);

      // Create workspace
      await createWorkspaceOnly(theme, selectedAgents, workspacePath);

      // Show next steps
      const options = { workspaceType, theme, selectedAgents };
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

      // Step 5: Choose theme
      const theme = await promptForTheme();

      // Step 6: Add agents
      const selectedAgents = await promptForAgents(theme);

      // Step 7: Add repositories
      const repos = await promptForRepositories(process.cwd(), []);

      // Step 8: PMO setup (uses shared prompt from lib/pmo)
      // Pass hqPath so it can detect repos and offer location choices
      // Pass hqName so default board name is {hqname}-kanban
      const pmoSetup = await promptForPMOSetup(hqPath, hqName);

      // Create the options object
      const options = {
        workspaceType,
        hqName,
        hqPath,
        theme,
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