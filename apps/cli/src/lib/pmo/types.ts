/**
 * PMO Interface Types
 *
 * Canonical interface for the Project Management Orchestration system.
 * All storage backends must implement the PMOStorage interface.
 *
 * Hierarchy:
 * - Initiative (optional) - OKR-level grouping
 * - Project - Discrete effort with its own board + specs
 * - Epic (optional) - Large body of work within a project
 * - Ticket - Individual work item
 * - Subtask - Smallest actionable piece
 */

// =============================================================================
// Core Data Types
// =============================================================================

export interface Initiative {
  id: string
  name: string
  objective?: string
  keyResults?: string[]
  createdAt: Date
  updatedAt: Date
}

export interface Project {
  id: string
  name: string
  template?: string
  description?: string
  status: ProjectStatus       // @deprecated - use phaseId instead
  phaseId?: string            // Reference to ProjectPhase
  workflowId?: string         // Reference to Workflow (shared workflow for board columns/statuses)
  isArchived: boolean         // Soft-delete flag (hidden from default views)
  targetDate?: Date           // Optional end date for time-bounded projects
  initiativeId?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Epic status lifecycle
 */
export type EpicStatus =
  | 'active'    // Currently working on
  | 'draft'     // Planning phase
  | 'complete'  // All work done
  | 'dropped'   // Cancelled/won't do
  | 'future'    // Backlog for later

/**
 * Epic represents a work container that groups related tickets
 * and tracks progress through lifecycle statuses.
 */
export interface Epic {
  id: string
  projectId: string
  title: string
  description?: string
  status: EpicStatus
  position: number  // Priority/rank ordering (lower = higher priority)
  filePath?: string
  specId?: string  // Link to the spec that describes this epic (1 Spec → Many Epics)
  createdAt: Date
  updatedAt: Date
}

/**
 * @deprecated TicketStatus enum removed. Use statusId reference to WorkflowStatus instead.
 * Kept as type alias for backward compatibility during transition.
 */
export type TicketStatus = string

// =============================================================================
// Priority Types
// =============================================================================

/**
 * Standardized priority values: P0 (critical) through P3 (low).
 */
export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

/**
 * Valid priority values as a const array for validation and CLI options.
 */
export const PRIORITIES: readonly Priority[] = ['P0', 'P1', 'P2', 'P3'] as const

/**
 * Priority display names for UI presentation.
 */
export const PRIORITY_LABELS: Record<Priority, string> = {
  P0: 'P0 - Critical',
  P1: 'P1 - High',
  P2: 'P2 - Medium',
  P3: 'P3 - Low',
}

/**
 * Legacy priority values for backwards compatibility.
 */
export type LegacyPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW'

/**
 * Mapping from legacy priority values to new P0-P3 format.
 */
export const LEGACY_PRIORITY_MAP: Record<LegacyPriority, Priority> = {
  URGENT: 'P0',
  HIGH: 'P1',
  MEDIUM: 'P2',
  LOW: 'P3',
}

/**
 * Ticket categories for classification.
 */
export const TICKET_CATEGORIES = [
  'feature',
  'bug',
  'refactor',
  'docs',
  'test',
  'chore',
  'performance',
  'ci',
  'build',
  'security',
  'database',
  'release',
] as const

export type TicketCategory = typeof TICKET_CATEGORIES[number]

/**
 * Check if a string is a valid Priority value.
 */
export function isValidPriority(value: string | undefined | null): value is Priority {
  if (!value) return false
  return (PRIORITIES as readonly string[]).includes(value)
}

/**
 * Check if a string is a legacy priority value.
 */
export function isLegacyPriority(value: string | undefined | null): value is LegacyPriority {
  if (!value) return false
  return value in LEGACY_PRIORITY_MAP
}

/**
 * Normalize a priority value to the new P0-P3 format.
 * Converts legacy values (URGENT/HIGH/MEDIUM/LOW) to P0-P3.
 * Returns undefined for invalid values.
 */
export function normalizePriority(value: string | undefined | null): Priority | undefined {
  if (!value) return undefined

  // Already in new format
  if (isValidPriority(value)) {
    return value
  }

  // Convert from legacy format
  if (isLegacyPriority(value)) {
    return LEGACY_PRIORITY_MAP[value]
  }

  // Unknown value
  return undefined
}

// =============================================================================
// Workflow Types (Two-Tier State/Status Model)
// =============================================================================

/**
 * Fixed state categories - the semantic buckets that statuses belong to.
 * These cannot be added, removed, or reordered.
 *
 * Order: triage < backlog < unstarted < started < completed < canceled
 */
export type StateCategory =
  | 'triage'      // Inbox - needs review before entering workflow
  | 'backlog'     // Not yet scheduled for work
  | 'unstarted'   // Scheduled but work hasn't begun
  | 'started'     // Work is actively in progress
  | 'completed'   // Work finished successfully
  | 'canceled'    // Work won't be done

/**
 * State category order for sorting columns/statuses
 */
export const STATE_CATEGORY_ORDER: readonly StateCategory[] = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
] as const

