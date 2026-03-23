/**
 * Theme Database Operations
 *
 * CRUD operations for agent naming themes.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { eq, and, or, isNull, sql, asc, desc } from 'drizzle-orm'
import {
  workspace as workspaceTable,
  agents as agentsTable,
  agentThemes as agentThemesTable,
  agentThemeNames as agentThemeNamesTable,
} from './drizzle-schema.js'
import { withDrizzle, getWorkspaceConfig } from './workspace.js'
import { getWorkspaceAgents } from './agents.js'

export interface AgentTheme {
  id: string
  name: string
  display_name: string
  description: string | null
  builtin: boolean
  created_at: string
}

export interface AgentThemeName {
  theme_id: string
  name: string
}

/**
 * Map a Drizzle theme row to the AgentTheme interface.
 */
function toAgentTheme(row: {
  id: string
  name: string
  displayName: string
  description: string | null
  builtin: boolean | null
  createdAt: string
}): AgentTheme {
  return {
    id: row.id,
    name: row.name,
    display_name: row.displayName,
    description: row.description,
    builtin: Boolean(row.builtin),
    created_at: row.createdAt,
  }
}

/**
 * Get the active theme for a workspace
 */
export function getActiveTheme(workspacePath: string): AgentTheme | null {
  const config = getWorkspaceConfig(workspacePath)

  if (config?.active_theme_id) {
    return getTheme(workspacePath, config.active_theme_id)
  }

  const agentList = getWorkspaceAgents(workspacePath)
  if (agentList.length === 0) {
    return null
  }

  const themedAgent = agentList.find(a => a.theme_id)
  if (themedAgent?.theme_id) {
    const theme = getTheme(workspacePath, themedAgent.theme_id)
    if (theme) {
      setActiveTheme(workspacePath, themedAgent.theme_id)
      return theme
    }
  }

  const themes = getThemes(workspacePath)
  for (const theme of themes) {
    const themeNames = getThemeNames(workspacePath, theme.id)
    const themeNameSet = new Set(themeNames.map(n => n.name.toLowerCase()))

    const matchingAgent = agentList.find(a => themeNameSet.has(a.name.toLowerCase()))
    if (matchingAgent) {
      setActiveTheme(workspacePath, theme.id)
      return theme
    }
  }

  return null
}

/**
 * Set the active theme for a workspace
 */
export function setActiveTheme(workspacePath: string, themeId: string | null): void {
  withDrizzle(workspacePath, (ddb) => {
    if (themeId) {
      const theme = ddb.select({ id: agentThemesTable.id })
        .from(agentThemesTable)
        .where(eq(agentThemesTable.id, themeId))
        .get()
      if (!theme) {
        throw new Error(`Theme "${themeId}" not found`)
      }
    }

    ddb.update(workspaceTable)
      .set({ activeThemeId: themeId })
      .where(eq(workspaceTable.id, 1))
      .run()
  })
}

/**
 * Get all themes
 */
export function getThemes(workspacePath: string): AgentTheme[] {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(agentThemesTable)
      .orderBy(desc(agentThemesTable.builtin), asc(agentThemesTable.name))
      .all()
    return rows.map(toAgentTheme)
  })
}

/**
 * Get a theme by ID
 */
export function getTheme(workspacePath: string, themeId: string): AgentTheme | null {
  return withDrizzle(workspacePath, (ddb) => {
    const row = ddb.select().from(agentThemesTable)
      .where(eq(agentThemesTable.id, themeId))
      .get()
    return row ? toAgentTheme(row) : null
  })
}

/**
 * Create a new theme
 */
export function createTheme(
  workspacePath: string,
  theme: { id: string; name: string; displayName: string; description?: string; builtin?: boolean }
): AgentTheme {
  return withDrizzle(workspacePath, (ddb) => {
    const now = new Date().toISOString()

    ddb.insert(agentThemesTable).values({
      id: theme.id,
      name: theme.name,
      displayName: theme.displayName,
      description: theme.description || null,
      builtin: theme.builtin || false,
      createdAt: now,
    }).run()

    const created = ddb.select().from(agentThemesTable)
      .where(eq(agentThemesTable.id, theme.id))
      .get()
    return toAgentTheme(created!)
  })
}

/**
 * Delete a theme (cannot delete builtin themes)
 */
export function deleteTheme(workspacePath: string, themeId: string): boolean {
  return withDrizzle(workspacePath, (ddb) => {
    const theme = ddb.select({ builtin: agentThemesTable.builtin })
      .from(agentThemesTable)
      .where(eq(agentThemesTable.id, themeId))
      .get()

    if (!theme) {
      return false
    }
    if (theme.builtin) {
      throw new Error('Cannot delete built-in themes')
    }

    ddb.delete(agentThemesTable)
      .where(eq(agentThemesTable.id, themeId))
      .run()
    return true
  })
}

/**
 * Get names for a theme
 */
export function getThemeNames(workspacePath: string, themeId: string): AgentThemeName[] {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(agentThemeNamesTable)
      .where(eq(agentThemeNamesTable.themeId, themeId))
      .orderBy(asc(agentThemeNamesTable.name))
      .all()
    return rows.map(row => ({
      theme_id: row.themeId,
      name: row.name,
    }))
  })
}

/**
 * Get available names for a theme.
 */
export function getAvailableThemeNames(workspacePath: string, themeId: string): string[] {
  return withDrizzle(workspacePath, (ddb) => {
    const names = ddb.select({ name: agentThemeNamesTable.name })
      .from(agentThemeNamesTable)
      .where(eq(agentThemeNamesTable.themeId, themeId))
      .orderBy(asc(agentThemeNamesTable.name))
      .all()

    const existingAgents = ddb.select({
      name: sql<string>`LOWER(${agentsTable.name})`,
      worktreePath: agentsTable.worktreePath,
    })
      .from(agentsTable)
      .where(and(
        eq(agentsTable.type, 'persistent'),
        or(
          eq(agentsTable.status, 'active'),
          isNull(agentsTable.status),
        ),
      ))
      .all()

    const inUseNames = new Set<string>()
    for (const agent of existingAgents) {
      if (agent.worktreePath) {
        const fullPath = path.join(workspacePath, agent.worktreePath)
        if (fs.existsSync(fullPath)) {
          inUseNames.add(agent.name)
        }
      } else {
        inUseNames.add(agent.name)
      }
    }

    return names
      .map(n => n.name)
      .filter(name => !inUseNames.has(name.toLowerCase()))
  })
}

/**
 * Add names to a theme (case-insensitive uniqueness)
 */
export function addThemeNames(workspacePath: string, themeId: string, names: string[]): void {
  withDrizzle(workspacePath, (ddb, sqliteDb) => {
    const transaction = sqliteDb.transaction(() => {
      for (const name of names) {
        const existing = ddb.select({ name: agentThemeNamesTable.name })
          .from(agentThemeNamesTable)
          .where(and(
            eq(agentThemeNamesTable.themeId, themeId),
            sql`LOWER(${agentThemeNamesTable.name}) = LOWER(${name})`,
          ))
          .get()
        if (existing) {
          continue
        }
        ddb.insert(agentThemeNamesTable).values({
          themeId,
          name,
        }).run()
      }
    })

    transaction()
  })
}
