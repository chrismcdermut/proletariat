import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { SQLiteStorage } from './storage-sqlite.js';
import { createSpecFolders } from './create-spec-folders.js';
import { slugify } from './utils.js';
import { createDevcontainerConfig } from '../execution/devcontainer.js';

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
  getWorkspaceDbPath,
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
  getProductPath,
  getEpicsPath,
} from './create-spec-folders.js';
export { findPMO } from './find-pmo.js';
export { getPMOContext, type PMOContext, type GetPMOContextOptions } from './pmo-context.js';
export { PMOCommand, pmoBaseFlags } from './base-command.js';
export {
  PMO_TABLES,
  PMO_TABLE_SCHEMAS,
  PMO_INDEXES,
  PMO_SCHEMA_SQL,
  EXPECTED_TICKET_COLUMNS,
  validateTicketSchema,
} from './schema.js';


/**
 * Get available board templates
 */
export function getBoardTemplates(): { [key: string]: string[] } {
  return {
    // Linear-style: Simple workflow with Planned for scheduled work
    kanban: ['Backlog', 'Planned', 'In Progress', 'Done'],
    // Linear-style with Canceled column for visibility
    linear: ['Backlog', 'Planned', 'In Progress', 'Done', 'Canceled'],
    // Founder template: 5-tool backlogs + workflow stages
    founder: [
      'SHIP BL', 'GROW BL', 'SUPPORT BL', 'BIZOPS BL', 'STRATEGY BL',
      'Planned', 'In Progress', 'Done', 'Dropped'
    ],
    custom: [] // Will be handled separately
  };
}

/**
 * Get column settings for work commands based on board template.
 * These settings determine which columns are used for:
 * - work start: moves ticket to column_in_progress
 * - work ready: moves ticket to column_review
 * - work complete: moves ticket to column_done
 *
 * For custom templates, we try to find matching columns by keyword.
 */
export function getColumnSettingsForTemplate(
  template: string,
  columns: string[]
): { column_planned: string; column_in_progress: string; column_done: string } {
  // Template-specific mappings (Linear-style: planned -> in_progress -> done)
  const templateMappings: Record<string, { column_planned: string; column_in_progress: string; column_done: string }> = {
    kanban: {
      column_planned: 'Planned',
      column_in_progress: 'In Progress',
      column_done: 'Done',
    },
    linear: {
      column_planned: 'Planned',
      column_in_progress: 'In Progress',
      column_done: 'Done',
    },
    founder: {
      column_planned: 'Planned',
      column_in_progress: 'In Progress',
      column_done: 'Done',
    },
  };

  // Use template mapping if available
  if (templateMappings[template]) {
    return templateMappings[template];
  }

  // For custom templates, try to find matching columns by keyword
  const findColumn = (keywords: string[], fallback: string): string => {
    const lowerColumns = columns.map(c => c.toLowerCase());
    for (const keyword of keywords) {
      const idx = lowerColumns.findIndex(c => c.includes(keyword));
      if (idx !== -1) return columns[idx];
    }
    return fallback;
  };

  return {
    column_planned: findColumn(['planned', 'ready', 'scheduled', 'todo'], columns[1] || 'Planned'),
    column_in_progress: findColumn(['progress', 'active', 'doing', 'working'], columns[2] || 'In Progress'),
    column_done: findColumn(['done', 'complete', 'finished', 'published', 'shipped'], columns[columns.length - 1] || 'Done'),
  };
}

export type PMOStorageType = 'sqlite' | 'git';
export type PMOLocation = 'separate' | `repo:${string}`;

export interface PMOSetupResult {
  includePMO: boolean;
  boardTemplate: string;
  storageType: PMOStorageType;
  location: PMOLocation;
  boardName: string;
  columns: string[];
}

/**
 * Detect repositories in an HQ
 */
export function detectRepos(hqRoot: string): Array<{ name: string; path: string }> {
  const reposDir = path.join(hqRoot, 'repos');
  if (!fs.existsSync(reposDir)) {
    return [];
  }

  const entries = fs.readdirSync(reposDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      path: path.join(reposDir, entry.name),
    }));
}

/**
 * Prompt for PMO location (in-repo vs separate)
 */
export async function promptForPMOLocation(hqRoot: string | null): Promise<PMOLocation> {
  if (!hqRoot) {
    return 'separate';
  }

  const repos = detectRepos(hqRoot);

  if (repos.length === 0) {
    return 'separate';
  } else if (repos.length === 1) {
    const { location } = await inquirer.prompt([{
      type: 'list',
      name: 'location',
      message: 'PMO location:',
      choices: [
        {
          name: `Inside repo (${repos[0].name}/pmo)`,
          value: `repo:${repos[0].name}`,
        },
        {
          name: 'Separate from repo (hq/pmo)',
          value: 'separate',
        },
      ],
      default: `repo:${repos[0].name}`,
    }]);
    return location;
  } else {
    const { location } = await inquirer.prompt([{
      type: 'list',
      name: 'location',
      message: 'PMO location:',
      choices: [
        {
          name: 'Separate from repos (recommended for multi-repo HQs)',
          value: 'separate',
        },
        new inquirer.Separator(),
        ...repos.map(repo => ({
          name: `Inside ${repo.name} repo`,
          value: `repo:${repo.name}`,
        })),
      ],
      default: 'separate',
    }]);
    return location;
  }
}

