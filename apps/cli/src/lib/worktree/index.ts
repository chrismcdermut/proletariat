import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { getAllThemes, getThemeNames, isValidTheme } from '../themes/index.js';
import { 
  getProjectName,
  getProjectRoot,
  resolveWorkspace,
  isInitialized,
  loadConfig,
  saveConfig 
} from '../config/index.js';
import { log, showBanner } from '../utils/logger.js';
import { InitOptions, ProjectConfig, Theme } from '../../types/index.js';

export { repairWorktrees, checkWorktreeHealth } from './repair.js';

export async function initProject(options: InitOptions): Promise<ProjectConfig | void> {
  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  
  if (isInitialized()) {
    log.warning(`Proletariat already initialized for ${projectName}!`);
    const config = loadConfig();
    if (config.theme) {
      showBanner(config.theme);
    }
    return config;
  }
  
  let themeName = options.theme || 'billionaires';
  
  // Interactive theme selection if no theme specified
  if (!options.theme) {
    const themes = getAllThemes();
    const themeChoices = Object.values(themes).map(t => ({
      name: `${t.emoji} ${t.displayName} - ${t.description}`,
      value: t.name
    }));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'theme',
        message: 'Choose your worktree theme:',
        choices: themeChoices
      }
    ]);
    
    themeName = answers.theme;
  }
  
  if (!isValidTheme(themeName)) {
    log.error(`Theme '${themeName}' not found!`);
    log.info(`Available themes: ${getThemeNames().join(', ')}`);
    return;
  }
  
  const themes = getAllThemes();
  const theme = themes[themeName];

  const resolvedOptions = { ...options } as InitOptions;

  if (!resolvedOptions.workspaceRoot && !resolvedOptions.workspace) {
    const { layoutChoice } = await inquirer.prompt([{
      type: 'list',
      name: 'layoutChoice',
      message: 'Where should agent worktrees live?',
      choices: [
        { name: 'Keep them alongside this repo (../project-staff)', value: 'sibling' },
        { name: 'Create a workspace directory to hold everything', value: 'workspace' },
        { name: 'Use a custom path', value: 'custom' }
      ]
    }]);

    if (layoutChoice === 'workspace') {
      const { workspaceName } = await inquirer.prompt([{
        type: 'input',
        name: 'workspaceName',
        message: 'Workspace directory name (tip: use your company or product name):',
        default: `${projectName}-workspace`,
        validate: (input: string) => input.trim().length ? true : 'Please provide a directory name.'
      }]);
      resolvedOptions.workspace = workspaceName.trim();
    } else if (layoutChoice === 'custom') {
      const { workspaceRoot } = await inquirer.prompt([{
        type: 'input',
        name: 'workspaceRoot',
        message: 'Path for agent worktrees (relative or absolute):',
        default: `../${projectName}-staff`,
        validate: (input: string) => input.trim().length ? true : 'Please provide a path.'
      }]);
      resolvedOptions.workspaceRoot = workspaceRoot.trim();
    }
  }

  const { workspaceDir, layout } = resolveWorkspace(theme, resolvedOptions);

  const configData: ProjectConfig = {
    version: '2.0.0',
    projectName,
    themeName: theme.name,
    workspaceDir,
    activeAgents: [],
    initialized: new Date().toISOString(),
    layout
  };

  saveConfig(configData);

  showBanner(theme);
  log.theme(theme, `Initializing ${projectName} with ${theme.displayName} theme...`);

  if (layout.mode === 'workspace' && !fs.existsSync(layout.baseDir)) {
    fs.mkdirSync(layout.baseDir, { recursive: true });
    log.success(`Created workspace directory: ${layout.baseDir}`);
  }

  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
    log.success(`Created workspace: ${workspaceDir}`);
  } else {
    log.info(`Using existing workspace: ${workspaceDir}`);
  }

  if (layout.mode === 'workspace') {
    const targetRepoPath = path.join(layout.baseDir, projectName);
    if (path.resolve(projectRoot) !== path.resolve(targetRepoPath)) {
      log.info(`💡 Recommended: place this repository inside ${targetRepoPath} so your company workspace contains both the source repo and its agents.`);

      const { moveNow } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'moveNow',
          message: `Move the current repository into ${targetRepoPath}?`,
          default: false
        }
      ]);

      if (moveNow) {
        try {
          const status = execSync('git status --porcelain', { cwd: projectRoot, encoding: 'utf8' }).trim();
          if (status.length > 0) {
            log.warning('Cannot move repository: working tree has uncommitted changes. Commit or stash first.');
          } else {
            if (!fs.existsSync(layout.baseDir)) {
              fs.mkdirSync(layout.baseDir, { recursive: true });
            }

            const repoName = path.basename(projectRoot);
            const destination = path.join(layout.baseDir, repoName);

            if (fs.existsSync(destination)) {
              log.error(`Destination ${destination} already exists. Move aborted.`);
            } else {
              fs.renameSync(projectRoot, destination);
              log.success(`Repository moved to ${destination}`);
              log.success('Proletariat initialized!');
              log.info('Please open a new shell and run prlt commands from the moved path.');
              return { ...configData, theme };
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error(`Failed to move repository: ${message}`);
        }
      } else {
        log.info('You can move the repository later; worktrees will still be created in the workspace directory.');
      }
    }
  }

  if (layout.mode === 'custom') {
    log.info(`Custom workspace path in use: ${workspaceDir}`);
  }

  log.success('Proletariat initialized!');
  log.info(`Available agents: ${theme.agents.join(', ')}`);
  log.theme(theme, 'Next steps:');
  console.log(`  prlt ${theme.commands.create} ${theme.agents.slice(0, 2).join(' ')}    # Create worktrees`);
  console.log(`  prlt ${theme.commands.list}                                   # Show status`);
  console.log(`
${chalk.cyan(theme.messages.slogan)}`);
  
  return { ...configData, theme };
}

