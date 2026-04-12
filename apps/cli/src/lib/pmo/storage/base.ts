/**
 * Base storage module with database initialization and seeding.
 *
 * As of PRLT-1299, the local ticket store and workflow definitions have been
 * removed. This module only seeds actions and workflow rules.
 */

import Database from 'better-sqlite3'
import { PMO_TABLES, PMO_SCHEMA_SQL } from '../schema.js'
import { setWorkspacePriorities, DEFAULT_PRIORITIES } from '../../work-lifecycle/settings.js'

const T = PMO_TABLES

/**
 * Initialize PMO tables in the database.
 * Creates tables, seeds built-in data.
 */
export function initializePMOTables(db: Database.Database): void {
  db.exec(PMO_SCHEMA_SQL)
  seedBuiltinActions(db)
  seedBuiltinWorkflowRules(db)
  seedDefaultPriorities(db)
}

/**
 * Rule for agents about using the globally installed prlt command.
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
      prompt: `${PRLT_USAGE_RULE}\n\n---\n\n# Action: Groom\n\nAnalyze this ticket and improve its definition:\n- Add detailed requirements if missing or vague\n- Add clear, testable acceptance criteria\n- Break down into subtasks if the work is complex\n- Estimate complexity (S/M/L/XL) if not already set\n- Flag any ambiguities or missing information that need clarification\n\nDo NOT implement the ticket - only improve its definition so it's ready to be worked on.\n\n${PRLT_COMMANDS_COMMON}\n${PRLT_COMMANDS_RESOLVE}`,
      endPrompt: 'When you have finished analyzing and grooming the ticket, update it using prlt ticket edit.',
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
      prompt: `${PRLT_USAGE_RULE}\n\n---\n\n# Action: Resolve Ambiguities\n\nThis ticket has been groomed and has open questions that need human answers.\n\n${PRLT_COMMANDS_COMMON}\n${PRLT_COMMANDS_RESOLVE}`,
      endPrompt: null,
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
      description: 'Write code to implement, continue, revise, or test based on context',
      prompt: `${PRLT_USAGE_RULE}\n\n---\n\n# Action: Implement\n\nYou are a context-aware implementation agent. Determine what kind of work is needed based on the current state of the ticket and codebase.\n\n${PRLT_COMMANDS_COMMON}\n${PRLT_COMMANDS_CODE}`,
      endPrompt: 'When complete, commit your work and run: prlt work propose {{TICKET_ID}}',
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
      id: 'review',
      name: 'Code Review',
      description: 'Review the PR — comment, fix, or both based on context',
      prompt: `${PRLT_USAGE_RULE}\n\n---\n\n# Action: Code Review\n\nReview this ticket's implementation thoroughly.\n\n${PRLT_COMMANDS_COMMON}\n${PRLT_COMMANDS_REVIEW}`,
      endPrompt: 'When you have finished reviewing, post your review on the PR using gh pr review.',
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
      id: 'merge',
      name: 'Merge',
      description: 'Verify CI is green, merge the PR, and clean up the branch',
      prompt: `${PRLT_USAGE_RULE}\n\n---\n\n# Action: Merge\n\nMerge this ticket's pull request after verifying it is ready.\n\n${PRLT_COMMANDS_COMMON}\n${PRLT_COMMANDS_CODE}`,
      endPrompt: 'After merging, the ticket is automatically moved to Done.',
      fromState: 'Review',
      toState: 'Done',
      executor: 'claude',
      environment: 'devcontainer',
      permissionMode: 'bypassPermissions',
      modifiesCode: false,
      isDefault: true,
      position: 10,
    },
  ]

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
      id: 'in-progress-implement',
      fromState: null,
      toState: 'In Progress',
      actionId: 'implement',
      trigger: 'manual',
    },
    {
      id: 'done-review',
      fromState: null,
      toState: 'Done',
      actionId: 'review',
      trigger: 'manual',
    },
  ]

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
 * Seed default priorities if not already set.
 */
export function seedDefaultPriorities(db: Database.Database): void {
  const row = db.prepare(
    `SELECT value FROM ${T.settings} WHERE key = 'priorities'`
  ).get() as { value: string } | undefined

  if (!row) {
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
