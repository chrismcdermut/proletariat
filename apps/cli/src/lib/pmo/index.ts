/**
 * PMO (Project Management Office) functionality
 * Manages tickets, kanban boards, and Claude integration
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadConfig } from '../config/index.js';
import { log } from '../utils/logger.js';

export interface Ticket {
  id: string;
  title: string;
  status: 'backlog' | 'triage' | 'in-progress' | 'review' | 'done';
  queue: 'Build' | 'Grow' | 'Support' | 'BizOps' | 'Strategy';
  points: number;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  urgency: 'U0' | 'U1' | 'U2' | 'U3';
  agent?: string;
  description?: string;
  acceptanceCriteria?: string[];
}

export async function initPMOForHQ(hqDir: string) {
  const pmoDir = path.join(hqDir, 'pmo');
  
  // Create PMO structure
  const dirs = [
    path.join(pmoDir, 'specs', 'backlog'),
    path.join(pmoDir, 'specs', 'active'),
    path.join(pmoDir, 'specs', 'completed')
  ];
  
  dirs.forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
  });
  
  // Create kanban board
  const kanbanPath = path.join(pmoDir, 'kanban.md');
  if (!fs.existsSync(kanbanPath)) {
    // Load template from file
    const templatePath = path.join(__dirname, '../../../templates/pmo/kanban-template.md');
    let kanbanContent: string;
    
    try {
      kanbanContent = fs.readFileSync(templatePath, 'utf-8');
    } catch {
      // Fallback to inline template if file not found
      kanbanContent = `---
kanban-plugin: board
---

## 📥 Triage

## 🏗️ Build Queue

## 📈 Grow Queue

## 🛟 Support Queue

## ⚙️ BizOps Queue

## 🎯 Strategy Queue

## 🚀 In Progress

## 🔄 PR/Review

## ✅ Done
`;
    }
    
    fs.writeFileSync(kanbanPath, kanbanContent);
  }
  
  // Initialize as git repo if not already
  if (!fs.existsSync(path.join(pmoDir, '.git'))) {
    try {
      execSync('git init', { cwd: pmoDir, stdio: 'ignore' });
      execSync('git add .', { cwd: pmoDir, stdio: 'ignore' });
      execSync('git commit -m "Initial PMO setup"', { cwd: pmoDir, stdio: 'ignore' });
    } catch {
      // Git init is optional, ignore errors
    }
  }
}

export async function initPMO() {
  // PMO can work independently of main config
  let pmoDir = './pmo';
  
  try {
    const config = loadConfig();
    // Use project-specific PMO location if available
    pmoDir = path.join(path.dirname(config.workspaceDir), 'pmo');
  } catch {
    // If no main config, use current directory
    pmoDir = './pmo';
  }
  
  log.info('🎯 Initializing PMO...');
  
  // Create PMO structure
  const dirs = [
    path.join(pmoDir, 'specs', 'backlog'),
    path.join(pmoDir, 'specs', 'active'),
    path.join(pmoDir, 'specs', 'completed')
  ];
  
  dirs.forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
  });
  
  // Create kanban board
  const kanbanPath = path.join(pmoDir, 'kanban.md');
  if (!fs.existsSync(kanbanPath)) {
    // Load template from file
    const templatePath = path.join(__dirname, '../../../templates/pmo/kanban-template.md');
    let kanbanContent: string;
    
    try {
      kanbanContent = fs.readFileSync(templatePath, 'utf-8');
    } catch {
      // Fallback to inline template if file not found
      kanbanContent = `---
kanban-plugin: board
---

## 📥 Triage

## 🏗️ Build Queue

## 📈 Grow Queue

## 🛟 Support Queue

## ⚙️ BizOps Queue

## 🎯 Strategy Queue

## 🚀 In Progress

## 🔄 PR/Review

## ✅ Done
`;
    }
    
    fs.writeFileSync(kanbanPath, kanbanContent);
  }
  
  // Initialize as git repo if not already
  if (!fs.existsSync(path.join(pmoDir, '.git'))) {
    const shouldInitGit = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'initGit',
        message: 'Initialize PMO as a git repository?',
        default: true
      }
    ]);
    
    if (shouldInitGit.initGit) {
      execSync('git init', { cwd: pmoDir });
      execSync('git add .', { cwd: pmoDir });
      execSync('git commit -m "Initial PMO setup"', { cwd: pmoDir });
      log.success('✅ PMO initialized as git repository');
    }
  }
  
  log.success(`✅ PMO initialized at ${pmoDir}`);
}

export async function createTicket() {
  let pmoDir = './pmo';
  
  try {
    const config = loadConfig();
    pmoDir = path.join(path.dirname(config.workspaceDir), 'pmo');
  } catch {
    pmoDir = './pmo';
  }
  
  log.info('📝 Creating new ticket...');
  
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'id',
      message: 'Ticket ID (e.g., implement-oauth):',
      validate: (input) => {
        if (!input) return 'ID is required';
        if (!/^[a-z0-9-]+$/.test(input)) return 'ID must be lowercase with hyphens';
        return true;
      }
    },
    {
      type: 'input',
      name: 'title',
      message: 'Title:',
      validate: (input) => input ? true : 'Title is required'
    },
    {
      type: 'list',
      name: 'queue',
      message: 'Queue (5-Tool-Founder):',
      choices: [
        { name: '🏗️ Build - Product features & engineering', value: 'Build' },
        { name: '📈 Grow - Growth, marketing & user acquisition', value: 'Grow' },
        { name: '🛟 Support - Customer success & operations', value: 'Support' },
        { name: '⚙️ BizOps - Business operations & infrastructure', value: 'BizOps' },
        { name: '🎯 Strategy - Strategic planning & vision', value: 'Strategy' }
      ]
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description (brief summary):',
      validate: (input) => input ? true : 'Description is required'
    },
    {
      type: 'list',
      name: 'points',
      message: 'Story points (Fibonacci):',
      choices: [1, 2, 3, 5, 8, 13, 21],
      default: 3
    },
    {
      type: 'list',
      name: 'priority',
      message: 'Priority (importance):',
      choices: [
        { name: 'P0 - Critical/Blocker', value: 'P0' },
        { name: 'P1 - High/Important', value: 'P1' },
        { name: 'P2 - Medium/Normal', value: 'P2' },
        { name: 'P3 - Low/Nice-to-have', value: 'P3' }
      ],
      default: 'P2'
    },
    {
      type: 'list',
      name: 'urgency',
      message: 'Urgency (time-sensitive):',
      choices: [
        { name: 'U0 - Immediate/Emergency', value: 'U0' },
        { name: 'U1 - This week', value: 'U1' },
        { name: 'U2 - This sprint', value: 'U2' },
        { name: 'U3 - Backlog', value: 'U3' }
      ],
      default: 'U2'
    }
  ]);
  
  // Ensure backlog directory exists
  const backlogDir = path.join(pmoDir, 'specs', 'backlog');
  if (!fs.existsSync(backlogDir)) {
    fs.mkdirSync(backlogDir, { recursive: true });
  }
  
  // Create spec file
  const specPath = path.join(pmoDir, 'specs', 'backlog', `${answers.id}.md`);
  
  // Load template and substitute values
  const templatePath = path.join(__dirname, '../../../templates/pmo/ticket-template.md');
  let specContent: string;
  
  try {
    const template = fs.readFileSync(templatePath, 'utf-8');
    specContent = template
      .replace(/\{\{TITLE\}\}/g, answers.title)
      .replace(/\{\{ID\}\}/g, answers.id)
      .replace(/\{\{STATUS\}\}/g, 'Backlog')
      .replace(/\{\{QUEUE\}\}/g, answers.queue)
      .replace(/\{\{POINTS\}\}/g, answers.points.toString())
      .replace(/\{\{PRIORITY\}\}/g, answers.priority)
      .replace(/\{\{URGENCY\}\}/g, answers.urgency)
      .replace(/\{\{CREATED_DATE\}\}/g, new Date().toISOString().split('T')[0])
      .replace(/\{\{DESCRIPTION\}\}/g, answers.description)
      .replace(/\{\{AGENT\}\}/g, '_Not assigned_')
      .replace(/\{\{CLAIMED_DATE\}\}/g, '_Not claimed_')
      .replace(/\{\{CRITERIA_1\}\}/g, 'TODO: Define acceptance criteria')
      .replace(/\{\{CRITERIA_2\}\}/g, 'TODO: Add more criteria as needed')
      .replace(/\{\{CRITERIA_3\}\}/g, 'TODO: Include edge cases')
      .replace(/\{\{TECHNICAL_NOTES\}\}/g, '_To be added during implementation_');
  } catch {
    // Fallback to inline template
    specContent = `# ${answers.title}

**ID**: ${answers.id}
**Status**: Backlog
**Queue**: ${answers.queue}
**Points**: ${answers.points}
**Priority**: ${answers.priority}
**Urgency**: ${answers.urgency}
**Created**: ${new Date().toISOString().split('T')[0]}

## Description

${answers.description}

## Acceptance Criteria

- [ ] TODO: Define acceptance criteria

## Technical Notes

_To be added during implementation_
`;
  }
  
  fs.writeFileSync(specPath, specContent);
  
  // Add to kanban
  const kanbanPath = path.join(pmoDir, 'kanban.md');
  if (fs.existsSync(kanbanPath)) {
    let kanban = fs.readFileSync(kanbanPath, 'utf-8');
    const queueHeader = `## ${getQueueEmoji(answers.queue)} ${answers.queue} Queue`;
    kanban = kanban.replace(
      queueHeader,
      `${queueHeader}\n\n- [ ] [[${answers.id}]] ${answers.points} pts | ${answers.priority}/${answers.urgency}`
    );
    fs.writeFileSync(kanbanPath, kanban);
  }
  
  log.success(`✅ Created ticket: ${answers.id}`);
  log.info(`Spec: ${specPath}`);
}

export async function claimTicket(ticketId?: string) {
  let pmoDir = './pmo';
  let agents: string[] = [];
  
  try {
    const config = loadConfig();
    pmoDir = path.join(path.dirname(config.workspaceDir), 'pmo');
    agents = config.activeAgents || [];
  } catch {
    pmoDir = './pmo';
  }
  
  // Get current agent from git branch or prompt
  let agent: string;
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    if (branch.startsWith('work/')) {
      agent = branch.replace('work/', '');
    } else {
      const answer = await inquirer.prompt([
        {
          type: 'input',
          name: 'agent',
          message: 'Agent name:',
          default: agents[0] || 'agent'
        }
      ]);
      agent = answer.agent;
    }
  } catch {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'agent',
        message: 'Agent name:',
        default: agents[0] || 'agent'
      }
    ]);
    agent = answer.agent;
  }
  
  // Select ticket if not provided
  if (!ticketId) {
    const specs = fs.readdirSync(path.join(pmoDir, 'specs', 'backlog'))
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''));
    
    if (specs.length === 0) {
      log.error('No tickets available in backlog');
      return;
    }
    
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'ticket',
        message: 'Select ticket:',
        choices: specs
      }
    ]);
    ticketId = answer.ticket;
  }
  
  log.info(`🎯 Claiming ${chalk.green(ticketId)} for ${chalk.cyan(agent)}`);
  
  // Update spec
  const specPath = path.join(pmoDir, 'specs', 'backlog', `${ticketId}.md`);
  if (!fs.existsSync(specPath)) {
    log.error(`Ticket not found: ${ticketId}`);
    return;
  }
  
  let spec = fs.readFileSync(specPath, 'utf-8');
  spec = spec.replace('**Status**: Backlog', '**Status**: In Progress');
  spec = spec.replace(/\*\*Agent\*\*:.*\n/, '');
  spec = spec.replace('**Created**:', `**Agent**: ${agent}\n**Claimed**: ${new Date().toISOString().split('T')[0]}\n**Created**:`);
  
  // Move to active
  const newSpecPath = path.join(pmoDir, 'specs', 'active', `${ticketId}.md`);
  fs.writeFileSync(newSpecPath, spec);
  fs.unlinkSync(specPath);
  
  // Create feature branch
  try {
    execSync(`git checkout -b feature/${ticketId}`, { encoding: 'utf-8' });
    log.success(`✅ Created branch: feature/${ticketId}`);
  } catch {
    log.warning(`Branch feature/${ticketId} may already exist`);
  }
  
  // Launch Claude if available
  const shouldLaunchClaude = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'launch',
      message: 'Launch Claude with context?',
      default: true
    }
  ]);
  
  if (shouldLaunchClaude.launch && ticketId) {
    await launchClaude(ticketId, agent, spec);
  }
  
  log.success(`✅ Ticket claimed: ${ticketId}`);
}

async function launchClaude(ticketId: string, agent: string, spec: string) {
  const contextFile = `/tmp/prlt-claude-${Date.now()}.md`;
  const context = `# Agent Context

You are agent **${agent}** working on ticket **${ticketId}**.

## Current Task

${spec}

## Instructions

1. Review the ticket requirements above
2. Implement the solution
3. Write tests if applicable
4. Commit changes with ticket reference
5. Create PR when ready

Begin by exploring the codebase to understand the current implementation.
`;
  
  fs.writeFileSync(contextFile, context);
  
  try {
    // Check if claude CLI is available
    execSync('which claude', { encoding: 'utf-8' });
    
    log.info('🚀 Launching Claude CLI...');
    execSync(`claude < ${contextFile}`, { stdio: 'inherit' });
  } catch {
    log.warning('Claude CLI not found');
    log.info(`Context saved to: ${contextFile}`);
    log.info('Install Claude CLI: https://claude.ai/download');
  }
}

function getQueueEmoji(queue: string): string {
  const emojis: Record<string, string> = {
    'Build': '🏗️',
    'Grow': '📈',
    'Support': '🛟',
    'BizOps': '⚙️',
    'Strategy': '🎯'
  };
  return emojis[queue] || '📋';
}