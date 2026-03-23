/**
 * Migration 0009 — Create media_items table
 *
 * Stores video/audio files with preprocessed asset metadata.
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const createMediaItems: Migration = {
  id: '0009',
  name: 'create_media_items',
  up: (db: SqliteDatabase) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS media_items (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source_path TEXT,
        media_type TEXT NOT NULL DEFAULT 'video' CHECK (media_type IN ('video', 'audio')),
        duration_seconds REAL,
        resolution TEXT,
        frame_count INTEGER NOT NULL DEFAULT 0,
        has_transcript INTEGER NOT NULL DEFAULT 0,
        frame_interval INTEGER NOT NULL DEFAULT 30,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'error')),
        error_message TEXT,
        added_at TEXT NOT NULL,
        processed_at TEXT
      )
    `)
  },
}
