/**
 * PMO Markdown Parser and Generator
 *
 * Handles conversion between Obsidian Kanban markdown format and Board objects.
 */

import { Board, Column, Ticket } from './types.js'
import { slugify } from './utils.js'

// =============================================================================
// Parser
// =============================================================================

/**
 * Parse an Obsidian Kanban markdown board into a Board object
 * @param markdown The markdown content
 * @param projectId The project ID to use (defaults to 'default')
 */
export function parseBoard(markdown: string, projectId: string = 'default'): Board {
  const lines = markdown.split('\n')
  const board: Board = {
    id: projectId,
    name: 'Board',
    columns: [],
    updatedAt: new Date(),
  }

  let currentColumn: Column | null = null
  let currentTicket: Ticket | null = null
  let inDescription = false
  let descriptionLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Board title: # Title (optional)
    if (line.startsWith('# ')) {
      board.name = line.slice(2).trim()
      continue
    }

    // Column header: ## Column Name (with optional emoji)
    if (line.startsWith('## ')) {
      // Save previous ticket's description
      if (currentTicket && descriptionLines.length > 0) {
        currentTicket.description = descriptionLines.join('\n').trim()
        descriptionLines = []
      }

      // Remove emoji prefix if present (e.g., "📥 Backlog" -> "Backlog")
      let columnName = line.slice(3).trim()
      const emojiMatch = columnName.match(/^[\p{Emoji}\s]+/u)
      if (emojiMatch) {
        columnName = columnName.slice(emojiMatch[0].length).trim()
      }

      currentColumn = {
        id: slugify(columnName),
        name: columnName,
        position: board.columns.length,
        tickets: [],
      }
      board.columns.push(currentColumn)
      currentTicket = null
      inDescription = false
      continue
    }

    // Ticket: - [ ] **ID** [[ID]] Title or - [ ] Title
    // Note: ID pattern is case-insensitive to handle both TKT-054 and tkt-054
    const ticketMatch = line.match(/^- \[[ x]\] (?:\*\*([a-zA-Z0-9-]+)\*\* \[\[\1\]\] )?(.+)$/i)
    if (ticketMatch && currentColumn) {
      // Save previous ticket's description
      if (currentTicket && descriptionLines.length > 0) {
        currentTicket.description = descriptionLines.join('\n').trim()
        descriptionLines = []
      }

      const id = ticketMatch[1] || slugify(ticketMatch[2])
      const title = ticketMatch[2]

      currentTicket = {
        id,
        title: title.trim(),
        statusId: '',  // Will be resolved when syncing to DB
        statusCategory: 'backlog', // Default status category when parsing from board
        column: currentColumn.name,
        position: currentColumn.tickets.length,
        subtasks: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      currentColumn.tickets.push(currentTicket)
      inDescription = false
      continue
    }

    // Metadata: **Key:** Value (indented)
    const metaMatch = line.match(/^\s+\*\*(.+?):\*\*\s*(.*)$/)
    if (metaMatch && currentTicket) {
      const [, key, value] = metaMatch
      const trimmedValue = value.trim()

      switch (key) {
        case 'Priority':
          currentTicket.priority = trimmedValue
          break
        case 'Category':
          currentTicket.category = trimmedValue
          break
        case 'Spec': {
          // Parse spec: [[spec-id]] (single spec per ticket)
          const specMatch = trimmedValue.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/)
          if (specMatch) {
            currentTicket.specId = specMatch[1]
          }
          break
        }
        default:
          currentTicket.metadata[key] = trimmedValue
      }
      continue
    }

    // Separator: *** (marks start of description/subtasks)
    if (line.trim() === '***' && currentTicket) {
      inDescription = true
      continue
    }

    // Subtask: - [ ] or - [x] (indented under ticket)
    const subtaskMatch = line.match(/^\s+- \[([ x])\] (.+)$/)
    if (subtaskMatch && currentTicket) {
      currentTicket.subtasks.push({
        id: slugify(subtaskMatch[2]),
        title: subtaskMatch[2].trim(),
        done: subtaskMatch[1] === 'x',
      })
      continue
    }

    // Description text (after *** separator, indented)
    if (inDescription && currentTicket) {
      const trimmedLine = line.replace(/^\s{6}/, '') // Remove 6-space indent
      if (trimmedLine || descriptionLines.length > 0) {
        descriptionLines.push(trimmedLine)
      }
    }
  }

  // Save last ticket's description
  if (currentTicket && descriptionLines.length > 0) {
    currentTicket.description = descriptionLines.join('\n').trim()
  }

  return board
}

