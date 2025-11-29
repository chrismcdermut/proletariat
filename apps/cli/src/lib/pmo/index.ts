import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { SQLiteStorage } from './storage-sqlite.js';
import { createSpecFolders } from './create-spec-folders.js';

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
export {
  createSpecFolders,
  getSpecFolderPath,
  getProjectPath,
} from './create-spec-folders.js';
export { findPMO } from './find-pmo.js';
export { getPMOContext, type PMOContext } from './pmo-context.js';


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
 * Create PMO structure in HQ
 *
 * New structure:
 * - PMO data is stored in workspace.db (pmo_* tables)
 * - Default project uses HQ name
 * - Boards live in pmo/projects/{id}/board.md
 * - Specs live in pmo/projects/{id}/specs/{active,complete,future,dropped}
 * - No config.json - all configuration in database
 */
export async function createPMO(
  hqPath: string,
  boardTemplate: string,
  storageType: PMOStorageType = 'sqlite',
  hqName?: string
): Promise<void> {
  console.log(chalk.blue('Creating PMO structure...'));

  const pmoPath = path.join(hqPath, 'pmo');
  const columns = getColumnsForTemplate(boardTemplate);

  // Use provided HQ name or default
  const projectId = hqName || 'default';
  const boardName = `${projectId} Board`;

  // Create PMO directory
  fs.mkdirSync(pmoPath, { recursive: true });

  // Initialize workspace.db with PMO tables
  const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`workspace.db not found. Run 'prlt init' first.`);
  }

  const storage = new SQLiteStorage(dbPath);

  // Create default project using HQ name
  await storage.createProject({
    id: projectId,
    name: boardName,
    description: `Default project for ${projectId}`,
    template: boardTemplate,
  });

  // Set as current project and initialize board
  storage.setCurrentProject(projectId);
  await storage.init({
    name: boardName,
    columns,
  });

  // Store PMO settings in database (no config.json)
  // TODO: Add pmo_settings table to store storageType, etc.

  await storage.close();
  console.log(chalk.green('  ✓ PMO tables initialized in workspace.db'));
  console.log(chalk.green(`  ✓ Default project "${projectId}" created`));

  // Create project folder structure: pmo/projects/{projectId}/
  const projectPath = path.join(pmoPath, 'projects', projectId);
  fs.mkdirSync(projectPath, { recursive: true });

  // Create spec folders in project directory
  createSpecFolders(pmoPath, projectId);
  console.log(chalk.green('  ✓ Spec folders created'));

  // Create board.md in project directory
  const boardContent = createBoardContent(boardTemplate);
  const boardPath = path.join(projectPath, 'board.md');
  fs.writeFileSync(boardPath, boardContent);
  console.log(chalk.green('  ✓ board.md created'));

  // Create README for PMO
  const storageDesc = `- **projects/{id}/board.md** - Kanban boards (Obsidian compatible, auto-synced with database)
- **projects/{id}/specs/** - Detailed specifications for tickets (active, complete, future, dropped)
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

# Projects
prlt project create "New Project"
prlt project list
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
 * Check if PMO exists in HQ by checking workspace.db for pmo_projects table
 */
export function hasPMO(hqPath: string): boolean {
  const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');

  if (!fs.existsSync(dbPath)) {
    return false;
  }

  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
    ).get();
    db.close();

    return result !== undefined;
  } catch {
    return false;
  }
}

