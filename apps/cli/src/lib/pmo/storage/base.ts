/**
 * Base storage module with database initialization, migrations, and seeding.
 * This module handles database setup and provides shared utilities.
 */

import Database from 'better-sqlite3'
import { PMO_TABLES, PMO_SCHEMA_SQL, validateTicketSchema } from '../schema.js'
import { StateCategory } from '../types.js'

const T = PMO_TABLES

/**
 * Initialize PMO tables in the database.
 * Runs migrations, creates tables, seeds built-in data, and validates schema.
 */
export function initializePMOTables(db: Database.Database): void {
  runMigrations(db)
  db.exec(PMO_SCHEMA_SQL)
  seedBuiltinTemplates(db)
  seedBuiltinPhases(db)
  seedBuiltinPhaseTemplates(db)
  seedBuiltinActions(db)
  seedBuiltinTicketTemplates(db)
  validateTicketSchema(db)
}

/**
 * Run schema migrations for existing databases.
 */
export function runMigrations(db: Database.Database): void {
  const tableExists = (name: string): boolean => {
    const result = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name=?
    `).get(name) as { name: string } | undefined
    return !!result
  }

  if (!tableExists(T.tickets) || !tableExists(T.specs) || !tableExists(T.projects)) {
    return
  }

  // Migration: Update specs table to new simplified schema
  if (tableExists(T.specs)) {
    const specsColumns = db.pragma(`table_info(${T.specs})`) as Array<{ name: string }>
    const specsColumnNames = new Set(specsColumns.map(c => c.name))

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
          db.exec(`ALTER TABLE ${T.specs} ADD COLUMN ${col.sql}`)
        } catch {
          // Column may already exist
        }
      }
    }
  }

  // Migration: Add status_id column to tickets table
  const ticketsColumns = db.pragma(`table_info(${T.tickets})`) as Array<{ name: string }>
  const ticketsColumnNames = new Set(ticketsColumns.map(c => c.name))

  if (!ticketsColumnNames.has('status_id')) {
    try {
      db.exec(`ALTER TABLE ${T.tickets} ADD COLUMN status_id TEXT`)
    } catch {
      // Column may already exist
    }
  }

  // Migration: Add status and target_date columns to projects table
  const projectsColumns = db.pragma(`table_info(${T.projects})`) as Array<{ name: string }>
  const projectsColumnNames = new Set(projectsColumns.map(c => c.name))

  if (!projectsColumnNames.has('status')) {
    try {
      db.exec(`ALTER TABLE ${T.projects} ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`)
    } catch {
      // Column may already exist
    }
  }

  if (!projectsColumnNames.has('target_date')) {
    try {
      db.exec(`ALTER TABLE ${T.projects} ADD COLUMN target_date TIMESTAMP`)
    } catch {
      // Column may already exist
    }
  }

  if (!projectsColumnNames.has('phase_id')) {
    try {
      db.exec(`ALTER TABLE ${T.projects} ADD COLUMN phase_id TEXT`)
    } catch {
      // Column may already exist
    }
  }

  if (!projectsColumnNames.has('is_archived')) {
    try {
      db.exec(`ALTER TABLE ${T.projects} ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0`)
    } catch {
      // Column may already exist
    }
  }

  // Migration: Add branch column to tickets table
  if (!ticketsColumnNames.has('branch')) {
    try {
      db.exec(`ALTER TABLE ${T.tickets} ADD COLUMN branch TEXT`)
    } catch {
      // Column may already exist
    }
  }

  // Migration: Add position column to actions table
  if (tableExists(T.actions)) {
    const actionsColumns = db.pragma(`table_info(${T.actions})`) as Array<{ name: string }>
    const actionsColumnNames = actionsColumns.map(c => c.name)
    if (!actionsColumnNames.includes('position')) {
      try {
        db.exec(`ALTER TABLE ${T.actions} ADD COLUMN position INTEGER NOT NULL DEFAULT 0`)
        const positionMap: Record<string, number> = {
          groom: 0, implement: 1, continue: 2, test: 3, review: 4, revise: 5
        }
        for (const [id, pos] of Object.entries(positionMap)) {
          db.prepare(`UPDATE ${T.actions} SET position = ? WHERE id = ?`).run(pos, id)
        }
      } catch {
        // Column may already exist
      }
    }

    if (!actionsColumnNames.includes('end_prompt')) {
      try {
        db.exec(`ALTER TABLE ${T.actions} ADD COLUMN end_prompt TEXT`)
      } catch {
        // Column may already exist
      }
    }
  }

  // Migration: Add labels column to tickets table
  if (!ticketsColumnNames.has('labels')) {
    try {
      db.exec(`ALTER TABLE ${T.tickets} ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'`)
    } catch {
      // Column may already exist
    }
  }

  // Migration: Add new columns to ticket_templates table
  if (tableExists(T.ticket_templates)) {
    const templateColumns = db.pragma(`table_info(${T.ticket_templates})`) as Array<{ name: string }>
    const templateColumnNames = new Set(templateColumns.map(c => c.name))

    const newTemplateColumns = [
      { name: 'default_status_id', sql: 'default_status_id TEXT' },
      { name: 'default_assignee', sql: 'default_assignee TEXT' },
      { name: 'default_owner', sql: 'default_owner TEXT' },
      { name: 'default_labels', sql: "default_labels TEXT NOT NULL DEFAULT '[]'" },
    ]

    for (const col of newTemplateColumns) {
      if (!templateColumnNames.has(col.name)) {
        try {
          db.exec(`ALTER TABLE ${T.ticket_templates} ADD COLUMN ${col.sql}`)
        } catch {
          // Column may already exist
        }
      }
    }
  }

  // Migration: Convert legacy priority values (URGENT/HIGH/MEDIUM/LOW) to P0-P3
  if (tableExists(T.tickets)) {
    try {
      // Convert ticket priorities
      db.exec(`UPDATE ${T.tickets} SET priority = 'P0' WHERE priority = 'URGENT'`)
      db.exec(`UPDATE ${T.tickets} SET priority = 'P1' WHERE priority = 'HIGH'`)
      db.exec(`UPDATE ${T.tickets} SET priority = 'P2' WHERE priority = 'MEDIUM'`)
      db.exec(`UPDATE ${T.tickets} SET priority = 'P3' WHERE priority = 'LOW'`)
    } catch {
      // Ignore errors if migration already ran
    }
  }

  // Migration: Convert legacy priority values in ticket templates
  if (tableExists(T.ticket_templates)) {
    try {
      db.exec(`UPDATE ${T.ticket_templates} SET default_priority = 'P0' WHERE default_priority = 'URGENT'`)
      db.exec(`UPDATE ${T.ticket_templates} SET default_priority = 'P1' WHERE default_priority = 'HIGH'`)
      db.exec(`UPDATE ${T.ticket_templates} SET default_priority = 'P2' WHERE default_priority = 'MEDIUM'`)
      db.exec(`UPDATE ${T.ticket_templates} SET default_priority = 'P3' WHERE default_priority = 'LOW'`)
    } catch {
      // Ignore errors if migration already ran
    }
  }
}

