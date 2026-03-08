/**
 * AgentRunner Interface
 *
 * Defines the pluggable runner contract for agent orchestration.
 * Runners implement this interface to support different agent runtimes
 * (Claude Code, Codex, Pi, etc.) through a common API.
 */

// =============================================================================
// Spawn Configuration
// =============================================================================

/**
 * Configuration for spawning a new agent session.
 */
export interface SpawnConfig {
  /** Task description or ticket context (the prompt) */
  task: string
  /** Git repo / working directory for the agent */
  workdir: string
  /** Override runner name (defaults to the runner's own name) */
  runner?: string
  /** Run detached (background mode) */
  background?: boolean
  /** Auto-create PR when work is done */
  createPR?: boolean
}

// =============================================================================
// Agent Session
// =============================================================================

/**
 * Represents a running or completed agent session.
 */
export interface AgentSession {
  /** Unique session identifier */
  id: string
  /** Runner that owns this session (e.g. 'claude-code', 'codex') */
  runner: string
  /** tmux session name */
  sessionName: string
  /** Task description the agent is working on */
  task: string
  /** Working directory */
  workdir: string
  /** When the session was started */
  startedAt: Date
  /** Current session status */
  status: 'running' | 'done' | 'error'
}

// =============================================================================
// AgentRunner Interface
// =============================================================================

/**
 * Pluggable agent runner interface.
 *
 * Each runner wraps a specific agent runtime (Claude Code, Codex, Pi, etc.)
 * and exposes a uniform API for spawning, monitoring, and controlling sessions.
 *
 * Runners are responsible for:
 * - Spawning agent processes (typically via tmux for session persistence)
 * - Reporting session status
 * - Providing output capture (peek)
 * - Sending follow-up messages (poke)
 * - Gracefully stopping sessions
 */
export interface AgentRunner {
  /** Runner identifier (e.g. 'claude-code', 'codex', 'pi') */
  readonly name: string

  /**
   * Spawn a new agent session.
   *
   * Creates a tmux session running the agent with the given config.
   * Returns an AgentSession representing the running agent.
   */
  spawn(config: SpawnConfig): Promise<AgentSession>

  /**
   * Get the current status of a session.
   *
   * Checks whether the agent process is still running inside its tmux session.
   */
  getStatus(session: AgentSession): Promise<'running' | 'done' | 'error'>

  /**
   * Capture recent output from the agent's tmux pane.
   *
   * @param session - The agent session to peek at
   * @param lines - Number of scrollback lines to capture (default: 50)
   * @returns The captured terminal output
   */
  peek(session: AgentSession, lines?: number): Promise<string>

  /**
   * Send a follow-up message to a running agent session.
   *
   * Sends keystrokes to the agent's tmux pane, allowing you to
   * inject additional instructions or respond to prompts.
   */
  poke(session: AgentSession, message: string): Promise<void>

  /**
   * Stop a running agent session.
   *
   * Sends SIGTERM to the agent process and kills the tmux session.
   */
  stop(session: AgentSession): Promise<void>
}