/**
 * Prompt for board template
 */
export async function promptForBoardTemplate(): Promise<string> {
  const { template } = await inquirer.prompt([{
    type: 'list',
    name: 'template',
    message: 'Choose board template:',
    choices: [
      { name: 'Kanban (Backlog, Planned, In Progress, Done)', value: 'kanban' },
      { name: 'Linear (+ Canceled column)', value: 'linear' },
      { name: '5-Tool Founder (SHIP/GROW/SUPPORT/BIZOPS/STRATEGY + workflow)', value: 'founder' },
      { name: 'Custom (define your own columns)', value: 'custom' },
    ],
    default: 'kanban',
  }]);
  return template;
}

/**
 * Prompt for custom columns
 */
export async function promptForCustomColumns(): Promise<string[]> {
  const { columnsInput } = await inquirer.prompt([{
    type: 'input',
    name: 'columnsInput',
    message: 'Enter column names (comma-separated):',
    default: 'Backlog, In Progress, Done',
    validate: (input: string) => {
      const cols = input.split(',').map(c => c.trim()).filter(Boolean);
      if (cols.length < 2) {
        return 'Please enter at least 2 columns';
      }
      return true;
    },
  }]);
  return columnsInput.split(',').map((c: string) => c.trim()).filter(Boolean);
}

/**
 * Prompt for board name
 */
export async function promptForBoardName(defaultName?: string): Promise<string> {
  const { name } = await inquirer.prompt([{
    type: 'input',
    name: 'name',
    message: 'Board name:',
    default: defaultName || 'Project Board',
  }]);
  return name;
}

/**
 * Full PMO setup prompt - used by both `prlt init` and `prlt pmo init`
 */
