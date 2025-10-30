import * as fs from 'fs';
import * as path from 'path';
import { getProjectRoot } from '../config/index.js';
import { log } from '../utils/logger.js';
import { README_TEMPLATE, KANBAN_TEMPLATE, SPEC_TEMPLATE, ENGINEERING_LEARNINGS_TEMPLATE } from './templates.js';

const DEFAULT_PMO_DIR = 'pmo';
const SUB_DIRECTORIES = ['active-work', 'completed-work', 'future-work'];
const IGNORE_DIRECTORIES = new Set([
  '.git',
  '.husky',
  '.idea',
  '.obsidian',
  '.turbo',
  '.nx',
  '.next',
  'build',
  'dist',
  'node_modules',
  'vendor'
]);

export interface PmoInitOptions {
  targetPath?: string;
  force?: boolean;
}

export interface PmoRollupOptions {
  root?: string;
  output?: string;
  maxDepth?: number;
}

interface BoardTask {
  column: string;
  lines: string[];
}

interface BoardInfo {
  project: string;
  boardPath: string;
  pmoRoot: string;
  tasks: BoardTask[];
}

function resolveTargetDirectory(targetPath?: string): string {
  let baseDir = process.cwd();

  try {
    const projectRoot = getProjectRoot();
    baseDir = projectRoot;
  } catch {
    // Not in a git repository; use CWD
  }

  if (!targetPath) {
    return path.resolve(baseDir, DEFAULT_PMO_DIR);
  }

  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.resolve(baseDir, targetPath);
}

function writeFileSafely(filePath: string, content: string, force = false): void {
  if (fs.existsSync(filePath) && !force) {
    log.warning(`Skipped existing file: ${filePath}`);
    return;
  }

  fs.writeFileSync(filePath, content, 'utf8');
  log.success(`Wrote ${filePath}`);
}

export function initPmoStructure(options: PmoInitOptions = {}): string {
  const targetDir = resolveTargetDirectory(options.targetPath);
  const force = Boolean(options.force);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    log.success(`Created PMO directory: ${targetDir}`);
  } else {
    log.info(`PMO directory already exists: ${targetDir}`);
  }

  SUB_DIRECTORIES.forEach(dirName => {
    const fullPath = path.join(targetDir, dirName);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      log.success(`Created ${fullPath}`);
    } else {
      log.info(`Directory already exists: ${fullPath}`);
    }
  });

  writeFileSafely(path.join(targetDir, 'README.md'), README_TEMPLATE, force);
  writeFileSafely(path.join(targetDir, 'kanban.md'), KANBAN_TEMPLATE, force);
  writeFileSafely(path.join(targetDir, 'SPEC_TEMPLATE.md'), SPEC_TEMPLATE, force);
  writeFileSafely(path.join(targetDir, 'engineering-learnings.md'), ENGINEERING_LEARNINGS_TEMPLATE, force);

  log.success('PMO scaffolding complete.');
  log.info('Add specs under active-work/, future-work/, or completed-work/ and keep kanban.md in sync.');

  return targetDir;
}

function findKanbanBoards(root: string, maxDepth: number): BoardInfo[] {
  const resolvedRoot = path.resolve(root);
  const discovered = new Map<string, BoardInfo>();
  const queue: Array<{ dir: string; depth: number }> = [{ dir: resolvedRoot, depth: 0 }];

  while (queue.length > 0) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number };

    if (depth > maxDepth) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (IGNORE_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.name === DEFAULT_PMO_DIR) {
        const boardPath = path.join(fullPath, 'kanban.md');
        if (!fs.existsSync(boardPath)) {
          continue;
        }

        const project = path.basename(path.dirname(fullPath));
        if (!discovered.has(boardPath)) {
          discovered.set(boardPath, {
            project,
            boardPath,
            pmoRoot: fullPath,
            tasks: parseKanban(boardPath)
          });
        }
      }

      queue.push({ dir: fullPath, depth: depth + 1 });
    }
  }

  return Array.from(discovered.values()).sort((a, b) => a.project.localeCompare(b.project));
}