/**
 * Shared workflow definition.
 * Projects reference workflows via workflowId.
 * Updating a workflow affects all projects using it.
 */
export interface Workflow {
  id: string
  name: string              // Display name, unique
  description?: string      // Description of this workflow
  isBuiltin: boolean        // System-provided vs user-created
  createdAt: Date
  updatedAt: Date
}

/**
 * Status within a shared workflow.
 * Each status belongs to exactly one StateCategory.
 * Status names must be unique within a workflow.
 * These are the board columns - workflows define the columns for all projects using them.
 */
export interface WorkflowStatus {
  id: string
  workflowId: string        // Reference to parent Workflow
  name: string              // Display name, unique within workflow
  category: StateCategory   // Which category this belongs to
  position: number          // Order within workflow (0-indexed, defines column order)
  color?: string            // Hex color for UI
  description?: string      // Tooltip/help text
  isDefault?: boolean       // Default status for new tickets
  createdAt: Date
}

/**
 * @deprecated Legacy per-project status - use WorkflowStatus instead.
 * Kept for backward compatibility during migration.
 */
export interface LegacyWorkflowStatus {
  id: string
  projectId: string
  name: string
  category: StateCategory
  position: number
  color?: string
  description?: string
  isDefault?: boolean
  createdAt: Date
}

/**
 * Workflow template - a preset status configuration.
 * Templates are copied when applied, not referenced.
 */
export interface WorkflowTemplate {
  id: string
  name: string
  description?: string
  isBuiltin: boolean        // System-provided vs user-created
  statuses: WorkflowTemplateStatus[]
  createdAt: Date
}

/**
 * Status definition within a template (no projectId since templates are reusable)
 */
export interface WorkflowTemplateStatus {
  name: string
  category: StateCategory
  position: number
  color?: string
}

/**
 * Project lifecycle status (fixed, not customizable)
 * @deprecated Use phaseId reference to workspace's phase configuration instead.
 */
export type ProjectStatus =
  | 'draft'       // Planning phase, not yet active
  | 'active'      // Work is happening
  | 'completed'   // Project finished
  | 'archived'    // Legacy - now use isArchived flag instead

/**
 * Project lifecycle phase (workspace-scoped, customizable)
 * Each phase belongs to exactly one StateCategory.
 * Phase names must be unique within a workspace.
 */
export interface ProjectPhase {
  id: string
  name: string              // Display name, unique within workspace
  category: StateCategory   // Which category this belongs to
  position: number          // Order within category (0-indexed)
  color?: string            // Hex color for UI
  description?: string      // Tooltip/help text
  isDefault?: boolean       // Default phase for new projects
  createdAt: Date
}

/**
 * Phase template - a preset phase configuration.
 * Templates are copied when applied, not referenced.
 */
export interface PhaseTemplate {
  id: string
  name: string
  description?: string
  isBuiltin: boolean        // System-provided vs user-created
  phases: PhaseTemplatePhase[]
  createdAt: Date
}

/**
 * Phase definition within a template (reusable across workspaces)
 */
export interface PhaseTemplatePhase {
  name: string
  category: StateCategory
  position: number
  color?: string
  description?: string
  isDefault?: boolean
}

// =============================================================================
// Roadmap Types
// =============================================================================

/**
 * Roadmap - a curated collection of projects for documentation/visualization.
 * Roadmaps group projects in a specific order for generating roadmap documents.
 * Projects can appear in multiple roadmaps (e.g., "Public Roadmap" vs "Internal Roadmap").
 */
