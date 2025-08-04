import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { isInitialized, loadConfig, saveConfig } from '../config/index.js';
import { log, showBanner } from '../utils/logger.js';
import { Application, updateAgentPorts } from '../applications/index.js';

export async function generateCaddyInteractive(): Promise<void> {
  if (!isInitialized()) {
    log.error('Proletariat not initialized! Run `prlt init` first.');
    return;
  }

  const config = loadConfig();
  if (config.theme) {
    showBanner(config.theme);
  }
  
  console.log(chalk.blue('🌐 Interactive Caddy Configuration Setup'));
  console.log(chalk.dim('Configure applications and their base ports for agent worktrees\n'));

  // Initialize applications array if it doesn't exist
  if (!config.applications) {
    config.applications = [];
  }

  // Show existing applications
  if (config.applications.length > 0) {
    console.log(chalk.yellow('📱 Existing applications:'));
    config.applications.forEach((app: Application) => {
      console.log(`  ${chalk.green(app.name)} (${app.type}) - base port ${app.basePort}`);
    });
    console.log();
    
    const { keepExisting } = await inquirer.prompt([{
      type: 'confirm',
      name: 'keepExisting',
      message: 'Keep existing applications and add more?',
      default: true
    }]);
    
    if (!keepExisting) {
      config.applications = [];
    }
  }

  // Interactive application setup
  let addingApps = true;
  while (addingApps) {
    const appAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Application name (e.g., careerops-web, inflow-backend):',
        validate: (input: string) => {
          if (!input.trim()) return 'Application name is required';
          if (config.applications?.some((app: Application) => app.name === input)) {
            return 'Application with this name already exists';
          }
          return true;
        }
      },
      {
        type: 'number',
        name: 'basePort',
        message: 'Base port (agents will use basePort + 1, basePort + 2, etc.):',
        default: 3000,
        validate: (input: number) => {
          if (input < 1000 || input > 65535) return 'Port must be between 1000 and 65535';
          return true;
        }
      },
      {
        type: 'list',
        name: 'type',
        message: 'Application type:',
        choices: [
          { name: 'Frontend (Next.js, React, etc.)', value: 'frontend' },
          { name: 'Backend (API, Node.js, etc.)', value: 'backend' },
          { name: 'Dev Server (HMR, build tools, etc.)', value: 'dev-server' }
        ]
      }
    ]);

    config.applications.push({
      name: appAnswers.name,
      basePort: appAnswers.basePort,
      type: appAnswers.type
    });

    log.success(`Added ${appAnswers.name} (${appAnswers.type}) on base port ${appAnswers.basePort}`);

    const { addAnother } = await inquirer.prompt([{
      type: 'confirm',
      name: 'addAnother',
      message: 'Add another application?',
      default: false
    }]);

    addingApps = addAnother;
  }

  // Save configuration
  saveConfig(config);

  // Update agent ports
  await updateAgentPorts(config);

  // Generate Caddyfile
  await generateCaddyfile(config);

  // Show summary
  console.log(chalk.blue('\n🎉 Setup complete!'));
  console.log(chalk.yellow('\n📋 Configuration Summary:'));
  console.log(`Project: ${chalk.green(config.projectName)}`);
  console.log(`Active agents: ${chalk.green(config.activeAgents?.join(', ') || 'none')}`);
  console.log(`Applications:`);
  
  config.applications.forEach((app: Application) => {
    console.log(`  ${chalk.green(app.name)} (${app.type}) - base port ${app.basePort}`);
    if (config.activeAgents?.length > 0) {
      config.activeAgents.forEach((agent: string, index: number) => {
        const agentPort = app.basePort + (index + 1);
        console.log(`    ${chalk.blue(agent)}: port ${agentPort} → ${agent}.${app.name}.${config.projectName}.localhost`);
      });
    }
  });

  console.log(chalk.cyan('\n💡 Next steps:'));
  console.log(`1. Start applications: ${chalk.yellow('pnpm dev')} (in each worktree)`);
  console.log(`2. Start Caddy proxy: ${chalk.yellow('pnpm proxy')}`);
  console.log(`3. Visit: ${chalk.green('https://agent.app.project.localhost')}`);
}

async function generateCaddyfile(config: any): Promise<void> {
  if (!config.applications || config.applications.length === 0) {
    log.warning('No applications configured. Skipping Caddyfile generation.');
    return;
  }

  const lines = [
    '# 🚩 PROLETARIAT - Revolutionary Caddy Configuration',
    '# Auto-generated proxy rules for applications and agents',
    ''
  ];

  // Generate domains for each agent and application
  if (config.activeAgents?.length > 0) {
    config.activeAgents.forEach((agent: string, agentIndex: number) => {
      config.applications.forEach((app: Application) => {
        const agentPort = app.basePort + (agentIndex + 1);
        const domain = `${agent}.${app.name}.${config.projectName}.localhost`;
        
        lines.push(`${domain} {`);
        lines.push(`    reverse_proxy localhost:${agentPort}`);
        lines.push(`    log {`);
        lines.push(`        output file /tmp/caddy-${agent}-${app.name}.log`);
        lines.push(`    }`);
        lines.push(`}`);
        lines.push('');
      });
    });
  }

  lines.push('# Manual development (base ports)');
  config.applications.forEach((app: Application) => {
    const domain = `${app.name}.${config.projectName}.localhost`;
    lines.push(`${domain} {`);
    lines.push(`    reverse_proxy localhost:${app.basePort}`);
    lines.push(`}`);
    lines.push('');
  });

  lines.push('# Configuration summary:');
  lines.push(`# Project: ${config.projectName}`);
  lines.push(`# Active agents: ${config.activeAgents?.join(', ') || 'none'}`);
  config.applications.forEach((app: Application) => {
    lines.push(`# ${app.name} (${app.type}): base port ${app.basePort}`);
  });

  const caddyfilePath = path.join(config.workspaceDir, 'Caddyfile');
  
  try {
    fs.writeFileSync(caddyfilePath, lines.join('\n'));
    log.success(`Generated Caddyfile: ${caddyfilePath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to generate Caddyfile: ${errorMessage}`);
  }
}