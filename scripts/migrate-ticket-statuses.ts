#!/usr/bin/env tsx
/**
 * Migration script to update ticket status_ids from old pmo_statuses to new pmo_workflow_statuses
 *
 * This completes the migration started in TKT-301 by:
 * 1. Mapping old project-specific status IDs to workflow status IDs
 * 2. Updating all tickets to reference workflow statuses
 * 3. Optionally dropping the old pmo_statuses table
 */

import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';

const WORKSPACE_DB = path.join(process.cwd(), '.proletariat', 'workspace.db');

interface OldStatus {
  id: string;
  project_id: string;
  name: string;
  category: string;
}

interface WorkflowStatus {
  id: string;
  workflow_id: string;
  name: string;
  category: string;
}

interface Project {
  id: string;
  workflow_id: string;
}

function migrateTicketStatuses(dryRun: boolean = true) {
  if (!fs.existsSync(WORKSPACE_DB)) {
    console.error(`Database not found: ${WORKSPACE_DB}`);
    process.exit(1);
  }

  const db = new Database(WORKSPACE_DB);

  try {
    console.log('Starting ticket status migration...\n');

    // Get all projects and their workflows
    const projects = db.prepare(`
      SELECT id, workflow_id FROM pmo_projects
    `).all() as Project[];

    console.log(`Found ${projects.length} projects\n`);

    // Get all old statuses
    const oldStatuses = db.prepare(`
      SELECT id, project_id, name, category FROM pmo_statuses
    `).all() as OldStatus[];

    console.log(`Found ${oldStatuses.length} old statuses\n`);

    // Build migration map: old_status_id -> new_workflow_status_id
    const migrationMap = new Map<string, string>();
    const orphanedStatuses: string[] = [];

    for (const oldStatus of oldStatuses) {
      const project = projects.find(p => p.id === oldStatus.project_id);

      if (!project) {
        console.log(`⚠️  Orphaned status: ${oldStatus.id} (project ${oldStatus.project_id} not found)`);
        orphanedStatuses.push(oldStatus.id);
        continue;
      }

      // Find matching workflow status by category and name
      const workflowStatus = db.prepare(`
        SELECT id, workflow_id, name, category
        FROM pmo_workflow_statuses
        WHERE workflow_id = ? AND category = ?
        LIMIT 1
      `).get(project.workflow_id, oldStatus.category) as WorkflowStatus | undefined;

      if (workflowStatus) {
        migrationMap.set(oldStatus.id, workflowStatus.id);
        console.log(`✓ ${oldStatus.id} (${oldStatus.category}) -> ${workflowStatus.id}`);
      } else {
        console.log(`⚠️  No workflow status found for ${oldStatus.id} (workflow: ${project.workflow_id}, category: ${oldStatus.category})`);
        orphanedStatuses.push(oldStatus.id);
      }
    }

    console.log(`\nMigration map created: ${migrationMap.size} mappings\n`);

    // Update tickets
    let totalUpdated = 0;

    if (dryRun) {
      console.log('DRY RUN MODE - No changes will be made\n');
    } else {
      db.prepare('BEGIN TRANSACTION').run();
    }

    for (const [oldStatusId, newStatusId] of migrationMap.entries()) {
      const ticketCount = db.prepare(`
        SELECT COUNT(*) as count FROM pmo_tickets WHERE status_id = ?
      `).get(oldStatusId) as { count: number };

      if (ticketCount.count > 0) {
        console.log(`Updating ${ticketCount.count} tickets from ${oldStatusId} -> ${newStatusId}`);

        if (!dryRun) {
          db.prepare(`
            UPDATE pmo_tickets SET status_id = ? WHERE status_id = ?
          `).run(newStatusId, oldStatusId);
        }

        totalUpdated += ticketCount.count;
      }
    }

    // Handle orphaned status_ids that don't match old statuses
    const orphanedTickets = db.prepare(`
      SELECT DISTINCT status_id, COUNT(*) as count
      FROM pmo_tickets t
      WHERE NOT EXISTS (
        SELECT 1 FROM pmo_workflow_statuses ws WHERE ws.id = t.status_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM pmo_statuses s WHERE s.id = t.status_id
      )
      GROUP BY status_id
    `).all() as { status_id: string; count: number }[];

    if (orphanedTickets.length > 0) {
      console.log(`\n⚠️  Found ${orphanedTickets.length} orphaned status_ids:`);
      for (const orphan of orphanedTickets) {
        console.log(`   ${orphan.status_id}: ${orphan.count} tickets`);
        // These should be manually reviewed and mapped to appropriate workflow statuses
      }
    }

    if (!dryRun) {
      db.prepare('COMMIT').run();
      console.log(`\n✅ Successfully updated ${totalUpdated} tickets`);

      console.log('\nTo drop the old pmo_statuses table, run:');
      console.log('  sqlite3 .proletariat/workspace.db "DROP TABLE IF EXISTS pmo_statuses"');
    } else {
      console.log(`\n📋 Would update ${totalUpdated} tickets`);
      console.log('\nTo apply changes, run:');
      console.log('  tsx scripts/migrate-ticket-statuses.ts --apply');
    }

  } catch (error) {
    if (!dryRun) {
      db.prepare('ROLLBACK').run();
    }
    console.error('Migration failed:', error);
    throw error;
  } finally {
    db.close();
  }
}

// Parse command line args
const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');

migrateTicketStatuses(dryRun);
