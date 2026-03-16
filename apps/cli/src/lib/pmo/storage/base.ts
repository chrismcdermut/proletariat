/**
 * Base storage module with database initialization, migrations, and seeding.
 * This module handles database setup and provides shared utilities.
 */

import Database from 'better-sqlite3'
import { PMO_TABLES, PMO_SCHEMA_SQL, validateTicketSchema } from '../schema.js'
import { StateCategory, TICKET_CATEGORIES, STATE_CATEGORY_ORDER } from '../types.js'
import { BUILTIN_TEMPLATES } from '../templates-builtin.js'
import { setWorkspacePriorities, DEFAULT_PRIORITIES } from '../utils.js'

const T = PMO_TABLES

/**
 * Initialize PMO tables in the database.
 * Runs migrations, creates tables, seeds built-in data, and validates schema.
 */
export function initializePMOTables(db: Database.Database): void {
  runMigrations(db)
  db.exec(PMO_SCHEMA_SQL)
  seedBuiltinWorkflows(db)  // Workflows are the source of truth for status configurations
  seedBuiltinPhases(db)
  seedBuiltinPhaseTemplates(db)
  seedBuiltinActions(db)
  seedBuiltinWorkflowRules(db)
  seedBuiltinTicketTemplates(db)
  seedDefaultPriorities(db)  // Seed default priority scale if not set
  seedBuiltinLabels(db)  // Seed built-in label groups and labels
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
    const actionsColumnNames = new Set(actionsColumns.map(c => c.name))
    if (!actionsColumnNames.has('position')) {
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

    if (!actionsColumnNames.has('end_prompt')) {
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

  // Migration: Migrate old ticket_dependencies schema (blocked_by_ticket_id) to new format
  if (tableExists(T.ticket_dependencies)) {
    const depsColumns = db.pragma(`table_info(${T.ticket_dependencies})`) as Array<{ name: string }>
    const depsColumnNames = new Set(depsColumns.map(c => c.name))

    if (depsColumnNames.has('blocked_by_ticket_id') && !depsColumnNames.has('depends_on_ticket_id')) {
      // Old schema detected - migrate to new format
      const migrate = db.transaction(() => {
        // Create new table with correct schema
        db.exec(`
          CREATE TABLE pmo_ticket_dependencies_new (
            ticket_id TEXT NOT NULL REFERENCES ${T.tickets}(id) ON DELETE RESTRICT,
            depends_on_ticket_id TEXT NOT NULL REFERENCES ${T.tickets}(id) ON DELETE RESTRICT,
            dependency_type TEXT NOT NULL DEFAULT 'blocks' CHECK (dependency_type IN ('blocks', 'relates_to', 'duplicates')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (ticket_id, depends_on_ticket_id, dependency_type),
            CHECK (ticket_id != depends_on_ticket_id)
          )
        `)

        // Copy existing blocking relationships (old schema: ticket_id is blocked by blocked_by_ticket_id)
        db.exec(`
          INSERT OR IGNORE INTO pmo_ticket_dependencies_new (ticket_id, depends_on_ticket_id, dependency_type, created_at)
          SELECT ticket_id, blocked_by_ticket_id, 'blocks', created_at
          FROM ${T.ticket_dependencies}
        `)

        // Replace old table with new one
        db.exec(`DROP TABLE ${T.ticket_dependencies}`)
        db.exec(`ALTER TABLE pmo_ticket_dependencies_new RENAME TO ${T.ticket_dependencies}`)
      })
      migrate()
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

  // Migration: Add workflow_id column to projects table
  if (!projectsColumnNames.has('workflow_id')) {
    try {
      db.exec(`ALTER TABLE ${T.projects} ADD COLUMN workflow_id TEXT`)
    } catch {
      // Column may already exist
    }
  }

  // Migration: Drop pmo_templates table (workflows are now used directly)
  if (tableExists('pmo_templates')) {
    try {
      db.exec('DROP TABLE pmo_templates')
    } catch {
      // Table may already be dropped
    }
  }

  // Migration: Add position column to tickets table (TKT-965)
  if (!ticketsColumnNames.has('position')) {
    try {
      db.exec(`ALTER TABLE ${T.tickets} ADD COLUMN position INTEGER NOT NULL DEFAULT 0`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status_position ON ${T.tickets}(status_id, position)`)

      // Backfill existing tickets with gapped positions (1000, 2000, ...) per status
      const statuses = db.prepare(
        `SELECT DISTINCT status_id FROM ${T.tickets} WHERE status_id IS NOT NULL`
      ).all() as { status_id: string }[]

      const getTicketsForStatus = db.prepare(`
        SELECT id FROM ${T.tickets} WHERE status_id = ?
        ORDER BY
          CASE priority
            WHEN 'P0' THEN 0
            WHEN 'P1' THEN 1
            WHEN 'P2' THEN 2
            WHEN 'P3' THEN 3
            ELSE 4
          END,
          created_at ASC
      `)
      const updatePosition = db.prepare(`UPDATE ${T.tickets} SET position = ? WHERE id = ?`)

      for (const { status_id } of statuses) {
        const tickets = getTicketsForStatus.all(status_id) as { id: string }[]
        for (let i = 0; i < tickets.length; i++) {
          updatePosition.run((i + 1) * 1000, tickets[i].id)
        }
      }
    } catch {
      // Column may already exist
    }
  }

  // Migration: Add error_message column to agent_work table (TKT-1082)
  if (tableExists(T.agent_work)) {
    const agentWorkColumns = db.pragma(`table_info(${T.agent_work})`) as Array<{ name: string }>
    const agentWorkColumnNames = new Set(agentWorkColumns.map(c => c.name))
    if (!agentWorkColumnNames.has('error_message')) {
      try {
        db.exec(`ALTER TABLE ${T.agent_work} ADD COLUMN error_message TEXT`)
      } catch {
        // Column may already exist
      }
    }

    if (!agentWorkColumnNames.has('external_source')) {
      try {
        db.exec(`ALTER TABLE ${T.agent_work} ADD COLUMN external_source TEXT`)
      } catch {
        // Column may already exist
      }
    }

    if (!agentWorkColumnNames.has('external_key')) {
      try {
        db.exec(`ALTER TABLE ${T.agent_work} ADD COLUMN external_key TEXT`)
      } catch {
        // Column may already exist
      }
    }

    if (!agentWorkColumnNames.has('external_id')) {
      try {
        db.exec(`ALTER TABLE ${T.agent_work} ADD COLUMN external_id TEXT`)
      } catch {
        // Column may already exist
      }
    }

    if (!agentWorkColumnNames.has('external_url')) {
      try {
        db.exec(`ALTER TABLE ${T.agent_work} ADD COLUMN external_url TEXT`)
      } catch {
        // Column may already exist
      }
    }
  }

  // Migration: Reassign orphaned tickets (TKT-940)
  // Tickets with project_id that doesn't match any existing project are "orphaned".
  // This can happen when a 'default' project never existed or was deleted.
  // NOTE: This runs on every init but is idempotent — if no orphaned tickets exist, it's a no-op.
  // Kept as a runtime check rather than a one-time migration since orphaned tickets could
  // reappear if projects are deleted in the future.
  if (tableExists(T.tickets) && tableExists(T.projects)) {
    try {
      // Find orphaned tickets (project_id doesn't match any project)
      const orphanedTickets = db.prepare(`
        SELECT t.id, t.project_id
        FROM ${T.tickets} t
        LEFT JOIN ${T.projects} p ON t.project_id = p.id
        WHERE p.id IS NULL
      `).all() as Array<{ id: string; project_id: string }>

      if (orphanedTickets.length > 0) {
        // Get the first available project to reassign to
        const firstProject = db.prepare(`
          SELECT id FROM ${T.projects} ORDER BY created_at ASC LIMIT 1
        `).get() as { id: string } | undefined

        if (firstProject) {
          // Get the default status for the target project's workflow
          const project = db.prepare(`
            SELECT workflow_id FROM ${T.projects} WHERE id = ?
          `).get(firstProject.id) as { workflow_id: string | null } | undefined

          const workflowId = project?.workflow_id || 'default'
          const defaultStatus = db.prepare(`
            SELECT id FROM ${T.workflow_statuses}
            WHERE workflow_id = ? AND is_default = 1
          `).get(workflowId) as { id: string } | undefined

          // Reassign orphaned tickets to the first project
          const updateStmt = defaultStatus
            ? db.prepare(`UPDATE ${T.tickets} SET project_id = ?, status_id = COALESCE(status_id, ?) WHERE id = ?`)
            : db.prepare(`UPDATE ${T.tickets} SET project_id = ? WHERE id = ?`)

          for (const ticket of orphanedTickets) {
            if (defaultStatus) {
              updateStmt.run(firstProject.id, defaultStatus.id, ticket.id)
            } else {
              updateStmt.run(firstProject.id, ticket.id)
            }
          }
        }
      }
    } catch {
      // Non-critical migration - don't fail initialization
    }
  }

  // Migration: Rename sandboxed column to permission_mode in agent_work table
  if (tableExists(T.agent_work)) {
    const awColumns = db.pragma(`table_info(${T.agent_work})`) as Array<{ name: string }>
    const awColumnNames = new Set(awColumns.map(c => c.name))

    if (awColumnNames.has('sandboxed') && !awColumnNames.has('permission_mode')) {
      try {
        db.exec(`ALTER TABLE ${T.agent_work} ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'safe'`)
        // Migrate existing data: sandboxed=1 → 'safe', sandboxed=0 → 'danger'
        db.exec(`UPDATE ${T.agent_work} SET permission_mode = CASE WHEN sandboxed = 1 THEN 'safe' ELSE 'danger' END`)
      } catch {
        // Column may already exist
      }
    }
  }

  // Migration: Rename execution.sandboxed setting to execution.permission_mode
  if (tableExists('workspace_settings')) {
    try {
      const oldSetting = db.prepare(
        `SELECT value FROM workspace_settings WHERE key = 'execution.sandboxed'`
      ).get() as { value: string } | undefined
      if (oldSetting) {
        const permMode = oldSetting.value === 'true' ? 'safe' : 'danger'
        db.prepare(`
          INSERT INTO workspace_settings (key, value) VALUES ('execution.permission_mode', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(permMode)
      }
    } catch {
      // Non-critical migration
    }
  }

  // Migration: Migrate pmo_linear_issue_map → pmo_external_issue_map (PRLT-947)
  if (tableExists(T.linear_issue_map) && !tableExists(T.external_issue_map)) {
    try {
      // Create the new generic table
      db.exec(`
        CREATE TABLE ${T.external_issue_map} (
          pmo_ticket_id TEXT NOT NULL REFERENCES ${T.tickets}(id) ON DELETE CASCADE,
          provider TEXT NOT NULL CHECK (provider IN ('linear', 'jira', 'shortcut', 'trello', 'github')),
          external_id TEXT NOT NULL,
          external_key TEXT NOT NULL,
          external_url TEXT NOT NULL,
          team_key TEXT NOT NULL,
          sync_direction TEXT NOT NULL DEFAULT 'inbound',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (pmo_ticket_id, provider),
          UNIQUE (provider, external_id)
        )
      `)

      // Copy existing Linear mappings into the new table
      db.exec(`
        INSERT INTO ${T.external_issue_map}
          (pmo_ticket_id, provider, external_id, external_key, external_url, team_key, sync_direction, created_at)
        SELECT
          pmo_ticket_id, 'linear', linear_issue_id, linear_identifier, linear_url, linear_team_key, sync_direction, created_at
        FROM ${T.linear_issue_map}
      `)
    } catch {
      // Migration may have already run
    }
  }

}

/**
 * Seed built-in workflows from BUILTIN_TEMPLATES (single source of truth).
 * Creates workflows from template definitions for reuse across projects.
 */
export function seedBuiltinWorkflows(db: Database.Database): void {
  const now = new Date().toISOString()

  const insertWorkflow = db.prepare(`
    INSERT OR IGNORE INTO ${T.workflows} (id, name, description, is_builtin, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `)

  const insertStatus = db.prepare(`
    INSERT OR IGNORE INTO ${T.workflow_statuses} (id, workflow_id, name, category, position, color, description, is_default, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Read from BUILTIN_TEMPLATES - the single source of truth
  for (const template of BUILTIN_TEMPLATES) {
    insertWorkflow.run(template.id, template.name, template.description, now, now)

    for (let i = 0; i < template.statuses.length; i++) {
      const status = template.statuses[i]
      const statusId = `${template.id}-${status.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`
      // First status is the default
      const isDefault = i === 0
      insertStatus.run(
        statusId,
        template.id,
        status.name,
        status.category,
        status.position,
        null, // color
        null, // description
        isDefault ? 1 : 0,
        now
      )
    }
  }

  // Assign default workflow to any projects without a workflow
  db.prepare(`
    UPDATE ${T.projects}
    SET workflow_id = 'default'
    WHERE workflow_id IS NULL
  `).run()
}

// REMOVED: seedBuiltinTemplates - workflows are now used directly (no separate template concept)
// Built-in workflows are seeded in seedBuiltinWorkflows() above

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
 * Rule for agents about using the globally installed prlt command.
 * This prevents agents from wasting time trying to build from source when working in the prlt repo.
 */
const PRLT_USAGE_RULE = `
**IMPORTANT RULES**:

1. **Use globally installed prlt**: Always use the \`prlt\` command directly
2. **Never use local dev builds**: Do NOT use \`./apps/cli/bin/dev.js\` or \`./apps/cli/bin/run.js\`
3. **Why**: You may be working inside the prlt source code. The local builds require dependencies and may not work correctly. The globally installed version is already configured and ready to use.

Example (correct):
\`\`\`bash
prlt ticket edit TKT-123 --add-ac "Test passes"
\`\`\`

Example (WRONG - do not do this):
\`\`\`bash
./apps/cli/bin/run.js ticket edit TKT-123 ...
\`\`\`
`.trim()

/**
 * prlt CLI command reference sections for action prompts.
 * Each action gets a tailored set of commands relevant to its workflow.
 */
const PRLT_COMMANDS_COMMON = `
## prlt CLI Reference

Use these commands to interact with the ticket system. Always use the global \`prlt\` command.

| Command | Description |
|---------|-------------|
| \`prlt ticket show <id>\` | View full ticket details (description, AC, subtasks, labels) |
| \`prlt ticket edit <id> [flags]\` | Update ticket fields (see flags below) |
| \`prlt ticket list\` | List tickets on the board |
| \`prlt whoami\` | Show current agent/user identity |

### Common \`ticket edit\` flags
| Flag | Description |
|------|-------------|
| \`--title "..."\` | Update title |
| \`--description "..."\` | Update description |
| \`--priority P0\\|P1\\|P2\\|P3\` | Set priority |
| \`--category <type>\` | Set category (feature, bug, refactor, etc.) |
| \`--add-ac "..."\` | Add acceptance criterion |
| \`--clear-ac\` | Clear all acceptance criteria |
| \`--add-subtask "..."\` | Add a subtask |
| \`--clear-subtasks\` | Clear all subtasks |
| \`--add-label "..."\` | Add a label |
| \`--remove-label "..."\` | Remove a label |
| \`--assignee <name>\` | Set assignee |
| \`--owner <name>\` | Set owner |`

const PRLT_COMMANDS_CODE = `
| \`prlt commit "message"\` | Create a commit with ticket ID from branch name |
| \`prlt work ready <id> --pr\` | Mark ticket ready for review and create a PR |`

const PRLT_COMMANDS_REVIEW = `
| \`prlt ticket move <id>\` | Move ticket to a different column |
| \`prlt ticket complete <id>\` | Mark ticket as complete (move to Done) |`

const PRLT_COMMANDS_RESOLVE = `
| \`prlt ticket resolve <id>\` | Interactive resolution of ambiguity questions |
| \`prlt work resolve <id>\` | Agent-assisted resolution of ambiguity questions |`

/**
 * Seed built-in work actions.
 */
export function seedBuiltinActions(db: Database.Database): void {
  const builtinActions = [
    {
      id: 'groom',
      name: 'Groom',
      description: 'Flesh out ticket with requirements and acceptance criteria',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Groom

Analyze this ticket and improve its definition:
- Add detailed requirements if missing or vague
- Add clear, testable acceptance criteria
- Break down into subtasks if the work is complex
- Estimate complexity (S/M/L/XL) if not already set
- Flag any ambiguities or missing information that need clarification

Do NOT implement the ticket - only improve its definition so it's ready to be worked on.

## Flagging Ambiguities

If you identify ambiguities or questions that need human clarification, add them to the description using this **exact format**:

\`\`\`
**Q1:** Should the API use REST or GraphQL?
**Q2:** What is the expected timeout for sessions?
**Q3:** Should this feature be behind a feature flag?
\`\`\`

When questions are added:
- Add the \`needs-clarification\` label: \`--add-label "needs-clarification"\`
- Questions can later be resolved with \`prlt ticket resolve\` or \`prlt work resolve\`

If NO ambiguities are found, add the \`ready\` label instead.

**AI Agent Tip:** When running \`prlt\` commands without all required arguments, use \`--json\` to receive interactive prompts as structured JSON.

### Additional prlt Commands
| Command | Description |
|---------|-------------|
| \`prlt ticket show <id>\` | View full ticket details |
| \`prlt ticket list\` | List tickets on the board |
| \`prlt whoami\` | Show current agent/user identity |
| \`prlt ticket resolve <id>\` | Interactive resolution of ambiguity questions |
| \`prlt work resolve <id>\` | Agent-assisted resolution of ambiguity questions |

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

**Tip:** Use \`prlt ticket view <id>\` to see full ticket details at any time.

After updating, output a brief summary of your grooming changes.`,
      fromState: 'Backlog',
      toState: 'Todo',
      executor: 'claude',
      environment: 'host',
      permissionMode: 'readonly',
      modifiesCode: false,
      isDefault: true,
      position: 0,
    },
    {
      id: 'resolve',
      name: 'Resolve',
      description: 'Help human resolve ambiguity questions flagged during grooming',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Resolve Ambiguities

This ticket has been groomed and has open questions (Q1, Q2, etc.) that need human answers.

Your job is to help the human answer each question by:
1. Reading the ticket description to find all **Q1:**, **Q2:**, etc. questions
2. For each question, explore the codebase to find relevant context
3. Present each question to the human with your findings and a suggested answer
4. Collect the human's answer (they may accept your suggestion or provide their own)
5. Write the resolved answers back into the ticket description

## Process

For each question:
1. **Search the codebase** for relevant context (files, patterns, existing implementations)
2. **Present your findings**: "Q1: Should this use REST or GraphQL? I found you're already using GraphQL in \`src/api/schema.ts\`..."
3. **Suggest an answer** based on the codebase context
4. **Ask the human** to confirm or provide their own answer
5. After collecting all answers, update the ticket:
   \`\`\`bash
   prlt ticket edit {{TICKET_ID}} --description "updated description with answers"
   prlt ticket edit {{TICKET_ID}} --remove-label "needs-clarification" --add-label "ready"
   \`\`\`

## Important
- This is an INTERACTIVE session - always ask the human before writing answers
- If the ticket has acceptance criteria or subtasks that need updating based on answers, update those too
- After resolving, move the ticket to the Ready column if all questions are answered

${PRLT_COMMANDS_COMMON}
${PRLT_COMMANDS_RESOLVE}`,
      endPrompt: `After resolving all questions:
1. Update the ticket description with answers below each question
2. Remove the \`needs-clarification\` label and add \`ready\` label
3. Update acceptance criteria and subtasks if answers affect them

\`\`\`bash
prlt ticket edit {{TICKET_ID}} --description "..." --remove-label "needs-clarification" --add-label "ready"
\`\`\``,
      fromState: null,
      toState: null,
      executor: 'claude',
      environment: 'host',
      permissionMode: 'readonly',
      modifiesCode: false,
      isDefault: false,
      position: 1,
    },
    {
      id: 'implement',
      name: 'Implement',
      description: 'Write code to implement the ticket requirements',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Implement

Implement this ticket according to its requirements and acceptance criteria:
- Follow the acceptance criteria exactly
- Write clean, well-tested code
- Update documentation if the changes affect it
- Run tests to verify the implementation

**IMPORTANT: Commit and push frequently!**
- Commit after each logical change or completed subtask
- Push after every 1-2 commits to save your work
- Use atomic commits with clear messages describing the change
- Don't wait until the end to commit - your work could be lost!

Example workflow:
\`\`\`bash
# After completing a piece of work
git add -A
prlt commit "implement user validation"
git push
\`\`\`

When complete, the ticket should be ready for code review.

${PRLT_COMMANDS_COMMON}
${PRLT_COMMANDS_CODE}`,
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
      fromState: 'Todo',
      toState: 'In Progress',
      executor: 'claude',
      environment: 'host',
      permissionMode: 'full',
      modifiesCode: true,
      isDefault: true,
      position: 2,
    },
    {
      id: 'continue',
      name: 'Continue',
      description: 'Continue working from where you left off',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Continue

Continue working on this ticket from where you left off.
- Review existing commits and changes to understand current state
- Check what subtasks remain incomplete
- Complete the remaining work
- Ensure all acceptance criteria are met

**IMPORTANT: Commit and push frequently!**
- Commit after each logical change or completed subtask
- Push after every 1-2 commits to save your work
- Don't wait until the end to commit - your work could be lost!

\`\`\`bash
git add -A && prlt commit "your change" && git push
\`\`\`

${PRLT_COMMANDS_COMMON}
${PRLT_COMMANDS_CODE}`,
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
      fromState: 'In Progress',
      toState: 'In Progress',
      executor: 'claude',
      environment: 'host',
      permissionMode: 'full',
      modifiesCode: true,
      isDefault: true,
      position: 3,
    },
    {
      id: 'review',
      name: 'Code Review',
      description: 'Review the implementation and post feedback on the PR',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Code Review

Review this ticket's implementation thoroughly:
- Check for bugs, edge cases, and potential issues
- Look for security vulnerabilities
- Verify it meets all acceptance criteria
- Check code quality and maintainability
- Suggest improvements if appropriate

After reviewing, determine your verdict:
- **APPROVE**: Code is ready to merge, no significant issues
- **REQUEST_CHANGES**: There are issues that must be fixed before merging
- **COMMENT**: General feedback, no blocking issues but some suggestions

## STRICT RULES - READ CAREFULLY

- **DO NOT** merge the PR (\`gh pr merge\` is FORBIDDEN)
- **DO NOT** push any code (\`git push\` is FORBIDDEN)
- **DO NOT** run tests or test suites
- **DO NOT** modify, edit, or write any code files
- **DO NOT** create commits
- Your ONLY output should be a \`gh pr review\` comment
- This is a **read-only** review — read the diff, analyze it, post your review, and stop

If you identify issues that need fixing, describe them in your review. A separate action (Review & Fix) will handle fixes.

${PRLT_COMMANDS_COMMON}
${PRLT_COMMANDS_REVIEW}`,
      endPrompt: `When you have finished reviewing, post your review on the PR using \`gh pr review\`.

**CRITICAL: Do NOT modify any code. Do NOT attempt to fix any issues you find. Your ONLY job is to report findings.**

Choose the appropriate command based on your verdict:

**If approving:**
\`\`\`bash
gh pr review --approve --body "## Code Review

### What looks good
- ...

### Verdict
APPROVED - Code is ready to merge."
\`\`\`

**If requesting changes:**
\`\`\`bash
gh pr review --request-changes --body "## Code Review

### What looks good
- ...

### Concerns
- ...

### Suggested improvements
- ...

### Verdict
REQUEST CHANGES - Issues must be addressed before merging."
\`\`\`

**If commenting:**
\`\`\`bash
gh pr review --comment --body "## Code Review

### What looks good
- ...

### Suggestions
- ...

### Verdict
COMMENT - Some suggestions but no blocking issues."
\`\`\`

Format the body with: what looks good, concerns (if any), suggested improvements (if any), and your verdict.

**REMINDER:** Do NOT merge the PR. Do NOT run tests. Do NOT modify code. Only post the review comment above.

**After posting your review**, if you found issues that need fixing, log them on the ticket so another action can address them:
\`\`\`bash
prlt ticket edit <TICKET_ID> --add-subtask "Fix: <description of issue>"
\`\`\`

**STOP:** After posting your review and logging any findings, your task is complete. Do not take any further actions, do not attempt to fix any issues, do not type additional instructions, and do not continue the conversation. Simply output your summary and use \`/exit\` to end the session.`,
      fromState: null,
      toState: null,
      executor: 'claude',
      environment: 'host',
      permissionMode: 'readonly',
      modifiesCode: false,
      isDefault: false,
      position: 4,
    },
    {
      id: 'review-comment',
      name: 'Review Comment',
      description: 'Post review comments on a PR without merging, testing, or modifying code',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Review Comment

Read the PR diff, analyze the changes, and post a GitHub review comment. That is your ONLY job.

## STRICT RULES - READ CAREFULLY

You are a **read-only** reviewer. You MUST follow these rules:

- **DO NOT** run \`gh pr merge\` — merging is FORBIDDEN
- **DO NOT** run \`git push\` — pushing is FORBIDDEN
- **DO NOT** run tests or test suites of any kind
- **DO NOT** modify, edit, or write any code files
- **DO NOT** create commits or branches
- **DO NOT** run any commands that change repository state
- Your **ONLY** permitted write operation is \`gh pr review\` to post your comment

## What To Do

1. Read the PR diff to understand the changes
2. Analyze the code for bugs, issues, style, and correctness
3. Post your review using \`gh pr review\` with the appropriate verdict
4. **STOP** — do nothing else after posting the review

${PRLT_COMMANDS_COMMON}
${PRLT_COMMANDS_REVIEW}`,
      endPrompt: `Post your review on the PR using \`gh pr review\`. This is the ONLY action you should take.

**If approving:**
\`\`\`bash
gh pr review --approve --body "## Review

### Summary
- ...

APPROVED - Looks good to merge."
\`\`\`

**If requesting changes:**
\`\`\`bash
gh pr review --request-changes --body "## Review

### Issues
- ...

REQUEST CHANGES - Please address the above."
\`\`\`

**If commenting:**
\`\`\`bash
gh pr review --comment --body "## Review

### Feedback
- ...

COMMENT - Some suggestions, no blockers."
\`\`\`

**CRITICAL REMINDER:** After posting your review, STOP. Do NOT merge the PR. Do NOT run tests. Do NOT modify code. Do NOT push anything. Your job is done after the \`gh pr review\` command.`,
      fromState: 'Done',
      toState: null,
      executor: 'claude',
      environment: 'host',
      permissionMode: 'readonly',
      modifiesCode: false,
      isDefault: true,
      position: 5,
    },
    {
      id: 'review-fix',
      name: 'Review & Fix',
      description: 'Review the implementation, fix issues, and post feedback on the PR',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Review & Fix

Review this ticket's implementation thoroughly and fix any issues found:
- Check for bugs, edge cases, and potential issues
- Look for security vulnerabilities
- Verify it meets all acceptance criteria
- Check code quality and maintainability
- Fix any issues you find directly in the code

**IMPORTANT: Commit and push frequently!**
- Commit after each fix or logical group of changes
- Push after every 1-2 commits to save your work

\`\`\`bash
git add -A && prlt commit "fix: address code review findings" && git push
\`\`\`

${PRLT_COMMANDS_COMMON}
${PRLT_COMMANDS_CODE}
${PRLT_COMMANDS_REVIEW}`,
      endPrompt: `When you have finished reviewing and fixing:

1. **If issues were found and fixed**, post a review summary and push your fixes:
   \`\`\`bash
   gh pr review --comment --body "## Code Review & Fix Summary

   ### Issues found and fixed
   - ...

   ### What looks good
   - ...

   ### Changes made
   - ...
   "
   prlt commit "fix: address code review findings"
   git push
   \`\`\`

2. **If no issues were found**, approve the PR:
   \`\`\`bash
   gh pr review --approve --body "## Code Review

   ### What looks good
   - ...

   ### Verdict
   APPROVED - Code looks great, no issues found."
   \`\`\``,
      fromState: null,
      toState: null,
      executor: 'claude',
      environment: 'host',
      permissionMode: 'full',
      modifiesCode: true,
      isDefault: false,
      position: 6,
    },
    {
      id: 'revise',
      name: 'Revise',
      description: 'Pull the branch, read PR review feedback, implement fixes, and push',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Revise

Address the feedback on this ticket's pull request:

1. **Pull the latest branch** to ensure you have the most recent code:
   \`\`\`bash
   git pull
   \`\`\`

2. **Read all review comments and requested changes** from the PR:
   \`\`\`bash
   gh pr view
   gh api repos/{owner}/{repo}/pulls/{number}/comments
   \`\`\`

3. **Understand each piece of feedback** before making changes — read carefully and understand the reviewer's intent

4. **Implement the requested fixes** and address each review comment:
   - Make the necessary code changes to address each point
   - Respond to questions with explanations
   - Ensure all requested changes are addressed

**IMPORTANT: Commit and push frequently!**
- Commit after each fix or logical group of changes
- Push after every 1-2 commits to save your work

\`\`\`bash
git add -A && prlt commit "fix: address PR review feedback" && git push
\`\`\`

${PRLT_COMMANDS_COMMON}
${PRLT_COMMANDS_CODE}`,
      endPrompt: `After addressing all feedback:

1. **Commit your changes**:
   \`\`\`bash
   git add -A
   prlt commit "fix: address PR review feedback"
   \`\`\`

2. **Push your changes**:
   \`\`\`bash
   git push
   \`\`\`

3. **Optionally reply to resolved review threads** using the GitHub API:
   \`\`\`bash
   gh api repos/{owner}/{repo}/pulls/{number}/comments
   \`\`\`

The PR will be updated automatically with your pushed changes.`,
      fromState: 'Done',
      toState: 'In Progress',
      executor: 'claude',
      environment: 'host',
      permissionMode: 'full',
      modifiesCode: true,
      isDefault: false,
      position: 7,
    },
    {
      id: 'explore-cli',
      name: 'Explore CLI',
      description: 'AI QA agent that autonomously explores the interactive CLI to discover bugs',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Explore CLI (Autonomous QA)

You are an AI QA tester for the prlt CLI. You have access to a tmux session where the CLI is running.
Your job is to **systematically explore every menu, try every option, and find bugs**.

## Your Tools

- **tmux_send_keys** — send keystrokes to the tmux session (typing, arrows, Enter, Escape, Ctrl+C, etc.)
- **tmux_capture_pane** — read the current terminal screen to see what's displayed
- **tmux_start_session** — start a new tmux session to run the CLI in
- **tmux_list_sessions** — list active tmux sessions
- **ticket_create** — file a bug ticket when you find something broken

## Getting Started

1. Start a tmux session for testing:
   \`\`\`
   tmux_start_session({ session: "qa-test", command: "prlt" })
   \`\`\`
2. Wait a moment, then capture the screen to see the main menu:
   \`\`\`
   tmux_capture_pane({ session: "qa-test" })
   \`\`\`
3. Begin systematic exploration.

## Exploration Strategies

Work through these systematically. After each action, always capture the screen to see the result.

### 1. Navigate Every Top-Level Menu Item
- Use arrow keys (Up/Down) to highlight each option
- Press Enter to select each one
- Capture the screen to see what happens
- Press Escape or Ctrl+C to go back

### 2. Test Every Submenu Option
- For each menu item, explore all sub-options
- Try selecting each choice in every list/menu

### 3. Test Input Handling
- **Valid inputs**: Normal expected values
- **Empty inputs**: Just press Enter without typing anything
- **Invalid inputs**: Random strings, numbers where text is expected, etc.
- **Long strings**: Very long ticket titles, descriptions (100+ characters)
- **Special characters**: Quotes, backslashes, Unicode (emojis, CJK characters)
- **SQL injection-like**: \`'; DROP TABLE --\` style strings
- **Boundary values**: 0, -1, 999999, etc. for numeric inputs

### 4. Test Cancellation Flows
- Press Ctrl+C mid-flow (should exit gracefully, no crash)
- Press Escape in menus (should go back)
- Press q or Q in menus (common quit shortcut)
- Rapidly press Escape multiple times

### 5. Test Navigation Edge Cases
- Rapid arrow key presses (Up Up Up Down Down Down)
- Arrow keys at the top/bottom of lists (should not crash)
- Tab key in various contexts
- Home/End keys

### 6. Test Error Recovery
- Navigate to ticket operations without any tickets
- Try to create items with duplicate names
- Try operations on non-existent IDs

## What to Look For

- **Crashes**: Unhandled exceptions, stack traces visible on screen
- **Rendering glitches**: Items cut off, wrong alignment, overlapping text, garbled output
- **Wrong data**: Incorrect values displayed, stale data, missing information
- **Missing options**: Menu items that should exist but don't
- **Broken navigation**: Arrow keys don't work, can't go back, infinite loops
- **Unhelpful errors**: Generic "Error" with no details, or raw error objects
- **Hangs**: Screen freezes, no response to input (wait 10 seconds before declaring a hang)
- **Screen overflow**: Content pushed off screen, no scrolling available
- **Partial renders**: Screen shows half-drawn UI elements
- **State corruption**: Operations succeed but data is wrong afterward

## Cross-Validation

Compare what you see on screen with what the MCP tools return:
- After creating a ticket via the interactive menu, use \`ticket_list\` to verify it was created correctly
- After moving a ticket, verify the status changed via \`ticket_show\`
- Check that counts displayed in menus match actual data

## When You Find a Bug

1. **Document exact reproduction steps** — which keys you pressed, in what order
2. **Capture the screen** showing the bug
3. **File a ticket** using the ticket_create MCP tool:
   - Title: Clear description of the bug
   - Category: "bug"
   - Priority: P1 for crashes/data loss, P2 for rendering/UX issues, P3 for minor issues
   - Description: Include exact reproduction steps, screen capture, and expected vs actual behavior

## Session Management

- If the CLI crashes, restart it: kill the session and start a new one
- If you get stuck, use Ctrl+C to escape, or kill and restart the session
- Periodically capture the screen even when not expecting changes (catch intermittent issues)

## Test Prioritization

Start with the most commonly used flows, then move to edge cases:
1. Main menu navigation
2. Ticket operations (create, list, view, edit, move)
3. Project operations
4. Board view
5. Work/session operations
6. Epic and spec operations
7. Settings and configuration
8. Edge cases and stress testing`,
      endPrompt: `## Wrap-Up

When you've completed your exploration:

1. **Summarize your findings**: List all bugs found with their ticket IDs
2. **Note areas not tested**: If you couldn't reach certain features, list them
3. **Rate overall CLI quality**: Brief assessment of stability, UX, and completeness

Output a structured summary:
\`\`\`
## Exploratory QA Summary

### Bugs Filed
- TKT-XXX: [brief description]
- TKT-YYY: [brief description]

### Areas Tested
- [ ] Main menu navigation
- [ ] Ticket CRUD
- [ ] Project operations
- [ ] Board view
- [ ] Work sessions
- [ ] Epics & specs
- [ ] Error handling
- [ ] Input validation

### Areas Not Tested
- [list any areas you couldn't reach]

### Overall Assessment
[Brief quality assessment]
\`\`\`

Clean up your tmux session:
\`\`\`
tmux_kill_session({ session: "qa-test" })
\`\`\``,
      fromState: null,
      toState: null,
      executor: 'claude',
      environment: 'host',
      permissionMode: 'readonly',
      modifiesCode: false,
      isDefault: false,
      position: 9,
    },
    {
      id: 'merge',
      name: 'Merge',
      description: 'Verify CI is green, merge the PR, and clean up the branch',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Merge

Merge this ticket's pull request after verifying it is ready:

1. **Check CI status** — ensure all checks are passing:
   \`\`\`bash
   gh pr checks
   \`\`\`

2. **Verify approval** — ensure the PR has been approved:
   \`\`\`bash
   gh pr view --json reviews
   \`\`\`

3. **Merge the PR** — use squash merge by default:
   \`\`\`bash
   gh pr merge --squash --delete-branch
   \`\`\`

4. **Clean up** — the \`--delete-branch\` flag handles remote branch deletion.
   Locally, prune stale tracking branches:
   \`\`\`bash
   git fetch --prune
   \`\`\`

## Important Rules
- Do NOT merge if CI checks are failing — report the failures instead
- Do NOT merge if the PR has not been approved — report the status instead
- Do NOT force-merge or bypass required checks
- If merge conflicts exist, report them — do NOT attempt to resolve them in this action

${PRLT_COMMANDS_COMMON}
${PRLT_COMMANDS_REVIEW}`,
      endPrompt: `After merging:

1. **If merge was successful**, mark the ticket as complete:
   \`\`\`bash
   prlt work complete {{TICKET_ID}}
   \`\`\`

2. **If merge failed** (CI failures, conflicts, missing approval), report the issue:
   \`\`\`bash
   prlt ticket edit {{TICKET_ID}} --add-subtask "Fix: <description of merge blocker>"
   \`\`\`

**STOP:** After completing the above, your task is done. Do not take any further actions.`,
      fromState: 'Review',
      toState: 'Done',
      executor: 'claude',
      environment: 'devcontainer',
      permissionMode: 'bypassPermissions',
      modifiesCode: false,
      isDefault: true,
      position: 10,
    },
    {
      id: 'test',
      name: 'Write Tests',
      description: 'Add comprehensive tests for the implementation',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Write Tests

Write comprehensive tests for this ticket's implementation:
- Add unit tests for core functionality
- Add integration tests where appropriate
- Cover edge cases and error handling
- Aim for good coverage of the changed code
- Ensure all tests pass

**IMPORTANT: Commit and push frequently!**
- Commit after each test file or logical group of tests
- Push after every 1-2 commits to save your work

\`\`\`bash
git add -A && prlt commit "add tests for X" && git push
\`\`\`

${PRLT_COMMANDS_COMMON}
${PRLT_COMMANDS_CODE}`,
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
      fromState: null,
      toState: null,
      executor: 'claude',
      environment: 'host',
      permissionMode: 'full',
      modifiesCode: true,
      isDefault: false,
      position: 8,
    },
  ]

  // Use INSERT OR REPLACE to always update builtin actions with latest prompts
  // This ensures prompt improvements are applied to existing databases
  const upsertAction = db.prepare(`
    INSERT INTO ${T.actions} (id, name, description, prompt, end_prompt, from_state, to_state,
      executor, environment, permission_mode, modifies_code, is_default, is_builtin, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      prompt = excluded.prompt,
      end_prompt = excluded.end_prompt,
      from_state = excluded.from_state,
      to_state = excluded.to_state,
      executor = excluded.executor,
      environment = excluded.environment,
      permission_mode = excluded.permission_mode,
      modifies_code = excluded.modifies_code,
      is_default = excluded.is_default,
      position = excluded.position,
      updated_at = excluded.updated_at
    WHERE is_builtin = 1
  `)

  const now = new Date().toISOString()
  for (const action of builtinActions) {
    upsertAction.run(
      action.id,
      action.name,
      action.description,
      action.prompt,
      action.endPrompt || null,
      action.fromState || null,
      action.toState || null,
      action.executor || 'claude',
      action.environment || 'host',
      action.permissionMode || 'full',
      action.modifiesCode ? 1 : 0,
      action.isDefault ? 1 : 0,
      action.position,
      now,
      now
    )
  }
}

/**
 * Seed built-in workflow rules.
 * Wires default actions to standard Linear/kanban states.
 */
export function seedBuiltinWorkflowRules(db: Database.Database): void {
  const builtinRules = [
    {
      id: 'backlog-groom',
      fromState: null,
      toState: 'Backlog',
      actionId: 'groom',
      trigger: 'manual',
    },
    {
      id: 'todo-implement',
      fromState: null,
      toState: 'Todo',
      actionId: 'implement',
      trigger: 'manual',
    },
    {
      id: 'in-progress-continue',
      fromState: null,
      toState: 'In Progress',
      actionId: 'continue',
      trigger: 'manual',
    },
    {
      id: 'done-review',
      fromState: null,
      toState: 'Done',
      actionId: 'review',
      trigger: 'manual',
    },
    {
      id: 'done-review-comment',
      fromState: null,
      toState: 'Done',
      actionId: 'review-comment',
      trigger: 'manual',
    },
  ]

  // Verify pmo_workflow_rules table exists
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_workflow_rules'"
  ).get()
  if (!tableExists) return

  const upsertRule = db.prepare(`
    INSERT INTO ${T.workflow_rules} (id, from_state, to_state, action_id, trigger, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      from_state = excluded.from_state,
      to_state = excluded.to_state,
      action_id = excluded.action_id,
      trigger = excluded.trigger,
      updated_at = excluded.updated_at
  `)

  const now = new Date().toISOString()
  for (const rule of builtinRules) {
    // Only insert if the referenced action exists
    const actionExists = db.prepare(`
      SELECT id FROM ${T.actions} WHERE id = ?
    `).get(rule.actionId)
    if (!actionExists) continue

    upsertRule.run(
      rule.id,
      rule.fromState,
      rule.toState,
      rule.actionId,
      rule.trigger,
      now,
      now
    )
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
 * Seed built-in categories from TICKET_CATEGORIES and STATE_CATEGORY_ORDER.
 */
export function seedBuiltinCategories(db: Database.Database): void {
  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO ${T.categories} (id, name, type, description, position, is_builtin, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `)

  const now = new Date().toISOString()

  // Seed ticket categories from TICKET_CATEGORIES
  for (let i = 0; i < TICKET_CATEGORIES.length; i++) {
    const category = TICKET_CATEGORIES[i]
    const id = `ticket-${category}`
    insertCategory.run(
      id,
      category,
      'ticket',
      null,
      i,
      now
    )
  }

  // Seed status categories from STATE_CATEGORY_ORDER
  const statusCategoryDescriptions: Record<string, string> = {
    triage: 'Inbox - needs review before entering workflow',
    backlog: 'Not yet scheduled for work',
    unstarted: 'Scheduled but work has not begun',
    started: 'Work is actively in progress',
    completed: 'Work finished successfully',
    canceled: 'Work will not be done',
  }

  for (let i = 0; i < STATE_CATEGORY_ORDER.length; i++) {
    const category = STATE_CATEGORY_ORDER[i]
    const id = `status-${category}`
    insertCategory.run(
      id,
      category,
      'status',
      statusCategoryDescriptions[category] || null,
      i,
      now
    )
  }
}

/**
 * Seed default priorities if not already set.
 * Preserves any existing user-defined priority scale.
 */
export function seedDefaultPriorities(db: Database.Database): void {
  // getWorkspacePriorities returns DEFAULT_PRIORITIES if not set,
  // but we need to check if it's actually stored in the DB
  const row = db.prepare(
    `SELECT value FROM ${T.settings} WHERE key = 'priorities'`
  ).get() as { value: string } | undefined

  if (!row) {
    // No priorities set yet - seed with defaults
    setWorkspacePriorities(db, [...DEFAULT_PRIORITIES])
  }
}

/**
 * Seed built-in label groups and labels.
 * Creates Function, Type, and Area groups with their labels.
 * Migrates existing ticket category values to Function labels.
 */
export function seedBuiltinLabels(db: Database.Database): void {
  const now = new Date().toISOString()

  const insertGroup = db.prepare(`
    INSERT OR IGNORE INTO ${T.label_groups} (id, name, description, is_exclusive, is_required, position, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const insertLabel = db.prepare(`
    INSERT OR IGNORE INTO ${T.labels} (id, name, color, description, group_id, position, is_builtin, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `)

  // Built-in label groups
  const groups = [
    {
      id: 'function',
      name: 'Function',
      description: 'Business function category (diet enforcement)',
      isExclusive: true,
      isRequired: true,
      position: 0,
      labels: [
        { id: 'fn-ship', name: 'ship', description: 'Core product development', color: '#2da44e' },
        { id: 'fn-grow', name: 'grow', description: 'Marketing, adoption, community', color: '#bf8700' },
        { id: 'fn-support', name: 'support', description: 'Docs, error messages, onboarding', color: '#0969da' },
        { id: 'fn-bizops', name: 'bizops', description: 'Infrastructure, CI/CD, operations', color: '#8250df' },
        { id: 'fn-strategy', name: 'strategy', description: 'Design decisions, spikes, retros, planning', color: '#cf222e' },
      ],
    },
    {
      id: 'type',
      name: 'Type',
      description: 'Work type classification',
      isExclusive: true,
      isRequired: false,
      position: 1,
      labels: [
        { id: 'type-bug', name: 'bug', description: 'Bug fix', color: '#cf222e' },
        { id: 'type-feature', name: 'feature', description: 'New feature', color: '#2da44e' },
        { id: 'type-improvement', name: 'improvement', description: 'Enhancement to existing feature', color: '#0969da' },
        { id: 'type-task', name: 'task', description: 'General task', color: '#6e7781' },
      ],
    },
    {
      id: 'area',
      name: 'Area',
      description: 'System area (non-exclusive)',
      isExclusive: false,
      isRequired: false,
      position: 2,
      labels: [
        { id: 'area-cli', name: 'cli', description: 'CLI tool', color: '#0969da' },
        { id: 'area-pmo', name: 'pmo', description: 'Project management', color: '#8250df' },
        { id: 'area-agent', name: 'agent', description: 'Agent system', color: '#2da44e' },
        { id: 'area-docker', name: 'docker', description: 'Docker integration', color: '#bf8700' },
        { id: 'area-mcp', name: 'mcp', description: 'MCP server', color: '#cf222e' },
        { id: 'area-desktop', name: 'desktop', description: 'Desktop app', color: '#6e7781' },
      ],
    },
  ]

  for (const group of groups) {
    insertGroup.run(
      group.id,
      group.name,
      group.description,
      group.isExclusive ? 1 : 0,
      group.isRequired ? 1 : 0,
      group.position,
      now
    )

    for (let i = 0; i < group.labels.length; i++) {
      const label = group.labels[i]
      insertLabel.run(
        label.id,
        label.name,
        label.color,
        label.description,
        group.id,
        i,
        now
      )
    }
  }

  // Migrate existing category column values to Function label group
  // Only run if there are tickets with category set but no Function label yet
  migrateCategoryToFunctionLabels(db)
}

/**
 * Migrate existing ticket category values to Function label group entries.
 * Maps known category names to function labels (e.g., 'ship' -> fn-ship).
 * This is idempotent - only creates associations that don't exist yet.
 */
function migrateCategoryToFunctionLabels(db: Database.Database): void {
  // Map of old category values to function label IDs
  // The ticket's category field contains values like 'feature', 'bug', etc.
  // The diet system uses ship/grow/support/bizops/strategy which are different
  // from ticket categories. The diet categories map to the Function label group.
  // Since existing categories (feature, bug, etc.) don't map to Function labels,
  // we only migrate if the category field happens to contain a Function label name.
  const functionLabelMap: Record<string, string> = {
    ship: 'fn-ship',
    grow: 'fn-grow',
    support: 'fn-support',
    bizops: 'fn-bizops',
    strategy: 'fn-strategy',
  }

  const tickets = db.prepare(`
    SELECT id, category FROM ${T.tickets}
    WHERE category IS NOT NULL AND category != ''
  `).all() as Array<{ id: string; category: string }>

  const insertTicketLabel = db.prepare(`
    INSERT OR IGNORE INTO ${T.ticket_labels} (ticket_id, label_id)
    VALUES (?, ?)
  `)

  for (const ticket of tickets) {
    const labelId = functionLabelMap[ticket.category.toLowerCase()]
    if (labelId) {
      // Check label exists before inserting
      const labelExists = db.prepare(
        `SELECT id FROM ${T.labels} WHERE id = ?`
      ).get(labelId) as { id: string } | undefined
      if (labelExists) {
        insertTicketLabel.run(ticket.id, labelId)
      }
    }
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
