/**
 * Builtin workflow templates - single source of truth.
 *
 * This file defines all builtin templates used by:
 * - UI prompts (template selection menu)
 * - Database seeding (pmo_templates table)
 * - Board column creation
 * - Work command column mappings
 */

import { StateCategory } from './types.js';

export interface WorkflowTemplateStatus {
  name: string;
  category: StateCategory;
  position: number;
}

export interface ColumnSettings {
  column_planned: string;
  column_in_progress: string;
  column_done: string;
}

export interface BuiltinTemplate {
  /** Unique identifier used in code and database */
  id: string;
  /** Display name shown in UI */
  name: string;
  /** Description of the workflow */
  description: string;
  /** Column names for the board UI */
  columns: string[];
  /** Workflow statuses for state tracking */
  statuses: WorkflowTemplateStatus[];
  /** Column mappings for work commands (start, ready, complete) */
  columnSettings: ColumnSettings;
  /** Whether to show in the init template picker (false for specialized templates) */
  showInPicker: boolean;
}

/**
 * All builtin workflow templates.
 *
 * This is the SINGLE SOURCE OF TRUTH for:
 * - Database seeding (seedBuiltinWorkflows reads from this)
 * - UI template picker
 * - Board column creation
 * - Work command column mappings
 *
 * To add a new template:
 * 1. Add it to this array
 * 2. That's it - UI and DB will pick it up automatically
 */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Default workflow: Backlog → Ready → In Progress → Review → Done',
    columns: ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'],
    statuses: [
      { name: 'Backlog', category: 'backlog', position: 0 },
      { name: 'Ready', category: 'unstarted', position: 1 },
      { name: 'In Progress', category: 'started', position: 2 },
      { name: 'Review', category: 'started', position: 3 },
      { name: 'Done', category: 'completed', position: 4 },
    ],
    columnSettings: {
      column_planned: 'Ready',
      column_in_progress: 'In Progress',
      column_done: 'Done',
    },
    showInPicker: false, // Internal default, not shown in picker
  },
  {
    id: 'kanban',
    name: 'Kanban',
    description: 'Simple kanban workflow: Backlog → To Do → In Progress → Done',
    columns: ['Backlog', 'To Do', 'In Progress', 'Done', 'Canceled'],
    statuses: [
      { name: 'Backlog', category: 'backlog', position: 0 },
      { name: 'To Do', category: 'unstarted', position: 1 },
      { name: 'In Progress', category: 'started', position: 2 },
      { name: 'Done', category: 'completed', position: 3 },
      { name: 'Canceled', category: 'canceled', position: 4 },
    ],
    columnSettings: {
      column_planned: 'To Do',
      column_in_progress: 'In Progress',
      column_done: 'Done',
    },
    showInPicker: true,
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Linear-style workflow with triage and review stages',
    columns: ['Backlog', 'Triage', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled'],
    statuses: [
      { name: 'Backlog', category: 'backlog', position: 0 },
      { name: 'Triage', category: 'backlog', position: 1 },
      { name: 'Todo', category: 'unstarted', position: 2 },
      { name: 'In Progress', category: 'started', position: 3 },
      { name: 'In Review', category: 'started', position: 4 },
      { name: 'Done', category: 'completed', position: 5 },
      { name: 'Canceled', category: 'canceled', position: 6 },
    ],
    columnSettings: {
      column_planned: 'Todo',
      column_in_progress: 'In Progress',
      column_done: 'Done',
    },
    showInPicker: true,
  },
  {
    id: '5-tool-founder',
    name: '5-Tool Founder',
    description: 'Founder workflow: Ship, Grow, Support, Strategy, BizOps backlogs → In Progress → Review → Done',
    columns: ['Ship', 'Grow', 'Support', 'Strategy', 'BizOps', 'In Progress', 'Review', 'Done'],
    statuses: [
      { name: 'Ship', category: 'backlog', position: 0 },
      { name: 'Grow', category: 'backlog', position: 1 },
      { name: 'Support', category: 'backlog', position: 2 },
      { name: 'Strategy', category: 'backlog', position: 3 },
      { name: 'BizOps', category: 'backlog', position: 4 },
      { name: 'In Progress', category: 'started', position: 5 },
      { name: 'Review', category: 'started', position: 6 },
      { name: 'Done', category: 'completed', position: 7 },
    ],
    columnSettings: {
      column_planned: 'Ship',
      column_in_progress: 'In Progress',
      column_done: 'Done',
    },
    showInPicker: true,
  },
  {
    id: 'bug-smash',
    name: 'Bug Smash',
    description: 'Bug tracking workflow with verification stages',
    columns: ['Reported', 'Confirmed', 'Fixing', 'Verifying', 'Fixed', "Won't Fix"],
    statuses: [
      { name: 'Reported', category: 'backlog', position: 0 },
      { name: 'Confirmed', category: 'unstarted', position: 1 },
      { name: 'Fixing', category: 'started', position: 2 },
      { name: 'Verifying', category: 'started', position: 3 },
      { name: 'Fixed', category: 'completed', position: 4 },
      { name: "Won't Fix", category: 'canceled', position: 5 },
    ],
    columnSettings: {
      column_planned: 'Confirmed',
      column_in_progress: 'Fixing',
      column_done: 'Fixed',
    },
    showInPicker: false, // Specialized template
  },
  {
    id: 'gtm',
    name: 'GTM',
    description: 'Go-to-market workflow for launches and campaigns',
    columns: ['Ideation', 'Planning', 'In Development', 'Ready to Launch', 'Launched', 'Retired'],
    statuses: [
      { name: 'Ideation', category: 'backlog', position: 0 },
      { name: 'Planning', category: 'unstarted', position: 1 },
      { name: 'In Development', category: 'started', position: 2 },
      { name: 'Ready to Launch', category: 'started', position: 3 },
      { name: 'Launched', category: 'completed', position: 4 },
      { name: 'Retired', category: 'canceled', position: 5 },
    ],
    columnSettings: {
      column_planned: 'Planning',
      column_in_progress: 'In Development',
      column_done: 'Launched',
    },
    showInPicker: false, // Specialized template
  },
];

/**
 * Get a template by ID.
 */
export function getBuiltinTemplate(id: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find(t => t.id === id);
}

/**
 * Get templates that should be shown in the init picker.
 */
export function getPickerTemplates(): BuiltinTemplate[] {
  return BUILTIN_TEMPLATES.filter(t => t.showInPicker);
}

/**
 * Get columns for a template (for backward compatibility).
 */
export function getColumnsForTemplate(templateId: string): string[] {
  const template = getBuiltinTemplate(templateId);
  if (template) {
    return template.columns;
  }
  // Default columns for unknown templates
  return ['Backlog', 'Planned', 'In Progress', 'Done'];
}

/**
 * Get column settings for a template (for backward compatibility).
 */
export function getColumnSettingsForTemplate(
  templateId: string,
  columns: string[]
): ColumnSettings {
  const template = getBuiltinTemplate(templateId);
  if (template) {
    return template.columnSettings;
  }

  // For custom/unknown templates, try to find matching columns by keyword
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
