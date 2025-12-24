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
  filePath?: string
  specId?: string  // Link to the spec that describes this epic (1 Spec → Many Epics)
  createdAt: Date
  updatedAt: Date
}

/**
 * Ticket lifecycle status (independent of board column position)
 */
export type TicketStatus =
  | 'backlog'    // Not started
  | 'ready'      // Ready to start
  | 'in_progress' // Being worked on
  | 'blocked'    // Can't proceed
  | 'review'     // Needs review
  | 'done'       // Completed
  | 'cancelled'  // Won't do

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

  // Workflow state
  status: TicketStatus
  owner?: string      // Human responsible for ticket
  assignee?: string   // Who's executing (human or agent)

  // Relationships
  specId?: string     // Which spec defined this ticket
  epicId?: string     // Which epic this ticket belongs to
  subtasks: Subtask[]
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

  // DEPRECATED: Board view fields (populated when querying with board context)
  // These are maintained for backward compatibility during refactor
  // Use BoardTicket table for authoritative board position
  column?: string     // Column name (from board view)
  position?: number   // Position in column (from board view)
  specs?: string[]    // Spec paths (backward compat - use specId instead)
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
 * Ticket dependency for scheduling.
 * Represents a "blocked by" relationship between tickets.
 */
export interface TicketDependency {
  ticketId: string
  blockedByTicketId: string
  createdAt?: Date
}

/**
 * Spec type - determines directory location and format
 */
export type SpecType = 'domain' | 'infrastructure'

/**
 * Common modalities - these are suggestions, not constraints.
 * The normalized schema allows any string as a modality.
 */
export type CommonModality =
  | 'storage'    // Direct database operations (MVP)
  | 'cli'        // Command-line interface
  | 'api'        // REST/GraphQL endpoints
  | 'sdk'        // Programmatic SDK
  | 'web'        // Web application
  | 'mobile'     // Mobile application
  | 'desktop'    // Desktop application
  | 'obsidian'   // Obsidian plugin
  | 'slack'      // Slack integration
  | 'sms'        // SMS interface

/**
 * @deprecated Use CommonModality instead - modalities are now flexible strings
 */
export type Modality = CommonModality

export const COMMON_MODALITIES: readonly CommonModality[] = [
  'storage', 'cli', 'api', 'sdk', 'web', 'mobile', 'desktop', 'obsidian', 'slack', 'sms'
] as const

/**
 * @deprecated Use COMMON_MODALITIES instead
 */
export const MODALITIES = COMMON_MODALITIES

export interface Spec {
  id: string
  path: string
  title?: string
  overview?: string
  status: 'draft' | 'active' | 'deprecated'
  specType: SpecType           // domain or infrastructure
  domain?: string              // e.g., 'tickets', 'epics', 'agents'
  createdAt: Date
  updatedAt: Date
  // Content (populated when fetching full spec)
  abilities?: SpecAbility[]
  fields?: SpecField[]
  rules?: SpecRule[]
  relatedDomains?: SpecRelation[]
}

/**
 * An ability defined in a spec (row in abilities table)
 * Normalized: implementations are stored in separate SpecImplementation records
 */
export interface SpecAbility {
  id?: number
  specId: string
  name: string
  description?: string
  position: number
  // Populated from joins when fetching full spec
  implementations?: SpecImplementation[]
}

/**
 * An implementation of an ability for a specific modality
 * Normalized from the old *_impl columns into rows
 */
export interface SpecImplementation {
  id?: number
  abilityId: number
  modality: string  // Flexible - not constrained to predefined modalities
  signature: string // The implementation signature (e.g., `createTicket()`, `prlt ticket create`)
}

/**
 * A field in the data model
 */
export interface SpecField {
  id?: number
  specId: string
  name: string
  fieldType: 'string' | 'number' | 'boolean' | 'timestamp' | 'enum' | 'ref' | 'json'
  required: 'required' | 'auto' | 'optional'
  defaultValue?: string
  description?: string
  position: number
}

/**
 * A business rule
 */
export interface SpecRule {
  id?: number
  specId: string
  name: string
  description: string
  position: number
}

/**
 * A relationship to another domain
 */
export interface SpecRelation {
  id?: number
  specId: string
  relatedDomain: string
  relationship?: string
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
  status?: TicketStatus
  priority?: string
  category?: string
  owner?: string
  assignee?: string
  search?: string
  spec?: string
  epic?: string
  column?: string
}

export interface SpecFilter {
  status?: 'draft' | 'active' | 'deprecated'
  specType?: SpecType
  domain?: string
  search?: string
}

export interface EpicFilter {
  status?: EpicStatus
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

export type PMOErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'INVALID' | 'SYNC_FAILED'

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
  init(config: BoardConfig): Promise<Board>
  getBoard(): Promise<Board>
  getBoardMarkdown(): Promise<string>

  // Column Operations
  createColumn(name: string, position?: number): Promise<Column>
  renameColumn(id: string, name: string): Promise<Column>
  moveColumn(id: string, position: number): Promise<Column>
  deleteColumn(id: string, cascade?: boolean): Promise<void>

  // Ticket Operations
  createTicket(ticket: Partial<Ticket>): Promise<Ticket>
  getTicket(id: string): Promise<Ticket | null>
  updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket>
  moveTicket(id: string, column: string, position?: number): Promise<Ticket>
  deleteTicket(id: string): Promise<void>
  listTickets(filter?: TicketFilter): Promise<Ticket[]>

  // Subtask Operations
  addSubtask(ticketId: string, title: string): Promise<Subtask>
  toggleSubtask(ticketId: string, subtaskId: string): Promise<Subtask>
  removeSubtask(ticketId: string, subtaskId: string): Promise<void>

  // Spec Operations
  createSpec(spec: Partial<Spec>): Promise<Spec>
  getSpec(id: string): Promise<Spec | null>
  listSpecs(filter?: SpecFilter): Promise<Spec[]>
  updateSpec(id: string, changes: Partial<Spec>): Promise<Spec>
  linkTicketToSpec(ticketId: string, specId: string): Promise<void>
  unlinkTicketFromSpec(ticketId: string, specId: string): Promise<void>
  getTicketsForSpec(specId: string): Promise<Ticket[]>
  getSpecsForTicket(ticketId: string): Promise<Spec[]>

  // Epic Operations
  createEpic(epic: Partial<Epic>): Promise<Epic>
  getEpic(id: string): Promise<Epic | null>
  listEpics(filter?: EpicFilter): Promise<Epic[]>
  updateEpic(id: string, changes: Partial<Epic>): Promise<Epic>
  deleteEpic(id: string): Promise<void>
  getTicketsForEpic(epicId: string): Promise<Ticket[]>
  linkTicketToEpic(ticketId: string, epicId: string): Promise<void>
  unlinkTicketFromEpic(ticketId: string): Promise<void>

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

export type CreateTicketInput = Omit<Partial<Ticket>, 'createdAt' | 'updatedAt'>
export type UpdateTicketInput = Omit<Partial<Ticket>, 'id' | 'createdAt' | 'updatedAt'>
