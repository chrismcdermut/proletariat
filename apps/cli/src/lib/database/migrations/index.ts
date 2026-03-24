/**
 * Migration registry.
 *
 * All migrations must be imported here and added to ALL_MIGRATIONS
 * in chronological order. The migrator applies them in array order.
 */

import type { Migration } from '../migrator.js'
import { baseline } from './0001_baseline.js'
import { workHooks } from './0002_work_hooks.js'
import { actionsRedesign } from './0003_actions_redesign.js'
import { workflowRules } from './0004_workflow_rules.js'
import { providerStatusMapping } from './0005_provider_status_mapping.js'
import { dropThemeNamesUsed } from './0006_drop_theme_names_used.js'
import { addWorktreeColumns } from './0007_add_worktree_columns.js'
import { addAgentMountMode } from './0008_add_agent_mount_mode.js'
import { createMediaItems } from './0009_create_media_items.js'
import { addTicketPosition } from './0010_add_ticket_position.js'
import { addReviewGate } from './0011_add_review_gate.js'
import { addActionNetworkAllowlist } from './0012_add_action_network_allowlist.js'
import { agentLifecycleStates } from './0013_agent_lifecycle_states.js'
import { agentWorkLifecycle } from './0014_agent_work_lifecycle.js'
import { orchestrateHooks } from './0015_orchestrate_hooks.js'
import { schemaCatchup } from './0016_schema_catchup.js'

/**
 * Ordered list of all migrations.
 * New migrations should be appended to the end of this array.
 */
export const ALL_MIGRATIONS: Migration[] = [
  baseline,
  workHooks,
  actionsRedesign,
  workflowRules,
  providerStatusMapping,
  dropThemeNamesUsed,
  addWorktreeColumns,
  addAgentMountMode,
  createMediaItems,
  addTicketPosition,
  addReviewGate,
  addActionNetworkAllowlist,
  agentLifecycleStates,
  agentWorkLifecycle,
  orchestrateHooks,
  schemaCatchup,
]
