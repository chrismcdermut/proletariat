#!/usr/bin/env node

/**
 * 🚩 PROLETARIAT - Simple Themed Git Worktree Manager
 * ⚒️ Making git worktrees fun with themed agents!
 * 
 * Billionaires: "Workers of the codebase, unite!"
 * Cars: "Start your engines!"
 * Companies: "Time to make some acquisitions!"
 */

const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const program = new Command();

// Theme configurations
const THEMES = {
  billionaires: {
    name: 'billionaires',
    displayName: 'Billionaire Staff',
    description: '⚒️ Making billionaires work as your git worktrees!',
    emoji: '💰',
    directory: 'staff',
    agents: ['bezos', 'musk', 'gates', 'buffett', 'zuckerberg', 'cook', 'ellison', 'page'],
    commands: {
      create: 'hire',
      remove: 'fire', 
      list: 'staff',
      session: 'work'
    },
    messages: {
      create: 'Hiring billionaire workers',
      remove: 'Firing lazy billionaires',
      list: 'Current billionaire staff',
      slogan: 'Workers of the codebase, unite! ✊'
    }
  },
  cars: {
    name: 'cars',
    displayName: 'Car Garage',
    description: '🚗 Your development garage with classic rides!',
    emoji: '🚗',
    directory: 'garage',
    agents: ['tesla', 'prius', 'mustang', 'camry', 'accord', 'civic', 'hdj81', 'landcruiser'],
    commands: {
      create: 'drive',
      remove: 'park',
      list: 'garage',
      session: 'ride'
    },
    messages: {
      create: 'Taking cars for a drive',
      remove: 'Parking cars in the garage',
      list: 'Cars in your garage',
      slogan: 'Start your engines! 🏁'
    }
  },
  companies: {
    name: 'companies',
    displayName: 'Company Portfolio',
    description: '🏢 Building your corporate empire, one acquisition at a time!',
    emoji: '🏢',
    directory: 'portfolio',
    agents: ['apple', 'microsoft', 'google', 'amazon', 'meta', 'tesla', 'nvidia', 'oracle'],
    commands: {
      create: 'buy',
      remove: 'sell',
      list: 'portfolio',
      session: 'manage'
    },
    messages: {
      create: 'Acquiring companies',
      remove: 'Selling off companies',
      list: 'Your company portfolio',
      slogan: 'Time to make some acquisitions! 💼'
    }
  }
};

// Current theme and configuration
let currentTheme = null;
let config = null;

// Utility functions
const log = {
  theme: (theme, msg) => console.log(chalk.cyan(`${theme.emoji}`), chalk.bold(msg)),
  success: (msg) => console.log(chalk.green('✅'), msg),
  warning: (msg) => console.log(chalk.yellow('⚠️'), msg),
  error: (msg) => console.log(chalk.red('❌'), msg),
  info: (msg) => console.log(chalk.blue('ℹ️'), msg),
  agent: (agent, msg, theme) => {
    console.log(chalk.cyan(`${theme.emoji} ${agent.toUpperCase()}:`), msg);
  }
};

function showBanner(theme) {
  console.log(`
${chalk.red('⚒️  PROLETARIAT ⚒️')}
${chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
${chalk.green(`${theme.emoji} ${theme.displayName} ${theme.emoji}`)}
${chalk.cyan(theme.description)}
${chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
`);
}

function getProjectRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error('Not in a git repository! Proletariat requires version control.');
  }
}

function getProjectName() {
  const projectRoot = getProjectRoot();
  return path.basename(projectRoot);
}

function getConfigPath() {
  const projectRoot = getProjectRoot();
  return path.join(projectRoot, '.proletariat', 'config.json');
}

function getWorkspaceDir(theme) {
  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  return path.join(path.dirname(projectRoot), `${projectName}-${theme.directory}`);
}

function isInitialized() {
  return fs.existsSync(getConfigPath());
}

function loadConfig() {
  if (!isInitialized()) {
    throw new Error('Proletariat not initialized! Run `proletariat init` first.');
  }
  
  const configPath = getConfigPath();
  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    ...rawConfig,
    theme: THEMES[rawConfig.themeName] || THEMES.billionaires
  };
}

function saveConfig(configData) {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
}

