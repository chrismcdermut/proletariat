import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';

export interface PMOConfig {
  boardTitle: string;
  queues: string[];
  lastTicketId: number;
  columns: string[];
}

/**
 * Get available board templates
 */
export function getBoardTemplates(): { [key: string]: string[] } {
  return {
    basic: ['Backlog', 'In Progress', 'Done'],
    extended: ['Backlog', 'In Progress', 'In Review', 'Blocked', 'Done'],
    custom: [] // Will be handled separately
  };
}

/**
 * Prompt user for PMO setup
 */
export async function promptForPMOSetup(): Promise<{ includePMO: boolean; boardTemplate: string }> {
  const { includePMO } = await inquirer.prompt([{
    type: 'list',
    name: 'includePMO',
    message: 'Include project management office (PMO)?',
    choices: [
      { name: 'Yes', value: true },
      { name: 'No', value: false }
    ],
    default: true,
  }]);

  let boardTemplate = 'extended';
  if (includePMO) {
    const { template } = await inquirer.prompt([{
      type: 'list',
      name: 'template',
      message: 'Choose board template:',
      choices: [
        { name: 'Basic (Backlog, In Progress, Done)', value: 'basic' },
        { name: 'Extended (+ In Review, Blocked)', value: 'extended' },
        { name: 'Custom', value: 'custom' },
      ],
    }]);
    boardTemplate = template;
  }

  return { includePMO, boardTemplate };
}

/**
 * Get columns for a board template
 */
export function getColumnsForTemplate(template: string): string[] {
  const templates = getBoardTemplates();
  return templates[template] || templates.basic;
}

/**
 * Create board content for Obsidian Kanban
 */
export function createBoardContent(template: string): string {
  const columns = getColumnsForTemplate(template);
  const icons: Record<string, string> = {
    'Backlog': '📥',
    'In Progress': '🚀',
    'In Review': '👀',
    'Blocked': '🚧',
    'Done': '✅',
  };

  let content = '---\nkanban-plugin: obsidian-kanban\n---\n\n';
  
  for (const column of columns) {
    const icon = icons[column] || '📋';
    content += `## ${icon} ${column}\n\n`;
  }

  return content;
}

/**
 * Create PMO structure in HQ
 */
export async function createPMO(hqPath: string, boardTemplate: string): Promise<void> {
  console.log(chalk.blue('Creating PMO structure...'));
  
  const pmoPath = path.join(hqPath, 'pmo');
  
  // Create PMO directories
  fs.mkdirSync(pmoPath, { recursive: true });
  fs.mkdirSync(path.join(pmoPath, 'specs', 'backlog'), { recursive: true });
  fs.mkdirSync(path.join(pmoPath, 'specs', 'active'), { recursive: true });
  fs.mkdirSync(path.join(pmoPath, 'specs', 'completed'), { recursive: true });

  // Create PMO config
  const pmoConfig: PMOConfig = {
    boardTitle: 'Project Board',
    queues: ['feature', 'bug', 'refactor', 'docs', 'devops'],
    lastTicketId: 0,
    columns: getColumnsForTemplate(boardTemplate),
  };

  fs.writeFileSync(
    path.join(pmoPath, 'config.json'),
    JSON.stringify(pmoConfig, null, 2)
  );

  // Create initial board.md
  const boardContent = createBoardContent(boardTemplate);
  fs.writeFileSync(path.join(pmoPath, 'board.md'), boardContent);

  // Create README for PMO
  const readmeContent = `# Project Management Office (PMO)

This directory contains project management resources for the HQ.

## Structure

- \`config.json\` - PMO configuration
- \`board.md\` - Main kanban board (Obsidian compatible)
- \`specs/\` - Ticket specifications organized by status
  - \`backlog/\` - Tickets waiting to be worked on
  - \`active/\` - Tickets currently in progress
  - \`completed/\` - Completed tickets

## Usage

Use \`prlt ticket create\` to create new tickets.
Use \`prlt pmo board\` to view/edit the board.

## Board Template: ${boardTemplate}

Columns: ${pmoConfig.columns.join(', ')}
`;

  fs.writeFileSync(path.join(pmoPath, 'README.md'), readmeContent);

  // Initialize git for PMO
  try {
    execSync('git init', { cwd: pmoPath, stdio: 'pipe' });
    execSync('git add .', { cwd: pmoPath, stdio: 'pipe' });
    execSync('git commit -m "Initial PMO setup"', { cwd: pmoPath, stdio: 'pipe' });
    console.log(chalk.green('✅ PMO git repository initialized'));
  } catch (error) {
    console.log(chalk.yellow('Could not initialize git for PMO'));
  }

  console.log(chalk.green(`✅ PMO created with ${boardTemplate} template`));
}

/**
 * Update HQ config to include PMO
 */
export function updateHQConfigWithPMO(hqPath: string): void {
  const configPath = path.join(hqPath, '.proletariat', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  
  config.hasPMO = true;
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Check if PMO exists in HQ
 */
export function hasPMO(hqPath: string): boolean {
  const pmoPath = path.join(hqPath, 'pmo');
  return fs.existsSync(pmoPath) && fs.existsSync(path.join(pmoPath, 'config.json'));
}

/**
 * Get PMO config
 */
export function getPMOConfig(hqPath: string): PMOConfig | null {
  const pmoConfigPath = path.join(hqPath, 'pmo', 'config.json');
  
  if (!fs.existsSync(pmoConfigPath)) {
    return null;
  }
  
  return JSON.parse(fs.readFileSync(pmoConfigPath, 'utf-8')) as PMOConfig;
}