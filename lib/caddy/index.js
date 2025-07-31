const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { isInitialized, loadConfig, saveConfig } = require('../config');
const { log, showBanner } = require('../utils/logger');

function checkCaddyAvailable() {
  try {
    execSync('which caddy', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

function generateCaddyfile(agents, config, theme) {
  const projectName = config.projectName;
  const frontendPort = config.ports?.frontend || 3000;
  const backendPort = config.ports?.backend || 5000;
  
  const lines = ['# 🚩 PROLETARIAT - Revolutionary Caddy Configuration', '# Auto-generated proxy rules for agents', ''];
  
  agents.forEach(agent => {
    const agentPath = path.join(config.workspaceDir, agent);
    if (fs.existsSync(agentPath)) {
      // Frontend proxy
      lines.push(`${agent}.${projectName}.test {`);
      lines.push(`    reverse_proxy localhost:${frontendPort}`);
      lines.push(`    log {`);
      lines.push(`        output file /tmp/caddy-${agent}.log`);
      lines.push(`    }`);
      lines.push(`}`);
      lines.push('');
      
      // API proxy (if backend port is different)
      if (backendPort !== frontendPort) {
        lines.push(`api.${agent}.${projectName}.test {`);
        lines.push(`    reverse_proxy localhost:${backendPort}`);
        lines.push(`}`);
        lines.push('');
      }
    }
  });
  
  lines.push('# Add more custom rules here as needed');
  lines.push(`# Frontend port: ${frontendPort}`);
  lines.push(`# Backend port: ${backendPort}`);
  return lines.join('\n');
}

async function promptForPorts() {
  console.log(chalk.yellow('\n🔧 Port Configuration Needed:'));
  
  const portAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'frontend',
      message: 'What port does your frontend run on?',
      default: '3000',
      validate: input => {
        const port = parseInt(input);
        return (port > 0 && port < 65536) ? true : 'Please enter a valid port number (1-65535)';
      }
    },
    {
      type: 'input', 
      name: 'backend',
      message: 'What port does your backend/API run on?',
      default: '5000',
      validate: input => {
        const port = parseInt(input);
        return (port > 0 && port < 65536) ? true : 'Please enter a valid port number (1-65535)';
      }
    }
  ]);
  
  return {
    frontend: parseInt(portAnswers.frontend),
    backend: parseInt(portAnswers.backend)
  };
}

async function setupCaddyProxy(agents) {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `prlt init` first.');
    return;
  }
  
  if (!checkCaddyAvailable()) {
    log.error('Caddy not found! Please install Caddy first.');
    log.info('Install with: brew install caddy (macOS) or https://caddyserver.com/docs/install');
    return;
  }
  
  let config = loadConfig();
  const currentTheme = config.theme;
  
  if (agents.length === 0) {
    log.error(`Usage: prlt ${currentTheme.commands.proxy} <agent1> [agent2] ...`);
    log.info(`Available agents: ${currentTheme.agents.join(', ')}`);
    return;
  }
  
  // Check if ports are configured, if not, prompt
  if (!config.ports || !config.ports.frontend || !config.ports.backend) {
    const ports = await promptForPorts();
    config.ports = ports;
    saveConfig(config);
    log.success(`Port configuration saved! Frontend: ${config.ports.frontend}, Backend: ${config.ports.backend}`);
    console.log(chalk.dim('💡 You can edit these anytime in .proletariat/config.json'));
  }
  
  showBanner(currentTheme);
  log.theme(currentTheme, `Setting up Caddy proxy for ${currentTheme.name} agents`);
  
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
    log.error('No valid agents to set up proxy for!');
    return;
  }
  
  // Generate Caddyfile
  const caddyfile = generateCaddyfile(validAgents, config, currentTheme);
  const caddyfilePath = path.join(config.workspaceDir, 'Caddyfile');
  
  try {
    fs.writeFileSync(caddyfilePath, caddyfile);
    log.success(`Generated Caddyfile: ${caddyfilePath}`);
    
    // Show the beautiful domain names
    console.log('\n' + chalk.blue('🌐 Your agent domains:'));
    validAgents.forEach(agent => {
      log.agent(agent, chalk.green(`https://${agent}.${config.projectName}.test`), currentTheme);
      console.log(`    ${chalk.dim('API:')} https://api.${agent}.${config.projectName}.test`);
    });
    
    console.log('\n' + chalk.yellow('🚀 To start Caddy:'));
    console.log(`  cd ${config.workspaceDir}`);
    console.log(`  caddy run`);
    
    console.log('\n' + chalk.blue('💡 Setup steps:'));
    console.log('  1. Make sure your dev servers are running on standard ports');
    console.log('  2. Add the domains to your /etc/hosts if needed');
    console.log('  3. Start Caddy in the fleet directory');
    console.log('  4. Visit your beautiful agent URLs! 🎉');
    
    log.theme(currentTheme, `Proxy configuration ready! ${currentTheme.messages.slogan}`);
    
  } catch (error) {
    log.error(`Failed to generate Caddyfile: ${error.message}`);
  }
  
  return config;
}

module.exports = {
  checkCaddyAvailable,
  generateCaddyfile,
  promptForPorts,
  setupCaddyProxy
};