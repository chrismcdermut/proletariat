/**
 * SQLite Storage Implementation for PMO
 *
 * Uses the unified workspace.db database with pmo_ prefixed tables.
 * This enables foreign key relationships between PMO tickets and agents.
 */

import Database from 'better-sqlite3'
import {
  Board,
  BoardConfig,
  BoardView,
  BoardViewFilter,
  BoardViewFilters,
  BoardViewGroupBy,
  BoardViewSortBy,
  Column,
  CreateTicketInput,
  Epic,
  EpicDependency,
  EpicDependencyType,
  EpicFilter,
  PhaseFilter,
  PhaseTemplate,
  PhaseTemplateFilter,
  PhaseTemplatePhase,
  PMOError,
  PMOStorage,
  Project,
  ProjectFilter,
  ProjectPhase,
  Spec,
  SpecDependency,
  SpecDependencyType,
  SpecFilter,
  StateCategory,
  STATE_CATEGORY_ORDER,
  Subtask,
  SyncResult,
  SyncStatus,
  TemplateFilter,
  Ticket,
  TicketDependency,
  TicketDependencyType,
  TicketFilter,
  TicketTemplate,
  TicketTemplateFilter,
  WorkAction,
  WorkActionFilter,
  WorkflowStatus,
  WorkflowTemplate,
  WorkflowTemplateStatus,
} from './types.js'
import { generateBoardMarkdown } from './markdown.js'
import { slugify, generateEntityId } from './utils.js'
import { PMO_TABLES, PMO_SCHEMA_SQL, validateTicketSchema } from './schema.js'

// Use shared table names
const T = PMO_TABLES

// =============================================================================
// SQLite Storage Class
// =============================================================================

export class SQLiteStorage implements PMOStorage {
  readonly type = 'sqlite' as const
  private db: Database.Database
  private dbPath: string
  private currentProjectId: string

  constructor(dbPath: string, projectId: string = 'default') {
    this.dbPath = dbPath
    this.currentProjectId = projectId

    // Open database (creates if doesn't exist)
    this.db = new Database(dbPath)
    this.db.pragma('foreign_keys = ON')

    // Ensure PMO tables exist
    this.ensurePMOTables()
  }

  /**
   * Set the current project context for operations
   */
  setCurrentProject(projectId: string): void {
    this.currentProjectId = projectId
  }

  /**
   * Get the current project ID
   */
  getCurrentProjectId(): string {
    return this.currentProjectId
  }

  /**
   * Get the underlying database connection.
   * Use this when you need direct database access for custom queries.
   */
  getDatabase(): Database.Database {
    return this.db
  }

  /**
   * Ensure PMO tables exist in the database.
   * Uses shared schema from schema.ts to guarantee consistency.
   * This handles migration for workspaces created before PMO was added.
   */
  private ensurePMOTables(): void {
    // Run migrations FIRST for existing databases
    // This adds missing columns before we try to create indexes on them
    this.runMigrations()

    // Create tables and indexes using shared schema (single source of truth)
    // CREATE TABLE/INDEX IF NOT EXISTS is safe - won't fail if already exists
    this.db.exec(PMO_SCHEMA_SQL)

    // Seed built-in templates and phases AFTER tables are created
    this.seedBuiltinTemplates()
    this.seedBuiltinPhases()
    this.seedBuiltinPhaseTemplates()
    this.seedBuiltinActions()
    this.seedBuiltinTicketTemplates()

    // Validate schema matches expected columns (catches drift early)
    validateTicketSchema(this.db)
  }

  /**
   * Run schema migrations for existing databases.
   * Each migration checks if the column exists before adding it.
   * Skips if tables don't exist yet (fresh database).
   */
  private runMigrations(): void {
    // Check if tables exist (skip migrations for fresh databases)
    const tableExists = (name: string): boolean => {
      const result = this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name=?
      `).get(name) as { name: string } | undefined
      return !!result
    }

    // Skip if core tables don't exist yet
    if (!tableExists(T.tickets) || !tableExists(T.specs) || !tableExists(T.projects)) {
      return
    }

    // Migration: Update specs table to new simplified schema
    if (tableExists(T.specs)) {
      const specsColumns = this.db.pragma(`table_info(${T.specs})`) as Array<{ name: string }>
      const specsColumnNames = new Set(specsColumns.map(c => c.name))

      // New columns for simplified spec schema
      const newColumns = [
        { name: 'type', sql: 'type TEXT' },
        { name: 'tags', sql: 'tags TEXT' },
        { name: 'depends_on', sql: 'depends_on TEXT' },
        { name: 'problem', sql: 'problem TEXT' },
        { name: 'solution', sql: 'solution TEXT' },
        { name: 'decisions', sql: 'decisions TEXT' },
        { name: 'not_now', sql: 'not_now TEXT' },
        { name: 'ui_ux', sql: 'ui_ux TEXT' },
        { name: 'acceptance_criteria', sql: 'acceptance_criteria TEXT' },
        { name: 'open_questions', sql: 'open_questions TEXT' },
        { name: 'requirements_functional', sql: 'requirements_functional TEXT' },
        { name: 'requirements_technical', sql: 'requirements_technical TEXT' },
        { name: 'context', sql: 'context TEXT' },
      ]

      for (const col of newColumns) {
        if (!specsColumnNames.has(col.name)) {
          try {
            this.db.exec(`ALTER TABLE ${T.specs} ADD COLUMN ${col.sql}`)
          } catch {
            // Column may already exist
          }
        }
      }
    }

    // Migration: Add status_id column to tickets table (for workflow statuses)
    const ticketsColumns = this.db.pragma(`table_info(${T.tickets})`) as Array<{ name: string }>
    const ticketsColumnNames = new Set(ticketsColumns.map(c => c.name))

    if (!ticketsColumnNames.has('status_id')) {
      try {
        this.db.exec(`ALTER TABLE ${T.tickets} ADD COLUMN status_id TEXT`)
      } catch {
        // Column may already exist
      }
    }

    // Migration: Add status and target_date columns to projects table
    const projectsColumns = this.db.pragma(`table_info(${T.projects})`) as Array<{ name: string }>
    const projectsColumnNames = new Set(projectsColumns.map(c => c.name))

    if (!projectsColumnNames.has('status')) {
      try {
        this.db.exec(`ALTER TABLE ${T.projects} ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`)
      } catch {
        // Column may already exist
      }
    }

    if (!projectsColumnNames.has('target_date')) {
      try {
        this.db.exec(`ALTER TABLE ${T.projects} ADD COLUMN target_date TIMESTAMP`)
      } catch {
        // Column may already exist
      }
    }

    if (!projectsColumnNames.has('phase_id')) {
      try {
        this.db.exec(`ALTER TABLE ${T.projects} ADD COLUMN phase_id TEXT`)
      } catch {
        // Column may already exist
      }
    }

    if (!projectsColumnNames.has('is_archived')) {
      try {
        this.db.exec(`ALTER TABLE ${T.projects} ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0`)
      } catch {
        // Column may already exist
      }
    }

    // Migration: Add branch column to tickets table
    if (!ticketsColumnNames.has('branch')) {
      try {
        this.db.exec(`ALTER TABLE ${T.tickets} ADD COLUMN branch TEXT`)
      } catch {
        // Column may already exist
      }
    }

    // Migration: Add position column to actions table
    if (tableExists(T.actions)) {
      const actionsColumns = this.db.pragma(`table_info(${T.actions})`) as Array<{ name: string }>
      const actionsColumnNames = actionsColumns.map(c => c.name)
      if (!actionsColumnNames.includes('position')) {
        try {
          this.db.exec(`ALTER TABLE ${T.actions} ADD COLUMN position INTEGER NOT NULL DEFAULT 0`)
          // Update existing builtin actions with correct positions
          const positionMap: Record<string, number> = {
            groom: 0, implement: 1, continue: 2, test: 3, review: 4, revise: 5
          }
          for (const [id, pos] of Object.entries(positionMap)) {
            this.db.prepare(`UPDATE ${T.actions} SET position = ? WHERE id = ?`).run(pos, id)
          }
        } catch {
          // Column may already exist
        }
      }
    }

    // Migration: Add labels column to tickets table
    if (!ticketsColumnNames.has('labels')) {
      try {
        this.db.exec(`ALTER TABLE ${T.tickets} ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'`)
      } catch {
        // Column may already exist
      }
    }