// Command implementations
async function initProject(options) {
  const projectName = getProjectName();
  
  if (isInitialized()) {
    log.warning(`Proletariat already initialized for ${projectName}!`);
    config = loadConfig();
    currentTheme = config.theme;
    showBanner(currentTheme);
    return;
  }
  
  let themeName = options.theme || 'billionaires';
  
  // Interactive theme selection if no theme specified
  if (!options.theme) {
    const themeChoices = Object.values(THEMES).map(t => ({
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
  
  if (!THEMES[themeName]) {
    log.error(`Theme '${themeName}' not found!`);
    log.info(`Available themes: ${Object.keys(THEMES).join(', ')}`);
    return;
  }
  
  const theme = THEMES[themeName];
  currentTheme = theme;
  
  showBanner(theme);
  log.theme(theme, `Initializing ${projectName} with ${theme.displayName} theme...`);
  
  // Create workspace directory
  const workspaceDir = getWorkspaceDir(theme);
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
    log.success(`Created workspace: ${workspaceDir}`);
  }
  
  // Save configuration
  const configData = {
    version: '2.0.0',
    projectName,
    themeName: theme.name,
    workspaceDir,
    activeAgents: [],
    initialized: new Date().toISOString()
  };
  
  saveConfig(configData);
  
  log.success('Proletariat initialized!');
  log.info(`Available agents: ${theme.agents.join(', ')}`);
  log.theme(theme, 'Next steps:');
  console.log(`  prlt ${theme.commands.create} ${theme.agents.slice(0, 2).join(' ')}    # Create worktrees`);
  console.log(`  prlt ${theme.commands.session} ${theme.agents.slice(0, 2).join(' ')}    # Start tmux sessions`);
  console.log(`  prlt ${theme.commands.list}                                   # Show status`);
  console.log(`\\n${chalk.cyan(theme.messages.slogan)}`);
}

async function createWorktrees(agents) {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `proletariat init` first.');
    return;
  }
  
  config = loadConfig();
  currentTheme = config.theme;
  
  if (agents.length === 0) {
    log.error(`Usage: proletariat ${currentTheme.commands.create} <agent1> [agent2] ...`);
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
      log.error(`Failed to create worktree for ${agent}: ${error.message}`);
    }
  }
  
  // Save updated config
  saveConfig({
    ...config,
    activeAgents: config.activeAgents
  });
  
  log.theme(currentTheme, `${currentTheme.messages.create} complete!`);
  log.info(`Use 'prlt ${currentTheme.commands.list}' to see all active agents`);
}

async function removeWorktrees(agents) {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `proletariat init` first.');
    return;
  }
  
  config = loadConfig();
  currentTheme = config.theme;
  
  if (agents.length === 0) {
    log.error(`Usage: proletariat ${currentTheme.commands.remove} <agent1> [agent2] ...`);
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
      log.error(`Failed to remove worktree for ${agent}: ${error.message}`);
    }
  }
  
  // Save updated config
  saveConfig({
    ...config,
    activeAgents: config.activeAgents
  });
  
  log.theme(currentTheme, `${currentTheme.messages.remove} complete!`);
}

function showStatus() {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `proletariat init` first.');
    return;
  }
  
  config = loadConfig();
  currentTheme = config.theme;
  
  showBanner(currentTheme);
  log.theme(currentTheme, currentTheme.messages.list);
  
  try {
    const worktrees = execSync('git worktree list', { encoding: 'utf8' });
    
    console.log(chalk.blue(`\\n📊 ${currentTheme.displayName}:\\n`));
    
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
    
    console.log('\\n' + chalk.yellow(`💡 Tip: Use 'prlt ${currentTheme.commands.create} <agent>' to add more agents`));
    console.log(chalk.cyan(currentTheme.messages.slogan));
  } catch (error) {
    log.error(`Failed to get status: ${error.message}`);
  }
}

function listAgents(options) {
  const themeName = options.theme || 'billionaires';
  const theme = THEMES[themeName];
  
  if (!theme) {
    log.error(`Theme '${themeName}' not found!`);
    log.info(`Available themes: ${Object.keys(THEMES).join(', ')}`);
    return;
  }
  
  console.log(chalk.blue(`\\n${theme.emoji} Available ${theme.displayName} Agents:\\n`));
  
  theme.agents.forEach(agent => {
    console.log(`  ${chalk.green(agent)}`);
  });
  
  console.log('\\n' + chalk.yellow('Usage Examples:'));
  console.log(`  prlt ${theme.commands.create} ${theme.agents.slice(0, 2).join(' ')}`);
  console.log(`  prlt ${theme.commands.session} ${theme.agents.slice(0, 2).join(' ')}`);
  console.log(`  prlt ${theme.commands.remove} ${theme.agents[0]}`);
  console.log(`  prlt ${theme.commands.list}`);
}

function listThemes() {
  console.log(chalk.blue('\\n🎨 Available Themes:\\n'));
  
  Object.values(THEMES).forEach(theme => {
    console.log(`${chalk.green(theme.emoji)} ${chalk.bold(theme.name)}`);
    console.log(`   ${theme.description}`);
    console.log(`   Commands: ${theme.commands.create}, ${theme.commands.remove}, ${theme.commands.list}, ${theme.commands.session}`);
    console.log(`   Agents: ${theme.agents.slice(0, 4).join(', ')}...`);
    console.log('');
  });
}