export interface Roadmap {
  id: string
  name: string
  description?: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * RoadmapProject - association between a roadmap and a project with ordering.
 * Projects can be in multiple roadmaps with different positions.
 */
export interface RoadmapProject {
  roadmapId: string
  projectId: string
  position: number
  createdAt: Date
}

// =============================================================================
// Work Action Types
// =============================================================================

/**
 * Work action - defines what an agent should do with a ticket.
 * Actions are reusable prompts that can be applied to any ticket.
 */
export interface WorkAction {
  id: string
  name: string
  description?: string
  prompt: string                              // The start prompt (instruction for what to do)
  endPrompt?: string                          // The end prompt (completion instructions)
  suggestedForCategories?: StateCategory[]    // When to suggest this action
  defaultMoveToCategory?: StateCategory       // Where to move ticket after
  modifiesCode: boolean                       // Whether this action modifies code (needs branch)
  isBuiltin: boolean
  createdAt: Date
}

/**
 * Board represents a project's kanban board view.
 * This is what gets rendered to board.md and displayed in the UI.
 */
export interface Board {
  id: string
  name: string
  columns: Column[]
  updatedAt: Date
}

/**
 * BoardView represents a saved, filtered view of a project's board.
 * Allows users to save common filter configurations like "My Tasks" or "High Priority".
 */
export interface BoardView {
  id: string
  projectId: string
  name: string                    // Display name (e.g., "My Tasks", "High Priority")
  description?: string            // Optional description of what this view shows
  isDefault?: boolean             // Whether this is the project's default view
  filters: BoardViewFilters       // Filter configuration
  groupBy?: BoardViewGroupBy      // Optional grouping
  sortBy?: BoardViewSortBy        // Optional sorting
  createdAt: Date
  updatedAt: Date
}

/**
 * Filter configuration for a board view.
 * All filters are optional - unset filters show all items.
 */
export interface BoardViewFilters {
  assignee?: string               // Filter by assignee (or "unassigned")
  owner?: string                  // Filter by owner
  priority?: string               // Filter by priority (HIGH, MEDIUM, LOW)
  statusCategory?: StateCategory  // Filter by status category
  statusId?: string               // Filter by specific status
  columnIds?: string[]            // Filter to specific columns
  epicId?: string                 // Filter to tickets in an epic
  search?: string                 // Text search in title/description
}

/**
 * Grouping options for board view
 */
export type BoardViewGroupBy =
  | 'assignee'    // Group by who's working on it
  | 'priority'    // Group by priority level
  | 'epic'        // Group by epic
  | 'status'      // Group by workflow status
  | 'category'    // Group by ticket category

/**
 * Sorting options for board view
 */
export type BoardViewSortBy =
  | 'priority'    // Sort by priority (HIGH first)
  | 'created'     // Sort by creation date
  | 'updated'     // Sort by last update
  | 'title'       // Sort alphabetically by title
  | 'assignee'    // Sort by assignee name

export interface Column {
  id: string
  name: string
  position: number
  status?: string  // Optional: semantic status mapping for this column
  tickets: Ticket[] // Populated when generating board view (join with BoardTicket)
}

/**
 * Ticket represents a work item (core entity - no board position here)
 */
export interface Ticket {
  // Core ticket data
  id: string
  title: string
  description?: string
  priority?: string
  category?: string
  projectId?: string    // Which project this ticket belongs to
  projectName?: string  // Resolved project name (for display in cross-project views)

  // Workflow state
  statusId: string            // Reference to WorkflowStatus in project's configuration
  statusName?: string         // Resolved status name (for display)
  statusCategory?: StateCategory  // Resolved status category
  /**
   * @deprecated Use statusCategory for logic, statusName for display
   * This is a temporary alias that maps old status values to categories
   */
  status?: TicketStatus
  owner?: string              // Human responsible for ticket
  assignee?: string           // Who's executing (human or agent)
  branch?: string             // Git branch for this ticket's work (reused across actions)

  // Relationships
  specId?: string     // Which spec defined this ticket
  epicId?: string     // Which epic this ticket belongs to
  subtasks: Subtask[]
  labels: string[]    // Tags/labels for categorization
  metadata: Record<string, string>

  // Agent execution support (populated from related tables)
  blockedBy?: string[]                    // Ticket IDs this depends on
  affectedPaths?: TicketAffectedPath[]    // File/path scope hints
  acceptanceCriteria?: AcceptanceCriterion[]  // Structured verifiable criteria