    // Migration: Add new columns to ticket_templates table (for existing templates tables)
    if (tableExists(T.ticket_templates)) {
      const templateColumns = this.db.pragma(`table_info(${T.ticket_templates})`) as Array<{ name: string }>
      const templateColumnNames = new Set(templateColumns.map(c => c.name))

      const newTemplateColumns = [
        { name: 'default_status_id', sql: 'default_status_id TEXT' },
        { name: 'default_assignee', sql: 'default_assignee TEXT' },
        { name: 'default_owner', sql: 'default_owner TEXT' },
        { name: 'default_labels', sql: 'default_labels TEXT NOT NULL DEFAULT \'[]\'' },
      ]

      for (const col of newTemplateColumns) {
        if (!templateColumnNames.has(col.name)) {
          try {
            this.db.exec(`ALTER TABLE ${T.ticket_templates} ADD COLUMN ${col.sql}`)
          } catch {
            // Column may already exist
          }
        }
      }
    }
  }

  /**
   * Seed built-in workflow templates.
   * These are system-provided templates that cannot be deleted.
   */
  private seedBuiltinTemplates(): void {
    const builtinTemplates: Array<{
      id: string
      name: string
      description: string
      statuses: WorkflowTemplateStatus[]
    }> = [
      {
        id: 'kanban',
        name: 'Kanban',
        description: 'Simple kanban workflow: Backlog → To Do → In Progress → Done',
        statuses: [
          { name: 'Backlog', category: 'backlog', position: 0 },
          { name: 'To Do', category: 'unstarted', position: 0 },
          { name: 'In Progress', category: 'started', position: 0 },
          { name: 'Done', category: 'completed', position: 0 },
          { name: 'Canceled', category: 'canceled', position: 0 },
        ],
      },
      {
        id: 'linear',
        name: 'Linear',
        description: 'Linear-style workflow with backlog, triage, and review stages',
        statuses: [
          { name: 'Backlog', category: 'backlog', position: 0 },
          { name: 'Triage', category: 'backlog', position: 1 },
          { name: 'Todo', category: 'unstarted', position: 0 },
          { name: 'In Progress', category: 'started', position: 0 },
          { name: 'In Review', category: 'started', position: 1 },
          { name: 'Done', category: 'completed', position: 0 },
          { name: 'Canceled', category: 'canceled', position: 0 },
        ],
      },
      {
        id: 'bug-smash',
        name: 'Bug Smash',
        description: 'Bug tracking workflow with verification stages',
        statuses: [
          { name: 'Reported', category: 'backlog', position: 0 },
          { name: 'Confirmed', category: 'unstarted', position: 0 },
          { name: 'Fixing', category: 'started', position: 0 },
          { name: 'Verifying', category: 'started', position: 1 },
          { name: 'Fixed', category: 'completed', position: 0 },
          { name: 'Won\'t Fix', category: 'canceled', position: 0 },
        ],
      },
      {
        id: '5-tool-founder',
        name: '5-Tool Founder',
        description: 'Founder workflow: Ideas → Build → Ship → Measure → Iterate',
        statuses: [
          { name: 'Ideas', category: 'backlog', position: 0 },
          { name: 'Next Up', category: 'unstarted', position: 0 },
          { name: 'Building', category: 'started', position: 0 },
          { name: 'Shipping', category: 'started', position: 1 },
          { name: 'Measuring', category: 'started', position: 2 },
          { name: 'Shipped', category: 'completed', position: 0 },
          { name: 'Parked', category: 'canceled', position: 0 },
        ],
      },
      {
        id: 'gtm',
        name: 'GTM',
        description: 'Go-to-market workflow for launches and campaigns',
        statuses: [
          { name: 'Ideation', category: 'backlog', position: 0 },
          { name: 'Planning', category: 'unstarted', position: 0 },
          { name: 'In Development', category: 'started', position: 0 },
          { name: 'Ready to Launch', category: 'started', position: 1 },
          { name: 'Launched', category: 'completed', position: 0 },
          { name: 'Retired', category: 'canceled', position: 0 },
        ],
      },
    ]

    const insertTemplate = this.db.prepare(`
      INSERT OR IGNORE INTO ${T.templates} (id, name, description, is_builtin, statuses, created_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `)

    const now = new Date().toISOString()
    for (const template of builtinTemplates) {
      insertTemplate.run(
        template.id,
        template.name,
        template.description,
        JSON.stringify(template.statuses),
        now
      )
    }
  }

  /**
   * Seed default project phases.
   * These are the default phases for project lifecycle.
   */
  private seedBuiltinPhases(): void {
    const defaultPhases: Array<{
      id: string
      name: string
      category: StateCategory
      position: number
      description?: string
      isDefault?: boolean
    }> = [
      { id: 'idea', name: 'Idea', category: 'backlog', position: 0, description: 'Project concept, not yet planned', isDefault: true },
      { id: 'planned', name: 'Planned', category: 'unstarted', position: 0, description: 'Scheduled for work but not started' },
      { id: 'active', name: 'Active', category: 'started', position: 0, description: 'Work is in progress' },
      { id: 'completed', name: 'Completed', category: 'completed', position: 0, description: 'Project finished successfully' },
      { id: 'canceled', name: 'Canceled', category: 'canceled', position: 0, description: 'Project won\'t be completed' },
    ]

    const insertPhase = this.db.prepare(`
      INSERT OR IGNORE INTO ${T.phases} (id, name, category, position, description, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const now = new Date().toISOString()
    for (const phase of defaultPhases) {
      insertPhase.run(
        phase.id,
        phase.name,
        phase.category,
        phase.position,
        phase.description || null,
        phase.isDefault ? 1 : 0,
        now
      )
    }
  }

  /**
   * Seed built-in phase templates.
   * These are system-provided templates for project lifecycle phases.
   */
  private seedBuiltinPhaseTemplates(): void {
    type TemplatePhase = {
      name: string
      category: StateCategory
      position: number
      description?: string
      isDefault?: boolean
    }

    const builtinPhaseTemplates: Array<{
      id: string
      name: string
      description: string
      phases: TemplatePhase[]
    }> = [
      {
        id: 'default',
        name: 'Default',
        description: 'Standard project lifecycle phases',
        phases: [
          { name: 'Idea', category: 'backlog', position: 0, description: 'Project concept, not yet planned', isDefault: true },
          { name: 'Planned', category: 'unstarted', position: 0, description: 'Scheduled for work but not started' },
          { name: 'Active', category: 'started', position: 0, description: 'Work is in progress' },
          { name: 'Completed', category: 'completed', position: 0, description: 'Project finished successfully' },
          { name: 'Canceled', category: 'canceled', position: 0, description: 'Project won\'t be completed' },
        ],
      },
      {
        id: 'agile',
        name: 'Agile',
        description: 'Agile/Scrum project phases',
        phases: [
          { name: 'Backlog', category: 'backlog', position: 0, description: 'Not yet prioritized' },
          { name: 'Groomed', category: 'unstarted', position: 0, description: 'Ready to be picked up' },
          { name: 'In Sprint', category: 'started', position: 0, description: 'Actively being worked on', isDefault: true },
          { name: 'Done', category: 'completed', position: 0, description: 'Sprint work completed' },
          { name: 'Dropped', category: 'canceled', position: 0, description: 'Removed from backlog' },
        ],
      },
      {
        id: 'product',
        name: 'Product',
        description: 'Product development lifecycle',
        phases: [
          { name: 'Discovery', category: 'backlog', position: 0, description: 'Research and exploration' },
          { name: 'Definition', category: 'unstarted', position: 0, description: 'Requirements and specs', isDefault: true },
          { name: 'Development', category: 'started', position: 0, description: 'Building the product' },
          { name: 'Launch', category: 'completed', position: 0, description: 'Shipped to users' },
          { name: 'Growth', category: 'completed', position: 1, description: 'Post-launch iteration' },
          { name: 'Sunset', category: 'canceled', position: 0, description: 'End of life' },
        ],
      },
      {
        id: 'startup',
        name: 'Startup',
        description: 'Lean startup methodology',
        phases: [
          { name: 'Hypothesis', category: 'backlog', position: 0, description: 'Untested idea' },
          { name: 'Validated', category: 'unstarted', position: 0, description: 'Problem validated', isDefault: true },
          { name: 'Building', category: 'started', position: 0, description: 'MVP in progress' },
          { name: 'Measuring', category: 'started', position: 1, description: 'Collecting feedback' },
          { name: 'Scaling', category: 'completed', position: 0, description: 'Growth phase' },
          { name: 'Pivoted', category: 'canceled', position: 0, description: 'Changed direction' },
        ],
      },
    ]

    const insertTemplate = this.db.prepare(`
      INSERT OR IGNORE INTO ${T.phase_templates} (id, name, description, is_builtin, phases, created_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `)

    const now = new Date().toISOString()
    for (const template of builtinPhaseTemplates) {
      insertTemplate.run(
        template.id,
        template.name,
        template.description,
        JSON.stringify(template.phases),
        now
      )
    }
  }

  /**
   * Seed built-in work actions.
   * These are reusable agent prompts for common work patterns.
   */
  private seedBuiltinActions(): void {
    // Ordered by typical workflow: groom → implement → continue → test → review → revise
    const builtinActions = [
      {
        id: 'groom',
        name: 'Groom',
        description: 'Flesh out ticket with requirements and acceptance criteria',
        prompt: `Analyze this ticket and improve its definition:
- Add detailed requirements if missing or vague
- Add clear, testable acceptance criteria
- Break down into subtasks if the work is complex
- Estimate complexity (S/M/L/XL) if not already set
- Flag any ambiguities or missing information that need clarification

Do NOT implement the ticket - only improve its definition so it's ready to be worked on.`,
        suggestedForCategories: ['backlog'],
        defaultMoveToCategory: 'unstarted',
        modifiesCode: false,
        position: 0,
      },
      {
        id: 'implement',
        name: 'Implement',
        description: 'Write code to implement the ticket requirements',
        prompt: `Implement this ticket according to its requirements and acceptance criteria:
- Follow the acceptance criteria exactly
- Write clean, well-tested code
- Create atomic commits with clear messages
- Update documentation if the changes affect it
- Run tests to verify the implementation

When complete, the ticket should be ready for code review.`,
        suggestedForCategories: ['unstarted', 'started'],
        defaultMoveToCategory: 'started',
        modifiesCode: true,
        position: 1,
      },
      {
        id: 'continue',
        name: 'Continue',
        description: 'Continue working from where you left off',
        prompt: `Continue working on this ticket from where you left off.
- Review existing commits and changes to understand current state
- Check what subtasks remain incomplete
- Complete the remaining work
- Ensure all acceptance criteria are met`,
        suggestedForCategories: ['started'],
        defaultMoveToCategory: 'started',
        modifiesCode: true,
        position: 2,
      },
      {
        id: 'test',
        name: 'Write Tests',
        description: 'Add comprehensive tests for the implementation',
        prompt: `Write comprehensive tests for this ticket's implementation:
- Add unit tests for core functionality
- Add integration tests where appropriate
- Cover edge cases and error handling
- Aim for good coverage of the changed code
- Ensure all tests pass`,
        suggestedForCategories: ['started', 'completed'],
        modifiesCode: true,
        position: 3,
      },
      {
        id: 'review',
        name: 'Code Review',
        description: 'Review the implementation for issues',
        prompt: `Review this ticket's implementation thoroughly:
- Check for bugs, edge cases, and potential issues
- Look for security vulnerabilities
- Verify it meets all acceptance criteria
- Check code quality and maintainability
- Suggest improvements if appropriate

Output a review summary with your findings and any concerns.`,
        suggestedForCategories: ['started', 'completed'],
        modifiesCode: false,
        position: 4,
      },
      {
        id: 'revise',
        name: 'Revise',
        description: 'Address PR feedback and review comments',
        prompt: `Address the feedback on this ticket's pull request:
- Review all comments and requested changes carefully
- Make the necessary code changes to address each point
- Respond to questions with explanations
- Push updates to the PR branch
- Mark resolved conversations as resolved`,
        suggestedForCategories: ['completed'],
        defaultMoveToCategory: 'started',
        modifiesCode: true,
        position: 5,
      },
    ]

    const insertAction = this.db.prepare(`
      INSERT OR IGNORE INTO ${T.actions} (id, name, description, prompt, suggested_for_categories, default_move_to_category, modifies_code, is_builtin, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `)

    const now = new Date().toISOString()
    for (const action of builtinActions) {
      insertAction.run(
        action.id,
        action.name,
        action.description,
        action.prompt,
        JSON.stringify(action.suggestedForCategories),
        action.defaultMoveToCategory || null,
        action.modifiesCode ? 1 : 0,
        action.position,
        now
      )
    }
  }

  /**
   * Seed built-in ticket templates.
   * These are system-provided templates that cannot be deleted.
   */
  private seedBuiltinTicketTemplates(): void {
    const builtinTemplates = [
      {
        id: 'bug-report',
        name: 'Bug Report',
        description: 'Template for reporting bugs with reproduction steps',
        titlePattern: '[BUG] ',
        descriptionTemplate: `## Description
Brief description of the bug.

## Steps to Reproduce
1.
2.
3.

## Expected Behavior


## Actual Behavior


## Environment
- OS:
- Version:
`,
        defaultPriority: 'HIGH',
        defaultCategory: 'bug',
        suggestedSubtasks: [
          { title: 'Reproduce the bug' },
          { title: 'Identify root cause' },
          { title: 'Implement fix' },
          { title: 'Add regression test' },
        ],
      },
      {
        id: 'feature-request',
        name: 'Feature Request',
        description: 'Template for new feature requests',
        titlePattern: '[FEATURE] ',
        descriptionTemplate: `## Summary
Brief description of the feature.

## User Story
As a [type of user], I want [goal] so that [benefit].

## Acceptance Criteria
- [ ]
- [ ]

## Design Notes

`,
        defaultPriority: 'MEDIUM',
        defaultCategory: 'feature',
        suggestedSubtasks: [
          { title: 'Design implementation approach' },
          { title: 'Implement feature' },
          { title: 'Add tests' },
          { title: 'Update documentation' },
        ],
      },
      {
        id: 'task',
        name: 'Task',
        description: 'General task template',
        descriptionTemplate: `## What
Describe what needs to be done.

## Done when
- [ ]

## Context
Any relevant context or notes.
`,
        defaultPriority: 'MEDIUM',
        defaultCategory: 'chore',
        suggestedSubtasks: [],
      },
      {
        id: 'refactor',
        name: 'Refactor',
        description: 'Template for refactoring tasks',
        titlePattern: '[REFACTOR] ',
        descriptionTemplate: `## Current State
Describe the current implementation.

## Desired State
Describe the target implementation.

## Motivation
Why is this refactor needed?

## Scope
- [ ] Files/modules to change
`,
        defaultPriority: 'LOW',
        defaultCategory: 'refactor',
        suggestedSubtasks: [
          { title: 'Analyze current code' },
          { title: 'Plan refactoring approach' },
          { title: 'Implement changes' },
          { title: 'Ensure tests pass' },
        ],
      },
      {
        id: 'documentation',
        name: 'Documentation',
        description: 'Template for documentation tasks',
        titlePattern: '[DOCS] ',
        descriptionTemplate: `## Documentation Type
[ ] README
[ ] API docs
[ ] User guide
[ ] Internal docs

## Content to Document


## Target Audience

`,
        defaultPriority: 'LOW',
        defaultCategory: 'docs',
        suggestedSubtasks: [
          { title: 'Draft content' },
          { title: 'Review for accuracy' },
          { title: 'Add examples if needed' },
        ],
      },
    ]

    const insertTemplate = this.db.prepare(`
      INSERT OR IGNORE INTO ${T.ticket_templates} (
        id, name, description, is_builtin, title_pattern, description_template,
        default_priority, default_category, default_status_id, default_assignee,
        default_owner, default_labels, suggested_subtasks, created_at
      )
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const now = new Date().toISOString()
    for (const template of builtinTemplates) {
      insertTemplate.run(
        template.id,
        template.name,
        template.description || null,
        template.titlePattern || null,
        template.descriptionTemplate || null,
        template.defaultPriority || null,
        template.defaultCategory || null,
        null, // default_status_id
        null, // default_assignee
        null, // default_owner
        '[]', // default_labels
        JSON.stringify(template.suggestedSubtasks || []),
        now
      )
    }
  }


  // ===========================================================================
  // Project Operations
  // ===========================================================================

  async createProject(project: { id?: string; name: string; template?: string; description?: string }): Promise<Board> {
    const id = project.id || slugify(project.name)
    const templateId = project.template || 'kanban'
    const now = Date.now()

    this.db.prepare(`
      INSERT INTO ${T.projects} (id, name, template, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, project.name, templateId, project.description || null, now, now)

    // Try to apply workflow template if it exists
    const template = await this.getTemplate(templateId)
    if (template) {
      // Apply workflow template - creates statuses for this project
      await this.applyTemplate(id, templateId)

      // Create columns from statuses (columns mirror statuses)
      const statuses = await this.listStatuses(id)
      const insertColumn = this.db.prepare(`
        INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      statuses.forEach((status, position) => {
        insertColumn.run(slugify(status.name), id, status.name, position, now)
      })
    } else {
      // Fallback to default columns if template doesn't exist
      const defaultColumns = ['Backlog', 'Planned', 'In Progress', 'Done']
      const insertColumn = this.db.prepare(`
        INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      defaultColumns.forEach((name, position) => {
        insertColumn.run(slugify(name), id, name, position, now)
      })
    }

    // Switch context to new project and return it
    const oldProjectId = this.currentProjectId
    this.currentProjectId = id
    const result = await this.getBoard()
    this.currentProjectId = oldProjectId
    return result
  }

  async getProjectBoard(projectId: string): Promise<Board | null> {
    const projectRow = this.db.prepare(`SELECT * FROM ${T.projects} WHERE id = ?`).get(projectId) as
      | { id: string; name: string; template: string | null; description: string | null; updated_at: string }
      | undefined

    if (!projectRow) {
      return null
    }

    // Get columns with tickets for this project
    const columnRows = this.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ?
      ORDER BY position
    `).all(projectId) as Array<{
      id: string
      project_id: string
      name: string
      position: number
    }>

    const columns: Column[] = await Promise.all(
      columnRows.map(async (col) => ({
        id: col.id,
        name: col.name,
        position: col.position,
        tickets: await this.getTicketsForColumn(col.id, projectId),
      }))
    )

    return {
      id: projectRow.id,
      name: projectRow.name,
      columns,
      updatedAt: new Date(projectRow.updated_at),
    }
  }

  async listProjectSummaries(): Promise<Array<{ id: string; name: string; template: string | null; description: string | null; ticketCount: number }>> {
    const projects = this.db.prepare(`
      SELECT p.*, COUNT(t.id) as ticket_count
      FROM ${T.projects} p
      LEFT JOIN ${T.tickets} t ON p.id = t.project_id
      GROUP BY p.id
      ORDER BY p.created_at
    `).all() as Array<{
      id: string
      name: string
      template: string | null
      description: string | null
      ticket_count: number
    }>

    return projects.map(p => ({
      id: p.id,
      name: p.name,
      template: p.template,
      description: p.description,
      ticketCount: p.ticket_count,
    }))
  }

  async deleteProject(projectId: string): Promise<void> {
    if (projectId === 'default') {
      throw new PMOError('INVALID', 'Cannot delete the default project')
    }

    const result = this.db.prepare(`DELETE FROM ${T.projects} WHERE id = ?`).run(projectId)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectId}`)
    }

    // Columns and tickets are deleted via CASCADE
  }

  // ===========================================================================
  // Board Operations (operates on current project)
  // ===========================================================================

  async init(config: BoardConfig): Promise<Board> {
    const projectId = this.currentProjectId
    const projectName = config.name || 'Project Board'
    const columns = config.columns || ['Backlog', 'Planned', 'In Progress', 'Done']
    const now = Date.now()

    // Create or update project
    this.db.prepare(`
      INSERT OR REPLACE INTO ${T.projects} (id, name, template, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(projectId, projectName, 'kanban', now)

    // Delete existing columns for this project
    this.db.prepare(`DELETE FROM ${T.columns} WHERE project_id = ?`).run(projectId)

    // Create columns
    const insertColumn = this.db.prepare(`
      INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    columns.forEach((name, position) => {
      insertColumn.run(slugify(name), projectId, name, position, now)
    })

    return this.getBoard()
  }

  async getBoard(): Promise<Board> {
    // Get project metadata
    const projectRow = this.db.prepare(`SELECT * FROM ${T.projects} WHERE id = ?`).get(this.currentProjectId) as
      | { id: string; name: string; updated_at: string }
      | undefined

    if (!projectRow) {
      throw new PMOError('NOT_FOUND', `Project not found: ${this.currentProjectId}. Run init() first.`)
    }

    // Get columns with tickets for current project
    const columnRows = this.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ?
      ORDER BY position
    `).all(this.currentProjectId) as Array<{
      id: string
      project_id: string
      name: string
      position: number
    }>

    const columns: Column[] = await Promise.all(
      columnRows.map(async (col) => ({
        id: col.id,
        name: col.name,
        position: col.position,
        tickets: await this.getTicketsForColumn(col.id, this.currentProjectId),
      }))
    )

    return {
      id: projectRow.id,
      name: projectRow.name,
      columns,
      updatedAt: new Date(projectRow.updated_at),
    }
  }

  async getBoardMarkdown(): Promise<string> {
    const board = await this.getBoard()
    return generateBoardMarkdown(board)
  }

  // ===========================================================================
  // Column Operations
  // ===========================================================================

  /**
   * Get column names for current project
   * Returns array of column names in order
   */
  getColumnNames(): string[] {
    const columnRows = this.db.prepare(`
      SELECT name FROM ${T.columns}
      WHERE project_id = ?
      ORDER BY position
    `).all(this.currentProjectId) as Array<{ name: string }>;

    return columnRows.map(row => row.name);
  }

  async createColumn(name: string, position?: number): Promise<Column> {
    const id = slugify(name)
    const projectId = this.currentProjectId
    const pos = position ?? this.getMaxColumnPosition() + 1

    // Shift existing columns if inserting at specific position
    if (position !== undefined) {
      this.db.prepare(`
        UPDATE ${T.columns}
        SET position = position + 1
        WHERE project_id = ? AND position >= ?
      `).run(projectId, pos)
    }

    this.db.prepare(`
      INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, projectId, name, pos, Date.now())

    this.updateBoardTimestamp()

    return {
      id,
      name,
      position: pos,
      tickets: [],
    }
  }

  async renameColumn(id: string, name: string): Promise<Column> {
    const projectId = this.currentProjectId
    const result = this.db.prepare(`
      UPDATE ${T.columns}
      SET name = ?
      WHERE project_id = ? AND id = ?
    `).run(name, projectId, id)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Column not found: ${id}`)
    }

    this.updateBoardTimestamp()

    const row = this.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ? AND id = ?
    `).get(projectId, id) as {
      id: string
      project_id: string
      name: string
      position: number
    }

    return {
      id: row.id,
      name: row.name,
      position: row.position,
      tickets: await this.getTicketsForColumn(id, projectId),
    }
  }

  async moveColumn(id: string, position: number): Promise<Column> {
    const projectId = this.currentProjectId
    const current = this.db.prepare(`
      SELECT position FROM ${T.columns}
      WHERE project_id = ? AND id = ?
    `).get(projectId, id) as { position: number } | undefined

    if (!current) {
      throw new PMOError('NOT_FOUND', `Column not found: ${id}`)
    }

    // Shift columns between old and new position
    if (position < current.position) {
      this.db.prepare(`
        UPDATE ${T.columns}
        SET position = position + 1
        WHERE project_id = ? AND position >= ? AND position < ?
      `).run(projectId, position, current.position)
    } else {
      this.db.prepare(`
        UPDATE ${T.columns}
        SET position = position - 1
        WHERE project_id = ? AND position > ? AND position <= ?
      `).run(projectId, current.position, position)
    }

    this.db.prepare(`
      UPDATE ${T.columns}
      SET position = ?
      WHERE project_id = ? AND id = ?
    `).run(position, projectId, id)

    this.updateBoardTimestamp()

    const row = this.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ? AND id = ?
    `).get(projectId, id) as {
      id: string
      project_id: string
      name: string
      position: number
    }

    return {
      id: row.id,
      name: row.name,
      position: row.position,
      tickets: await this.getTicketsForColumn(id, projectId),
    }
  }

  async deleteColumn(id: string, cascade = false): Promise<void> {
    const projectId = this.currentProjectId
    const ticketCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM ${T.board_tickets}
      WHERE project_id = ? AND column_id = ?
    `).get(projectId, id) as { count: number }

    if (ticketCount.count > 0 && !cascade) {
      throw new PMOError('INVALID', `Column has ${ticketCount.count} tickets. Use cascade=true to delete.`)
    }

    const result = this.db.prepare(`
      DELETE FROM ${T.columns}
      WHERE project_id = ? AND id = ?
    `).run(projectId, id)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Column not found: ${id}`)
    }

    this.updateBoardTimestamp()
  }

  // ===========================================================================
  // Ticket Operations
  // ===========================================================================

  async createTicket(ticket: CreateTicketInput): Promise<Ticket> {
    const id = ticket.id || generateEntityId(this.db, 'ticket')
    const title = ticket.title || 'Untitled'
    const projectId = this.currentProjectId

    // Get column (default to first column) - this is for board position
    let columnId = ticket.statusName
    if (!columnId) {
      const firstColumn = this.db.prepare(`
        SELECT id FROM ${T.columns}
        WHERE project_id = ?
        ORDER BY position LIMIT 1
      `).get(projectId) as { id: string } | undefined
      if (!firstColumn) {
        throw new PMOError('NOT_FOUND', 'No columns exist. Initialize board first.')
      }
      columnId = firstColumn.id
    }

    // Verify column exists in current project
    const column = this.db.prepare(`
      SELECT id FROM ${T.columns}
      WHERE project_id = ? AND (id = ? OR name = ?)
    `).get(projectId, columnId, columnId) as { id: string } | undefined
    if (!column) {
      throw new PMOError('NOT_FOUND', `Column not found: ${columnId}`)
    }
    columnId = column.id

    // Get position for board (always append to end)
    const position = this.getMaxTicketPosition(columnId) + 1

    const now = Date.now()

    // Get spec_id (single spec per ticket)
    const specId = ticket.specId || null

    // Get status_id - use provided or get project's default status
    let statusId = ticket.statusId
    if (!statusId) {
      const defaultStatus = await this.getDefaultStatus(projectId)
      if (defaultStatus) {
        statusId = defaultStatus.id
      } else {
        // Fall back to first status in backlog category
        const firstStatus = this.db.prepare(`
          SELECT id FROM ${T.statuses}
          WHERE project_id = ?
          ORDER BY
            CASE category
              WHEN 'backlog' THEN 1
              WHEN 'unstarted' THEN 2
              WHEN 'started' THEN 3
              WHEN 'completed' THEN 4
              WHEN 'canceled' THEN 5
            END,
            position ASC
          LIMIT 1
        `).get(projectId) as { id: string } | undefined
        if (firstStatus) {
          statusId = firstStatus.id
        } else {
          throw new PMOError('NOT_FOUND', 'No statuses found. Apply a workflow template first.')
        }
      }
    }

    // Insert into tickets table (pure ticket data)
    const labels = ticket.labels || []
    this.db.prepare(`
      INSERT INTO ${T.tickets} (
        id, project_id, title, description, priority, category,
        status_id, owner, assignee, spec_id, epic_id, labels,
        created_at, updated_at, last_synced_from_spec, last_synced_from_board
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, projectId, title,
      ticket.description || null,
      ticket.priority || null,
      ticket.category || null,
      statusId,
      ticket.owner || null,
      ticket.assignee || null,
      specId,
      ticket.epicId || null,
      JSON.stringify(labels),
      now, now,
      ticket.lastSyncedFromSpec || null,
      ticket.lastSyncedFromBoard || null
    )

    // Insert into board_tickets table (board position)
    this.db.prepare(`
      INSERT INTO ${T.board_tickets} (project_id, ticket_id, column_id, position)
      VALUES (?, ?, ?, ?)
    `).run(projectId, id, columnId, position)

    // Insert subtasks
    if (ticket.subtasks && ticket.subtasks.length > 0) {
      const insertSubtask = this.db.prepare(`
        INSERT INTO ${T.subtasks} (id, ticket_id, title, done, position)
        VALUES (?, ?, ?, ?, ?)
      `)
      ticket.subtasks.forEach((st, idx) => {
        insertSubtask.run(st.id || slugify(st.title), id, st.title, st.done ? 1 : 0, idx)
      })
    }

    // Insert metadata
    if (ticket.metadata) {
      const insertMeta = this.db.prepare(`
        INSERT INTO ${T.ticket_metadata} (ticket_id, key, value)
        VALUES (?, ?, ?)
      `)
      for (const [key, value] of Object.entries(ticket.metadata)) {
        insertMeta.run(id, key, value)
      }
    }

    this.updateBoardTimestamp()

    return this.getTicketById(id) as Promise<Ticket>
  }

  async getTicket(id: string): Promise<Ticket | null> {
    return this.getTicketById(id)
  }

  async updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket> {
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.title !== undefined) {
      updates.push('title = ?')
      params.push(changes.title)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description)
    }
    if (changes.priority !== undefined) {
      updates.push('priority = ?')
      params.push(changes.priority)
    }
    if (changes.category !== undefined) {
      updates.push('category = ?')
      params.push(changes.category)
    }
    if (changes.statusId !== undefined) {
      updates.push('status_id = ?')
      params.push(changes.statusId)
    }
    if (changes.owner !== undefined) {
      updates.push('owner = ?')
      params.push(changes.owner)
    }
    if (changes.assignee !== undefined) {
      updates.push('assignee = ?')
      params.push(changes.assignee)
    }
    if (changes.branch !== undefined) {
      updates.push('branch = ?')
      params.push(changes.branch)
    }
    if (changes.specId !== undefined) {
      updates.push('spec_id = ?')
      params.push(changes.specId)
    }
    if (changes.lastSyncedFromSpec !== undefined) {
      updates.push('last_synced_from_spec = ?')
      params.push(changes.lastSyncedFromSpec)
    }
    if (changes.lastSyncedFromBoard !== undefined) {
      updates.push('last_synced_from_board = ?')
      params.push(changes.lastSyncedFromBoard)
    }
    if (changes.labels !== undefined) {
      updates.push('labels = ?')
      params.push(JSON.stringify(changes.labels))
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(Date.now())
      params.push(id)

      this.db.prepare(`UPDATE ${T.tickets} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    // Update subtasks if provided
    if (changes.subtasks !== undefined) {
      this.db.prepare(`DELETE FROM ${T.subtasks} WHERE ticket_id = ?`).run(id)
      const insertSubtask = this.db.prepare(`
        INSERT INTO ${T.subtasks} (id, ticket_id, title, done, position)
        VALUES (?, ?, ?, ?, ?)
      `)
      changes.subtasks.forEach((st, idx) => {
        insertSubtask.run(st.id || slugify(st.title), id, st.title, st.done ? 1 : 0, idx)
      })
    }

    // Update metadata if provided
    if (changes.metadata !== undefined) {
      this.db.prepare(`DELETE FROM ${T.ticket_metadata} WHERE ticket_id = ?`).run(id)
      const insertMeta = this.db.prepare(`
        INSERT INTO ${T.ticket_metadata} (ticket_id, key, value)
        VALUES (?, ?, ?)
      `)
      for (const [key, value] of Object.entries(changes.metadata)) {
        insertMeta.run(id, key, value)
      }
    }

    this.updateBoardTimestamp()

    return this.getTicketById(id) as Promise<Ticket>
  }

  async moveTicket(id: string, column: string, position?: number): Promise<Ticket> {
    const projectId = this.currentProjectId
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    // Verify target column exists in current project
    const targetColumn = this.db.prepare(`
      SELECT id FROM ${T.columns}
      WHERE project_id = ? AND (id = ? OR name = ?)
    `).get(projectId, column, column) as { id: string } | undefined
    if (!targetColumn) {
      throw new PMOError('NOT_FOUND', `Column not found: ${column}`)
    }

    const targetColumnId = targetColumn.id
    const pos = position ?? this.getMaxTicketPosition(targetColumnId) + 1

    // Get current board position
    const currentBoardPos = this.db.prepare(`
      SELECT column_id, position FROM ${T.board_tickets}
      WHERE project_id = ? AND ticket_id = ?
    `).get(projectId, id) as { column_id: string; position: number } | undefined

    if (!currentBoardPos) {
      throw new PMOError('NOT_FOUND', `Board position not found for ticket: ${id}`)
    }

    // If moving within same column, adjust positions
    if (currentBoardPos.column_id === targetColumnId) {
      if (pos < currentBoardPos.position) {
        this.db.prepare(`
          UPDATE ${T.board_tickets}
          SET position = position + 1
          WHERE project_id = ? AND column_id = ? AND position >= ? AND position < ?
        `).run(projectId, targetColumnId, pos, currentBoardPos.position)
      } else if (pos > currentBoardPos.position) {
        this.db.prepare(`
          UPDATE ${T.board_tickets}
          SET position = position - 1
          WHERE project_id = ? AND column_id = ? AND position > ? AND position <= ?
        `).run(projectId, targetColumnId, currentBoardPos.position, pos)
      }
    } else {
      // Moving to different column
      // Shift positions in old column
      this.db.prepare(`
        UPDATE ${T.board_tickets}
        SET position = position - 1
        WHERE project_id = ? AND column_id = ? AND position > ?
      `).run(projectId, currentBoardPos.column_id, currentBoardPos.position)
      // Shift positions in new column
      this.db.prepare(`
        UPDATE ${T.board_tickets}
        SET position = position + 1
        WHERE project_id = ? AND column_id = ? AND position >= ?
      `).run(projectId, targetColumnId, pos)
    }

    // Update board position
    this.db.prepare(`
      UPDATE ${T.board_tickets}
      SET column_id = ?, position = ?
      WHERE project_id = ? AND ticket_id = ?
    `).run(targetColumnId, pos, projectId, id)

    // Find status matching the target column name and update status_id
    const matchingStatus = this.db.prepare(`
      SELECT id FROM ${T.statuses}
      WHERE project_id = ? AND LOWER(name) = LOWER(?)
    `).get(projectId, column) as { id: string } | undefined

    // Update ticket timestamp and status_id if a matching status exists
    if (matchingStatus) {
      this.db.prepare(`
        UPDATE ${T.tickets}
        SET updated_at = ?, status_id = ?
        WHERE id = ?
      `).run(Date.now(), matchingStatus.id, id)
    } else {
      this.db.prepare(`
        UPDATE ${T.tickets}
        SET updated_at = ?
        WHERE id = ?
      `).run(Date.now(), id)
    }

    this.updateBoardTimestamp()

    return this.getTicketById(id) as Promise<Ticket>
  }

  async deleteTicket(id: string): Promise<void> {
    const projectId = this.currentProjectId
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    // Get board position before deleting
    const boardPos = this.db.prepare(`
      SELECT column_id, position FROM ${T.board_tickets}
      WHERE project_id = ? AND ticket_id = ?
    `).get(projectId, id) as { column_id: string; position: number } | undefined

    // Delete ticket (CASCADE will delete board_tickets entry)
    const result = this.db.prepare(`
      DELETE FROM ${T.tickets}
      WHERE project_id = ? AND id = ?
    `).run(projectId, id)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    // Shift positions of remaining tickets in the same column
    if (boardPos) {
      this.db.prepare(`
        UPDATE ${T.board_tickets}
        SET position = position - 1
        WHERE project_id = ? AND column_id = ? AND position > ?
      `).run(projectId, boardPos.column_id, boardPos.position)
    }

    this.updateBoardTimestamp()
  }

  async listTickets(filter?: TicketFilter): Promise<Ticket[]> {
    const projectId = this.currentProjectId
    let query = `
      SELECT t.*, bt.column_id, bt.position, c.name as column_name
      FROM ${T.tickets} t
      LEFT JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      LEFT JOIN ${T.columns} c ON bt.project_id = c.project_id AND bt.column_id = c.id
      LEFT JOIN ${T.statuses} s ON t.status_id = s.id
      WHERE t.project_id = ?
    `
    const params: unknown[] = [projectId]

    if (filter?.statusId) {
      query += ' AND t.status_id = ?'
      params.push(filter.statusId)
    }
    if (filter?.statusCategory) {
      query += ' AND s.category = ?'
      params.push(filter.statusCategory)
    }
    if (filter?.priority) {
      query += ' AND t.priority = ?'
      params.push(filter.priority)
    }
    if (filter?.category) {
      query += ' AND t.category = ?'
      params.push(filter.category)
    }
    if (filter?.owner) {
      query += ' AND t.owner = ?'
      params.push(filter.owner)
    }
    if (filter?.assignee) {
      query += ' AND t.assignee = ?'
      params.push(filter.assignee)
    }
    if (filter?.search) {
      query += ' AND (t.title LIKE ? OR t.description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }
    if (filter?.spec) {
      query += ' AND t.spec_id = ?'
      params.push(filter.spec)
    }
    if (filter?.epic) {
      query += ' AND t.epic_id = ?'
      params.push(filter.epic)
    }
    if (filter?.column) {
      query += ' AND c.name = ?'
      params.push(filter.column)
    }

    query += ' ORDER BY c.position, bt.position'

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string
      project_id: string
      title: string
      description: string | null
      priority: string | null
      category: string | null
      status_id: string
      owner: string | null
      assignee: string | null
      branch: string | null
      spec_id: string | null
      epic_id: string | null
      labels: string | null
      column_id: string | null
      column_name: string | null
      position: number | null
      created_at: string
      updated_at: string
      last_synced_from_spec: string | null
      last_synced_from_board: string | null
    }>

    return Promise.all(rows.map((row) => this.rowToTicket(row)))
  }

  // ===========================================================================
  // Subtask Operations
  // ===========================================================================

  async addSubtask(ticketId: string, title: string): Promise<Subtask> {
    const ticket = await this.getTicketById(ticketId)
    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    const id = slugify(title)
    const position = ticket.subtasks.length

    this.db
      .prepare(
        `
      INSERT INTO ${T.subtasks} (id, ticket_id, title, done, position)
      VALUES (?, ?, ?, 0, ?)
    `
      )
      .run(id, ticketId, title, position)

    this.db.prepare(`UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?`).run(Date.now(), ticketId)

    this.updateBoardTimestamp()

    return { id, title, done: false }
  }

  async toggleSubtask(ticketId: string, subtaskId: string): Promise<Subtask> {
    const subtask = this.db
      .prepare(`SELECT * FROM ${T.subtasks} WHERE ticket_id = ? AND id = ?`)
      .get(ticketId, subtaskId) as { id: string; title: string; done: number } | undefined

    if (!subtask) {
      throw new PMOError('NOT_FOUND', `Subtask not found: ${subtaskId}`)
    }

    const newDone = subtask.done ? 0 : 1
    this.db.prepare(`UPDATE ${T.subtasks} SET done = ? WHERE ticket_id = ? AND id = ?`).run(newDone, ticketId, subtaskId)

    this.db.prepare(`UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?`).run(Date.now(), ticketId)

    this.updateBoardTimestamp()

    return {
      id: subtask.id,
      title: subtask.title,
      done: newDone === 1,
    }
  }

  async removeSubtask(ticketId: string, subtaskId: string): Promise<void> {
    const result = this.db
      .prepare(`DELETE FROM ${T.subtasks} WHERE ticket_id = ? AND id = ?`)
      .run(ticketId, subtaskId)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Subtask not found: ${subtaskId}`)
    }

    this.db.prepare(`UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?`).run(Date.now(), ticketId)

    this.updateBoardTimestamp()
  }

  // ===========================================================================
  // Spec Operations
  // ===========================================================================

  async createSpec(spec: Partial<Spec>): Promise<Spec> {
    const id = spec.id || slugify(spec.title || 'untitled')
    const now = Date.now()

    this.db
      .prepare(
        `
      INSERT INTO ${T.specs} (
        id, title, status, type, tags, depends_on,
        problem, solution, decisions, not_now, ui_ux,
        acceptance_criteria, open_questions,
        requirements_functional, requirements_technical,
        context, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        spec.title || 'Untitled Spec',
        spec.status || 'draft',
        spec.type || null,
        spec.tags ? JSON.stringify(spec.tags) : null,
        spec.dependsOn ? JSON.stringify(spec.dependsOn) : null,
        spec.problem || null,
        spec.solution || null,
        spec.decisions || null,
        spec.notNow || null,
        spec.uiUx || null,
        spec.acceptanceCriteria || null,
        spec.openQuestions || null,
        spec.requirementsFunctional || null,
        spec.requirementsTechnical || null,
        spec.context || null,
        now,
        now
      )

    return {
      id,
      title: spec.title || 'Untitled Spec',
      status: spec.status || 'draft',
      type: spec.type,
      tags: spec.tags,
      dependsOn: spec.dependsOn,
      problem: spec.problem,
      solution: spec.solution,
      decisions: spec.decisions,
      notNow: spec.notNow,
      uiUx: spec.uiUx,
      acceptanceCriteria: spec.acceptanceCriteria,
      openQuestions: spec.openQuestions,
      requirementsFunctional: spec.requirementsFunctional,
      requirementsTechnical: spec.requirementsTechnical,
      context: spec.context,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  async getSpec(id: string): Promise<Spec | null> {
    const row = this.db.prepare(`
      SELECT id, title, status, type, tags, depends_on,
             problem, solution, decisions, not_now, ui_ux,
             acceptance_criteria, open_questions,
             requirements_functional, requirements_technical,
             context, created_at, updated_at
      FROM ${T.specs} WHERE id = ?
    `).get(id) as
      | {
          id: string
          title: string
          status: string
          type: string | null
          tags: string | null
          depends_on: string | null
          problem: string | null
          solution: string | null
          decisions: string | null
          not_now: string | null
          ui_ux: string | null
          acceptance_criteria: string | null
          open_questions: string | null
          requirements_functional: string | null
          requirements_technical: string | null
          context: string | null
          created_at: string
          updated_at: string
        }
      | undefined

    if (!row) return null

    return {
      id: row.id,
      title: row.title,
      status: row.status as 'draft' | 'active' | 'implemented',
      type: row.type as 'product' | 'platform' | 'infra' | 'integration' | undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      dependsOn: row.depends_on ? JSON.parse(row.depends_on) : undefined,
      problem: row.problem || undefined,
      solution: row.solution || undefined,
      decisions: row.decisions || undefined,
      notNow: row.not_now || undefined,
      uiUx: row.ui_ux || undefined,
      acceptanceCriteria: row.acceptance_criteria || undefined,
      openQuestions: row.open_questions || undefined,
      requirementsFunctional: row.requirements_functional || undefined,
      requirementsTechnical: row.requirements_technical || undefined,
      context: row.context || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

  async listSpecs(filter?: SpecFilter): Promise<Spec[]> {
    let query = `
      SELECT id, title, status, type, tags, depends_on,
             problem, solution, decisions, not_now, ui_ux,
             acceptance_criteria, open_questions,
             requirements_functional, requirements_technical,
             context, created_at, updated_at
      FROM ${T.specs} WHERE 1=1
    `
    const params: unknown[] = []

    if (filter?.status) {
      query += ' AND status = ?'
      params.push(filter.status)
    }
    if (filter?.type) {
      query += ' AND type = ?'
      params.push(filter.type)
    }
    if (filter?.search) {
      query += ' AND (id LIKE ? OR title LIKE ? OR problem LIKE ? OR solution LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`)
    }

    query += ' ORDER BY title'

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string
      title: string
      status: string
      type: string | null
      tags: string | null
      depends_on: string | null
      problem: string | null
      solution: string | null
      decisions: string | null
      not_now: string | null
      ui_ux: string | null
      acceptance_criteria: string | null
      open_questions: string | null
      requirements_functional: string | null
      requirements_technical: string | null
      context: string | null
      created_at: string
      updated_at: string
    }>

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status as 'draft' | 'active' | 'implemented',
      type: row.type as 'product' | 'platform' | 'infra' | 'integration' | undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      dependsOn: row.depends_on ? JSON.parse(row.depends_on) : undefined,
      problem: row.problem || undefined,
      solution: row.solution || undefined,
      decisions: row.decisions || undefined,
      notNow: row.not_now || undefined,
      uiUx: row.ui_ux || undefined,
      acceptanceCriteria: row.acceptance_criteria || undefined,
      openQuestions: row.open_questions || undefined,
      requirementsFunctional: row.requirements_functional || undefined,
      requirementsTechnical: row.requirements_technical || undefined,
      context: row.context || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }))
  }

  async updateSpec(id: string, changes: Partial<Spec>): Promise<Spec> {
    const existing = await this.getSpec(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.title !== undefined) {
      updates.push('title = ?')
      params.push(changes.title)
    }
    if (changes.status !== undefined) {
      updates.push('status = ?')
      params.push(changes.status)
    }
    if (changes.type !== undefined) {
      updates.push('type = ?')
      params.push(changes.type)
    }
    if (changes.tags !== undefined) {
      updates.push('tags = ?')
      params.push(JSON.stringify(changes.tags))
    }
    if (changes.dependsOn !== undefined) {
      updates.push('depends_on = ?')
      params.push(JSON.stringify(changes.dependsOn))
    }
    if (changes.problem !== undefined) {
      updates.push('problem = ?')
      params.push(changes.problem)
    }
    if (changes.solution !== undefined) {
      updates.push('solution = ?')
      params.push(changes.solution)
    }
    if (changes.decisions !== undefined) {
      updates.push('decisions = ?')
      params.push(changes.decisions)
    }
    if (changes.notNow !== undefined) {
      updates.push('not_now = ?')
      params.push(changes.notNow)
    }
    if (changes.uiUx !== undefined) {
      updates.push('ui_ux = ?')
      params.push(changes.uiUx)
    }
    if (changes.acceptanceCriteria !== undefined) {
      updates.push('acceptance_criteria = ?')
      params.push(changes.acceptanceCriteria)
    }
    if (changes.openQuestions !== undefined) {
      updates.push('open_questions = ?')
      params.push(changes.openQuestions)
    }
    if (changes.requirementsFunctional !== undefined) {
      updates.push('requirements_functional = ?')
      params.push(changes.requirementsFunctional)
    }
    if (changes.requirementsTechnical !== undefined) {
      updates.push('requirements_technical = ?')
      params.push(changes.requirementsTechnical)
    }
    if (changes.context !== undefined) {
      updates.push('context = ?')
      params.push(changes.context)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(Date.now())
      params.push(id)

      this.db.prepare(`UPDATE ${T.specs} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    return this.getSpec(id) as Promise<Spec>
  }

  async deleteSpec(id: string): Promise<void> {
    const existing = await this.getSpec(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${id}`)
    }

    // Delete spec (cascade will handle spec_dependencies)
    this.db.prepare(`DELETE FROM ${T.specs} WHERE id = ?`).run(id)

    // Clear spec_id from any tickets that reference this spec
    this.db.prepare(`UPDATE ${T.tickets} SET spec_id = NULL WHERE spec_id = ?`).run(id)
  }

  async linkTicketToSpec(ticketId: string, specId: string): Promise<void> {
    // Verify both exist
    const ticket = await this.getTicketById(ticketId)
    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    const spec = await this.getSpec(specId)
    if (!spec) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${specId}`)
    }

    // Update spec_id on ticket (one-to-many relationship)
    this.db.prepare(`
      UPDATE ${T.tickets}
      SET spec_id = ?, updated_at = ?
      WHERE id = ?
    `).run(specId, Date.now(), ticketId)

    this.updateBoardTimestamp()
  }

  async unlinkTicketFromSpec(ticketId: string, specId: string): Promise<void> {
    // Clear spec_id if it matches
    this.db.prepare(`
      UPDATE ${T.tickets}
      SET spec_id = NULL, updated_at = ?
      WHERE id = ? AND spec_id = ?
    `).run(Date.now(), ticketId, specId)

    this.updateBoardTimestamp()
  }

  async getTicketsForSpec(specId: string): Promise<Ticket[]> {
    return this.listTickets({ spec: specId })
  }

  async getSpecsForTicket(ticketId: string): Promise<Spec[]> {
    // Get the ticket to find its spec_id
    const ticket = await this.getTicketById(ticketId)
    if (!ticket || !ticket.specId) {
      return []
    }

    const spec = await this.getSpec(ticket.specId)
    return spec ? [spec] : []
  }

  async addSpecDependency(specId: string, dependsOnId: string): Promise<void> {
    // Verify both specs exist
    const spec = await this.getSpec(specId)
    if (!spec) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${specId}`)
    }

    const dependsOnSpec = await this.getSpec(dependsOnId)
    if (!dependsOnSpec) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${dependsOnId}`)
    }

    // Insert dependency (ignore if already exists)
    this.db.prepare(`
      INSERT OR IGNORE INTO ${T.spec_dependencies} (spec_id, depends_on, created_at)
      VALUES (?, ?, ?)
    `).run(specId, dependsOnId, Date.now())
  }

  async removeSpecDependency(specId: string, dependsOnId: string): Promise<void> {
    this.db.prepare(`
      DELETE FROM ${T.spec_dependencies}
      WHERE spec_id = ? AND depends_on = ?
    `).run(specId, dependsOnId)
  }

  async getSpecDependencies(specId: string): Promise<Spec[]> {
    const rows = this.db.prepare(`
      SELECT depends_on FROM ${T.spec_dependencies} WHERE spec_id = ?
    `).all(specId) as Array<{ depends_on: string }>

    const specs: Spec[] = []
    for (const row of rows) {
      const spec = await this.getSpec(row.depends_on)
      if (spec) specs.push(spec)
    }
    return specs
  }

  async getSpecDependents(specId: string): Promise<Spec[]> {
    const rows = this.db.prepare(`
      SELECT spec_id FROM ${T.spec_dependencies} WHERE depends_on = ?
    `).all(specId) as Array<{ spec_id: string }>

    const specs: Spec[] = []
    for (const row of rows) {
      const spec = await this.getSpec(row.spec_id)
      if (spec) specs.push(spec)
    }
    return specs
  }

  // ===========================================================================
  // Project-Spec Association Operations (Many-to-Many)
  // ===========================================================================

  async linkProjectToSpec(projectId: string, specId: string): Promise<void> {
    // Verify project exists
    const project = await this.getProject(projectId)
    if (!project) {
      throw new PMOError('NOT_FOUND', `Project "${projectId}" not found`)
    }

    // Verify spec exists
    const spec = await this.getSpec(specId)
    if (!spec) {
      throw new PMOError('NOT_FOUND', `Spec "${specId}" not found`)
    }

    this.db.prepare(`
      INSERT OR IGNORE INTO ${T.project_specs} (project_id, spec_id)
      VALUES (?, ?)
    `).run(projectId, specId)
  }

  async unlinkProjectFromSpec(projectId: string, specId: string): Promise<void> {
    this.db.prepare(`
      DELETE FROM ${T.project_specs}
      WHERE project_id = ? AND spec_id = ?
    `).run(projectId, specId)
  }

  async getSpecsForProject(projectId: string): Promise<Spec[]> {
    const rows = this.db.prepare(`
      SELECT spec_id FROM ${T.project_specs} WHERE project_id = ?
    `).all(projectId) as Array<{ spec_id: string }>

    const specs: Spec[] = []
    for (const row of rows) {
      const spec = await this.getSpec(row.spec_id)
      if (spec) specs.push(spec)
    }
    return specs
  }

  async getProjectsForSpec(specId: string): Promise<Project[]> {
    const rows = this.db.prepare(`
      SELECT project_id FROM ${T.project_specs} WHERE spec_id = ?
    `).all(specId) as Array<{ project_id: string }>

    const projects: Project[] = []
    for (const row of rows) {
      const project = await this.getProject(row.project_id)
      if (project) projects.push(project)
    }
    return projects
  }

  // ===========================================================================
  // Epic Operations
  // ===========================================================================

  async createEpic(epic: Partial<Epic>): Promise<Epic> {
    const id = epic.id || generateEntityId(this.db, 'epic')
    const title = epic.title || 'Untitled Epic'
    const projectId = this.currentProjectId
    const status = epic.status || 'active'
    const now = Date.now()

    // Get next position if not provided (add to end)
    let position = epic.position
    if (position === undefined) {
      const maxPos = this.db.prepare(`
        SELECT COALESCE(MAX(position), -1) as max_pos FROM ${T.epics} WHERE project_id = ?
      `).get(projectId) as { max_pos: number }
      position = maxPos.max_pos + 1
    }

    this.db.prepare(`
      INSERT INTO ${T.epics} (id, project_id, title, description, status, position, file_path, spec_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, title, epic.description || null, status, position, epic.filePath || null, epic.specId || null, now, now)

    this.updateBoardTimestamp()

    return {
      id,
      projectId,
      title,
      description: epic.description,
      status,
      position,
      filePath: epic.filePath,
      specId: epic.specId,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  async getEpic(id: string): Promise<Epic | null> {
    const row = this.db.prepare(`
      SELECT * FROM ${T.epics} WHERE id = ?
    `).get(id) as {
      id: string
      project_id: string
      title: string
      description: string | null
      status: string
      position: number
      file_path: string | null
      spec_id: string | null
      created_at: string
      updated_at: string
    } | undefined

    if (!row) return null

    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description || undefined,
      status: row.status as Epic['status'],
      position: row.position,
      filePath: row.file_path || undefined,
      specId: row.spec_id || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

  async listEpics(filter?: EpicFilter): Promise<Epic[]> {
    const projectId = this.currentProjectId
    let query = `SELECT * FROM ${T.epics} WHERE project_id = ?`
    const params: unknown[] = [projectId]

    if (filter?.status) {
      query += ' AND status = ?'
      params.push(filter.status)
    }
    if (filter?.search) {
      query += ' AND (title LIKE ? OR description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    // Sort by position (priority order), then by created_at as tiebreaker
    query += ' ORDER BY position ASC, created_at ASC'

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string
      project_id: string
      title: string
      description: string | null
      status: string
      position: number
      file_path: string | null
      spec_id: string | null
      created_at: string
      updated_at: string
    }>

    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description || undefined,
      status: row.status as Epic['status'],
      position: row.position,
      filePath: row.file_path || undefined,
      specId: row.spec_id || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }))
  }

  /**
   * Reorder an epic to a new position.
   * Updates positions of other epics to maintain order.
   */
  async reorderEpic(epicId: string, newPosition: number): Promise<Epic> {
    const epic = await this.getEpic(epicId)
    if (!epic) {
      throw new Error(`Epic not found: ${epicId}`)
    }

    const oldPosition = epic.position
    if (oldPosition === newPosition) {
      return epic
    }

    const projectId = this.currentProjectId

    // Shift other epics to make room
    if (newPosition < oldPosition) {
      // Moving up: shift epics in [newPosition, oldPosition) down by 1
      this.db.prepare(`
        UPDATE ${T.epics}
        SET position = position + 1, updated_at = ?
        WHERE project_id = ? AND position >= ? AND position < ?
      `).run(Date.now(), projectId, newPosition, oldPosition)
    } else {
      // Moving down: shift epics in (oldPosition, newPosition] up by 1
      this.db.prepare(`
        UPDATE ${T.epics}
        SET position = position - 1, updated_at = ?
        WHERE project_id = ? AND position > ? AND position <= ?
      `).run(Date.now(), projectId, oldPosition, newPosition)
    }

    // Update the epic's position
    this.db.prepare(`
      UPDATE ${T.epics}
      SET position = ?, updated_at = ?
      WHERE id = ?
    `).run(newPosition, Date.now(), epicId)

    this.updateBoardTimestamp()

    return (await this.getEpic(epicId))!
  }

  async updateEpic(id: string, changes: Partial<Epic>): Promise<Epic> {
    const epic = await this.getEpic(id)
    if (!epic) {
      throw new PMOError('NOT_FOUND', `Epic not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.title !== undefined) {
      updates.push('title = ?')
      params.push(changes.title)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description)
    }
    if (changes.status !== undefined) {
      updates.push('status = ?')
      params.push(changes.status)
    }
    if (changes.filePath !== undefined) {
      updates.push('file_path = ?')
      params.push(changes.filePath)
    }
    if (changes.specId !== undefined) {
      updates.push('spec_id = ?')
      params.push(changes.specId || null)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(Date.now())
      params.push(id)

      this.db.prepare(`UPDATE ${T.epics} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    this.updateBoardTimestamp()
    return this.getEpic(id) as Promise<Epic>
  }

  async deleteEpic(id: string): Promise<void> {
    const epic = await this.getEpic(id)
    if (!epic) {
      throw new PMOError('NOT_FOUND', `Epic not found: ${id}`)
    }

    // Unlink all tickets from this epic first
    this.db.prepare(`
      UPDATE ${T.tickets} SET epic_id = NULL WHERE epic_id = ?
    `).run(id)

    this.db.prepare(`DELETE FROM ${T.epics} WHERE id = ?`).run(id)
    this.updateBoardTimestamp()
  }

  async getTicketsForEpic(epicId: string): Promise<Ticket[]> {
    return this.listTickets({ epic: epicId })
  }

  async linkTicketToEpic(ticketId: string, epicId: string): Promise<void> {
    // Verify both exist
    const ticket = await this.getTicketById(ticketId)
    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    const epic = await this.getEpic(epicId)
    if (!epic) {
      throw new PMOError('NOT_FOUND', `Epic not found: ${epicId}`)
    }

    this.db.prepare(`
      UPDATE ${T.tickets}
      SET epic_id = ?, updated_at = ?
      WHERE id = ?
    `).run(epicId, Date.now(), ticketId)

    this.updateBoardTimestamp()
  }

  async unlinkTicketFromEpic(ticketId: string): Promise<void> {
    this.db.prepare(`
      UPDATE ${T.tickets}
      SET epic_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), ticketId)

    this.updateBoardTimestamp()
  }

  // ===========================================================================
  // Ticket Dependency Operations
  // ===========================================================================

  /**
   * Create a dependency between two tickets.
   * @throws PMOError if tickets don't exist or dependency already exists
   */
  async createTicketDependency(
    ticketId: string,
    dependsOnTicketId: string,
    dependencyType: TicketDependencyType = 'blocks'
  ): Promise<TicketDependency> {
    // Validate tickets exist
    const ticket = await this.getTicket(ticketId)
    if (!ticket) throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`)

    const dependsOnTicket = await this.getTicket(dependsOnTicketId)
    if (!dependsOnTicket) throw new PMOError('NOT_FOUND', `Ticket not found: ${dependsOnTicketId}`)

    try {
      this.db.prepare(`
        INSERT INTO ${T.ticket_dependencies} (ticket_id, depends_on_ticket_id, dependency_type)
        VALUES (?, ?, ?)
      `).run(ticketId, dependsOnTicketId, dependencyType)

      return {
        ticketId,
        dependsOnTicketId,
        dependencyType,
        createdAt: new Date(),
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
        throw new PMOError('CONFLICT', 'Dependency already exists')
      }
      if (error instanceof Error && error.message.includes('CHECK constraint')) {
        throw new PMOError('INVALID', 'Cannot create self-dependency')
      }
      throw error
    }
  }

  /**
   * Delete a ticket dependency.
   */
  async deleteTicketDependency(
    ticketId: string,
    dependsOnTicketId: string,
    dependencyType?: TicketDependencyType
  ): Promise<void> {
    let query = `DELETE FROM ${T.ticket_dependencies} WHERE ticket_id = ? AND depends_on_ticket_id = ?`
    const params: unknown[] = [ticketId, dependsOnTicketId]

    if (dependencyType) {
      query += ' AND dependency_type = ?'
      params.push(dependencyType)
    }

    const result = this.db.prepare(query).run(...params)
    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', 'Dependency not found')
    }
  }

  /**
   * List dependencies for a ticket.
   */
  async listTicketDependencies(ticketId: string): Promise<TicketDependency[]> {
    const rows = this.db.prepare(`
      SELECT ticket_id, depends_on_ticket_id, dependency_type, created_at
      FROM ${T.ticket_dependencies}
      WHERE ticket_id = ?
      ORDER BY created_at DESC
    `).all(ticketId) as Array<{
      ticket_id: string
      depends_on_ticket_id: string
      dependency_type: string
      created_at: string
    }>

    return rows.map(row => ({
      ticketId: row.ticket_id,
      dependsOnTicketId: row.depends_on_ticket_id,
      dependencyType: row.dependency_type as TicketDependencyType,
      createdAt: new Date(row.created_at),
    }))
  }

  /**
   * Get tickets that this ticket depends on (blockers).
   */
  async getTicketBlockers(ticketId: string): Promise<Ticket[]> {
    type TicketRow = {
      id: string
      title: string
      description: string | null
      priority: string | null
      category: string | null
      status_id: string
      owner: string | null
      assignee: string | null
      branch: string | null
      spec_id: string | null
      epic_id: string | null
      labels: string | null
      column_id: string | null
      column_name: string | null
      position: number | null
      created_at: string
      updated_at: string
      last_synced_from_spec: string | null
      last_synced_from_board: string | null
    }

    const rows = this.db.prepare(`
      SELECT t.*, bt.column_id, c.name as column_name, bt.position
      FROM ${T.tickets} t
      JOIN ${T.ticket_dependencies} d ON t.id = d.depends_on_ticket_id
      LEFT JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id
      LEFT JOIN ${T.columns} c ON bt.column_id = c.id AND bt.project_id = c.project_id
      WHERE d.ticket_id = ? AND d.dependency_type = 'blocks'
    `).all(ticketId) as TicketRow[]

    return Promise.all(rows.map(row => this.rowToTicket(row)))
  }

  /**
   * Get tickets that depend on this ticket (blocking).
   */
  async getTicketsBlockedBy(ticketId: string): Promise<Ticket[]> {
    type TicketRow = {
      id: string
      title: string
      description: string | null
      priority: string | null
      category: string | null
      status_id: string
      owner: string | null
      assignee: string | null
      branch: string | null
      spec_id: string | null
      epic_id: string | null
      labels: string | null
      column_id: string | null
      column_name: string | null
      position: number | null
      created_at: string
      updated_at: string
      last_synced_from_spec: string | null
      last_synced_from_board: string | null
    }

    const rows = this.db.prepare(`
      SELECT t.*, bt.column_id, c.name as column_name, bt.position
      FROM ${T.tickets} t
      JOIN ${T.ticket_dependencies} d ON t.id = d.ticket_id
      LEFT JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id
      LEFT JOIN ${T.columns} c ON bt.column_id = c.id AND bt.project_id = c.project_id
      WHERE d.depends_on_ticket_id = ? AND d.dependency_type = 'blocks'
    `).all(ticketId) as TicketRow[]

    return Promise.all(rows.map(row => this.rowToTicket(row)))
  }

  /**
   * Check if a ticket is blocked by incomplete dependencies.
   */
  async isTicketBlocked(ticketId: string): Promise<boolean> {
    const blockers = await this.getTicketBlockers(ticketId)
    return blockers.some(t => t.status !== 'done' && t.status !== 'canceled')
  }

  // ===========================================================================
  // Spec Dependency Operations
  // ===========================================================================

  /**
   * Create a dependency between two specs.
   */
  async createSpecDependency(
    specId: string,
    dependsOnSpecId: string,
    dependencyType: SpecDependencyType = 'depends_on'
  ): Promise<SpecDependency> {
    // Validate specs exist
    const spec = await this.getSpec(specId)
    if (!spec) throw new PMOError('NOT_FOUND', `Spec not found: ${specId}`)

    const dependsOnSpec = await this.getSpec(dependsOnSpecId)
    if (!dependsOnSpec) throw new PMOError('NOT_FOUND', `Spec not found: ${dependsOnSpecId}`)

    try {
      this.db.prepare(`
        INSERT INTO ${T.spec_dependencies} (spec_id, depends_on_spec_id, dependency_type)
        VALUES (?, ?, ?)
      `).run(specId, dependsOnSpecId, dependencyType)

      return {
        specId,
        dependsOnSpecId,
        dependencyType,
        createdAt: new Date(),
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
        throw new PMOError('CONFLICT', 'Dependency already exists')
      }
      if (error instanceof Error && error.message.includes('CHECK constraint')) {
        throw new PMOError('INVALID', 'Cannot create self-dependency')
      }
      throw error
    }
  }

  /**
   * Delete a spec dependency.
   */
  async deleteSpecDependency(
    specId: string,
    dependsOnSpecId: string,
    dependencyType?: SpecDependencyType
  ): Promise<void> {
    let query = `DELETE FROM ${T.spec_dependencies} WHERE spec_id = ? AND depends_on_spec_id = ?`
    const params: unknown[] = [specId, dependsOnSpecId]

    if (dependencyType) {
      query += ' AND dependency_type = ?'
      params.push(dependencyType)
    }

    const result = this.db.prepare(query).run(...params)
    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', 'Dependency not found')
    }
  }

  /**
   * List dependencies for a spec.
   */
  async listSpecDependencies(specId: string): Promise<SpecDependency[]> {
    const rows = this.db.prepare(`
      SELECT spec_id, depends_on_spec_id, dependency_type, created_at
      FROM ${T.spec_dependencies}
      WHERE spec_id = ?
      ORDER BY created_at DESC
    `).all(specId) as Array<{
      spec_id: string
      depends_on_spec_id: string
      dependency_type: string
      created_at: string
    }>

    return rows.map(row => ({
      specId: row.spec_id,
      dependsOnSpecId: row.depends_on_spec_id,
      dependencyType: row.dependency_type as SpecDependencyType,
      createdAt: new Date(row.created_at),
    }))
  }

  // ===========================================================================
  // Epic Dependency Operations
  // ===========================================================================

  /**
   * Create a dependency between two epics.
   */
  async createEpicDependency(
    epicId: string,
    dependsOnEpicId: string,
    dependencyType: EpicDependencyType = 'blocks'
  ): Promise<EpicDependency> {
    // Validate epics exist
    const epic = await this.getEpic(epicId)
    if (!epic) throw new PMOError('NOT_FOUND', `Epic not found: ${epicId}`)

    const dependsOnEpic = await this.getEpic(dependsOnEpicId)
    if (!dependsOnEpic) throw new PMOError('NOT_FOUND', `Epic not found: ${dependsOnEpicId}`)

    try {
      this.db.prepare(`
        INSERT INTO ${T.epic_dependencies} (epic_id, depends_on_epic_id, dependency_type)
        VALUES (?, ?, ?)
      `).run(epicId, dependsOnEpicId, dependencyType)

      return {
        epicId,
        dependsOnEpicId,
        dependencyType,
        createdAt: new Date(),
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
        throw new PMOError('CONFLICT', 'Dependency already exists')
      }
      if (error instanceof Error && error.message.includes('CHECK constraint')) {
        throw new PMOError('INVALID', 'Cannot create self-dependency')
      }
      throw error
    }
  }

  /**
   * Delete an epic dependency.
   */
  async deleteEpicDependency(
    epicId: string,
    dependsOnEpicId: string,
    dependencyType?: EpicDependencyType
  ): Promise<void> {
    let query = `DELETE FROM ${T.epic_dependencies} WHERE epic_id = ? AND depends_on_epic_id = ?`
    const params: unknown[] = [epicId, dependsOnEpicId]

    if (dependencyType) {
      query += ' AND dependency_type = ?'
      params.push(dependencyType)
    }

    const result = this.db.prepare(query).run(...params)
    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', 'Dependency not found')
    }
  }

  /**
   * List dependencies for an epic.
   */
  async listEpicDependencies(epicId: string): Promise<EpicDependency[]> {
    const rows = this.db.prepare(`
      SELECT epic_id, depends_on_epic_id, dependency_type, created_at
      FROM ${T.epic_dependencies}
      WHERE epic_id = ?
      ORDER BY created_at DESC
    `).all(epicId) as Array<{
      epic_id: string
      depends_on_epic_id: string
      dependency_type: string
      created_at: string
    }>

    return rows.map(row => ({
      epicId: row.epic_id,
      dependsOnEpicId: row.depends_on_epic_id,
      dependencyType: row.dependency_type as EpicDependencyType,
      createdAt: new Date(row.created_at),
    }))
  }

  /**
   * Check if an epic is blocked by incomplete dependencies.
   */
  async isEpicBlocked(epicId: string): Promise<boolean> {
    const rows = this.db.prepare(`
      SELECT e.status FROM ${T.epics} e
      JOIN ${T.epic_dependencies} d ON e.id = d.depends_on_epic_id
      WHERE d.epic_id = ? AND d.dependency_type = 'blocks'
    `).all(epicId) as Array<{ status: string }>

    return rows.some(r => r.status !== 'complete' && r.status !== 'dropped')
  }

  // ===========================================================================
  // Workflow Status Operations
  // ===========================================================================

  async listStatuses(projectId: string): Promise<WorkflowStatus[]> {
    const rows = this.db.prepare(`
      SELECT * FROM ${T.statuses}
      WHERE project_id = ?
      ORDER BY
        CASE category
          WHEN 'backlog' THEN 0
          WHEN 'unstarted' THEN 1
          WHEN 'started' THEN 2
          WHEN 'completed' THEN 3
          WHEN 'canceled' THEN 4
        END,
        position
    `).all(projectId) as Array<{
      id: string
      project_id: string
      name: string
      category: string
      position: number
      color: string | null
      description: string | null
      is_default: number
      created_at: string
    }>

    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      category: row.category as StateCategory,
      position: row.position,
      color: row.color || undefined,
      description: row.description || undefined,
      isDefault: row.is_default === 1,
      createdAt: new Date(row.created_at),
    }))
  }
  async getStatus(id: string): Promise<WorkflowStatus | null> {
    const row = this.db.prepare(`
      SELECT * FROM ${T.statuses} WHERE id = ?
    `).get(id) as {
      id: string
      project_id: string
      name: string
      category: string
      position: number
      color: string | null
      description: string | null
      is_default: number
      created_at: string
    } | undefined

    if (!row) return null

    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      category: row.category as StateCategory,
      position: row.position,
      color: row.color || undefined,
      description: row.description || undefined,
      isDefault: row.is_default === 1,
      createdAt: new Date(row.created_at),
    }
  }

  async createStatus(status: Partial<WorkflowStatus>): Promise<WorkflowStatus> {
    const projectId = status.projectId || this.currentProjectId
    const id = status.id || slugify(status.name || 'status')
    const category = status.category || 'backlog'
    const now = new Date().toISOString()

    // Validate category
    if (!STATE_CATEGORY_ORDER.includes(category)) {
      throw new PMOError('INVALID', `Invalid category: ${category}. Must be one of: ${STATE_CATEGORY_ORDER.join(', ')}`)
    }

    // Get next position within category if not specified
    let position = status.position
    if (position === undefined) {
      const maxPos = this.db.prepare(`
        SELECT COALESCE(MAX(position), -1) as max_pos
        FROM ${T.statuses}
        WHERE project_id = ? AND category = ?
      `).get(projectId, category) as { max_pos: number }
      position = maxPos.max_pos + 1
    }

    // Check for duplicate name in project
    const existing = this.db.prepare(`
      SELECT id FROM ${T.statuses}
      WHERE project_id = ? AND LOWER(name) = LOWER(?)
    `).get(projectId, status.name) as { id: string } | undefined
    if (existing) {
      throw new PMOError('CONFLICT', `Status with name "${status.name}" already exists in this project`)
    }

    // If this is the default, unset other defaults in the project
    if (status.isDefault) {
      this.db.prepare(`
        UPDATE ${T.statuses}
        SET is_default = 0
        WHERE project_id = ?
      `).run(projectId)
    }

    this.db.prepare(`
      INSERT INTO ${T.statuses} (id, project_id, name, category, position, color, description, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      status.name || 'New Status',
      category,
      position,
      status.color || null,
      status.description || null,
      status.isDefault ? 1 : 0,
      now
    )

    return {
      id,
      projectId,
      name: status.name || 'New Status',
      category,
      position,
      color: status.color,
      description: status.description,
      isDefault: status.isDefault || false,
      createdAt: new Date(now),
    }
  }

  async updateStatus(id: string, changes: Partial<WorkflowStatus>): Promise<WorkflowStatus> {
    const existing = await this.getStatus(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Status not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      // Check for duplicate name
      const duplicate = this.db.prepare(`
        SELECT id FROM ${T.statuses}
        WHERE project_id = ? AND LOWER(name) = LOWER(?) AND id != ?
      `).get(existing.projectId, changes.name, id) as { id: string } | undefined
      if (duplicate) {
        throw new PMOError('CONFLICT', `Status with name "${changes.name}" already exists in this project`)
      }
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.category !== undefined) {
      if (!STATE_CATEGORY_ORDER.includes(changes.category)) {
        throw new PMOError('INVALID', `Invalid category: ${changes.category}`)
      }
      updates.push('category = ?')
      params.push(changes.category)
    }
    if (changes.position !== undefined) {
      updates.push('position = ?')
      params.push(changes.position)
    }
    if (changes.color !== undefined) {
      updates.push('color = ?')
      params.push(changes.color || null)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }
    if (changes.isDefault !== undefined) {
      if (changes.isDefault) {
        // Unset other defaults
        this.db.prepare(`
          UPDATE ${T.statuses}
          SET is_default = 0
          WHERE project_id = ?
        `).run(existing.projectId)
      }
      updates.push('is_default = ?')
      params.push(changes.isDefault ? 1 : 0)
    }

    if (updates.length > 0) {
      params.push(id)
      this.db.prepare(`UPDATE ${T.statuses} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    return this.getStatus(id) as Promise<WorkflowStatus>
  }

  async deleteStatus(id: string): Promise<void> {
    const existing = await this.getStatus(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Status not found: ${id}`)
    }

    // Check if any tickets use this status
    const ticketCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM ${T.tickets}
      WHERE status_id = ?
    `).get(id) as { count: number }

    if (ticketCount.count > 0) {
      throw new PMOError('CONFLICT', `Cannot delete status: ${ticketCount.count} ticket(s) are using it`)
    }

    this.db.prepare(`DELETE FROM ${T.statuses} WHERE id = ?`).run(id)

    // Reorder remaining statuses in the same category
    this.db.prepare(`
      UPDATE ${T.statuses}
      SET position = position - 1
      WHERE project_id = ? AND category = ? AND position > ?
    `).run(existing.projectId, existing.category, existing.position)
  }

  async reorderStatus(id: string, newPosition: number): Promise<WorkflowStatus> {
    const existing = await this.getStatus(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Status not found: ${id}`)
    }

    const oldPosition = existing.position
    if (oldPosition === newPosition) {
      return existing
    }

    // Shift other statuses within the same category
    if (newPosition < oldPosition) {
      // Moving up: shift statuses in [newPosition, oldPosition) down by 1
      this.db.prepare(`
        UPDATE ${T.statuses}
        SET position = position + 1
        WHERE project_id = ? AND category = ? AND position >= ? AND position < ?
      `).run(existing.projectId, existing.category, newPosition, oldPosition)
    } else {
      // Moving down: shift statuses in (oldPosition, newPosition] up by 1
      this.db.prepare(`
        UPDATE ${T.statuses}
        SET position = position - 1
        WHERE project_id = ? AND category = ? AND position > ? AND position <= ?
      `).run(existing.projectId, existing.category, oldPosition, newPosition)
    }

    // Update the status's position
    this.db.prepare(`
      UPDATE ${T.statuses}
      SET position = ?
      WHERE id = ?
    `).run(newPosition, id)

    return this.getStatus(id) as Promise<WorkflowStatus>
  }

  async getDefaultStatus(projectId: string): Promise<WorkflowStatus | null> {
    type StatusRow = {
      id: string
      project_id: string
      name: string
      category: string
      position: number
      color: string | null
      description: string | null
      is_default: number
      created_at: string
    }

    const row = this.db.prepare(`
      SELECT * FROM ${T.statuses}
      WHERE project_id = ? AND is_default = 1
    `).get(projectId) as StatusRow | undefined

    if (!row) {
      // If no explicit default, return first status in backlog category
      const fallback = this.db.prepare(`
        SELECT * FROM ${T.statuses}
        WHERE project_id = ?
        ORDER BY
          CASE category
            WHEN 'backlog' THEN 0
            WHEN 'unstarted' THEN 1
            WHEN 'started' THEN 2
            WHEN 'completed' THEN 3
            WHEN 'canceled' THEN 4
          END,
          position
        LIMIT 1
      `).get(projectId) as StatusRow | undefined

      if (!fallback) return null
      return {
        id: fallback.id,
        projectId: fallback.project_id,
        name: fallback.name,
        category: fallback.category as StateCategory,
        position: fallback.position,
        color: fallback.color || undefined,
        description: fallback.description || undefined,
        isDefault: fallback.is_default === 1,
        createdAt: new Date(fallback.created_at),
      }
    }

    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      category: row.category as StateCategory,
      position: row.position,
      color: row.color || undefined,
      description: row.description || undefined,
      isDefault: true,
      createdAt: new Date(row.created_at),
    }
  }

  // ===========================================================================
  // Workflow Template Operations
  // ===========================================================================

  async listTemplates(filter?: TemplateFilter): Promise<WorkflowTemplate[]> {
    let query = `SELECT * FROM ${T.templates} WHERE 1=1`
    const params: unknown[] = []

    if (filter?.isBuiltin !== undefined) {
      query += ' AND is_builtin = ?'
      params.push(filter.isBuiltin ? 1 : 0)
    }
    if (filter?.search) {
      query += ' AND (name LIKE ? OR description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    query += ' ORDER BY is_builtin DESC, name'

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string
      name: string
      description: string | null
      is_builtin: number
      statuses: string
      created_at: string
    }>

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isBuiltin: row.is_builtin === 1,
      statuses: JSON.parse(row.statuses) as WorkflowTemplateStatus[],
      createdAt: new Date(row.created_at),
    }))
  }

  async getTemplate(id: string): Promise<WorkflowTemplate | null> {
    const row = this.db.prepare(`
      SELECT * FROM ${T.templates} WHERE id = ?
    `).get(id) as {
      id: string
      name: string
      description: string | null
      is_builtin: number
      statuses: string
      created_at: string
    } | undefined

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isBuiltin: row.is_builtin === 1,
      statuses: JSON.parse(row.statuses) as WorkflowTemplateStatus[],
      createdAt: new Date(row.created_at),
    }
  }

  async applyTemplate(projectId: string, templateId: string): Promise<WorkflowStatus[]> {
    const template = await this.getTemplate(templateId)
    if (!template) {
      throw new PMOError('NOT_FOUND', `Template not found: ${templateId}`)
    }

    // Verify project exists
    const project = this.db.prepare(`SELECT id FROM ${T.projects} WHERE id = ?`).get(projectId)
    if (!project) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectId}`)
    }

    // Delete existing statuses for this project
    this.db.prepare(`DELETE FROM ${T.statuses} WHERE project_id = ?`).run(projectId)

    // Create new statuses from template
    const now = new Date().toISOString()
    const insertStatus = this.db.prepare(`
      INSERT INTO ${T.statuses} (id, project_id, name, category, position, color, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const createdStatuses: WorkflowStatus[] = []
    let isFirstBacklog = true

    for (const templateStatus of template.statuses) {
      const id = `${projectId}-${slugify(templateStatus.name)}`
      // First backlog status is default
      const isDefault = templateStatus.category === 'backlog' && isFirstBacklog
      if (isDefault) isFirstBacklog = false

      insertStatus.run(
        id,
        projectId,
        templateStatus.name,
        templateStatus.category,
        templateStatus.position,
        templateStatus.color || null,
        isDefault ? 1 : 0,
        now
      )

      createdStatuses.push({
        id,
        projectId,
        name: templateStatus.name,
        category: templateStatus.category,
        position: templateStatus.position,
        color: templateStatus.color,
        isDefault,
        createdAt: new Date(now),
      })
    }

    return createdStatuses
  }

  async saveTemplate(name: string, projectId: string, description?: string): Promise<WorkflowTemplate> {
    // Get statuses from the project
    const statuses = await this.listStatuses(projectId)
    if (statuses.length === 0) {
      throw new PMOError('INVALID', `Project ${projectId} has no statuses to save as template`)
    }

    // Check for duplicate template name
    const existing = this.db.prepare(`
      SELECT id FROM ${T.templates}
      WHERE LOWER(name) = LOWER(?)
    `).get(name) as { id: string } | undefined
    if (existing) {
      throw new PMOError('CONFLICT', `Template with name "${name}" already exists`)
    }

    const id = slugify(name)
    const now = new Date().toISOString()

    // Convert statuses to template format (remove project-specific fields)
    const templateStatuses: WorkflowTemplateStatus[] = statuses.map(s => ({
      name: s.name,
      category: s.category,
      position: s.position,
      color: s.color,
    }))

    this.db.prepare(`
      INSERT INTO ${T.templates} (id, name, description, is_builtin, statuses, created_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(id, name, description || null, JSON.stringify(templateStatuses), now)

    return {
      id,
      name,
      description,
      isBuiltin: false,
      statuses: templateStatuses,
      createdAt: new Date(now),
    }
  }

  async updateTemplate(id: string, changes: { name?: string; description?: string }): Promise<WorkflowTemplate> {
    const existing = await this.getTemplate(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Template not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot modify built-in templates')
    }

    // Check for duplicate name if name is changing
    if (changes.name && changes.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = this.db.prepare(`SELECT id FROM ${T.templates} WHERE LOWER(name) = LOWER(?) AND id != ?`).get(changes.name, id)
      if (dup) {
        throw new PMOError('CONFLICT', `Template "${changes.name}" already exists`)
      }
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }

    if (updates.length > 0) {
      params.push(id)
      this.db.prepare(`UPDATE ${T.templates} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    return (await this.getTemplate(id))!
  }

  async deleteTemplate(id: string): Promise<void> {
    const existing = await this.getTemplate(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Template not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot delete built-in templates')
    }

    this.db.prepare(`DELETE FROM ${T.templates} WHERE id = ?`).run(id)
  }

  // ===========================================================================
  // Project Phase Operations (workspace-scoped)
  // ===========================================================================

  async listPhases(filter?: PhaseFilter): Promise<ProjectPhase[]> {
    let sql = `SELECT * FROM ${T.phases}`
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.category) {
      conditions.push('category = ?')
      params.push(filter.category)
    }

    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      const searchTerm = `%${filter.search}%`
      params.push(searchTerm, searchTerm)
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    // Order by category order, then by position within category
    sql += ` ORDER BY
      CASE category
        WHEN 'backlog' THEN 0
        WHEN 'unstarted' THEN 1
        WHEN 'started' THEN 2
        WHEN 'completed' THEN 3
        WHEN 'canceled' THEN 4
      END,
      position`

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string
      name: string
      category: string
      position: number
      color: string | null
      description: string | null
      is_default: number
      created_at: string
    }>

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      category: row.category as StateCategory,
      position: row.position,
      color: row.color || undefined,
      description: row.description || undefined,
      isDefault: row.is_default === 1,
      createdAt: new Date(row.created_at),
    }))
  }

  async getPhase(id: string): Promise<ProjectPhase | null> {
    const row = this.db.prepare(`SELECT * FROM ${T.phases} WHERE id = ?`).get(id) as {
      id: string
      name: string
      category: string
      position: number
      color: string | null
      description: string | null
      is_default: number
      created_at: string
    } | undefined

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      category: row.category as StateCategory,
      position: row.position,
      color: row.color || undefined,
      description: row.description || undefined,
      isDefault: row.is_default === 1,
      createdAt: new Date(row.created_at),
    }
  }

  async createPhase(phase: Partial<ProjectPhase>): Promise<ProjectPhase> {
    if (!phase.name) {
      throw new PMOError('INVALID', 'Phase name is required')
    }

    if (!phase.category) {
      throw new PMOError('INVALID', 'Phase category is required')
    }

    // Validate category
    if (!STATE_CATEGORY_ORDER.includes(phase.category)) {
      throw new PMOError('INVALID', `Invalid category: ${phase.category}. Must be one of: ${STATE_CATEGORY_ORDER.join(', ')}`)
    }

    // Check for duplicate name
    const existing = this.db.prepare(`SELECT id FROM ${T.phases} WHERE LOWER(name) = LOWER(?)`).get(phase.name)
    if (existing) {
      throw new PMOError('CONFLICT', `Phase "${phase.name}" already exists`)
    }

    // Get next position within category
    const maxPos = this.db.prepare(`
      SELECT MAX(position) as max FROM ${T.phases} WHERE category = ?
    `).get(phase.category) as { max: number | null }
    const position = phase.position ?? (maxPos.max !== null ? maxPos.max + 1 : 0)

    const id = phase.id || slugify(phase.name)
    const now = new Date().toISOString()

    // If setting as default, unset other defaults first
    if (phase.isDefault) {
      this.db.prepare(`UPDATE ${T.phases} SET is_default = 0`).run()
    }

    this.db.prepare(`
      INSERT INTO ${T.phases} (id, name, category, position, color, description, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      phase.name,
      phase.category,
      position,
      phase.color || null,
      phase.description || null,
      phase.isDefault ? 1 : 0,
      now
    )

    return (await this.getPhase(id))!
  }

  async updatePhase(id: string, changes: Partial<ProjectPhase>): Promise<ProjectPhase> {
    const existing = await this.getPhase(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Phase not found: ${id}`)
    }

    if (changes.category && !STATE_CATEGORY_ORDER.includes(changes.category)) {
      throw new PMOError('INVALID', `Invalid category: ${changes.category}. Must be one of: ${STATE_CATEGORY_ORDER.join(', ')}`)
    }

    // Check for duplicate name if name is changing
    if (changes.name && changes.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = this.db.prepare(`SELECT id FROM ${T.phases} WHERE LOWER(name) = LOWER(?) AND id != ?`).get(changes.name, id)
      if (dup) {
        throw new PMOError('CONFLICT', `Phase "${changes.name}" already exists`)
      }
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.category !== undefined) {
      updates.push('category = ?')
      params.push(changes.category)
    }
    if (changes.position !== undefined) {
      updates.push('position = ?')
      params.push(changes.position)
    }
    if (changes.color !== undefined) {
      updates.push('color = ?')
      params.push(changes.color || null)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }
    if (changes.isDefault !== undefined) {
      updates.push('is_default = ?')
      params.push(changes.isDefault ? 1 : 0)

      // If setting as default, unset other defaults
      if (changes.isDefault) {
        this.db.prepare(`UPDATE ${T.phases} SET is_default = 0 WHERE id != ?`).run(id)
      }
    }

    if (updates.length > 0) {
      params.push(id)
      this.db.prepare(`UPDATE ${T.phases} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    return (await this.getPhase(id))!
  }

  async deletePhase(id: string): Promise<void> {
    const existing = await this.getPhase(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Phase not found: ${id}`)
    }

    // Check if any projects use this phase
    const projectCount = this.db.prepare(`SELECT COUNT(*) as count FROM ${T.projects} WHERE phase_id = ?`).get(id) as { count: number }
    if (projectCount.count > 0) {
      throw new PMOError('CONFLICT', `Cannot delete phase "${existing.name}" - ${projectCount.count} project(s) are using it`)
    }

    this.db.prepare(`DELETE FROM ${T.phases} WHERE id = ?`).run(id)
  }

  async reorderPhase(id: string, newPosition: number): Promise<ProjectPhase> {
    const phase = await this.getPhase(id)
    if (!phase) {
      throw new PMOError('NOT_FOUND', `Phase not found: ${id}`)
    }

    const oldPosition = phase.position

    if (newPosition === oldPosition) {
      return phase
    }

    // Shift other phases within the same category
    if (newPosition < oldPosition) {
      this.db.prepare(`
        UPDATE ${T.phases}
        SET position = position + 1
        WHERE category = ? AND position >= ? AND position < ? AND id != ?
      `).run(phase.category, newPosition, oldPosition, id)
    } else {
      this.db.prepare(`
        UPDATE ${T.phases}
        SET position = position - 1
        WHERE category = ? AND position > ? AND position <= ? AND id != ?
      `).run(phase.category, oldPosition, newPosition, id)
    }

    this.db.prepare(`UPDATE ${T.phases} SET position = ? WHERE id = ?`).run(newPosition, id)

    return (await this.getPhase(id))!
  }

  async getDefaultPhase(): Promise<ProjectPhase | null> {
    type PhaseRow = {
      id: string
      name: string
      category: string
      position: number
      color: string | null
      description: string | null
      is_default: number
      created_at: string
    }

    const row = this.db.prepare(`SELECT * FROM ${T.phases} WHERE is_default = 1`).get() as PhaseRow | undefined

    if (!row) {
      // Fallback to first phase
      const firstRow = this.db.prepare(`
        SELECT * FROM ${T.phases}
        ORDER BY
          CASE category WHEN 'backlog' THEN 0 WHEN 'unstarted' THEN 1 WHEN 'started' THEN 2 WHEN 'completed' THEN 3 WHEN 'canceled' THEN 4 END,
          position
        LIMIT 1
      `).get() as PhaseRow | undefined
      if (!firstRow) return null
      return {
        id: firstRow.id,
        name: firstRow.name,
        category: firstRow.category as StateCategory,
        position: firstRow.position,
        color: firstRow.color || undefined,
        description: firstRow.description || undefined,
        isDefault: false,
        createdAt: new Date(firstRow.created_at),
      }
    }

    return {
      id: row.id,
      name: row.name,
      category: row.category as StateCategory,
      position: row.position,
      color: row.color || undefined,
      description: row.description || undefined,
      isDefault: true,
      createdAt: new Date(row.created_at),
    }
  }

  // ===========================================================================
  // Phase Template Operations
  // ===========================================================================

  async listPhaseTemplates(filter?: PhaseTemplateFilter): Promise<PhaseTemplate[]> {
    type TemplateRow = {
      id: string
      name: string
      description: string | null
      is_builtin: number
      phases: string
      created_at: string
    }

    let sql = `SELECT * FROM ${T.phase_templates}`
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push('is_builtin = ?')
      params.push(filter.isBuiltin ? 1 : 0)
    }

    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    sql += ' ORDER BY is_builtin DESC, name ASC'

    const rows = this.db.prepare(sql).all(...params) as TemplateRow[]

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isBuiltin: row.is_builtin === 1,
      phases: JSON.parse(row.phases) as PhaseTemplatePhase[],
      createdAt: new Date(row.created_at),
    }))
  }

  async getPhaseTemplate(id: string): Promise<PhaseTemplate | null> {
    type TemplateRow = {
      id: string
      name: string
      description: string | null
      is_builtin: number
      phases: string
      created_at: string
    }

    const row = this.db.prepare(`SELECT * FROM ${T.phase_templates} WHERE id = ?`).get(id) as TemplateRow | undefined

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isBuiltin: row.is_builtin === 1,
      phases: JSON.parse(row.phases) as PhaseTemplatePhase[],
      createdAt: new Date(row.created_at),
    }
  }

  async applyPhaseTemplate(templateId: string): Promise<ProjectPhase[]> {
    const template = await this.getPhaseTemplate(templateId)
    if (!template) {
      throw new PMOError('NOT_FOUND', `Phase template not found: ${templateId}`)
    }

    // Delete existing phases
    this.db.prepare(`DELETE FROM ${T.phases}`).run()

    // Create phases from template
    const createdPhases: ProjectPhase[] = []
    const now = new Date().toISOString()

    for (const templatePhase of template.phases) {
      const id = slugify(templatePhase.name)

      this.db.prepare(`
        INSERT INTO ${T.phases} (id, name, category, position, color, description, is_default, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        templatePhase.name,
        templatePhase.category,
        templatePhase.position,
        templatePhase.color || null,
        templatePhase.description || null,
        templatePhase.isDefault ? 1 : 0,
        now
      )

      createdPhases.push({
        id,
        name: templatePhase.name,
        category: templatePhase.category,
        position: templatePhase.position,
        color: templatePhase.color,
        description: templatePhase.description,
        isDefault: templatePhase.isDefault,
        createdAt: new Date(now),
      })
    }

    return createdPhases
  }

  async savePhaseTemplate(name: string, description?: string): Promise<PhaseTemplate> {
    // Get current phases from workspace
    const phases = await this.listPhases()
    if (phases.length === 0) {
      throw new PMOError('INVALID', 'No phases configured to save as template')
    }

    // Check for duplicate template name
    const existing = this.db.prepare(`
      SELECT id FROM ${T.phase_templates}
      WHERE LOWER(name) = LOWER(?)
    `).get(name) as { id: string } | undefined
    if (existing) {
      throw new PMOError('CONFLICT', `Phase template with name "${name}" already exists`)
    }

    const id = slugify(name)
    const now = new Date().toISOString()

    // Convert phases to template format
    const templatePhases: PhaseTemplatePhase[] = phases.map(p => ({
      name: p.name,
      category: p.category,
      position: p.position,
      color: p.color,
      description: p.description,
      isDefault: p.isDefault,
    }))

    this.db.prepare(`
      INSERT INTO ${T.phase_templates} (id, name, description, is_builtin, phases, created_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(id, name, description || null, JSON.stringify(templatePhases), now)

    return {
      id,
      name,
      description,
      isBuiltin: false,
      phases: templatePhases,
      createdAt: new Date(now),
    }
  }

  async updatePhaseTemplate(id: string, changes: { name?: string; description?: string }): Promise<PhaseTemplate> {
    const existing = await this.getPhaseTemplate(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Phase template not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot modify built-in phase templates')
    }

    // Check for duplicate name if name is changing
    if (changes.name && changes.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = this.db.prepare(`SELECT id FROM ${T.phase_templates} WHERE LOWER(name) = LOWER(?) AND id != ?`).get(changes.name, id)
      if (dup) {
        throw new PMOError('CONFLICT', `Phase template "${changes.name}" already exists`)
      }
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }

    if (updates.length > 0) {
      params.push(id)
      this.db.prepare(`UPDATE ${T.phase_templates} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    return (await this.getPhaseTemplate(id))!
  }

  async deletePhaseTemplate(id: string): Promise<void> {
    const existing = await this.getPhaseTemplate(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Phase template not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot delete built-in phase templates')
    }

    this.db.prepare(`DELETE FROM ${T.phase_templates} WHERE id = ?`).run(id)
  }

  // ===========================================================================
  // Work Action Operations
  // ===========================================================================

  async listActions(filter?: WorkActionFilter): Promise<WorkAction[]> {
    type ActionRow = {
      id: string
      name: string
      description: string | null
      prompt: string
      suggested_for_categories: string | null
      default_move_to_category: string | null
      modifies_code: number
      is_builtin: number
      created_at: string
    }

    let sql = `SELECT * FROM ${T.actions}`
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push('is_builtin = ?')
      params.push(filter.isBuiltin ? 1 : 0)
    }

    if (filter?.suggestedFor) {
      conditions.push('suggested_for_categories LIKE ?')
      params.push(`%"${filter.suggestedFor}"%`)
    }

    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    sql += ' ORDER BY is_builtin DESC, position ASC, name ASC'

    const rows = this.db.prepare(sql).all(...params) as ActionRow[]

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      prompt: row.prompt,
      suggestedForCategories: row.suggested_for_categories
        ? JSON.parse(row.suggested_for_categories) as StateCategory[]
        : undefined,
      defaultMoveToCategory: row.default_move_to_category as StateCategory | undefined,
      modifiesCode: row.modifies_code === 1,
      isBuiltin: row.is_builtin === 1,
      createdAt: new Date(row.created_at),
    }))
  }

  async getAction(id: string): Promise<WorkAction | null> {
    type ActionRow = {
      id: string
      name: string
      description: string | null
      prompt: string
      suggested_for_categories: string | null
      default_move_to_category: string | null
      modifies_code: number
      is_builtin: number
      created_at: string
    }

    const row = this.db.prepare(`SELECT * FROM ${T.actions} WHERE id = ?`).get(id) as ActionRow | undefined

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      prompt: row.prompt,
      suggestedForCategories: row.suggested_for_categories
        ? JSON.parse(row.suggested_for_categories) as StateCategory[]
        : undefined,
      defaultMoveToCategory: row.default_move_to_category as StateCategory | undefined,
      modifiesCode: row.modifies_code === 1,
      isBuiltin: row.is_builtin === 1,
      createdAt: new Date(row.created_at),
    }
  }

  async createAction(action: Partial<WorkAction>): Promise<WorkAction> {
    if (!action.name) {
      throw new PMOError('INVALID', 'Action name is required')
    }
    if (!action.prompt) {
      throw new PMOError('INVALID', 'Action prompt is required')
    }

    const id = action.id || slugify(action.name)

    // Check for duplicate name
    const existing = this.db.prepare(`SELECT id FROM ${T.actions} WHERE LOWER(name) = LOWER(?)`).get(action.name)
    if (existing) {
      throw new PMOError('CONFLICT', `Action with name "${action.name}" already exists`)
    }

    const now = new Date().toISOString()
    const modifiesCode = action.modifiesCode !== false  // Default to true

    this.db.prepare(`
      INSERT INTO ${T.actions} (id, name, description, prompt, suggested_for_categories, default_move_to_category, modifies_code, is_builtin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      action.name,
      action.description || null,
      action.prompt,
      action.suggestedForCategories ? JSON.stringify(action.suggestedForCategories) : null,
      action.defaultMoveToCategory || null,
      modifiesCode ? 1 : 0,
      action.isBuiltin ? 1 : 0,
      now
    )

    return {
      id,
      name: action.name,
      description: action.description,
      prompt: action.prompt,
      suggestedForCategories: action.suggestedForCategories,
      defaultMoveToCategory: action.defaultMoveToCategory,
      modifiesCode,
      isBuiltin: action.isBuiltin || false,
      createdAt: new Date(now),
    }
  }

  async updateAction(id: string, changes: Partial<WorkAction>): Promise<WorkAction> {
    const existing = await this.getAction(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Action not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot modify built-in actions')
    }

    // Check for duplicate name if name is changing
    if (changes.name && changes.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = this.db.prepare(`SELECT id FROM ${T.actions} WHERE LOWER(name) = LOWER(?) AND id != ?`).get(changes.name, id)
      if (dup) {
        throw new PMOError('CONFLICT', `Action "${changes.name}" already exists`)
      }
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }
    if (changes.prompt !== undefined) {
      updates.push('prompt = ?')
      params.push(changes.prompt)
    }
    if (changes.suggestedForCategories !== undefined) {
      updates.push('suggested_for_categories = ?')
      params.push(changes.suggestedForCategories ? JSON.stringify(changes.suggestedForCategories) : null)
    }
    if (changes.defaultMoveToCategory !== undefined) {
      updates.push('default_move_to_category = ?')
      params.push(changes.defaultMoveToCategory || null)
    }
    if (changes.modifiesCode !== undefined) {
      updates.push('modifies_code = ?')
      params.push(changes.modifiesCode ? 1 : 0)
    }

    if (updates.length > 0) {
      params.push(id)
      this.db.prepare(`UPDATE ${T.actions} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    return (await this.getAction(id))!
  }

  async deleteAction(id: string): Promise<void> {
    const existing = await this.getAction(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Action not found: ${id}`)
    }

    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot delete built-in actions')
    }

    this.db.prepare(`DELETE FROM ${T.actions} WHERE id = ?`).run(id)
  }

  async getSuggestedAction(category: StateCategory): Promise<WorkAction | null> {
    const actions = await this.listActions({ suggestedFor: category })
    // Return first matching action (built-ins first due to ordering)
    return actions.length > 0 ? actions[0] : null
  }

  // ===========================================================================
  // Extended Project Operations
  // ===========================================================================

  async getProject(id: string): Promise<Project | null> {
    const row = this.db.prepare(`SELECT * FROM ${T.projects} WHERE id = ?`).get(id) as {
      id: string
      name: string
      template: string | null
      description: string | null
      status: string
      phase_id: string | null
      is_archived: number
      target_date: string | null
      initiative_id: string | null
      created_at: string
      updated_at: string
    } | undefined

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      template: row.template || undefined,
      description: row.description || undefined,
      status: (row.status || 'active') as 'draft' | 'active' | 'completed' | 'archived',
      phaseId: row.phase_id || undefined,
      isArchived: row.is_archived === 1,
      targetDate: row.target_date ? new Date(row.target_date) : undefined,
      initiativeId: row.initiative_id || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

  async updateProject(id: string, changes: Partial<Project>): Promise<Project> {
    const existing = await this.getProject(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Project not found: ${id}`)
    }

    const updates: string[] = ['updated_at = ?']
    const params: unknown[] = [Date.now()]

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }
    if (changes.status !== undefined) {
      updates.push('status = ?')
      params.push(changes.status)
    }
    if (changes.phaseId !== undefined) {
      updates.push('phase_id = ?')
      params.push(changes.phaseId || null)
    }
    if (changes.isArchived !== undefined) {
      updates.push('is_archived = ?')
      params.push(changes.isArchived ? 1 : 0)
    }
    if (changes.targetDate !== undefined) {
      updates.push('target_date = ?')
      params.push(changes.targetDate ? changes.targetDate.toISOString() : null)
    }

    params.push(id)
    this.db.prepare(`UPDATE ${T.projects} SET ${updates.join(', ')} WHERE id = ?`).run(...params)

    return (await this.getProject(id))!
  }

  async listProjects(filter?: ProjectFilter): Promise<Project[]> {
    let sql = `SELECT * FROM ${T.projects}`
    const conditions: string[] = []
    const params: unknown[] = []

    // Filter by archived status if explicitly specified
    // undefined means show all, true means only archived, false means only non-archived
    if (filter?.isArchived === true) {
      conditions.push('is_archived = 1')
    } else if (filter?.isArchived === false) {
      conditions.push('is_archived = 0')
    }
    // If isArchived is undefined, show all projects

    if (filter?.phaseId) {
      conditions.push('phase_id = ?')
      params.push(filter.phaseId)
    }

    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      const searchTerm = `%${filter.search}%`
      params.push(searchTerm, searchTerm)
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    sql += ' ORDER BY updated_at DESC'

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string
      name: string
      template: string | null
      description: string | null
      status: string
      phase_id: string | null
      is_archived: number
      target_date: string | null
      initiative_id: string | null
      created_at: string
      updated_at: string
    }>

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      template: row.template || undefined,
      description: row.description || undefined,
      status: (row.status || 'active') as 'draft' | 'active' | 'completed' | 'archived',
      phaseId: row.phase_id || undefined,
      isArchived: row.is_archived === 1,
      targetDate: row.target_date ? new Date(row.target_date) : undefined,
      initiativeId: row.initiative_id || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }))
  }

  async archiveProject(id: string): Promise<Project> {
    const existing = await this.getProject(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Project not found: ${id}`)
    }

    if (existing.isArchived) {
      return existing
    }

    return this.updateProject(id, { isArchived: true })
  }

  async unarchiveProject(id: string): Promise<Project> {
    const existing = await this.getProject(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Project not found: ${id}`)
    }

    if (!existing.isArchived) {
      return existing
    }

    return this.updateProject(id, { isArchived: false })
  }

  // ===========================================================================
  // Board View Operations
  // ===========================================================================

  async listBoardViews(filter?: BoardViewFilter): Promise<BoardView[]> {
    let sql = `SELECT * FROM ${T.board_views}`
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.projectId) {
      conditions.push('project_id = ?')
      params.push(filter.projectId)
    }

    if (filter?.isDefault !== undefined) {
      conditions.push('is_default = ?')
      params.push(filter.isDefault ? 1 : 0)
    }

    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      const searchTerm = `%${filter.search}%`
      params.push(searchTerm, searchTerm)
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    sql += ' ORDER BY is_default DESC, name ASC'

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string
      project_id: string
      name: string
      description: string | null
      is_default: number
      filters: string
      group_by: string | null
      sort_by: string | null
      created_at: string
      updated_at: string
    }>

    return rows.map(row => this.rowToBoardView(row))
  }

  async getBoardView(id: string): Promise<BoardView | null> {
    const row = this.db.prepare(`SELECT * FROM ${T.board_views} WHERE id = ?`).get(id) as {
      id: string
      project_id: string
      name: string
      description: string | null
      is_default: number
      filters: string
      group_by: string | null
      sort_by: string | null
      created_at: string
      updated_at: string
    } | undefined

    if (!row) return null
    return this.rowToBoardView(row)
  }

  async createBoardView(view: Partial<BoardView>): Promise<BoardView> {
    if (!view.projectId) {
      throw new PMOError('INVALID', 'Project ID is required')
    }
    if (!view.name) {
      throw new PMOError('INVALID', 'View name is required')
    }

    const id = view.id || slugify(view.name) + '-' + Date.now().toString(36)
    const now = Date.now()
    const filters = JSON.stringify(view.filters || {})

    // If this is set as default, unset other defaults for this project
    if (view.isDefault) {
      this.db.prepare(`
        UPDATE ${T.board_views} SET is_default = 0 WHERE project_id = ?
      `).run(view.projectId)
    }

    this.db.prepare(`
      INSERT INTO ${T.board_views} (id, project_id, name, description, is_default, filters, group_by, sort_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      view.projectId,
      view.name,
      view.description || null,
      view.isDefault ? 1 : 0,
      filters,
      view.groupBy || null,
      view.sortBy || null,
      now,
      now
    )

    return (await this.getBoardView(id))!
  }

  async updateBoardView(id: string, changes: Partial<BoardView>): Promise<BoardView> {
    const existing = await this.getBoardView(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Board view not found: ${id}`)
    }

    const updates: string[] = ['updated_at = ?']
    const params: unknown[] = [Date.now()]

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }
    if (changes.isDefault !== undefined) {
      // If setting as default, unset other defaults for this project
      if (changes.isDefault) {
        this.db.prepare(`
          UPDATE ${T.board_views} SET is_default = 0 WHERE project_id = ?
        `).run(existing.projectId)
      }
      updates.push('is_default = ?')
      params.push(changes.isDefault ? 1 : 0)
    }
    if (changes.filters !== undefined) {
      updates.push('filters = ?')
      params.push(JSON.stringify(changes.filters))
    }
    if (changes.groupBy !== undefined) {
      updates.push('group_by = ?')
      params.push(changes.groupBy || null)
    }
    if (changes.sortBy !== undefined) {
      updates.push('sort_by = ?')
      params.push(changes.sortBy || null)
    }

    params.push(id)
    this.db.prepare(`UPDATE ${T.board_views} SET ${updates.join(', ')} WHERE id = ?`).run(...params)

    return (await this.getBoardView(id))!
  }

  async deleteBoardView(id: string): Promise<void> {
    const result = this.db.prepare(`DELETE FROM ${T.board_views} WHERE id = ?`).run(id)
    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Board view not found: ${id}`)
    }
  }

  async getDefaultBoardView(projectId: string): Promise<BoardView | null> {
    const row = this.db.prepare(`
      SELECT * FROM ${T.board_views} WHERE project_id = ? AND is_default = 1
    `).get(projectId) as {
      id: string
      project_id: string
      name: string
      description: string | null
      is_default: number
      filters: string
      group_by: string | null
      sort_by: string | null
      created_at: string
      updated_at: string
    } | undefined

    if (!row) return null
    return this.rowToBoardView(row)
  }

  /**
   * Get board with optional filters applied.
   * If viewId is provided, uses that view's filters.
   * If filters are provided, they override the view's filters.
   */
  async getBoardWithView(viewId?: string, filters?: BoardViewFilters): Promise<Board> {
    let viewFilters: BoardViewFilters = {}
    let viewSortBy: BoardViewSortBy | undefined

    // Load view if specified
    if (viewId) {
      const view = await this.getBoardView(viewId)
      if (view) {
        viewFilters = view.filters
        viewSortBy = view.sortBy
      }
    }

    // Override with explicit filters if provided
    const effectiveFilters = { ...viewFilters, ...filters }

    // Get project metadata
    const projectRow = this.db.prepare(`SELECT * FROM ${T.projects} WHERE id = ?`).get(this.currentProjectId) as
      | { id: string; name: string; updated_at: string }
      | undefined

    if (!projectRow) {
      throw new PMOError('NOT_FOUND', `Project not found: ${this.currentProjectId}. Run init() first.`)
    }

    // Get columns for current project
    const columnRows = this.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ?
      ORDER BY position
    `).all(this.currentProjectId) as Array<{
      id: string
      project_id: string
      name: string
      position: number
    }>

    // Filter columns if columnIds filter is set
    const filteredColumnRows = effectiveFilters.columnIds?.length
      ? columnRows.filter(col => effectiveFilters.columnIds!.includes(col.id))
      : columnRows

    // Get tickets with filters applied
    const columns: Column[] = await Promise.all(
      filteredColumnRows.map(async (col) => {
        const tickets = await this.getTicketsForColumnWithFilters(col.id, this.currentProjectId, effectiveFilters)

        // Apply sorting if specified
        const sortedTickets = viewSortBy ? this.sortTickets(tickets, viewSortBy) : tickets

        return {
          id: col.id,
          name: col.name,
          position: col.position,
          tickets: sortedTickets,
        }
      })
    )

    return {
      id: projectRow.id,
      name: projectRow.name,
      columns,
      updatedAt: new Date(projectRow.updated_at),
    }
  }

  private rowToBoardView(row: {
    id: string
    project_id: string
    name: string
    description: string | null
    is_default: number
    filters: string
    group_by: string | null
    sort_by: string | null
    created_at: string
    updated_at: string
  }): BoardView {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description || undefined,
      isDefault: row.is_default === 1,
      filters: JSON.parse(row.filters) as BoardViewFilters,
      groupBy: row.group_by as BoardViewGroupBy | undefined,
      sortBy: row.sort_by as BoardViewSortBy | undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

  /**
   * Get tickets for a column with filters applied
   */
  private async getTicketsForColumnWithFilters(
    columnId: string,
    projectId: string,
    filters: BoardViewFilters
  ): Promise<Ticket[]> {
    let sql = `
      SELECT t.*, bt.position as board_position, c.name as column_name,
             s.name as status_name, s.category as status_category
      FROM ${T.tickets} t
      JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      JOIN ${T.columns} c ON bt.column_id = c.id AND bt.project_id = c.project_id
      LEFT JOIN ${T.statuses} s ON t.status_id = s.id
      WHERE bt.column_id = ? AND bt.project_id = ?
    `
    const params: unknown[] = [columnId, projectId]

    // Apply filters
    if (filters.assignee !== undefined) {
      if (filters.assignee === 'unassigned') {
        sql += ' AND (t.assignee IS NULL OR t.assignee = "")'
      } else {
        sql += ' AND t.assignee = ?'
        params.push(filters.assignee)
      }
    }

    if (filters.owner !== undefined) {
      sql += ' AND t.owner = ?'
      params.push(filters.owner)
    }

    if (filters.priority !== undefined) {
      sql += ' AND UPPER(t.priority) = UPPER(?)'
      params.push(filters.priority)
    }

    if (filters.statusCategory !== undefined) {
      sql += ' AND s.category = ?'
      params.push(filters.statusCategory)
    }

    if (filters.statusId !== undefined) {
      sql += ' AND t.status_id = ?'
      params.push(filters.statusId)
    }

    if (filters.epicId !== undefined) {
      sql += ' AND t.epic_id = ?'
      params.push(filters.epicId)
    }

    if (filters.search !== undefined) {
      sql += ' AND (t.title LIKE ? OR t.description LIKE ?)'
      const searchTerm = `%${filters.search}%`
      params.push(searchTerm, searchTerm)
    }

    sql += ' ORDER BY bt.position'

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string
      project_id: string
      title: string
      description: string | null
      priority: string | null
      category: string | null
      status: string
      status_id: string | null
      owner: string | null
      assignee: string | null
      branch: string | null
      spec_id: string | null
      epic_id: string | null
      labels: string | null
      created_at: string
      updated_at: string
      last_synced_from_spec: string | null
      last_synced_from_board: string | null
      board_position: number
      column_name: string
      status_name: string | null
      status_category: string | null
    }>

    return Promise.all(rows.map(row => this.rowToTicketWithColumn(row)))
  }

  private async rowToTicketWithColumn(row: {
    id: string
    project_id: string
    title: string
    description: string | null
    priority: string | null
    category: string | null
    status: string
    status_id: string | null
    owner: string | null
    assignee: string | null
    branch: string | null
    spec_id: string | null
    epic_id: string | null
    labels: string | null
    created_at: string
    updated_at: string
    last_synced_from_spec: string | null
    last_synced_from_board: string | null
    board_position: number
    column_name: string
    status_name: string | null
    status_category: string | null
  }): Promise<Ticket> {
    // Get subtasks
    const subtaskRows = this.db.prepare(`
      SELECT * FROM ${T.subtasks} WHERE ticket_id = ? ORDER BY position
    `).all(row.id) as Array<{ id: string; title: string; done: number }>

    const subtasks: Subtask[] = subtaskRows.map(s => ({
      id: s.id,
      title: s.title,
      done: s.done === 1,
    }))

    // Get metadata
    const metadataRows = this.db.prepare(`
      SELECT key, value FROM ${T.ticket_metadata} WHERE ticket_id = ?
    `).all(row.id) as Array<{ key: string; value: string }>

    const metadata: Record<string, string> = {}
    for (const m of metadataRows) {
      metadata[m.key] = m.value
    }

    // Parse labels from JSON
    let labels: string[] = []
    try {
      labels = row.labels ? JSON.parse(row.labels) : []
    } catch {
      labels = []
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description || undefined,
      priority: row.priority || undefined,
      category: row.category || undefined,
      statusId: row.status_id || '',
      statusName: row.status_name || undefined,
      statusCategory: row.status_category as StateCategory | undefined,
      status: row.status,
      owner: row.owner || undefined,
      assignee: row.assignee || undefined,
      branch: row.branch || undefined,
      specId: row.spec_id || undefined,
      epicId: row.epic_id || undefined,
      subtasks,
      labels,
      metadata,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastSyncedFromSpec: row.last_synced_from_spec ? new Date(row.last_synced_from_spec) : undefined,
      lastSyncedFromBoard: row.last_synced_from_board ? new Date(row.last_synced_from_board) : undefined,
    }
  }

  private sortTickets(tickets: Ticket[], sortBy: BoardViewSortBy): Ticket[] {
    const sorted = [...tickets]

    switch (sortBy) {
      case 'priority': {
        const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
        sorted.sort((a, b) => {
          const aOrder = priorityOrder[(a.priority || 'MEDIUM').toUpperCase()] ?? 3
          const bOrder = priorityOrder[(b.priority || 'MEDIUM').toUpperCase()] ?? 3
          return aOrder - bOrder
        })
        break
      }
      case 'created':
        sorted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        break
      case 'updated':
        sorted.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        break
      case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title))
        break
      case 'assignee':
        sorted.sort((a, b) => (a.assignee || '').localeCompare(b.assignee || ''))
        break
    }

    return sorted
  }

  // ===========================================================================
  // Ticket Template Operations
  // ===========================================================================

  async listTicketTemplates(filter?: TicketTemplateFilter): Promise<TicketTemplate[]> {
    let query = `SELECT * FROM ${T.ticket_templates}`
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.isBuiltin !== undefined) {
      conditions.push('is_builtin = ?')
      params.push(filter.isBuiltin ? 1 : 0)
    }
    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      const searchPattern = `%${filter.search}%`
      params.push(searchPattern, searchPattern)
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`
    }
    query += ' ORDER BY is_builtin DESC, name ASC'

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string
      name: string
      description: string | null
      is_builtin: number
      title_pattern: string | null
      description_template: string | null
      default_priority: string | null
      default_category: string | null
      default_status_id: string | null
      default_assignee: string | null
      default_owner: string | null
      default_labels: string | null
      suggested_subtasks: string | null
      created_at: string
    }>

    return rows.map(row => this.rowToTicketTemplate(row))
  }

  async getTicketTemplate(id: string): Promise<TicketTemplate | null> {
    const row = this.db.prepare(`
      SELECT * FROM ${T.ticket_templates} WHERE id = ?
    `).get(id) as {
      id: string
      name: string
      description: string | null
      is_builtin: number
      title_pattern: string | null
      description_template: string | null
      default_priority: string | null
      default_category: string | null
      default_status_id: string | null
      default_assignee: string | null
      default_owner: string | null
      default_labels: string | null
      suggested_subtasks: string | null
      created_at: string
    } | undefined

    if (!row) return null
    return this.rowToTicketTemplate(row)
  }

  async createTicketTemplate(template: Partial<TicketTemplate> & { name: string }): Promise<TicketTemplate> {
    const id = template.id || slugify(template.name)

    // Check if template already exists
    const existing = await this.getTicketTemplate(id)
    if (existing) {
      throw new PMOError('CONFLICT', `Template with ID "${id}" already exists`)
    }

    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO ${T.ticket_templates} (
        id, name, description, is_builtin, title_pattern, description_template,
        default_priority, default_category, default_status_id, default_assignee,
        default_owner, default_labels, suggested_subtasks, created_at
      )
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      template.name,
      template.description || null,
      template.titlePattern || null,
      template.descriptionTemplate || null,
      template.defaultPriority || null,
      template.defaultCategory || null,
      template.defaultStatusId || null,
      template.defaultAssignee || null,
      template.defaultOwner || null,
      JSON.stringify(template.defaultLabels || []),
      JSON.stringify(template.suggestedSubtasks || []),
      now
    )

    const created = await this.getTicketTemplate(id)
    if (!created) {
      throw new PMOError('NOT_FOUND', `Failed to create template: ${id}`)
    }
    return created
  }

  async createTicketTemplateFromTicket(ticketId: string, name: string, description?: string): Promise<TicketTemplate> {
    const ticket = await this.getTicket(ticketId)
    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`)
    }

    return this.createTicketTemplate({
      name,
      description,
      titlePattern: ticket.title,
      descriptionTemplate: ticket.description,
      defaultPriority: ticket.priority,
      defaultCategory: ticket.category,
      defaultStatusId: ticket.statusId,
      defaultAssignee: ticket.assignee,
      defaultOwner: ticket.owner,
      defaultLabels: ticket.labels,
      suggestedSubtasks: ticket.subtasks.map(st => ({ title: st.title })),
    })
  }

  async updateTicketTemplate(id: string, changes: Partial<TicketTemplate>): Promise<TicketTemplate> {
    const existing = await this.getTicketTemplate(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Template not found: ${id}`)
    }
    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot modify built-in templates')
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description)
    }
    if (changes.titlePattern !== undefined) {
      updates.push('title_pattern = ?')
      params.push(changes.titlePattern)
    }
    if (changes.descriptionTemplate !== undefined) {
      updates.push('description_template = ?')
      params.push(changes.descriptionTemplate)
    }
    if (changes.defaultPriority !== undefined) {
      updates.push('default_priority = ?')
      params.push(changes.defaultPriority)
    }
    if (changes.defaultCategory !== undefined) {
      updates.push('default_category = ?')
      params.push(changes.defaultCategory)
    }
    if (changes.defaultStatusId !== undefined) {
      updates.push('default_status_id = ?')
      params.push(changes.defaultStatusId)
    }
    if (changes.defaultAssignee !== undefined) {
      updates.push('default_assignee = ?')
      params.push(changes.defaultAssignee)
    }
    if (changes.defaultOwner !== undefined) {
      updates.push('default_owner = ?')
      params.push(changes.defaultOwner)
    }
    if (changes.defaultLabels !== undefined) {
      updates.push('default_labels = ?')
      params.push(JSON.stringify(changes.defaultLabels))
    }
    if (changes.suggestedSubtasks !== undefined) {
      updates.push('suggested_subtasks = ?')
      params.push(JSON.stringify(changes.suggestedSubtasks))
    }

    if (updates.length > 0) {
      params.push(id)
      this.db.prepare(`UPDATE ${T.ticket_templates} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    const updated = await this.getTicketTemplate(id)
    if (!updated) {
      throw new PMOError('NOT_FOUND', `Template not found after update: ${id}`)
    }
    return updated
  }

  async deleteTicketTemplate(id: string): Promise<void> {
    const existing = await this.getTicketTemplate(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Template not found: ${id}`)
    }
    if (existing.isBuiltin) {
      throw new PMOError('INVALID', 'Cannot delete built-in templates')
    }

    this.db.prepare(`DELETE FROM ${T.ticket_templates} WHERE id = ?`).run(id)
  }

  private rowToTicketTemplate(row: {
    id: string
    name: string
    description: string | null
    is_builtin: number
    title_pattern: string | null
    description_template: string | null
    default_priority: string | null
    default_category: string | null
    default_status_id: string | null
    default_assignee: string | null
    default_owner: string | null
    default_labels: string | null
    suggested_subtasks: string | null
    created_at: string
  }): TicketTemplate {
    let defaultLabels: string[] = []
    try {
      defaultLabels = row.default_labels ? JSON.parse(row.default_labels) : []
    } catch {
      defaultLabels = []
    }

    let suggestedSubtasks: Array<{ title: string }> = []
    try {
      suggestedSubtasks = row.suggested_subtasks ? JSON.parse(row.suggested_subtasks) : []
    } catch {
      suggestedSubtasks = []
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      isBuiltin: row.is_builtin === 1,
      titlePattern: row.title_pattern || undefined,
      descriptionTemplate: row.description_template || undefined,
      defaultPriority: row.default_priority || undefined,
      defaultCategory: row.default_category || undefined,
      defaultStatusId: row.default_status_id || undefined,
      defaultAssignee: row.default_assignee || undefined,
      defaultOwner: row.default_owner || undefined,
      defaultLabels,
      suggestedSubtasks,
      createdAt: new Date(row.created_at),
    }
  }

  // ===========================================================================
  // Sync Operations (no-op for pure SQLite)
  // ===========================================================================

  async pull(): Promise<SyncResult> {
    // SQLite is local-only, no remote to pull from
    return { success: true, changes: 0 }
  }

  async push(): Promise<SyncResult> {
    // SQLite is local-only, no remote to push to
    return { success: true, changes: 0 }
  }

  async status(): Promise<SyncStatus> {
    // SQLite is local-only, always in sync
    return { ahead: 0, behind: 0, conflicts: false }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async close(): Promise<void> {
    this.db.close()
  }

  // ===========================================================================
  // Cache Operations (for git storage)
  // ===========================================================================

  getCacheMetadata(): { boardMtime: number; cacheBuiltAt: number; contentHash?: string } | null {
    const mtime = this.db.prepare(`SELECT value FROM ${T.cache_metadata} WHERE key = 'boardMtime'`).get() as
      | { value: string }
      | undefined
    const builtAt = this.db.prepare(`SELECT value FROM ${T.cache_metadata} WHERE key = 'cacheBuiltAt'`).get() as
      | { value: string }
      | undefined
    const hash = this.db.prepare(`SELECT value FROM ${T.cache_metadata} WHERE key = 'contentHash'`).get() as
      | { value: string }
      | undefined

    if (!mtime || !builtAt) return null

    return {
      boardMtime: parseInt(mtime.value, 10),
      cacheBuiltAt: parseInt(builtAt.value, 10),
      contentHash: hash?.value,
    }
  }

  setCacheMetadata(meta: { boardMtime: number; cacheBuiltAt: number; contentHash?: string }): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO ${T.cache_metadata} (key, value)
      VALUES ('boardMtime', ?)
    `
      )
      .run(meta.boardMtime.toString())

    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO ${T.cache_metadata} (key, value)
      VALUES ('cacheBuiltAt', ?)
    `
      )
      .run(meta.cacheBuiltAt.toString())

    if (meta.contentHash) {
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO ${T.cache_metadata} (key, value)
        VALUES ('contentHash', ?)
      `
        )
        .run(meta.contentHash)
    }
  }

  rebuildFromBoard(board: Board): void {
    const projectId = this.currentProjectId

    // Clear existing data for current project only
    this.db.prepare(`DELETE FROM ${T.tickets} WHERE project_id = ?`).run(projectId)
    this.db.prepare(`DELETE FROM ${T.columns} WHERE project_id = ?`).run(projectId)

    // Rebuild
    const now = Date.now()

    // Update or insert project - preserve existing name if board.name is default "Board"
    const existingProject = this.db.prepare(`SELECT name FROM ${T.projects} WHERE id = ?`).get(projectId) as { name: string } | undefined
    const projectName = (board.name === 'Board' && existingProject?.name) ? existingProject.name : board.name

    this.db.prepare(`
      INSERT OR REPLACE INTO ${T.projects} (id, name, updated_at)
      VALUES (?, ?, ?)
    `).run(projectId, projectName, now)

    // Insert columns and tickets
    const insertColumn = this.db.prepare(`
      INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertTicket = this.db.prepare(`
      INSERT INTO ${T.tickets} (
        id, project_id, title, description, priority, category,
        status, owner, assignee, spec_id,
        created_at, updated_at, last_synced_from_spec, last_synced_from_board
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertBoardTicket = this.db.prepare(`
      INSERT INTO ${T.board_tickets} (project_id, ticket_id, column_id, position)
      VALUES (?, ?, ?, ?)
    `)
    const insertSubtask = this.db.prepare(`
      INSERT INTO ${T.subtasks} (id, ticket_id, title, done, position)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertMeta = this.db.prepare(`
      INSERT INTO ${T.ticket_metadata} (ticket_id, key, value)
      VALUES (?, ?, ?)
    `)

    for (const column of board.columns) {
      insertColumn.run(column.id, projectId, column.name, column.position, now)

      for (const ticket of column.tickets) {
        // Insert ticket data
        insertTicket.run(
          ticket.id,
          projectId,
          ticket.title,
          ticket.description || null,
          ticket.priority || null,
          ticket.category || null,
          ticket.status || 'backlog',
          ticket.owner || null,
          ticket.assignee || null,
          ticket.specId || null,
          ticket.createdAt.toISOString(),
          ticket.updatedAt.toISOString(),
          ticket.lastSyncedFromSpec || null,
          ticket.lastSyncedFromBoard || null
        )

        // Insert board position
        insertBoardTicket.run(projectId, ticket.id, column.id, ticket.position)

        // Subtasks
        ticket.subtasks.forEach((st, idx) => {
          insertSubtask.run(st.id, ticket.id, st.title, st.done ? 1 : 0, idx)
        })

        // Metadata
        for (const [key, value] of Object.entries(ticket.metadata)) {
          insertMeta.run(ticket.id, key, value)
        }
      }
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async getTicketsForColumn(columnId: string, projectId?: string): Promise<Ticket[]> {
    const pid = projectId ?? this.currentProjectId
    const rows = this.db.prepare(`
      SELECT t.*, bt.column_id, bt.position, c.name as column_name
      FROM ${T.tickets} t
      JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      JOIN ${T.columns} c ON bt.project_id = c.project_id AND bt.column_id = c.id
      WHERE t.project_id = ? AND bt.column_id = ?
      ORDER BY bt.position
    `).all(pid, columnId) as Array<{
      id: string
      project_id: string
      title: string
      description: string | null
      priority: string | null
      category: string | null
      status_id: string
      owner: string | null
      assignee: string | null
      branch: string | null
      spec_id: string | null
      epic_id: string | null
      labels: string | null
      column_id: string
      column_name: string
      position: number
      created_at: string
      updated_at: string
      last_synced_from_spec: string | null
      last_synced_from_board: string | null
    }>

    return Promise.all(rows.map((row) => this.rowToTicket(row)))
  }

  private async getTicketById(id: string): Promise<Ticket | null> {
    const projectId = this.currentProjectId
    const row = this.db.prepare(`
      SELECT t.*, bt.column_id, bt.position, c.name as column_name
      FROM ${T.tickets} t
      LEFT JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      LEFT JOIN ${T.columns} c ON bt.project_id = c.project_id AND bt.column_id = c.id
      WHERE t.project_id = ? AND LOWER(t.id) = LOWER(?)
    `).get(projectId, id) as
      | {
          id: string
          project_id: string
          title: string
          description: string | null
          priority: string | null
          category: string | null
          status_id: string
          owner: string | null
          assignee: string | null
          branch: string | null
          spec_id: string | null
          epic_id: string | null
          labels: string | null
          column_id: string | null
          column_name: string | null
          position: number | null
          created_at: string
          updated_at: string
          last_synced_from_spec: string | null
          last_synced_from_board: string | null
        }
      | undefined

    if (!row) return null

    return this.rowToTicket(row)
  }

  private async rowToTicket(row: {
    id: string
    title: string
    description: string | null
    priority: string | null
    category: string | null
    status_id: string
    owner: string | null
    assignee: string | null
    branch: string | null
    spec_id: string | null
    epic_id: string | null
    labels: string | null
    column_id: string | null
    column_name: string | null
    position: number | null
    created_at: string
    updated_at: string
    last_synced_from_spec: string | null
    last_synced_from_board: string | null
  }): Promise<Ticket> {
    // Get subtasks
    const subtasks = this.db
      .prepare(`SELECT * FROM ${T.subtasks} WHERE ticket_id = ? ORDER BY position`)
      .all(row.id) as Array<{
      id: string
      title: string
      done: number
    }>

    // Get metadata
    const metaRows = this.db
      .prepare(`SELECT key, value FROM ${T.ticket_metadata} WHERE ticket_id = ?`)
      .all(row.id) as Array<{ key: string; value: string }>
    const metadata: Record<string, string> = {}
    for (const m of metaRows) {
      metadata[m.key] = m.value
    }

    // Note: specs field is deprecated - use specId and getSpecsForTicket() instead

    // Get status info
    let statusName: string | undefined
    let statusCategory: StateCategory | undefined
    if (row.status_id) {
      const statusRow = this.db
        .prepare(`SELECT name, category FROM ${T.statuses} WHERE id = ?`)
        .get(row.status_id) as { name: string; category: StateCategory } | undefined
      if (statusRow) {
        statusName = statusRow.name
        statusCategory = statusRow.category
      }
    }

    // Map category to deprecated status enum for backward compat
    const categoryToStatus: Record<StateCategory, string> = {
      'backlog': 'backlog',
      'unstarted': 'planned',
      'started': 'in_progress',
      'completed': 'done',
      'canceled': 'canceled',
    }
    const status = statusCategory ? categoryToStatus[statusCategory] : 'backlog'

    // Parse labels from JSON
    let labels: string[] = []
    try {
      labels = row.labels ? JSON.parse(row.labels) : []
    } catch {
      labels = []
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description || undefined,
      priority: row.priority || undefined,
      category: row.category || undefined,
      statusId: row.status_id,
      statusName,
      statusCategory,
      status,
      owner: row.owner || undefined,
      assignee: row.assignee || undefined,
      branch: row.branch || undefined,
      specId: row.spec_id || undefined,
      epicId: row.epic_id || undefined,
      subtasks: subtasks.map((st) => ({
        id: st.id,
        title: st.title,
        done: st.done === 1,
      })),
      labels,
      metadata,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastSyncedFromSpec: row.last_synced_from_spec ? new Date(row.last_synced_from_spec) : undefined,
      lastSyncedFromBoard: row.last_synced_from_board ? new Date(row.last_synced_from_board) : undefined,
      position: row.position !== null ? row.position : undefined,
    }
  }

  private getMaxColumnPosition(): number {
    const projectId = this.currentProjectId
    const result = this.db.prepare(`
      SELECT MAX(position) as max FROM ${T.columns}
      WHERE project_id = ?
    `).get(projectId) as { max: number | null }
    return result.max ?? -1
  }

  private getMaxTicketPosition(columnId: string): number {
    const projectId = this.currentProjectId
    const result = this.db.prepare(`
      SELECT MAX(position) as max FROM ${T.board_tickets}
      WHERE project_id = ? AND column_id = ?
    `).get(projectId, columnId) as { max: number | null }
    return result.max ?? -1
  }

  private updateBoardTimestamp(): void {
    this.db.prepare(`
      UPDATE ${T.projects}
      SET updated_at = ?
      WHERE id = ?
    `).run(Date.now(), this.currentProjectId)
  }
}
