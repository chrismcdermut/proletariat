/**
 * Repository Database Operations
 *
 * CRUD operations for repositories in the workspace database.
 */

import { asc } from 'drizzle-orm'
import {
  repositories as repositoriesTable,
} from './drizzle-schema.js'
import { withDrizzle } from './workspace.js'

export interface Repository {
  name: string
  path: string
  type: 'main' | 'dependency'
  source_url?: string
  action?: 'clone' | 'move' | 'link'
  added_at: string
}

/**
 * Add repositories to database
 */
export function addRepositoriesToDatabase(workspacePath: string, repos: { name: string; path: string; source_url?: string; action?: 'clone' | 'move' | 'link' }[]): void {
  withDrizzle(workspacePath, (ddb) => {
    for (const repo of repos) {
      ddb.insert(repositoriesTable)
        .values({
          name: repo.name,
          path: repo.path,
          type: 'main',
          sourceUrl: repo.source_url || null,
          action: repo.action || null,
          addedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: repositoriesTable.name,
          set: {
            path: repo.path,
            type: 'main',
            sourceUrl: repo.source_url || null,
            action: repo.action || null,
            addedAt: new Date().toISOString(),
          },
        })
        .run()
    }
  })
}

/**
 * Get all repositories in workspace
 */
export function getWorkspaceRepositories(workspacePath: string): Repository[] {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(repositoriesTable)
      .orderBy(asc(repositoriesTable.addedAt))
      .all()
    return rows.map(row => ({
      name: row.name,
      path: row.path,
      type: (row.type || 'main') as 'main' | 'dependency',
      source_url: row.sourceUrl ?? undefined,
      action: (row.action ?? undefined) as 'clone' | 'move' | 'link' | undefined,
      added_at: row.addedAt,
    }))
  })
}