/**
 * Seed built-in workflow templates.
 */
export function seedBuiltinTemplates(db: Database.Database): void {
  type WorkflowTemplateStatus = {
    name: string
    category: StateCategory
    position: number
  }

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
        { name: "Won't Fix", category: 'canceled', position: 0 },
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

  const insertTemplate = db.prepare(`
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
 */
export function seedBuiltinPhases(db: Database.Database): void {
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
    { id: 'canceled', name: 'Canceled', category: 'canceled', position: 0, description: "Project won't be completed" },
  ]

  const insertPhase = db.prepare(`
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
 */
export function seedBuiltinPhaseTemplates(db: Database.Database): void {
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
        { name: 'Canceled', category: 'canceled', position: 0, description: "Project won't be completed" },
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

  const insertTemplate = db.prepare(`
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
 */
export function seedBuiltinActions(db: Database.Database): void {
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

Do NOT implement the ticket - only improve its definition so it's ready to be worked on.

## Ticket Schema Reference

| Field | Type | Valid Values | CLI Flag |
|-------|------|--------------|----------|
| title | string | any text | --title |
| description | markdown | requirements, context, notes | --description |
| priority | enum | P0 (critical), P1 (high), P2 (medium), P3 (low) | --priority |
| category | enum | feature, bug, refactor, docs, test, chore, performance, ci, build, security, database, release | --category |
| subtasks | list | task descriptions | --add-subtask (--clear-subtasks to replace) |
| acceptanceCriteria | list | testable statements | --add-ac (--clear-ac to replace) |
| labels | list | complexity:S/M/L/XL, ready, needs-clarification, etc. | --add-label, --remove-label |
| owner | string | human responsible | --owner |
| assignee | string | agent/person executing | --assignee |`,
      endPrompt: `When you have finished analyzing and grooming the ticket, update it using prlt ticket edit.

## Field Mapping (use ONLY these fields)

| Your Analysis | Maps To | Example |
|--------------|---------|---------|
| Requirements/Context | --description | Include R1, R2, etc. in description text |
| Acceptance Criteria | --add-ac | One per criterion (testable statement) |
| Subtasks | --add-subtask | One per subtask |
| Complexity (S/M/L/XL) | --add-label | \`complexity:M\` or \`complexity:L\` |
| Priority | --priority | P0, P1, P2, or P3 only |
| Category | --category | feature, bug, refactor, docs, test, chore |
| Needs clarification | --add-label | \`needs-clarification\` |
| Ready for work | --add-label | \`ready\` |

## Example Command

\`\`\`bash
prlt ticket edit {{TICKET_ID}} \\
  --description "Implement user session timeout...

Requirements:
- R1: Sessions expire after 30 minutes of inactivity
- R2: Users see a warning 5 minutes before timeout" \\
  --priority P2 \\
  --category feature \\
  --add-label "complexity:M" \\
  --add-ac "Sessions expire after 30 min inactivity" \\
  --add-ac "Warning shown 5 min before timeout" \\
  --add-subtask "Add session timeout config" \\
  --add-subtask "Implement warning modal"
\`\`\`

## Important Rules
- Priority must be exactly: P0, P1, P2, or P3 (not custom values)
- Use \`--add-label "complexity:S|M|L|XL"\` for complexity (not a separate field)
- Technical notes/flagged ambiguities go in description
- Use \`--clear-subtasks\` if replacing existing subtasks
- Use \`--clear-ac\` if replacing existing acceptance criteria

After updating, output a brief summary of your grooming changes.`,
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
      endPrompt: `When complete:
1. **Commit your work** in each repository directory you modified:
   \`\`\`bash
   cd /workspace/<repo-name>
   git add -A
   prlt commit "describe your change"
   git push
   \`\`\`
   This formats your commit as a conventional commit with the ticket ID.

2. **Mark work as ready** by running:
   \`\`\`bash
   prlt work ready {{TICKET_ID}} --pr
   \`\`\`
   This moves the ticket to review and creates a pull request.

**IMPORTANT:** Use the global \`prlt\` command (just type \`prlt\`). Do NOT use \`./bin/run.js\` or any local path.`,
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
      endPrompt: `When complete:
1. **Commit your work** in each repository directory you modified:
   \`\`\`bash
   cd /workspace/<repo-name>
   git add -A
   prlt commit "describe your change"
   git push
   \`\`\`

2. **Mark work as ready** by running:
   \`\`\`bash
   prlt work ready {{TICKET_ID}} --pr
   \`\`\`
   This moves the ticket to review and creates a pull request.

**IMPORTANT:** Use the global \`prlt\` command (just type \`prlt\`). Do NOT use \`./bin/run.js\` or any local path.`,
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
      endPrompt: `When complete:
1. **Commit your tests**:
   \`\`\`bash
   git add -A
   prlt commit "add tests for {{TICKET_ID}}"
   git push
   \`\`\`

2. **Mark work as ready** by running:
   \`\`\`bash
   prlt work ready {{TICKET_ID}} --pr
   \`\`\`

**IMPORTANT:** Use the global \`prlt\` command.`,
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
      endPrompt: `When you have finished reviewing, output a detailed review summary with:
- ✅ What looks good
- ⚠️ Concerns or potential issues
- 🔧 Suggested improvements
- 📋 Verdict: Approve, Request Changes, or Needs Discussion

No commits are needed for code review.`,
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
      endPrompt: `After addressing the feedback:
1. Commit your changes using \`prlt commit "your message"\`
2. Push your changes: \`git push\`

The PR will be updated automatically.`,
      suggestedForCategories: ['completed'],
      defaultMoveToCategory: 'started',
      modifiesCode: true,
      position: 5,
    },
  ]

  const insertAction = db.prepare(`
    INSERT OR IGNORE INTO ${T.actions} (id, name, description, prompt, end_prompt, suggested_for_categories, default_move_to_category, modifies_code, is_builtin, position, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `)

  const updateEndPrompt = db.prepare(`
    UPDATE ${T.actions} SET end_prompt = ? WHERE id = ? AND is_builtin = 1 AND (end_prompt IS NULL OR end_prompt = '')
  `)

  const now = new Date().toISOString()
  for (const action of builtinActions) {
    insertAction.run(
      action.id,
      action.name,
      action.description,
      action.prompt,
      action.endPrompt || null,
      JSON.stringify(action.suggestedForCategories),
      action.defaultMoveToCategory || null,
      action.modifiesCode ? 1 : 0,
      action.position,
      now
    )
    if (action.endPrompt) {
      updateEndPrompt.run(action.endPrompt, action.id)
    }
  }
}

/**
 * Seed built-in ticket templates.
 */
export function seedBuiltinTicketTemplates(db: Database.Database): void {
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
      defaultPriority: 'P1',
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
      defaultPriority: 'P2',
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
      defaultPriority: 'P2',
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
      defaultPriority: 'P3',
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
      defaultPriority: 'P3',
      defaultCategory: 'docs',
      suggestedSubtasks: [
        { title: 'Draft content' },
        { title: 'Review for accuracy' },
        { title: 'Add examples if needed' },
      ],
    },
  ]

  const insertTemplate = db.prepare(`
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
      null,
      null,
      null,
      '[]',
      JSON.stringify(template.suggestedSubtasks || []),
      now
    )
  }
}

/**
 * Update board timestamp for a project.
 */
export function updateBoardTimestamp(db: Database.Database, projectId: string): void {
  db.prepare(`
    UPDATE ${T.projects}
    SET updated_at = ?
    WHERE id = ?
  `).run(Date.now(), projectId)
}

/**
 * Get max position for columns in a project.
 */
export function getMaxColumnPosition(db: Database.Database, projectId: string): number {
  const result = db.prepare(`
    SELECT MAX(position) as max FROM ${T.columns}
    WHERE project_id = ?
  `).get(projectId) as { max: number | null }
  return result.max ?? -1
}

/**
 * Get max position for tickets in a column.
 */
export function getMaxTicketPosition(db: Database.Database, projectId: string, columnId: string): number {
  const result = db.prepare(`
    SELECT MAX(position) as max FROM ${T.board_tickets}
    WHERE project_id = ? AND column_id = ?
  `).get(projectId, columnId) as { max: number | null }
  return result.max ?? -1
}
