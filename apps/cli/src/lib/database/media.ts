/**
 * Media Item Database Operations
 *
 * CRUD operations for video/audio media items.
 */

import { eq, asc } from 'drizzle-orm'
import {
  mediaItems as mediaItemsTable,
} from './drizzle-schema.js'
import { withDrizzle } from './workspace.js'

export interface MediaItem {
  name: string
  path: string
  source_path: string | null
  media_type: 'video' | 'audio'
  duration_seconds: number | null
  resolution: string | null
  frame_count: number
  has_transcript: boolean
  frame_interval: number
  status: 'pending' | 'processing' | 'ready' | 'error'
  error_message: string | null
  added_at: string
  processed_at: string | null
}

function toMediaItem(row: {
  name: string
  path: string
  sourcePath: string | null
  mediaType: string
  durationSeconds: number | null
  resolution: string | null
  frameCount: number
  hasTranscript: boolean | null
  frameInterval: number
  status: string
  errorMessage: string | null
  addedAt: string
  processedAt: string | null
}): MediaItem {
  return {
    name: row.name,
    path: row.path,
    source_path: row.sourcePath,
    media_type: row.mediaType as 'video' | 'audio',
    duration_seconds: row.durationSeconds,
    resolution: row.resolution,
    frame_count: row.frameCount,
    has_transcript: Boolean(row.hasTranscript),
    frame_interval: row.frameInterval,
    status: row.status as MediaItem['status'],
    error_message: row.errorMessage,
    added_at: row.addedAt,
    processed_at: row.processedAt,
  }
}

/**
 * Add a media item to the database
 */
export function addMediaItemToDatabase(
  workspacePath: string,
  item: { name: string; path: string; source_path?: string; media_type: 'video' | 'audio'; frame_interval?: number }
): void {
  withDrizzle(workspacePath, (ddb) => {
    const now = new Date().toISOString()
    ddb.insert(mediaItemsTable)
      .values({
        name: item.name,
        path: item.path,
        sourcePath: item.source_path || null,
        mediaType: item.media_type,
        frameInterval: item.frame_interval || 30,
        addedAt: now,
      })
      .onConflictDoUpdate({
        target: mediaItemsTable.name,
        set: {
          path: item.path,
          sourcePath: item.source_path || null,
          mediaType: item.media_type,
          frameInterval: item.frame_interval || 30,
          addedAt: now,
        },
      })
      .run()
  })
}

/**
 * Update media item after preprocessing
 */
export function updateMediaItemStatus(
  workspacePath: string,
  name: string,
  updates: {
    status: 'pending' | 'processing' | 'ready' | 'error'
    duration_seconds?: number
    resolution?: string
    frame_count?: number
    has_transcript?: boolean
    error_message?: string
  }
): void {
  withDrizzle(workspacePath, (ddb) => {
    const setValues: Record<string, unknown> = { status: updates.status }

    if (updates.duration_seconds !== undefined) {
      setValues.durationSeconds = updates.duration_seconds
    }
    if (updates.resolution !== undefined) {
      setValues.resolution = updates.resolution
    }
    if (updates.frame_count !== undefined) {
      setValues.frameCount = updates.frame_count
    }
    if (updates.has_transcript !== undefined) {
      setValues.hasTranscript = updates.has_transcript
    }
    if (updates.error_message !== undefined) {
      setValues.errorMessage = updates.error_message
    }
    if (updates.status === 'ready' || updates.status === 'error') {
      setValues.processedAt = new Date().toISOString()
    }

    ddb.update(mediaItemsTable)
      .set(setValues)
      .where(eq(mediaItemsTable.name, name))
      .run()
  })
}

/**
 * Get all media items in workspace
 */
export function getWorkspaceMediaItems(workspacePath: string): MediaItem[] {
  return withDrizzle(workspacePath, (ddb) => {
    const rows = ddb.select().from(mediaItemsTable)
      .orderBy(asc(mediaItemsTable.addedAt))
      .all()
    return rows.map(toMediaItem)
  })
}

/**
 * Get a single media item by name
 */
export function getMediaItem(workspacePath: string, name: string): MediaItem | null {
  return withDrizzle(workspacePath, (ddb) => {
    const row = ddb.select().from(mediaItemsTable)
      .where(eq(mediaItemsTable.name, name))
      .get()
    if (!row) return null
    return toMediaItem(row)
  })
}

/**
 * Remove a media item from the database
 */
export function removeMediaItemFromDatabase(workspacePath: string, name: string): void {
  withDrizzle(workspacePath, (ddb) => {
    ddb.delete(mediaItemsTable)
      .where(eq(mediaItemsTable.name, name))
      .run()
  })
}