export async function promptForPMOSetup(hqRoot: string | null, hqName?: string): Promise<PMOSetupResult> {
  // Ask if they want PMO
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

  if (!includePMO) {
    return {
      includePMO: false,
      boardTemplate: 'kanban',
      storageType: 'sqlite',
      location: 'separate',
      boardName: '',
      columns: [],
    };
  }

  // PMO location (in-repo vs separate)
  const location = await promptForPMOLocation(hqRoot);

  // Board template
  const boardTemplate = await promptForBoardTemplate();

  // Get columns for template (or prompt for custom)
  let columns = getColumnsForTemplate(boardTemplate);
  if (boardTemplate === 'custom') {
    columns = await promptForCustomColumns();
  }

  // Board name - default to {hqname}-kanban if hqName provided
  const defaultBoardName = hqName ? `${hqName}-kanban` : undefined;
  const boardName = await promptForBoardName(defaultBoardName);

  return {
    includePMO: true,
    boardTemplate,
    storageType: 'sqlite', // Always SQLite now
    location,
    boardName,
    columns,
  };
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
export function createBoardContent(template: string, boardName?: string): string {
  const columns = getColumnsForTemplate(template);
  const icons: Record<string, string> = {
    // Linear-style workflow
    'Backlog': '📥',
    'Planned': '📋',
    'In Progress': '🚀',
    'Done': '✅',
    'Canceled': '🚫',
    // 5-Tool Founder backlogs
    'SHIP BL': '🚢',
    'GROW BL': '📈',
    'SUPPORT BL': '🛟',
    'BIZOPS BL': '⚙️',
    'STRATEGY BL': '🎯',
    // 5-Tool Founder workflow
    'Dropped': '🗑️',
  };

  let content = '---\nkanban-plugin: obsidian-kanban\n---\n\n';

  // Add board title (matches parser expectation for `# Title` line)
  if (boardName) {
    content += `# ${boardName}\n\n`;
  }

  for (const column of columns) {
    const icon = icons[column] || '📋';
    content += `## ${icon} ${column}\n\n`;
  }

  return content;
}


/**
 * Determine PMO path based on location setting
 */
export function determinePMOPath(hqPath: string, location: PMOLocation): string {
  if (location === 'separate') {
    return path.join(hqPath, 'pmo');
  } else if (location.startsWith('repo:')) {
    const repoName = location.substring(5);
    return path.join(hqPath, 'repos', repoName, 'pmo');
  }
  throw new Error(`Invalid PMO location: ${location}`);
}

export interface CreatePMOOptions {
  hqPath: string;
  location: PMOLocation;
  boardTemplate: string;
  boardName: string;
  columns: string[];
  storageType?: PMOStorageType;
}

/**
 * Create PMO structure in HQ
 *
 * Used by both `prlt init` and `prlt pmo init` for consistent behavior.
 *
 * Structure:
 * - PMO data is stored in workspace.db (pmo_* tables)
 * - Boards live in pmo/projects/{id}/board.md
 * - Specs live in pmo/projects/{id}/specs/{active,complete,future,dropped}
 */
export async function createPMO(options: CreatePMOOptions): Promise<void> {
  const {
    hqPath,
    location,
    boardTemplate,
    boardName,
    columns,
  } = options;

  console.log(chalk.blue('Creating PMO structure...'));

  // Determine PMO path based on location
  const pmoPath = determinePMOPath(hqPath, location);

  // Generate project ID from board name
  const projectId = slugify(boardName);

  // Create PMO directory
  fs.mkdirSync(pmoPath, { recursive: true });

  // Initialize workspace.db with PMO tables
  const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`workspace.db not found. Run 'prlt init' first.`);
  }

  const storage = new SQLiteStorage(dbPath);

  // Create project
  await storage.createProject({
    id: projectId,
    name: boardName,
    description: `Project for ${boardName}`,
    template: boardTemplate,
  });

  // Initialize board with columns (projectId already created above)
  await storage.init(projectId, {
    name: boardName,
    columns,
  });

  // Save PMO path and column settings (relative to HQ root for container compatibility)
  try {
    const db = new (await import('better-sqlite3')).default(dbPath);
    // Store relative path from HQ root (e.g., "pmo" or "repos/myrepo/pmo")
    const relativePmoPath = path.relative(hqPath, pmoPath);
    db.prepare('INSERT OR REPLACE INTO pmo_settings (key, value) VALUES (?, ?)').run('pmo_path', relativePmoPath);

    // Set column settings based on template
    // These determine which columns work commands use for transitions
    const columnSettings = getColumnSettingsForTemplate(boardTemplate, columns);
    for (const [key, value] of Object.entries(columnSettings)) {
      db.prepare('INSERT OR REPLACE INTO pmo_settings (key, value) VALUES (?, ?)').run(key, value);
    }

    db.close();
  } catch {
    // Ignore if settings table doesn't exist
  }

  await storage.close();
  console.log(chalk.green('  ✓ PMO tables initialized in workspace.db'));
  console.log(chalk.green(`  ✓ Project "${projectId}" created`));

  // Create project folder structure: pmo/projects/{projectId}/
  const projectPath = path.join(pmoPath, 'projects', projectId);
  fs.mkdirSync(projectPath, { recursive: true });

  // Create spec folders in project directory
  createSpecFolders(pmoPath, projectId);
  console.log(chalk.green('  ✓ Spec folders created'));

  // Create kanban.md in project directory with board name as title
  const boardFileName = 'kanban.md';
  const boardContent = createBoardContent(boardTemplate, boardName);
  const boardFilePath = path.join(projectPath, boardFileName);
  fs.writeFileSync(boardFilePath, boardContent);
  console.log(chalk.green(`  ✓ ${boardFileName} created`));

  // Create README for PMO
  const readmeContent = `# PMO (Project Management Office)

## Template: ${boardTemplate}

## Structure

### product/ - Living Product Definitions
Specs, requirements, and architecture docs that define WHAT the product should do.
These don't move through lifecycle - they get updated in place as the product evolves.

### projects/{id}/ - Implementation Work
Work that flows through a lifecycle to build the product.

\`\`\`
pmo/
├── product/                    # WHAT (specs, requirements, architecture)
│   ├── init-commands.md        # How init should work
│   ├── ticket-commands.md      # How tickets should work
│   └── architecture.md         # System design
│
└── projects/
    └── {project-id}/
        ├── {project-id}-kanban.md  # Kanban board (Obsidian compatible)
        └── epics/                  # Implementation work
            ├── draft/              # Planning phase
            ├── active/             # Currently implementing
            └── complete/           # Done
\`\`\`

## Commands
\`\`\`bash
# Create ticket
prlt ticket create --title "My ticket" --column "Backlog"

# List tickets
prlt ticket list
prlt ticket list --column "In Progress"

# Move ticket
prlt ticket move <ticket-id> "In Progress"

# View board
prlt board view
\`\`\`

## Columns
${columns.join(', ')}

## Obsidian Setup
1. Open this folder as an Obsidian vault
2. Install the "Kanban" plugin
3. Open ${projectId}-kanban.md and switch to Kanban view
`;

  fs.writeFileSync(path.join(pmoPath, 'README.md'), readmeContent);

  // Create devcontainer for separate PMO (it's its own repo)
  if (location === 'separate') {
    console.log(chalk.blue('Creating devcontainer config for PMO...'));
    createDevcontainerConfig({
      agentName: 'pmo',
      agentDir: pmoPath,
      repoWorktrees: [],  // PMO is the repo itself, no nested worktrees
    });
    console.log(chalk.green('  ✓ Devcontainer config created'));
  }

  const locationDesc = location === 'separate' ? 'hq/pmo' : location.replace('repo:', '') + '/pmo';
  console.log(chalk.green(`✅ PMO created at ${locationDesc} with ${boardTemplate} template`));
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