// =============================================================================
// Generator
// =============================================================================

/**
 * Generate Obsidian Kanban markdown from a Board object
 */
export function generateBoardMarkdown(board: Board): string {
  const lines: string[] = []

  // Frontmatter for Obsidian Kanban plugin
  lines.push('---')
  lines.push('kanban-plugin: basic')
  lines.push('---')
  lines.push('')

  // Board title
  lines.push(`# ${board.name}`)
  lines.push('')

  for (const column of board.columns) {
    // Column header
    lines.push(`## ${column.name}`)
    lines.push('')

    for (const ticket of column.tickets) {
      // Ticket header with bold ID, wikilink, and title
      lines.push(`- [ ] **${ticket.id}** [[${ticket.id}]] ${ticket.title}`)

      // Metadata
      if (ticket.priority) {
        lines.push(`      **Priority:** ${ticket.priority}`)
      }
      if (ticket.category) {
        lines.push(`      **Category:** ${ticket.category}`)
      }
      if (ticket.specId) {
        lines.push(`      **Spec:** [[${ticket.specId}]]`)
      }
      for (const [key, value] of Object.entries(ticket.metadata)) {
        lines.push(`      **${key}:** ${value}`)
      }

      // Separator and description/subtasks
      if (ticket.description || ticket.subtasks.length > 0) {
        lines.push(`      ***`)
      }

      if (ticket.description) {
        // Indent each line of description
        const descLines = ticket.description.split('\n')
        for (const descLine of descLines) {
          lines.push(`      ${descLine}`)
        }
      }

      // Subtasks
      for (const subtask of ticket.subtasks) {
        const checkbox = subtask.done ? '[x]' : '[ ]'
        lines.push(`      - ${checkbox} ${subtask.title}`)
      }

      lines.push('')
    }
  }

  return lines.join('\n')
}

// =============================================================================
// Diff/Merge Utilities
// =============================================================================

/**
 * Find tickets that exist in newBoard but not in oldBoard
 */
export function findAddedTickets(oldBoard: Board, newBoard: Board): Ticket[] {
  const oldIds = new Set(oldBoard.columns.flatMap((c) => c.tickets.map((t) => t.id)))
  return newBoard.columns.flatMap((c) => c.tickets.filter((t) => !oldIds.has(t.id)))
}

/**
 * Find tickets that exist in oldBoard but not in newBoard
 */
export function findRemovedTickets(oldBoard: Board, newBoard: Board): Ticket[] {
  const newIds = new Set(newBoard.columns.flatMap((c) => c.tickets.map((t) => t.id)))
  return oldBoard.columns.flatMap((c) => c.tickets.filter((t) => !newIds.has(t.id)))
}

/**
 * Find tickets that changed between boards
 */
export function findModifiedTickets(
  oldBoard: Board,
  newBoard: Board
): Array<{ old: Ticket; new: Ticket }> {
  const oldTickets = new Map<string, Ticket>()
  oldBoard.columns.forEach((c) => c.tickets.forEach((t) => oldTickets.set(t.id, t)))

  const modified: Array<{ old: Ticket; new: Ticket }> = []

  for (const column of newBoard.columns) {
    for (const ticket of column.tickets) {
      const oldTicket = oldTickets.get(ticket.id)
      if (oldTicket && !ticketsEqual(oldTicket, ticket)) {
        modified.push({ old: oldTicket, new: ticket })
      }
    }
  }

  return modified
}

/**
 * Check if two tickets are equal (ignoring timestamps)
 */
function ticketsEqual(a: Ticket, b: Ticket): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.column === b.column &&
    a.position === b.position &&
    a.priority === b.priority &&
    a.category === b.category &&
    a.description === b.description &&
    a.specId === b.specId &&
    JSON.stringify(a.subtasks) === JSON.stringify(b.subtasks) &&
    JSON.stringify(a.metadata) === JSON.stringify(b.metadata)
  )
}
