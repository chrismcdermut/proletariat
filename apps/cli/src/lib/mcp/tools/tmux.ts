/**
 * MCP Tmux Tools
 *
 * Provides tmux interaction tools for AI agents to drive interactive CLI sessions.
 * Used by the explore-cli action to perform exploratory QA testing.
 *
 * Tools:
 * - tmux_send_keys: Send keystrokes to a tmux session
 * - tmux_capture_pane: Capture current terminal screen from a tmux session
 * - tmux_start_session: Start a new tmux session with an optional command
 * - tmux_list_sessions: List active tmux sessions
 * - tmux_kill_session: Kill a tmux session
 */

import { z } from 'zod'
import { execFileSync } from 'node:child_process'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool, successResponse, textResponse } from '../helpers.js'

const TMUX_ENV = { ...process.env, TERM: process.env.TERM || 'xterm-256color' }

/**
 * Execute a tmux command with args passed as an array (no shell interpretation).
 */
function runTmux(args: string[], timeoutMs = 10_000): string {
  return execFileSync('tmux', args, {
    encoding: 'utf-8',
    timeout: timeoutMs,
    env: TMUX_ENV,
  }).trim()
}

/** Validate session name — alphanumeric, hyphens, underscores, dots only. */
function validateSessionName(name: string): void {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    throw new Error(`Invalid session name: "${name}". Only alphanumeric, hyphens, underscores, and dots allowed.`)
  }
}

/**
 * Check if a tmux session exists.
 */
function sessionExists(sessionName: string): boolean {
  try {
    runTmux(['has-session', '-t', sessionName])
    return true
  } catch {
    return false
  }
}

