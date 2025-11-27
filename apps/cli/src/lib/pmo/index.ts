import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { SQLiteStorage } from './storage-sqlite.js';

// Re-export new PMO modules
export * from './types.js';
export * from './utils.js';
export {
  parseBoard,
  generateBoardMarkdown,
  findAddedTickets,
  findRemovedTickets,
  findModifiedTickets,
} from './markdown.js';
export { SQLiteStorage } from './storage-sqlite.js';
export {
  getStorageWithAutoSync,
  autoExportToBoard,
  withAutoExport,
  autoSyncFromBoard,
  getBoardPath,
} from './sync-manager.js';
export {
  startWatcher,
  runWatcherForeground,
  type WatcherOptions,
  type WatcherInstance,
  type SyncStats,
} from './watcher.js';

// Legacy config interface (for backward compatibility)
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
    kanban: ['Backlog', 'In Progress', 'Done'],
    scrum: ['Backlog', 'In Progress', 'In Review', 'Blocked', 'Done'],
    founder: [
      'BUILD BL', 'GROW BL', 'SUPPORT BL', 'BIZOPS BL', 'STRATEGY BL',
      'Ready', 'In Progress', 'In Review', 'Merged', 'Published', 'Dropped'
    ],
    custom: [] // Will be handled separately
  };
}

export type PMOStorageType = 'sqlite' | 'git';

export interface PMOSetupResult {
  includePMO: boolean;
  boardTemplate: string;
  storageType: PMOStorageType;
}

/**
 * Prompt user for PMO setup
 */
export async function promptForPMOSetup(): Promise<PMOSetupResult> {
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

  let boardTemplate = 'kanban';
  let storageType: PMOStorageType = 'sqlite';

  if (includePMO) {
    // Ask for storage type
    const { storage } = await inquirer.prompt([{
      type: 'list',
      name: 'storage',
      message: 'Choose storage backend:',
      choices: [
        {
          name: 'SQLite (local only, fast, no sync)',
          value: 'sqlite',
        },
        {
          name: 'Git (markdown file + cache, sync via git)',
          value: 'git',
        },
      ],
      default: 'sqlite',
    }]);
    storageType = storage;

    // Ask for board template
    const { template } = await inquirer.prompt([{
      type: 'list',
      name: 'template',
      message: 'Choose board template:',
      choices: [
        { name: 'Kanban (Backlog, In Progress, Done)', value: 'kanban' },
        { name: 'Scrum (+ In Review, Blocked)', value: 'scrum' },
        { name: '5-Tool Founder (BUILD/GROW/SUPPORT/BIZOPS/STRATEGY + workflow)', value: 'founder' },
        { name: 'Custom', value: 'custom' },
      ],
    }]);
    boardTemplate = template;
  }

  return { includePMO, boardTemplate, storageType };
}

/**
 * Get columns for a board template
 */
export function getColumnsForTemplate(template: string): string[] {
  const templates = getBoardTemplates();
  return templates[template] || templates.kanban;
}

/**
 * Create board content for Obsidian Kanban
 */
export function createBoardContent(template: string): string {
  const columns = getColumnsForTemplate(template);
  const icons: Record<string, string> = {
    // Kanban/Scrum
    'Backlog': '📥',
    'In Progress': '🚀',
    'In Review': '👀',
    'Blocked': '🚧',
    'Done': '✅',
    // 5-Tool Founder backlogs
    'BUILD BL': '🔨',
    'GROW BL': '📈',
    'SUPPORT BL': '🛟',
    'BIZOPS BL': '⚙️',
    'STRATEGY BL': '🎯',
    // 5-Tool Founder workflow
    'Ready': '📥',
    'Merged': '🔀',
    'Published': '🚀',
    'Dropped': '🗑️',
  };

  let content = '---\nkanban-plugin: obsidian-kanban\n---\n\n';
  
  for (const column of columns) {
    const icon = icons[column] || '📋';
    content += `## ${icon} ${column}\n\n`;
  }

  return content;
}

/**
 * PMO config file structure (new format with SQLite storage)
 */
interface PMOConfigFile {
  storage: 'sqlite' | 'git';
  template: string;
  boardName: string;
  columns: string[];
  created: string;
  gitRemote?: string;
  autoSync?: boolean;
}

/**
 * Create PMO structure in HQ
 *
 * PMO data is stored in the unified workspace.db (pmo_* tables)
 * This allows foreign key relationships between agents and tickets
 */
export async function createPMO(
  hqPath: string,
  boardTemplate: string,
  storageType: PMOStorageType = 'sqlite'
): Promise<void> {
  console.log(chalk.blue('Creating PMO structure...'));

  const pmoPath = path.join(hqPath, 'pmo');
  const columns = getColumnsForTemplate(boardTemplate);
  const boardName = 'Project Board';

  // Create PMO directories
  fs.mkdirSync(pmoPath, { recursive: true });
  fs.mkdirSync(path.join(pmoPath, 'specs'), { recursive: true });

  // Create PMO config (new format)
  const pmoConfig: PMOConfigFile = {
    storage: storageType,
    template: boardTemplate,
    boardName,
    columns,
    created: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(pmoPath, 'config.json'),
    JSON.stringify(pmoConfig, null, 2)
  );

  // Create board.md for Obsidian viewing (both storage types)
  const boardContent = createBoardContent(boardTemplate);
  fs.writeFileSync(path.join(pmoPath, 'board.md'), boardContent);
  console.log(chalk.green('  ✓ board.md created'));

  // Initialize PMO tables in workspace.db
  // workspace.db is created by init and already has pmo_* tables from schema
  const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`workspace.db not found. Run 'prlt init' first.`);
  }

  const storage = new SQLiteStorage(dbPath);
  await storage.init({
    name: boardName,
    columns,
  });
  await storage.close();
  console.log(chalk.green('  ✓ PMO tables initialized in workspace.db'));

  // Create README for PMO
  // Note: PMO data is now stored in workspace.db, not a separate board.db
  const storageDesc = `- **config.json** - PMO configuration
- **board.md** - Kanban board (Obsidian compatible, auto-synced with database)
- **specs/** - Detailed specifications for tickets
- Data stored in \`../.proletariat/workspace.db\` (pmo_* tables)`;

  const syncCommands = storageType === 'git'
    ? `
# Sync (git storage)
prlt board pull
prlt board push
`
    : '';

  const readmeContent = `# Project Management Office (PMO)

This directory contains project management resources for the HQ.

## Storage: ${storageType}

## Template: ${boardTemplate}

## Structure

${storageDesc}

## Commands

\`\`\`bash
# View board
prlt pmo board view

# Create ticket
prlt ticket create --title "My ticket" --column "Backlog"

# List tickets
prlt ticket list
prlt ticket list --column "In Progress"
prlt ticket list --priority URGENT

# Move ticket
prlt ticket move <ticket-id> "In Progress"
${syncCommands}\`\`\`

## Columns

${columns.join(', ')}
`;

  fs.writeFileSync(path.join(pmoPath, 'README.md'), readmeContent);

  console.log(chalk.green(`✅ PMO created with ${boardTemplate} template (${storageType} storage)`));
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