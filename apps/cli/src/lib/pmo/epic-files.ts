/**
 * Epic File Operations
 *
 * Handles creating, moving, and managing epic markdown files
 * in the PMO folder structure.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Epic, EpicStatus } from './types.js';

/**
 * Get the epics directory for a project
 */
export function getEpicsDir(pmoPath: string, projectId: string = 'default'): string {
  // For default project, use pmo/epics directly
  // For named projects, use pmo/projects/{projectId}/epics
  if (projectId === 'default') {
    return path.join(pmoPath, 'epics');
  }
  return path.join(pmoPath, 'projects', projectId, 'epics');
}

/**
 * Get the path to an epic's markdown file
 */
export function getEpicFilePath(pmoPath: string, epicId: string, status: EpicStatus, projectId: string = 'default'): string {
  const epicsDir = getEpicsDir(pmoPath, projectId);
  return path.join(epicsDir, status, `${epicId}.md`);
}

/**
 * Ensure epic status directories exist
 */
export function ensureEpicDirs(pmoPath: string, projectId: string = 'default'): void {
  const epicsDir = getEpicsDir(pmoPath, projectId);
  const statuses: EpicStatus[] = ['active', 'draft', 'complete', 'dropped', 'future'];

  for (const status of statuses) {
    const statusDir = path.join(epicsDir, status);
    if (!fs.existsSync(statusDir)) {
      fs.mkdirSync(statusDir, { recursive: true });
    }
  }
}

/**
 * Ticket info for markdown generation
 */
export interface TicketInfo {
  id: string;
  title: string;
  status?: string;  // Optional: use statusName or column from ticket
  priority?: string;
}

/**
 * Generate markdown content for an epic
 */
export function generateEpicMarkdown(epic: Epic, tickets: TicketInfo[] = []): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`id: ${epic.id}`);
  lines.push(`title: ${epic.title}`);
  lines.push(`status: ${epic.status}`);
  lines.push(`created: ${epic.createdAt.toISOString()}`);
  if (epic.description) {
    lines.push(`description: ${epic.description}`);
  }
  lines.push('---');
  lines.push('');

  // Title
  lines.push(`# ${epic.title}`);
  lines.push('');

  // Overview section
  lines.push('## Overview');
  if (epic.description) {
    lines.push(epic.description);
  } else {
    lines.push('[Describe what this epic covers]');
  }
  lines.push('');

  // Motivation section
  lines.push('## Motivation');
  lines.push('[Why this work matters - the problem being solved or opportunity being captured]');
  lines.push('');

  // Goals section
  lines.push('## Goals');
  lines.push('- [ ] Goal 1');
  lines.push('- [ ] Goal 2');
  lines.push('');

  // Success Criteria section
  lines.push('## Success Criteria');
  lines.push('- [ ] Criterion 1');
  lines.push('');

  // Tickets section
  lines.push('## Tickets');
  lines.push('');
  if (tickets.length === 0) {
    lines.push('_No tickets linked yet. Create tickets with:_');
    lines.push('```bash');
    lines.push(`prlt ticket create --epic ${epic.id} "Task title"`);
    lines.push('```');
  } else {
    const doneCount = tickets.filter(t => t.status === 'done').length;
    lines.push(`Progress: ${doneCount}/${tickets.length} complete`);
    lines.push('');
    for (const ticket of tickets) {
      const emoji = ticket.status === 'done' ? '✅' : ticket.status === 'in_progress' ? '🚧' : '📋';
      const priority = ticket.priority ? ` [${ticket.priority}]` : '';
      lines.push(`- ${emoji} ${ticket.id}: ${ticket.title}${priority}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Update the Tickets section of an existing epic markdown file
 * This is a one-way sync: database → markdown
 */
export function updateEpicTicketsSection(
  pmoPath: string,
  epicId: string,
  status: EpicStatus,
  tickets: TicketInfo[],
  projectId: string = 'default'
): boolean {
  const filePath = getEpicFilePath(pmoPath, epicId, status, projectId);

  if (!fs.existsSync(filePath)) {
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf-8');

  // Find and replace the Tickets section
  const ticketsSectionRegex = /## Tickets\n[\s\S]*?(?=\n## |\n---|\z|$)/;

  // Generate new tickets section
  const ticketsLines: string[] = ['## Tickets', ''];

  if (tickets.length === 0) {
    ticketsLines.push('_No tickets linked yet. Create tickets with:_');
    ticketsLines.push('```bash');
    ticketsLines.push(`prlt ticket create --epic ${epicId} "Task title"`);
    ticketsLines.push('```');
  } else {
    const doneCount = tickets.filter(t => t.status === 'done').length;
    ticketsLines.push(`Progress: ${doneCount}/${tickets.length} complete`);
    ticketsLines.push('');
    for (const ticket of tickets) {
      const emoji = ticket.status === 'done' ? '✅' : ticket.status === 'in_progress' ? '🚧' : '📋';
      const priority = ticket.priority ? ` [${ticket.priority}]` : '';
      ticketsLines.push(`- ${emoji} ${ticket.id}: ${ticket.title}${priority}`);
    }
  }
  ticketsLines.push('');

  const newTicketsSection = ticketsLines.join('\n');

  if (ticketsSectionRegex.test(content)) {
    // Replace existing section
    content = content.replace(ticketsSectionRegex, newTicketsSection);
  } else {
    // Append section at end
    content = content.trimEnd() + '\n\n' + newTicketsSection;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
}

/**
 * Create an epic markdown file
 */
export function createEpicFile(pmoPath: string, epic: Epic, projectId: string = 'default'): string {
  ensureEpicDirs(pmoPath, projectId);

  const filePath = getEpicFilePath(pmoPath, epic.id, epic.status, projectId);
  const content = generateEpicMarkdown(epic);

  fs.writeFileSync(filePath, content, 'utf-8');

  return filePath;
}

/**
 * Move an epic file to a new status directory
 */
export function moveEpicFile(
  pmoPath: string,
  epicId: string,
  fromStatus: EpicStatus,
  toStatus: EpicStatus,
  projectId: string = 'default'
): { oldPath: string; newPath: string } | null {
  ensureEpicDirs(pmoPath, projectId);

  const oldPath = getEpicFilePath(pmoPath, epicId, fromStatus, projectId);
  const newPath = getEpicFilePath(pmoPath, epicId, toStatus, projectId);

  if (!fs.existsSync(oldPath)) {
    return null;
  }

  // Read the file content
  let content = fs.readFileSync(oldPath, 'utf-8');

  // Update the status in frontmatter
  content = content.replace(/^status: .+$/m, `status: ${toStatus}`);

  // Write to new location
  fs.writeFileSync(newPath, content, 'utf-8');

  // Delete old file
  fs.unlinkSync(oldPath);

  return { oldPath, newPath };
}

/**
 * Delete an epic file
 */
export function deleteEpicFile(pmoPath: string, epicId: string, status: EpicStatus, projectId: string = 'default'): boolean {
  const filePath = getEpicFilePath(pmoPath, epicId, status, projectId);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }

  return false;
}

/**
 * Get relative path from PMO root for display
 */
export function getRelativeEpicPath(pmoPath: string, epicId: string, status: EpicStatus, projectId: string = 'default'): string {
  const fullPath = getEpicFilePath(pmoPath, epicId, status, projectId);
  // Get path relative to pmo directory's parent (the HQ root)
  const hqRoot = path.dirname(pmoPath);
  return path.relative(hqRoot, fullPath);
}
