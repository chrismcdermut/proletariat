#!/usr/bin/env node

/**
 * Aggregate changelog fragments into CHANGELOG.md for a release.
 *
 * Usage:
 *   node scripts/aggregate-changelog.mjs <version>           # aggregate and update CHANGELOG.md
 *   node scripts/aggregate-changelog.mjs <version> --dry-run  # preview without writing
 *   node scripts/aggregate-changelog.mjs <version> --keep     # don't delete fragments after aggregation
 *
 * Reads all .yaml files from .changelog/, groups entries by type
 * (Added, Fixed, Changed, Removed), and prepends a new version section
 * to CHANGELOG.md.
 */

import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CHANGELOG_DIR = join(ROOT, '.changelog');
const CHANGELOG_FILE = join(ROOT, 'CHANGELOG.md');

// Map fragment types to Keep-a-Changelog section headings
const TYPE_HEADINGS = {
  added: 'Added',
  fixed: 'Fixed',
  changed: 'Changed',
  removed: 'Removed',
};

const TYPE_ORDER = ['added', 'fixed', 'changed', 'removed'];

// Minimal YAML parser — fragments are simple key: value or list-of-objects.
// This avoids adding a YAML dependency for a straightforward schema.
function parseFragment(content) {
  const lines = content.split('\n');
  const entries = [];

  // Check for multi-entry format (entries: list)
  const entriesIdx = lines.findIndex((l) => /^entries:\s*$/.test(l.trim()));
  if (entriesIdx !== -1) {
    let current = null;
    for (let i = entriesIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*-\s+type:\s*/.test(line)) {
        if (current) entries.push(current);
        current = { type: line.replace(/^\s*-\s+type:\s*/, '').trim().toLowerCase() };
      } else if (/^\s+description:\s*/.test(line) && current) {
        current.description = line.replace(/^\s+description:\s*/, '').trim().replace(/^["']|["']$/g, '');
      }
    }
    if (current) entries.push(current);
    return entries;
  }

  // Single-entry format
  let type = null;
  let description = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;
    const typeMatch = trimmed.match(/^type:\s*(.+)/);
    if (typeMatch) type = typeMatch[1].trim().toLowerCase();
    const descMatch = trimmed.match(/^description:\s*(.+)/);
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '');
  }
  if (type && description) entries.push({ type, description });
  return entries;
}

function run() {
  const args = process.argv.slice(2);
  const version = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const keep = args.includes('--keep');

  if (!version) {
    console.error('Usage: node scripts/aggregate-changelog.mjs <version> [--dry-run] [--keep]');
    process.exit(1);
  }

  if (!existsSync(CHANGELOG_DIR)) {
    console.error(`No .changelog/ directory found at ${CHANGELOG_DIR}`);
    process.exit(1);
  }

  // Collect all fragment files
  const files = readdirSync(CHANGELOG_DIR).filter(
    (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
  );

  if (files.length === 0) {
    console.log('No changelog fragments found. Nothing to aggregate.');
    process.exit(0);
  }

  // Parse all fragments
  const allEntries = [];
  const fragmentFiles = [];
  for (const file of files) {
    const filePath = join(CHANGELOG_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const entries = parseFragment(content);
    if (entries.length === 0) {
      console.warn(`Warning: No valid entries in ${file}, skipping`);
      continue;
    }
    for (const entry of entries) {
      if (!TYPE_HEADINGS[entry.type]) {
        console.warn(`Warning: Unknown type "${entry.type}" in ${file}, skipping entry`);
        continue;
      }
      allEntries.push(entry);
    }
    fragmentFiles.push(filePath);
  }

  if (allEntries.length === 0) {
    console.log('No valid entries found in fragments. Nothing to aggregate.');
    process.exit(0);
  }

  // Group by type
  const grouped = {};
  for (const type of TYPE_ORDER) {
    const items = allEntries.filter((e) => e.type === type);
    if (items.length > 0) grouped[type] = items;
  }

  // Build the new version section
  const today = new Date().toISOString().split('T')[0];
  const sectionLines = [`## [${version}] - ${today}`, ''];
  for (const type of TYPE_ORDER) {
    if (!grouped[type]) continue;
    sectionLines.push(`### ${TYPE_HEADINGS[type]}`);
    for (const entry of grouped[type]) {
      sectionLines.push(`- ${entry.description}`);
    }
    sectionLines.push('');
  }
  const newSection = sectionLines.join('\n');

  if (dryRun) {
    console.log('--- DRY RUN: would prepend to CHANGELOG.md ---');
    console.log(newSection);
    console.log(`--- ${fragmentFiles.length} fragment file(s) would be deleted ---`);
    for (const f of fragmentFiles) console.log(`  ${f}`);
    return;
  }

  // Read existing CHANGELOG.md and insert after the header line
  let existing = '';
  if (existsSync(CHANGELOG_FILE)) {
    existing = readFileSync(CHANGELOG_FILE, 'utf-8');
  }

  // Split at first version heading (## [...]) or at end of header
  const headerLine = '# Changelog';
  const preamble = 'All notable changes to this project will be documented in this file.';
  let output;
  const firstVersionIdx = existing.indexOf('\n## [');
  if (firstVersionIdx !== -1) {
    const before = existing.slice(0, firstVersionIdx);
    const after = existing.slice(firstVersionIdx + 1); // skip the newline
    output = `${before.trimEnd()}\n\n${newSection}${after}`;
  } else {
    // No existing versions — create from scratch
    output = `${headerLine}\n\n${preamble}\n\n${newSection}`;
  }

  writeFileSync(CHANGELOG_FILE, output, 'utf-8');
  console.log(`Updated CHANGELOG.md with [${version}] section (${allEntries.length} entries)`);

  // Delete consumed fragment files
  if (!keep) {
    for (const f of fragmentFiles) {
      unlinkSync(f);
      console.log(`  Deleted: ${f}`);
    }
    console.log(`Removed ${fragmentFiles.length} fragment file(s)`);
  } else {
    console.log('Fragments kept (--keep flag)');
  }
}

run();