  // Timestamps
  createdAt: Date
  updatedAt: Date
  lastSyncedFromSpec?: Date   // When last synced from spec frontmatter
  lastSyncedFromBoard?: Date  // When last synced from board.md

  // Board position (populated when querying with board context)
  position?: number   // Position in column (from board view)
}

/**
 * BoardTicket represents where a ticket appears on the board (view state)
 */
export interface BoardTicket {
  projectId: string
  ticketId: string
  columnId: string
  position: number
}

export interface Subtask {
  id: string
  title: string
  done: boolean
}

/**
 * Input for creating a new ticket.
 * statusName is the status/column name to place the ticket in.
 */
export interface CreateTicketInput {
  id?: string
  title: string
  statusName?: string       // Status name to place ticket in (defaults to first backlog status)
  description?: string
  priority?: string
  category?: string
  statusId?: string
  owner?: string
  assignee?: string
  specId?: string
  epicId?: string
  labels?: string[]
  subtasks?: Subtask[]
  metadata?: Record<string, string>
  lastSyncedFromSpec?: Date
  lastSyncedFromBoard?: Date
}

// =============================================================================
// Ticket Template Types
// =============================================================================

/**
 * Subtask definition within a ticket template
 */
export interface TicketTemplateSubtask {
  title: string
}

/**
 * Ticket template - a reusable configuration for creating tickets.
 * Templates can be built-in (system-provided) or custom (user-created).
 */
export interface TicketTemplate {
  id: string
  name: string
  description?: string
  isBuiltin: boolean               // System-provided vs user-created
  titlePattern?: string            // Default title pattern (e.g., "[BUG] ")
  descriptionTemplate?: string     // Default description markdown
  defaultPriority?: string         // Default priority (URGENT, HIGH, MEDIUM, LOW)
  defaultCategory?: string         // Default category (bug, feature, etc.)
  defaultStatusId?: string         // Default workflow status
  defaultAssignee?: string         // Default assignee
  defaultOwner?: string            // Default owner
  defaultLabels: string[]          // Default labels
  suggestedSubtasks: TicketTemplateSubtask[]  // Subtasks to create with ticket
  createdAt: Date
}

/**
 * Filter options for listing ticket templates
 */
export interface TicketTemplateFilter {
  isBuiltin?: boolean
  search?: string
}

/**
 * Affected path hint for agent context scoping.
 * Tells agents which files/directories are relevant to a ticket.
 */
export interface TicketAffectedPath {
  id?: number
  ticketId: string
  pathPattern: string      // e.g., "src/lib/pmo/*.ts" or "specs/domain/tickets.md"
  pathType: 'file' | 'directory' | 'glob'  // Type of path pattern
  createdAt?: Date
}

/**
 * Structured acceptance criterion for verifiable completion.
 * Allows programmatic verification rather than markdown parsing.
 */
export interface AcceptanceCriterion {
  id: string
  ticketId: string
  criterion: string        // The acceptance criterion text
  verifiable: boolean      // Can this be auto-verified?
  verified: boolean        // Has it been verified?
  verifiedAt?: Date        // When was it verified?
  verifiedBy?: string      // Who/what verified it (e.g., 'agent:dorsey', 'human:chris', 'test:unit')
  position: number         // Display order
}

/**
 * Ticket dependency types for same-entity relationships
 */
export type TicketDependencyType = 'blocks' | 'relates_to' | 'duplicates'

/**
 * Ticket dependency for scheduling.
 * Represents a dependency relationship between tickets.
 */
export interface TicketDependency {
  ticketId: string
  dependsOnTicketId: string
  dependencyType: TicketDependencyType
  createdAt?: Date
}

/**
 * Spec dependency types
 */
export type SpecDependencyType = 'depends_on' | 'relates_to' | 'duplicates'

/**
 * Spec dependency for design ordering.
 */
export interface SpecDependency {
  specId: string
  dependsOnSpecId: string
  dependencyType: SpecDependencyType
  createdAt?: Date
}

/**
 * Epic dependency types
 */
export type EpicDependencyType = 'blocks' | 'relates_to' | 'duplicates'

/**
 * Epic dependency for phased work.
 */
export interface EpicDependency {
  epicId: string
  dependsOnEpicId: string
  dependencyType: EpicDependencyType
  createdAt?: Date
}

/**
 * Spec type - determines directory location and format
 */
export type SpecType = 'product' | 'platform' | 'infra' | 'integration'

/**
 * Spec status - lifecycle state
 */
export type SpecStatus = 'draft' | 'active' | 'implemented'

/**
 * Spec - a living document describing ideal state
 */
export interface Spec {
  id: string
  title: string
  status: SpecStatus
  type?: SpecType
  tags?: string[]                    // JSON array in DB
  dependsOn?: string[]               // JSON array of spec IDs
  problem?: string
  solution?: string
  decisions?: string
  notNow?: string
  uiUx?: string
  acceptanceCriteria?: string
  openQuestions?: string
  requirementsFunctional?: string
  requirementsTechnical?: string
  context?: string
  createdAt: Date
  updatedAt: Date
}

// =============================================================================
// Configuration Types
// =============================================================================

export interface BoardConfig {
  name?: string
  columns?: string[]
  mode?: 'in-repo' | 'separate-repo'
  repo?: string
  branch?: string
  path?: string
}

export interface SyncConfig {
  autoPull: boolean
  autoPush: boolean
  conflictStrategy: 'manual' | 'theirs' | 'ours'
}

export interface PMOConfig {
  version: number
  storage: {
    type: 'sqlite' | 'git' | 'cloud' | 'adapter'
    mode?: 'in-repo' | 'separate-repo'
    repo?: string
    branch?: string
    path?: string
    connection?: string
  }
  board: BoardConfig
  sync: SyncConfig
}

// =============================================================================
// Filter Types
// =============================================================================

export interface TicketFilter {
  statusId?: string           // Filter by status ID
  statusCategory?: StateCategory  // Filter by status category
  priority?: string
  category?: string
  owner?: string
  assignee?: string
  search?: string
  spec?: string
  epic?: string
  column?: string
  projectId?: string          // Filter to a specific project
  allProjects?: boolean       // If true, list tickets across all projects (ignores current project scope)
}

export interface SpecFilter {
  status?: SpecStatus
  type?: SpecType
  tags?: string[]
  search?: string
}

export interface EpicFilter {
  status?: EpicStatus
  search?: string
}

export interface StatusFilter {
  workflowId?: string         // Filter by workflow (new)
  projectId?: string          // @deprecated - use workflowId instead
  category?: StateCategory
  search?: string
}

export interface WorkflowFilter {
  isBuiltin?: boolean
  search?: string
}

export interface TemplateFilter {
  isBuiltin?: boolean
  search?: string
}

export interface PhaseFilter {
  category?: StateCategory
  search?: string
}

export interface PhaseTemplateFilter {
  isBuiltin?: boolean
  search?: string
}

export interface WorkActionFilter {
  isBuiltin?: boolean
  suggestedFor?: StateCategory    // Filter to actions suggested for this category
  search?: string
}

export interface ProjectFilter {
  phaseId?: string
  isArchived?: boolean
  search?: string
}

export interface BoardViewFilter {
  projectId?: string
  isDefault?: boolean
  search?: string
}

export interface RoadmapFilter {
  isDefault?: boolean
  search?: string
}

// =============================================================================
// Result Types
// =============================================================================

export interface SyncResult {
  success: boolean
  changes: number
  conflicts?: Conflict[]
}

export interface SyncStatus {
  ahead: number
  behind: number
  conflicts: boolean
}

export interface Conflict {
  type: string
  ticketId?: string
  description?: string
  message?: string
}

// =============================================================================
// Error Types
// =============================================================================

export type PMOErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'INVALID' | 'SYNC_FAILED' | 'NO_PROJECT'

export class PMOError extends Error {
  constructor(
    public code: PMOErrorCode,
    message: string,
    public ticketId?: string
  ) {
    super(message)
    this.name = 'PMOError'
  }
}

// =============================================================================
// Storage Interface
// =============================================================================

export interface PMOStorage {
  readonly type: 'sqlite' | 'git' | 'cloud' | 'adapter'