export function registerTmuxTools(server: McpServer, ctx: McpToolContext): void {
  // ── tmux_send_keys ───────────────────────────────────────────────────
  strictTool(server,
    'tmux_send_keys',
    'Send keystrokes to a tmux session. Supports text input and special keys like Enter, Escape, Up, Down, Left, Right, C-c (Ctrl+C), Tab, BSpace, etc. Use this to interact with interactive CLI menus and prompts.',
    {
      session: z.string().describe('Tmux session name to send keys to'),
      keys: z.string().describe('Keys to send. Text is sent literally; special keys: Enter, Escape, Up, Down, Left, Right, C-c, C-d, Tab, BSpace, Space, Home, End, PPage, NPage'),
      literal: z.boolean().optional().describe('If true, send keys as literal text (disables special key lookup). Default false.'),
      delay_ms: z.number().optional().describe('Milliseconds to wait after sending keys before returning (default 100). Useful to let the UI render.'),
    },
    async (params) => {
      try {
        validateSessionName(params.session)
        if (!sessionExists(params.session)) {
          return errorResponse(new Error(`Tmux session not found: ${params.session}`))
        }

        const args = ['send-keys', '-t', params.session]
        if (params.literal) args.push('-l')
        args.push(params.keys)
        runTmux(args)

        // Wait for UI to render
        const delay = Math.min(params.delay_ms ?? 100, 30_000)
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }

        return successResponse({ sent: params.keys, session: params.session })
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // ── tmux_capture_pane ────────────────────────────────────────────────
  strictTool(server,
    'tmux_capture_pane',
    'Capture the current visible content of a tmux pane. Returns the terminal screen text, useful for reading CLI output, menu states, error messages, and interactive prompt displays.',
    {
      session: z.string().describe('Tmux session name to capture from'),
      start_line: z.number().optional().describe('Start line for capture (negative = scrollback). Default: beginning of visible pane.'),
      end_line: z.number().optional().describe('End line for capture. Default: end of visible pane.'),
      escape_sequences: z.boolean().optional().describe('If true, include ANSI escape sequences in output. Default false (plain text).'),
    },
    async (params) => {
      try {
        validateSessionName(params.session)
        if (!sessionExists(params.session)) {
          return errorResponse(new Error(`Tmux session not found: ${params.session}`))
        }

        const args = ['capture-pane', '-t', params.session, '-p']
        if (params.escape_sequences) args.push('-e')
        if (params.start_line !== undefined) args.push('-S', String(params.start_line))
        if (params.end_line !== undefined) args.push('-E', String(params.end_line))

        const content = runTmux(args)

        return successResponse({
          session: params.session,
          content,
          lines: content.split('\n').length,
        })
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // ── tmux_start_session ───────────────────────────────────────────────
  strictTool(server,
    'tmux_start_session',
    'Start a new tmux session, optionally running a command inside it. Use this to launch a CLI session for exploratory testing.',
    {
      session: z.string().describe('Name for the new tmux session'),
      command: z.string().optional().describe('Command to run in the session (e.g., "prlt" to launch the CLI)'),
      width: z.number().optional().describe('Terminal width in columns (default 120)'),
      height: z.number().optional().describe('Terminal height in rows (default 40)'),
    },
    async (params) => {
      try {
        validateSessionName(params.session)
        if (sessionExists(params.session)) {
          return errorResponse(new Error(`Tmux session already exists: ${params.session}`))
        }

        const width = params.width ?? 120
        const height = params.height ?? 40
        const args = ['new-session', '-d', '-s', params.session, '-x', String(width), '-y', String(height)]
        if (params.command) args.push(params.command)

        runTmux(args)

        // Give the session a moment to initialize
        await new Promise((resolve) => setTimeout(resolve, 500))

        return successResponse({
          session: params.session,
          width,
          height,
          command: params.command || '(default shell)',
        })
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // ── tmux_list_sessions ───────────────────────────────────────────────
  strictTool(server,
    'tmux_list_sessions',
    'List all active tmux sessions with their status and dimensions.',
    {},
    async () => {
      try {
        let output: string
        try {
          output = runTmux(['list-sessions', '-F', '#{session_name}|#{session_width}|#{session_height}|#{session_windows}|#{session_created}'])
        } catch {
          // No sessions running
          return successResponse({ sessions: [] })
        }

        const sessions = output.split('\n').filter(Boolean).map((line) => {
          const [name, width, height, windows, created] = line.split('|')
          return {
            name,
            width: parseInt(width, 10),
            height: parseInt(height, 10),
            windows: parseInt(windows, 10),
            created: new Date(parseInt(created, 10) * 1000).toISOString(),
          }
        })

        return successResponse({ sessions })
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // ── tmux_kill_session ────────────────────────────────────────────────
  strictTool(server,
    'tmux_kill_session',
    'Kill (terminate) a tmux session and all processes running in it.',
    {
      session: z.string().describe('Name of the tmux session to kill'),
    },
    async (params) => {
      try {
        validateSessionName(params.session)
        if (!sessionExists(params.session)) {
          return errorResponse(new Error(`Tmux session not found: ${params.session}`))
        }

        runTmux(['kill-session', '-t', params.session])

        return successResponse({
          killed: params.session,
          message: `Session "${params.session}" terminated`,
        })
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // ── session_inspect ────────────────────────────────────────────────
  strictTool(server,
    'session_inspect',
    'Comprehensive agent status inspection — returns git status, PR status, process liveness, output, and execution metadata in one call. Accepts agent name or ticket ID.',
    {
      target: z.string().describe('Agent name or ticket ID (e.g. altman, TKT-123)'),
      lines: z.number().optional().describe('Number of scrollback lines to capture (default 100)'),
    },
    async (params) => {
      try {
        const linesFlag = params.lines ? `--lines ${params.lines}` : ''
        const output = ctx.runCommand(`prlt session inspect ${params.target} ${linesFlag} --json`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // ── session_exec ──────────────────────────────────────────────────
  strictTool(server,
    'session_exec',
    'Run a shell command in an agent\'s worktree/container context. Returns structured stdout/stderr output.',
    {
      target: z.string().describe('Agent name or ticket ID'),
      command: z.string().describe('Shell command to execute in the agent\'s context'),
      timeout: z.number().optional().describe('Command timeout in seconds (default 30)'),
    },
    async (params) => {
      try {
        const timeoutFlag = params.timeout ? `--timeout ${params.timeout}` : ''
        const output = ctx.runCommand(`prlt session exec ${params.target} ${timeoutFlag} --json -- ${params.command}`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // ── session_restart ───────────────────────────────────────────────
  strictTool(server,
    'session_restart',
    'Gracefully restart a stuck agent — sends Ctrl-C, waits for exit, re-launches Claude Code.',
    {
      target: z.string().describe('Agent name or ticket ID'),
      fresh: z.boolean().optional().describe('Reset worktree to branch HEAD before restart'),
      resume: z.boolean().optional().describe('Continue from where it left off (--resume flag)'),
      timeout: z.number().optional().describe('Seconds to wait for clean exit (default 15)'),
    },
    async (params) => {
      try {
        const freshFlag = params.fresh ? '--fresh' : ''
        const resumeFlag = params.resume ? '--resume' : ''
        const timeoutFlag = params.timeout ? `--timeout ${params.timeout}` : ''
        const output = ctx.runCommand(`prlt session restart ${params.target} ${freshFlag} ${resumeFlag} ${timeoutFlag} --json`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // ── session_peek ──────────────────────────────────────────────────
  strictTool(server,
    'session_peek',
    'View agent tmux pane content without attaching. Supports full scrollback capture.',
    {
      target: z.string().describe('Agent name, ticket ID, or session ID'),
      lines: z.number().optional().describe('Number of scrollback lines (default 200)'),
      full: z.boolean().optional().describe('Capture entire scrollback buffer'),
    },
    async (params) => {
      try {
        const linesFlag = params.lines ? `--lines ${params.lines}` : ''
        const fullFlag = params.full ? '--full' : ''
        const output = ctx.runCommand(`prlt session peek ${params.target} ${linesFlag} ${fullFlag} --json`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )

  // ── session_poke ──────────────────────────────────────────────────
  strictTool(server,
    'session_poke',
    'Send a message to a running agent\'s Claude Code session. Supports waiting for response.',
    {
      target: z.string().describe('Agent name or ticket ID'),
      message: z.string().describe('Message to send to the agent'),
      wait: z.boolean().optional().describe('Wait for response after sending'),
      timeout: z.number().optional().describe('Timeout in seconds for wait mode (default 120)'),
    },
    async (params) => {
      try {
        const waitFlag = params.wait ? '--wait' : ''
        const timeoutFlag = params.timeout ? `--timeout ${params.timeout}` : ''
        // Escape double quotes in the message for shell safety
        const escapedMessage = params.message.replace(/"/g, '\\"')
        const output = ctx.runCommand(`prlt session poke ${params.target} "${escapedMessage}" ${waitFlag} ${timeoutFlag} --json`)
        return textResponse(output)
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