function checkTmuxAvailable() {
  try {
    execSync('which tmux', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

async function startTmuxSession(agents) {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `prlt init` first.');
    return;
  }
  
  if (!checkTmuxAvailable()) {
    log.error('tmux not found! Please install tmux first.');
    log.info('Install with: brew install tmux (macOS) or apt install tmux (Linux)');
    return;
  }
  
  config = loadConfig();
  currentTheme = config.theme;
  
  if (agents.length === 0) {
    log.error(`Usage: prlt ${currentTheme.commands.session} <agent1> [agent2] ...`);
    log.info(`Available agents: ${currentTheme.agents.join(', ')}`);
    return;
  }
  
  showBanner(currentTheme);
  log.theme(currentTheme, `Starting tmux sessions for ${currentTheme.name} agents`);
  
  const validAgents = agents.filter(agent => {
    if (!currentTheme.agents.includes(agent)) {
      log.warning(`Agent '${agent}' not available in ${currentTheme.name} theme`);
      return false;
    }
    
    const agentPath = path.join(config.workspaceDir, agent);
    if (!fs.existsSync(agentPath)) {
      log.warning(`Agent '${agent}' not deployed. Run 'prlt ${currentTheme.commands.create} ${agent}' first.`);
      return false;
    }
    
    return true;
  });
  
  if (validAgents.length === 0) {
    log.error('No valid agents to start sessions for!');
    return;
  }
  
  for (const agent of validAgents) {
    const agentPath = path.join(config.workspaceDir, agent);
    const sessionName = `${config.projectName}-${agent}`;
    
    try {
      // Check if session already exists
      try {
        execSync(`tmux has-session -t "${sessionName}"`, { stdio: 'ignore' });
        log.agent(agent, `Session '${sessionName}' already exists`, currentTheme);
        continue;
      } catch (e) {
        // Session doesn't exist, create it
      }
      
      // Create new tmux session in agent directory
      execSync(`tmux new-session -d -s "${sessionName}" -c "${agentPath}"`);
      log.agent(agent, `Started tmux session: ${sessionName}`, currentTheme);
      
      // Set up the session with useful windows
      execSync(`tmux rename-window -t "${sessionName}:0" "editor"`);
      execSync(`tmux new-window -t "${sessionName}" -n "terminal" -c "${agentPath}"`);
      execSync(`tmux new-window -t "${sessionName}" -n "git" -c "${agentPath}"`);
      execSync(`tmux new-window -t "${sessionName}" -n "ai" -c "${agentPath}"`);
      
      // Send some helpful commands to the git window
      execSync(`tmux send-keys -t "${sessionName}:git" "git status" Enter`);
      
      // Set up AI window with helpful message
      execSync(`tmux send-keys -t "${sessionName}:ai" "echo '🤖 AI Agent Workspace - Claude Code, GitHub Copilot, etc.'" Enter`);
      execSync(`tmux send-keys -t "${sessionName}:ai" "echo 'Ready for AI-assisted development! 🚀'" Enter`);
      execSync(`tmux send-keys -t "${sessionName}:ai" "echo ''" Enter`);
      
      // Focus back on the editor window
      execSync(`tmux select-window -t "${sessionName}:editor"`);
      
    } catch (error) {
      log.error(`Failed to create tmux session for ${agent}: ${error.message}`);
    }
  }
  
  // Show how to attach
  console.log('\\n' + chalk.yellow('💡 To attach to sessions:'));
  validAgents.forEach(agent => {
    const sessionName = `${config.projectName}-${agent}`;
    console.log(`  tmux attach -t ${sessionName}    # ${chalk.cyan(agent)}`);
  });
  
  console.log('\\n' + chalk.blue('📋 Useful tmux commands:'));
  console.log('  tmux list-sessions       # List all sessions');
  console.log('  tmux kill-session -t <name>  # Kill a session');
  console.log('  Ctrl+B then D           # Detach from session');
  
  log.theme(currentTheme, `Tmux sessions ready! ${currentTheme.messages.slogan}`);
}

// CLI Program setup
program
  .name('proletariat')
  .description('⚒️ Simple Themed Git Worktree Manager (alias: prlt)')
  .version('2.0.0');

program
  .command('init')
  .description('🚩 Initialize themed worktree management')
  .option('-t, --theme <theme>', 'theme (billionaires, cars, companies)')
  .action(initProject);

// Dynamic theme commands
Object.values(THEMES).forEach(theme => {
  program
    .command(`${theme.commands.create} <agents...>`)
    .description(`${theme.emoji} Create worktrees for ${theme.name} agents`)
    .action(createWorktrees);
    
  program
    .command(`${theme.commands.remove} <agents...>`)
    .description(`${theme.emoji} Remove worktrees for ${theme.name} agents`)
    .action(removeWorktrees);
    
  program
    .command(theme.commands.list)
    .description(`${theme.emoji} Show active ${theme.name} agents`)
    .action(showStatus);
    
  program
    .command(`${theme.commands.session} <agents...>`)
    .description(`${theme.emoji} Start tmux sessions for ${theme.name} agents`)
    .action(startTmuxSession);
});

program
  .command('list')
  .description('📋 List available agents for a theme')
  .option('-t, --theme <theme>', 'theme to list agents for')
  .action(listAgents);

program
  .command('themes')
  .description('🎨 List available themes')
  .action(listThemes);

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  const theme = THEMES.billionaires;
  showBanner(theme);
  program.outputHelp();
  console.log(chalk.yellow('\\n💡 Start with: prlt init'));
  console.log(chalk.cyan('💡 Simple themed git worktree management! ⚒️\\n'));
}