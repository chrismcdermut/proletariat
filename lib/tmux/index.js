const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const chalk = require('chalk');
const { isInitialized, loadConfig } = require('../config');
const { log, showBanner } = require('../utils/logger');

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
  
  const config = loadConfig();
  const currentTheme = config.theme;
  
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
  console.log('\n' + chalk.yellow('💡 To attach to sessions:'));
  validAgents.forEach(agent => {
    const sessionName = `${config.projectName}-${agent}`;
    console.log(`  tmux attach -t ${sessionName}    # ${chalk.cyan(agent)}`);
  });
  
  console.log('\n' + chalk.blue('📋 Useful tmux commands:'));
  console.log('  tmux list-sessions       # List all sessions');
  console.log('  tmux kill-session -t <name>  # Kill a session');
  console.log('  Ctrl+B then D           # Detach from session');
  
  log.theme(currentTheme, `Tmux sessions ready! ${currentTheme.messages.slogan}`);
  
  return config;
}

module.exports = {
  checkTmuxAvailable,
  startTmuxSession
};