import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { getAllThemes, getThemeNames, isValidTheme } from '../themes/index.js';
import { initPMOForHQ } from '../pmo/index.js';
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
  

  if (!resolvedOptions.hqRoot && !resolvedOptions.hq) {
    const { layoutChoice } = await inquirer.prompt([{
      type: 'list',
      name: 'layoutChoice',
      message: 'How should we organize your workspace?',
      choices: [
        { name: 'Create an HQ to manage multiple projects (recommended)', value: 'hq' },
        { name: 'Keep it simple - just this repo', value: 'sibling' }
      ]
    }]);

    if (layoutChoice === 'hq') {
      const { hqName } = await inquirer.prompt([{
        type: 'input',
        name: 'hqName',
        message: 'What should we call your HQ?',
        default: `${projectName}-hq`,
        validate: (input: string) => input.trim().length ? true : 'Please provide a name.'
      }]);
      resolvedOptions.hq = hqName.trim();
    }
  }

  const { workspaceDir, layout } = resolveWorkspace(theme, resolvedOptions);

  showBanner(theme);
  log.theme(theme, `Initializing ${projectName} with ${theme.displayName} theme...`);

  if (layout.mode === 'hq') {
    // Create HQ structure
    const hqConfigDir = path.join(layout.baseDir, '.proletariat');
    const agentsDir = path.join(hqConfigDir, 'agents', theme.directory);
    const reposDir = path.join(layout.baseDir, 'repos');
    
    // Create all HQ directories
    [hqConfigDir, agentsDir, reposDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Create HQ config
    const hqConfig = {
      version: '3.0.0',
      type: 'hq',
      name: layout.hqName || path.basename(layout.baseDir),
      theme: themeName,
      themeDirectory: theme.directory,
      agents: [],
      repos: [],
      agentRepoMode: 'ask',
      initialized: new Date().toISOString()
    };
    
    const hqConfigPath = path.join(hqConfigDir, 'config.json');
    if (!fs.existsSync(hqConfigPath)) {
      fs.writeFileSync(hqConfigPath, JSON.stringify(hqConfig, null, 2));
      log.success(`✅ Created HQ at ${layout.baseDir}`);
    }
    
    // Initialize PMO
    await initPMOForHQ(layout.baseDir);
    log.success(`✅ Initialized PMO at ${path.join(layout.baseDir, 'pmo')}`);
    
    // Don't create repo.json in HQ mode - HQ config is the source of truth
  } else {
    // Simple mode - create repo.json and workspace alongside repo
    const configData: ProjectConfig = {
      version: '0.2.0',
      configVersion: 2,
      projectName,
      themeName: theme.name,
      workspaceDir,
      activeAgents: [],
      initialized: new Date().toISOString(),
      layout
    };
    
    saveConfig(configData);
    
    if (!fs.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir, { recursive: true });
      log.success(`Created workspace: ${workspaceDir}`);
    } else {
      log.info(`Using existing workspace: ${workspaceDir}`);
    }
  }

  // Offer to clone the current repo into HQ
  if (layout.mode === 'hq') {
    try {
      // Check if we're in a git repo
      execSync('git rev-parse --git-dir', { cwd: projectRoot, stdio: 'ignore' });
      
      const { shouldClone } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldClone',
          message: `Add '${projectName}' to the HQ? (will clone into repos/)`,
          default: true
        }
      ]);
      
      if (shouldClone) {
        const repoPath = path.join(layout.baseDir, 'repos', projectName);
        
        if (!fs.existsSync(repoPath)) {
          // Get the remote URL
          try {
            const remoteUrl = execSync('git config --get remote.origin.url', { 
              cwd: projectRoot, 
              encoding: 'utf8' 
            }).trim();
            
            if (remoteUrl) {
              log.info(`Cloning ${projectName} into HQ...`);
              execSync(`git clone "${remoteUrl}" "${repoPath}"`, { 
                stdio: 'inherit' 
              });
              
              // Update HQ config to track this repo
              const hqConfigPath = path.join(layout.baseDir, '.proletariat', 'config.json');
              const hqConfig = JSON.parse(fs.readFileSync(hqConfigPath, 'utf8'));
              hqConfig.repos.push(projectName);
              fs.writeFileSync(hqConfigPath, JSON.stringify(hqConfig, null, 2));
              
              log.success(`✅ Added ${projectName} to HQ`);
              log.info(`💡 Agents will work on the HQ copy. Pull their changes to your local repo when ready.`);
            } else {
              log.warning('No git remote found. Add a remote and run: prlt add');
            }
          } catch (error) {
            log.warning('Could not clone repository. Run "prlt add" later to add it.');
          }
        } else {
          log.info(`Repository ${projectName} already exists in HQ`);
        }
      } else {
        log.info(`💡 To add this repo later, run: prlt add`);
      }
    } catch {
      // Not a git repo, skip cloning offer
      log.info(`💡 To add repositories to the HQ, run: prlt add`);
    }
  }

  log.success('✅ Proletariat initialized!');
  
  if (layout.mode === 'hq') {
    log.theme(theme, 'Next steps:');
    console.log(chalk.yellow('• Run: prlt hire        # Create your first agents'));
    console.log(chalk.yellow('• Run: prlt add-ticket  # Create work for agents'));
  } else {
    log.info(`Available agents: ${theme.agents.slice(0, 5).join(', ')}...`);
    log.theme(theme, 'Next steps:');
    console.log(`  prlt ${theme.commands.create} ${theme.agents.slice(0, 2).join(' ')}    # Create worktrees`);
    console.log(`  prlt ${theme.commands.list}                                   # Show status`);
  }
  
  console.log(`\n${chalk.cyan(theme.messages.slogan)}`);
  console.log('');
  
  // Return appropriate config based on mode
  if (layout.mode === 'hq') {
    // For HQ mode, return a minimal config representing the HQ
    return {
      version: '0.2.0',
      configVersion: 3,
      projectName: layout.hqName || path.basename(layout.baseDir),
      themeName: theme.name,
      workspaceDir: path.join(layout.baseDir, '.proletariat', 'agents', theme.directory),
      activeAgents: [],
      initialized: new Date().toISOString(),
      layout,
      theme
    };
  } else {
    // For simple mode, return the saved config
    return loadConfig();
  }
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