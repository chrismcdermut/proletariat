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
import { execSync } from 'node:child_process'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpToolContext } from '../types.js'
import { errorResponse, strictTool, successResponse } from '../helpers.js'

/**
 * Execute a tmux command and return output.
 */
function runTmux(args: string, timeoutMs = 10_000): string {
  return execSync(`tmux ${args}`, {
    encoding: 'utf-8',
    timeout: timeoutMs,
    env: { ...process.env, TERM: process.env.TERM || 'xterm-256color' },
  }).trim()
}

/**
 * Check if a tmux session exists.
 */
function sessionExists(sessionName: string): boolean {
  try {
    runTmux(`has-session -t ${JSON.stringify(sessionName)}`)
    return true
  } catch {
    return false
  }
}

export function registerTmuxTools(server: McpServer, _ctx: McpToolContext): void {
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
        if (!sessionExists(params.session)) {
          return errorResponse(new Error(`Tmux session not found: ${params.session}`))
        }

        const literalFlag = params.literal ? ' -l' : ''
        runTmux(`send-keys -t ${JSON.stringify(params.session)}${literalFlag} ${JSON.stringify(params.keys)}`)

        // Wait for UI to render
        const delay = params.delay_ms ?? 100
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
        if (!sessionExists(params.session)) {
          return errorResponse(new Error(`Tmux session not found: ${params.session}`))
        }

        const escFlag = params.escape_sequences ? ' -e' : ''
        const startFlag = params.start_line !== undefined ? ` -S ${params.start_line}` : ''
        const endFlag = params.end_line !== undefined ? ` -E ${params.end_line}` : ''

        const content = runTmux(
          `capture-pane -t ${JSON.stringify(params.session)} -p${escFlag}${startFlag}${endFlag}`
        )

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
        if (sessionExists(params.session)) {
          return errorResponse(new Error(`Tmux session already exists: ${params.session}`))
        }

        const width = params.width ?? 120
        const height = params.height ?? 40
        const cmdPart = params.command ? ` ${JSON.stringify(params.command)}` : ''

        runTmux(
          `new-session -d -s ${JSON.stringify(params.session)} -x ${width} -y ${height}${cmdPart}`
        )

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
          output = runTmux('list-sessions -F "#{session_name}|#{session_width}|#{session_height}|#{session_windows}|#{session_created}"')
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
        if (!sessionExists(params.session)) {
          return errorResponse(new Error(`Tmux session not found: ${params.session}`))
        }

        runTmux(`kill-session -t ${JSON.stringify(params.session)}`)

        return successResponse({
          killed: params.session,
          message: `Session "${params.session}" terminated`,
        })
      } catch (error) {
        return errorResponse(error)
      }
    }
  )
}