  // Board Operations
  init(projectId: string, config: BoardConfig): Promise<Board>
  getBoard(projectId: string): Promise<Board>
  getBoardMarkdown(projectId: string): Promise<string>

  // Column Operations
  getColumnNames(projectId: string): string[]
  createColumn(projectId: string, name: string, position?: number): Promise<Column>
  renameColumn(projectId: string, id: string, name: string): Promise<Column>
  moveColumn(projectId: string, id: string, position: number): Promise<Column>
  deleteColumn(projectId: string, id: string, cascade?: boolean): Promise<void>

  // Ticket Operations
  createTicket(projectId: string, ticket: CreateTicketInput): Promise<Ticket>
  getTicket(id: string): Promise<Ticket | null>
  updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket>
  moveTicket(projectId: string, id: string, column: string, position?: number): Promise<Ticket>
  moveTicketToProject(ticketId: string, newProjectId: string): Promise<Ticket>
  deleteTicket(id: string): Promise<void>
  listTickets(projectId: string | undefined, filter?: TicketFilter): Promise<Ticket[]>

  // Subtask Operations
  addSubtask(ticketId: string, title: string): Promise<Subtask>
  toggleSubtask(ticketId: string, subtaskId: string): Promise<Subtask>
  removeSubtask(ticketId: string, subtaskId: string): Promise<void>