export async function createWorktrees(agents: string[]): Promise<ProjectConfig | void> {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `prlt init` first.');
    return;
  }
  
  const config = loadConfig();
  const currentTheme = config.theme;
  
  if (!currentTheme) {
    log.error('Theme not found in configuration!');
    return;
  }
  
  if (agents.length === 0) {
    log.error(`Usage: prlt ${currentTheme.commands.create} <agent1> [agent2] ...`);
    log.info(`Available agents: ${currentTheme.agents.join(', ')}`);
    return;
  }
  
  showBanner(currentTheme);
  log.theme(currentTheme, currentTheme.messages.create);
  
  const validAgents = agents.filter(agent => {
    if (!currentTheme.agents.includes(agent)) {
      log.warning(`Agent '${agent}' not available in ${currentTheme.name} theme`);
      return false;
    }
    return true;
  });
  
  if (validAgents.length === 0) {
    log.error('No valid agents specified!');
    return;
  }
  
  for (const agent of validAgents) {
    const agentPath = path.join(config.workspaceDir, agent);
    
    try {
      // Check if worktree already exists
      const worktrees = execSync('git worktree list', { encoding: 'utf8' });
      
      if (worktrees.includes(agentPath)) {
        log.agent(agent, `Already active at ${agentPath}`, currentTheme);
      } else {
        // Create worktree with new branch from main
        const branchName = `${agent}-workspace`;
        execSync(`git worktree add -b "${branchName}" "${agentPath}" main`);
        log.agent(agent, `Ready to work at ${agentPath}`, currentTheme);
        
        // Update config
        if (!config.activeAgents.includes(agent)) {
          config.activeAgents.push(agent);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to create worktree for ${agent}: ${errorMessage}`);
    }
  }
  
  // Save updated config
  saveConfig({
    ...config,
    activeAgents: config.activeAgents
  });
  
  log.theme(currentTheme, `${currentTheme.messages.create} complete!`);
  log.info(`Use 'prlt ${currentTheme.commands.list}' to see all active agents`);
  
  return config;
}

export async function removeWorktrees(agents: string[]): Promise<ProjectConfig | void> {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `prlt init` first.');
    return;
  }
  
  const config = loadConfig();
  const currentTheme = config.theme;
  
  if (!currentTheme) {
    log.error('Theme not found in configuration!');
    return;
  }
  
  if (agents.length === 0) {
    log.error(`Usage: prlt ${currentTheme.commands.remove} <agent1> [agent2] ...`);
    return;
  }
  
  showBanner(currentTheme);
  log.theme(currentTheme, currentTheme.messages.remove);
  
  for (const agent of agents) {
    const agentPath = path.join(config.workspaceDir, agent);
    
    try {
      // Check if worktree exists
      const worktrees = execSync('git worktree list', { encoding: 'utf8' });
      
      if (worktrees.includes(agentPath)) {
        execSync(`git worktree remove "${agentPath}"`);
        log.agent(agent, 'Worktree removed', currentTheme);
        
        // Update config
        config.activeAgents = config.activeAgents.filter(a => a !== agent);
      } else {
        log.warning(`Agent '${agent}' is not active`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to remove worktree for ${agent}: ${errorMessage}`);
    }
  }
  
  // Save updated config
  saveConfig({
    ...config,
    activeAgents: config.activeAgents
  });
  
  log.theme(currentTheme, `${currentTheme.messages.remove} complete!`);
  
  return config;
}

export function showStatus(): ProjectConfig | void {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `prlt init` first.');
    return;
  }
  
  const config = loadConfig();
  const currentTheme = config.theme;
  
  if (!currentTheme) {
    log.error('Theme not found in configuration!');
    return;
  }
  
  showBanner(currentTheme);
  log.theme(currentTheme, currentTheme.messages.list);
  
  try {
    const worktrees = execSync('git worktree list', { encoding: 'utf8' });
    
    console.log(chalk.blue(`\n📊 ${currentTheme.displayName}:\n`));
    
    if (config.activeAgents.length === 0) {
      console.log(chalk.dim('No active agents'));
    } else {
      config.activeAgents.forEach(agent => {
        const agentPath = path.join(config.workspaceDir, agent);
        const isActive = worktrees.includes(agentPath);
        
        if (isActive) {
          log.agent(agent, chalk.green('✅ ACTIVE') + ` - ${agentPath}`, currentTheme);
          
          // Show current branch if possible
          try {
            const branch = execSync(`git -C "${agentPath}" branch --show-current`, { encoding: 'utf8' }).trim();
            console.log(`    ${chalk.dim('📝 Branch:')} ${branch}`);
          } catch (e) {
            // Ignore branch detection errors
          }
        } else {
          log.agent(agent, chalk.red('💤 INACTIVE') + ' - worktree missing', currentTheme);
        }
      });
    }
    
    console.log('\n' + chalk.yellow(`💡 Tip: Use 'prlt ${currentTheme.commands.create} <agent>' to add more agents`));
    console.log(chalk.cyan(currentTheme.messages.slogan));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to get status: ${errorMessage}`);
  }
  
  return config;
}