function stripFrontMatter(lines: string[]): string[] {
  if (lines.length === 0) {
    return lines;
  }

  if (!lines[0].trim().startsWith('---')) {
    return lines;
  }

  const stripped: string[] = [];
  let inFrontMatter = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '---') {
      if (!inFrontMatter) {
        inFrontMatter = true;
        continue;
      }
      inFrontMatter = false;
      continue;
    }

    if (!inFrontMatter) {
      stripped.push(line);
    }
  }

  return stripped;
}

function parseKanban(boardPath: string): BoardTask[] {
  const content = fs.readFileSync(boardPath, 'utf8');
  const lines = stripFrontMatter(content.split(/\r?\n/));
  const tasks: BoardTask[] = [];
  const bulletRegex = /^-\s*\[[ xX]\]/;

  let currentColumn: string | null = null;
  let currentTask: BoardTask | null = null;

  const pushTask = (): void => {
    if (currentTask && currentTask.lines.length > 0) {
      tasks.push(currentTask);
    }
    currentTask = null;
  };

  for (const rawLine of lines) {
    const line = rawLine;

    if (line.startsWith('## ')) {
      pushTask();
      currentColumn = line.slice(3).trim();
      continue;
    }

    if (!currentColumn) {
      continue;
    }

    if (bulletRegex.test(line)) {
      pushTask();
      currentTask = { column: currentColumn, lines: [line] };
      continue;
    }

    if (currentTask) {
      if (line.trim().length === 0) {
        currentTask.lines.push('');
      } else if (/^\s+/.test(line)) {
        currentTask.lines.push(line);
      } else {
        currentTask.lines.push(`    ${line}`);
      }
    }
  }

  pushTask();

  return tasks;
}

function annotateTaskLines(lines: string[], project: string): string[] {
  const hasProjectLine = lines.some(line => line.trim().toLowerCase().startsWith('**project:**'));
  if (hasProjectLine) {
    return lines;
  }

  const [firstLine, ...rest] = lines;
  const annotation = `      **Project:** ${project}`;
  return [firstLine, annotation, ...rest];
}

function aggregateBoards(boards: BoardInfo[]): string {
  const columnOrder: string[] = [];
  const aggregated = new Map<string, string[]>();

  for (const board of boards) {
    for (const task of board.tasks) {
      if (!columnOrder.includes(task.column)) {
        columnOrder.push(task.column);
      }

      const annotated = annotateTaskLines(task.lines, board.project);
      if (!aggregated.has(task.column)) {
        aggregated.set(task.column, []);
      }
      aggregated.get(task.column)?.push(annotated.join('\n'));
    }
  }

  const lines: string[] = [
    '---',
    'kanban-plugin: board',
    '---',
    ''
  ];

  for (const column of columnOrder) {
    lines.push(`## ${column}`, '');
    const entries = aggregated.get(column) ?? [];
    if (entries.length === 0) {
      continue;
    }

    for (const entry of entries) {
      lines.push(entry, '');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

export function rollupPmoBoards(options: PmoRollupOptions = {}): string | undefined {
  const maxDepth = options.maxDepth ?? 3;
  let searchRoot: string | undefined;

  if (options.root) {
    searchRoot = path.resolve(options.root);
  } else {
    try {
      const projectRoot = getProjectRoot();
      searchRoot = path.dirname(projectRoot);
    } catch {
      searchRoot = process.cwd();
    }
  }

  if (!fs.existsSync(searchRoot)) {
    log.error(`Root path not found: ${searchRoot}`);
    return;
  }

  const boards = findKanbanBoards(searchRoot, maxDepth);

  if (boards.length === 0) {
    log.warning(`No PMO boards found under ${searchRoot}`);
    return;
  }

  const aggregated = aggregateBoards(boards);

  if (options.output) {
    const outputPath = path.resolve(options.output);
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, aggregated, 'utf8');
    log.success(`Rollup written to ${outputPath}`);
  } else {
    console.log(aggregated);
  }

  return aggregated;
}