  // Spec Operations
  createSpec(spec: Partial<Spec>): Promise<Spec>
  getSpec(id: string): Promise<Spec | null>
  listSpecs(filter?: SpecFilter): Promise<Spec[]>
  updateSpec(id: string, changes: Partial<Spec>): Promise<Spec>
  deleteSpec(id: string): Promise<void>
  linkTicketToSpec(ticketId: string, specId: string): Promise<void>
  unlinkTicketFromSpec(ticketId: string, specId: string): Promise<void>
  getTicketsForSpec(projectId: string, specId: string): Promise<Ticket[]>
  getSpecsForTicket(ticketId: string): Promise<Spec[]>
  addSpecDependency(specId: string, dependsOnId: string): Promise<void>
  removeSpecDependency(specId: string, dependsOnId: string): Promise<void>
  getSpecDependencies(specId: string): Promise<Spec[]>
  getSpecDependents(specId: string): Promise<Spec[]>
  // Project-Spec associations (many-to-many, specs are global)
  linkProjectToSpec(projectId: string, specId: string): Promise<void>
  unlinkProjectFromSpec(projectId: string, specId: string): Promise<void>
  getSpecsForProject(projectId: string): Promise<Spec[]>
  getProjectsForSpec(specId: string): Promise<Project[]>

  // Epic Operations
  createEpic(projectId: string, epic: Partial<Epic>): Promise<Epic>
  getEpic(id: string): Promise<Epic | null>
  listEpics(projectId: string, filter?: EpicFilter): Promise<Epic[]>
  reorderEpic(projectId: string, epicId: string, newPosition: number): Promise<Epic>
  updateEpic(id: string, changes: Partial<Epic>): Promise<Epic>
  deleteEpic(id: string): Promise<void>
  getTicketsForEpic(projectId: string, epicId: string): Promise<Ticket[]>
  linkTicketToEpic(ticketId: string, epicId: string): Promise<void>
  unlinkTicketFromEpic(ticketId: string): Promise<void>

  // Workflow Operations (shared workflow definitions)
  listWorkflows(filter?: WorkflowFilter): Promise<Workflow[]>
  getWorkflow(id: string): Promise<Workflow | null>
  createWorkflow(workflow: Partial<Workflow>): Promise<Workflow>
  updateWorkflow(id: string, changes: Partial<Workflow>): Promise<Workflow>
  deleteWorkflow(id: string): Promise<void>
  getProjectWorkflow(projectId: string): Promise<Workflow | null>

  // Workflow Status Operations (statuses within workflows = board columns)
  listStatuses(workflowId: string): Promise<WorkflowStatus[]>
  getStatus(id: string): Promise<WorkflowStatus | null>
  createStatus(workflowId: string, status: Partial<WorkflowStatus>): Promise<WorkflowStatus>
  updateStatus(id: string, changes: Partial<WorkflowStatus>): Promise<WorkflowStatus>
  deleteStatus(id: string): Promise<void>
  reorderStatus(id: string, newPosition: number): Promise<WorkflowStatus>
  getDefaultStatus(workflowId: string): Promise<WorkflowStatus | null>

  // Note: Workflow templates have been removed. Use workflow commands directly
  // (prlt workflow list, prlt workflow create, prlt workflow switch)

