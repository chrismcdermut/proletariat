/**
 * Base storage module with database initialization, migrations, and seeding.
 * This module handles database setup and provides shared utilities.
 */

import Database from 'better-sqlite3'
import { PMO_TABLES, PMO_SCHEMA_SQL, validateTicketSchema } from '../schema.js'
import { BUILTIN_TEMPLATES } from '../templates-builtin.js'
import { setWorkspacePriorities, DEFAULT_PRIORITIES } from '../../work-lifecycle/settings.js'

const T = PMO_TABLES

/**
 * Initialize PMO tables in the database.
 * Runs migrations, creates tables, seeds built-in data, and validates schema.
 */
export function initializePMOTables(db: Database.Database): void {
  runMigrations(db)
  db.exec(PMO_SCHEMA_SQL)
  seedBuiltinWorkflows(db)  // Workflows are the source of truth for status configurations
  seedBuiltinActions(db)
  seedBuiltinWorkflowRules(db)
  seedBuiltinTicketTemplates(db)
  seedDefaultPriorities(db)  // Seed default priority scale if not set
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

  // Migration: Add cleanup_policy column to agent_work table (PRLT-1061)
  if (tableExists(T.agent_work)) {
    const awCols2 = db.pragma(`table_info(${T.agent_work})`) as Array<{ name: string }>
    const awColNames2 = new Set(awCols2.map(c => c.name))
    if (!awColNames2.has('cleanup_policy')) {
      try {
        db.exec(`ALTER TABLE ${T.agent_work} ADD COLUMN cleanup_policy TEXT NOT NULL DEFAULT 'on-exit'`)
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
| \`prlt work propose <id>\` | Create a PR and move ticket to Review (preferred for agents) |
| \`prlt work ready <id> --pr\` | Mark ticket ready for review and create a PR |
| \`prlt work ship <id>\` | Merge PR and move ticket to Done |
| \`prlt work complete <id>\` | Mark ticket as complete (move to Done) |
| \`prlt pr create\` | Create a PR with ticket context (use \`prlt work propose\` instead when possible) |

### Forbidden Commands — NEVER Use These

These raw commands bypass ticket state transitions and break board/Linear sync:

| Forbidden Command | Use Instead |
|-------------------|-------------|
| \`gh pr create\` | \`prlt work propose <id>\` or \`prlt pr create\` |
| \`gh pr merge\` | \`prlt work ship <id>\` |
| \`git push origin HEAD && gh pr create\` | \`prlt work propose <id>\` (handles push + PR + state) |

**Why:** \`prlt\` commands update ticket state (In Progress → Review → Done) and sync with Linear/Jira. Raw \`gh\` commands skip all of this, leaving the board stale.`

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
      fromIntent: 'backlog',
      toIntent: 'ready',
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
      fromIntent: null,
      toIntent: null,
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
      description: 'Write code to implement, continue, revise, or test based on context',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Implement

You are a context-aware implementation agent. Determine what kind of work is needed based on the current state of the ticket and codebase:

## Context Detection

Before starting, assess the situation:

1. **Check for an existing branch with commits** — if you find prior work on this ticket's branch, you are **continuing** from where the previous agent left off. Review existing commits and complete remaining work.

2. **Check for PR feedback** — if there is an open PR with review comments or requested changes, you are **revising** the implementation. Read all feedback, understand the reviewer's intent, and address each point.

3. **Check if the ticket specifically asks for tests** — if the ticket's requirements or acceptance criteria focus on writing tests, focus on test coverage.

4. **Otherwise** — this is a **fresh implementation**. Implement the ticket from scratch according to its requirements and acceptance criteria.

## Implementation Guidelines

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
git push origin HEAD
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
   git push origin HEAD
   \`\`\`
   This formats your commit as a conventional commit with the ticket ID.

2. **Propose your work for review** by running:
   \`\`\`bash
   prlt work propose {{TICKET_ID}}
   \`\`\`
   This creates a pull request and moves the ticket to Review automatically.

**IMPORTANT:** Use \`prlt work propose\` — do NOT use \`gh pr create\` directly, as that skips ticket state transitions.
**IMPORTANT:** Use the global \`prlt\` command (just type \`prlt\`). Do NOT use \`./bin/run.js\` or any local path.

**NEVER use these commands:**
- \`gh pr create\` → use \`prlt work propose {{TICKET_ID}}\` instead
- \`gh pr merge\` → use \`prlt work ship {{TICKET_ID}}\` instead
- These raw commands skip ticket lifecycle updates and break board sync.`,
      fromIntent: 'ready',
      toIntent: 'started',
      executor: 'claude',
      environment: 'host',
      permissionMode: 'full',
      modifiesCode: true,
      isDefault: true,
      position: 2,
    },
    // NOTE: 'continue' action removed — absorbed by 'implement' (model detects existing branch)
    {
      id: 'review',
      name: 'Code Review',
      description: 'Review the PR — comment, fix, or both based on context',
      prompt: `${PRLT_USAGE_RULE}

---

# Action: Code Review

Review this ticket's implementation thoroughly:
- Check for bugs, edge cases, and potential issues
- Look for security vulnerabilities
- Verify it meets all acceptance criteria
- Check code quality and maintainability
- Suggest improvements if appropriate

## Context Detection

Determine the appropriate review mode based on context:

1. **Review only** (default) — Read the diff, analyze the code, and post a review comment on the PR. Do NOT modify any code.
2. **Review & Fix** — If the ticket description or instructions explicitly ask you to fix issues found, you may also make code changes, commit, and push.

If you are unsure, default to **review only** mode (read-only).

## Review Guidelines

After reviewing, determine your verdict:
- **APPROVE**: Code is ready to merge, no significant issues
- **REQUEST_CHANGES**: There are issues that must be fixed before merging
- **COMMENT**: General feedback, no blocking issues but some suggestions

## For Review Only Mode

- **DO NOT** merge the PR (\`gh pr merge\` is FORBIDDEN)
- **DO NOT** push any code (\`git push\` is FORBIDDEN)
- **DO NOT** modify, edit, or write any code files
- **DO NOT** create commits
- Your ONLY output should be a \`gh pr review\` comment

## For Review & Fix Mode

- Fix any issues you find directly in the code
- Commit and push your fixes frequently
- Post a review summary describing what was found and fixed

${PRLT_COMMANDS_COMMON}
${PRLT_COMMANDS_REVIEW}`,
      endPrompt: `When you have finished reviewing, post your review on the PR using \`gh pr review\`.

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

**After posting your review**, if you found issues that need fixing, log them on the ticket:
\`\`\`bash
prlt ticket edit <TICKET_ID> --add-subtask "Fix: <description of issue>"
\`\`\`

**STOP:** After posting your review and logging any findings, your task is complete. Do not take any further actions.`,
      fromIntent: null,
      toIntent: null,
      executor: 'claude',
      environment: 'host',
      permissionMode: 'readonly',
      modifiesCode: false,
      isDefault: false,
      position: 4,
    },
    // NOTE: 'review-comment' action removed — absorbed by 'review' (model decides mode from context)
    // NOTE: 'review-fix' action removed — absorbed by 'review' (model decides whether to fix from context)
    // NOTE: 'revise' action removed — absorbed by 'implement' (model detects PR feedback)
    // NOTE: 'explore-cli' action removed — no longer a default work primitive
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
   prlt pr checks
   \`\`\`

2. **Verify approval** — ensure the PR has been approved:
   \`\`\`bash
   gh pr view --json reviews
   \`\`\`

3. **Merge the PR** using prlt:
   \`\`\`bash
   prlt work ship {{TICKET_ID}}
   \`\`\`
   This squash-merges the PR, deletes the branch, and moves the ticket to Done.

   If CI is not yet green, use \`--when-green\` to auto-merge once checks pass:
   \`\`\`bash
   prlt work ship {{TICKET_ID}} --when-green
   \`\`\`

4. **Clean up** — \`prlt work ship\` handles branch deletion automatically.

## Important Rules
- Do NOT merge if CI checks are failing — report the failures or use \`--when-green\`
- Do NOT merge if the PR has not been approved — report the status instead
- Do NOT force-merge or bypass required checks
- If merge conflicts exist, report them — do NOT attempt to resolve them in this action
- **NEVER use \`gh pr merge\`** — always use \`prlt work ship\` (it updates ticket state and syncs with Linear/Jira)

${PRLT_COMMANDS_COMMON}
${PRLT_COMMANDS_CODE}`,
      endPrompt: `After merging:

1. **If merge was successful** via \`prlt work ship\`, the ticket is automatically moved to Done — no further action needed.

2. **If merge failed** (CI failures, conflicts, missing approval), report the issue:
   \`\`\`bash
   prlt ticket edit {{TICKET_ID}} --add-subtask "Fix: <description of merge blocker>"
   \`\`\`

**IMPORTANT:** NEVER use \`gh pr merge\` — always use \`prlt work ship {{TICKET_ID}}\`.

**STOP:** After completing the above, your task is done. Do not take any further actions.`,
      fromIntent: 'needs_review',
      toIntent: 'completed',
      executor: 'claude',
      environment: 'devcontainer',
      permissionMode: 'bypassPermissions',
      modifiesCode: false,
      isDefault: true,
      position: 10,
    },
    // NOTE: 'test' action removed — absorbed by 'implement' (ticket says write tests)
  ]

  // Use INSERT OR REPLACE to always update builtin actions with latest prompts
  // This ensures prompt improvements are applied to existing databases
  const upsertAction = db.prepare(`
    INSERT INTO ${T.actions} (id, name, description, prompt, end_prompt, from_intent, to_intent,
      executor, environment, permission_mode, modifies_code, is_default, is_builtin, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      prompt = excluded.prompt,
      end_prompt = excluded.end_prompt,
      from_intent = excluded.from_intent,
      to_intent = excluded.to_intent,
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
      action.fromIntent || null,
      action.toIntent || null,
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
 * Wires default actions to canonical intents (board-agnostic).
 */
export function seedBuiltinWorkflowRules(db: Database.Database): void {
  const builtinRules = [
    {
      id: 'backlog-groom',
      fromIntent: null,
      toIntent: 'backlog',
      actionId: 'groom',
      trigger: 'manual',
    },
    {
      id: 'ready-implement',
      fromIntent: null,
      toIntent: 'ready',
      actionId: 'implement',
      trigger: 'manual',
    },
    {
      id: 'started-implement',
      fromIntent: null,
      toIntent: 'started',
      actionId: 'implement',
      trigger: 'manual',
    },
    {
      id: 'completed-review',
      fromIntent: null,
      toIntent: 'completed',
      actionId: 'review',
      trigger: 'manual',
    },
  ]

  // Verify pmo_workflow_rules table exists
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_workflow_rules'"
  ).get()
  if (!tableExists) return

  const upsertRule = db.prepare(`
    INSERT INTO ${T.workflow_rules} (id, from_intent, to_intent, action_id, trigger, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      from_intent = excluded.from_intent,
      to_intent = excluded.to_intent,
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
      rule.fromIntent,
      rule.toIntent,
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