  // Ticket Template Operations
  listTicketTemplates(filter?: TicketTemplateFilter): Promise<TicketTemplate[]>
  getTicketTemplate(id: string): Promise<TicketTemplate | null>
  createTicketTemplate(template: Partial<TicketTemplate> & { name: string }): Promise<TicketTemplate>
  createTicketTemplateFromTicket(ticketId: string, name: string, description?: string): Promise<TicketTemplate>
  updateTicketTemplate(id: string, changes: Partial<TicketTemplate>): Promise<TicketTemplate>
  deleteTicketTemplate(id: string): Promise<void>

  // Project Phase Operations (workspace-scoped)
  listPhases(filter?: PhaseFilter): Promise<ProjectPhase[]>
  getPhase(id: string): Promise<ProjectPhase | null>
  createPhase(phase: Partial<ProjectPhase>): Promise<ProjectPhase>
  updatePhase(id: string, changes: Partial<ProjectPhase>): Promise<ProjectPhase>
  deletePhase(id: string): Promise<void>
  reorderPhase(id: string, newPosition: number): Promise<ProjectPhase>
  getDefaultPhase(): Promise<ProjectPhase | null>

  // Phase Template Operations
  listPhaseTemplates(filter?: PhaseTemplateFilter): Promise<PhaseTemplate[]>
  getPhaseTemplate(id: string): Promise<PhaseTemplate | null>
  applyPhaseTemplate(templateId: string): Promise<ProjectPhase[]>
  savePhaseTemplate(name: string, description?: string): Promise<PhaseTemplate>
  updatePhaseTemplate(id: string, changes: { name?: string; description?: string }): Promise<PhaseTemplate>
  deletePhaseTemplate(id: string): Promise<void>

  // Work Action Operations
  listActions(filter?: WorkActionFilter): Promise<WorkAction[]>
  getAction(id: string): Promise<WorkAction | null>
  createAction(action: Partial<WorkAction>): Promise<WorkAction>
  updateAction(id: string, changes: Partial<WorkAction>): Promise<WorkAction>
  deleteAction(id: string): Promise<void>
  getSuggestedAction(category: StateCategory): Promise<WorkAction | null>

  // Project Operations
  getProject(id: string): Promise<Project | null>
  createProject(project: Partial<Project> & { template?: string }): Promise<Board>
  updateProject(id: string, changes: Partial<Project>): Promise<Project>
  listProjects(filter?: ProjectFilter): Promise<Project[]>
  archiveProject(id: string): Promise<Project>
  unarchiveProject(id: string): Promise<Project>

  // Board View Operations
  listBoardViews(filter?: BoardViewFilter): Promise<BoardView[]>
  getBoardView(id: string): Promise<BoardView | null>
  createBoardView(view: Partial<BoardView>): Promise<BoardView>
  updateBoardView(id: string, changes: Partial<BoardView>): Promise<BoardView>
  deleteBoardView(id: string): Promise<void>
  getDefaultBoardView(projectId: string): Promise<BoardView | null>
  getBoardWithView(projectId: string, viewId?: string, filters?: BoardViewFilters): Promise<Board>

  // Roadmap Operations
  listRoadmaps(filter?: RoadmapFilter): Promise<Roadmap[]>
  getRoadmap(id: string): Promise<Roadmap | null>
  createRoadmap(roadmap: Partial<Roadmap> & { name: string }): Promise<Roadmap>
  updateRoadmap(id: string, changes: Partial<Roadmap>): Promise<Roadmap>
  deleteRoadmap(id: string): Promise<void>
  getDefaultRoadmap(): Promise<Roadmap | null>
  setDefaultRoadmap(id: string): Promise<Roadmap>

  // Roadmap Project Operations (managing projects within a roadmap)
  listRoadmapProjects(roadmapId: string): Promise<Project[]>
  addProjectToRoadmap(roadmapId: string, projectId: string, position?: number): Promise<RoadmapProject>
  removeProjectFromRoadmap(roadmapId: string, projectId: string): Promise<void>
  reorderRoadmapProject(roadmapId: string, projectId: string, newPosition: number): Promise<RoadmapProject>
  getRoadmapsForProject(projectId: string): Promise<Roadmap[]>

  // Sync Operations
  pull(): Promise<SyncResult>
  push(): Promise<SyncResult>
  status(): Promise<SyncStatus>

  // Lifecycle
  close(): Promise<void>
}

// =============================================================================
// Utility Types
// =============================================================================

export type UpdateTicketInput = Omit<Partial<Ticket>, 'id' | 'createdAt' | 'updatedAt'>
