/**
 * Workstream prefix utilities for generating, validating, and checking
 * uniqueness of workstream prefixes used in entity IDs.
 *
 * Prefixes are 2-4 uppercase letters that identify a workstream.
 * Example: "Platform" → "PLT" → IDs become PLT-TKT-001, PLT-EPIC-001, etc.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import {
  readMachineConfig,
  getOrganizationWorkspaces,
} from '../machine-config.js';

/**
 * Suggest prefix candidates from a workstream name.
 * Returns up to 3 suggestions in order of preference.
 *
 * Examples:
 * - "Platform" → ["PLT", "PLA", "PLM"]
 * - "Mobile App" → ["MA", "MOB", "MBL"]
 * - "API Gateway" → ["AG", "API", "APG"]
 */
export function suggestPrefixes(name: string): string[] {
  const clean = name.toUpperCase().replace(/[^A-Z\s]/g, '');
  const words = clean.split(/\s+/).filter(Boolean);

  if (words.length === 0) return [];

  const suggestions: string[] = [];

  // For multi-word names, try acronym first
  if (words.length >= 2) {
    const acronym = words.map((w) => w[0]).join('');
    if (acronym.length >= 2 && acronym.length <= 4) {
      suggestions.push(acronym);
    }
  }

  // First word: first 3 letters
  const firstWord = words[0];
  if (firstWord.length >= 3) {
    suggestions.push(firstWord.substring(0, 3));
  } else if (firstWord.length >= 2) {
    suggestions.push(firstWord);
  }

  // First word: first 2 + last letter (for variation)
  if (firstWord.length >= 3) {
    const variant = firstWord.substring(0, 2) + firstWord[firstWord.length - 1];
    if (!suggestions.includes(variant)) {
      suggestions.push(variant);
    }
  }

  // Consonant-based abbreviation (skip vowels)
  const consonants = firstWord.replace(/[AEIOU]/g, '');
  if (consonants.length >= 3) {
    const consonantPrefix = consonants.substring(0, 3);
    if (!suggestions.includes(consonantPrefix)) {
      suggestions.push(consonantPrefix);
    }
  } else if (consonants.length >= 2) {
    // Add first vowel to pad
    const vowel = firstWord.match(/[AEIOU]/)?.[0] || firstWord[firstWord.length - 1];
    const consonantPrefix = consonants + vowel;
    if (!suggestions.includes(consonantPrefix)) {
      suggestions.push(consonantPrefix);
    }
  }

  // Dedupe and limit to 3
  return [...new Set(suggestions)].slice(0, 3);
}

/**
 * Validate a workstream prefix.
 *
 * Rules:
 * - Must be 2-4 characters
 * - Must be uppercase letters only (A-Z)
 */
export function validatePrefix(prefix: string): { valid: boolean; error?: string } {
  if (!prefix || prefix.length === 0) {
    return { valid: false, error: 'Prefix is required' };
  }

  if (!/^[A-Z]+$/.test(prefix)) {
    return { valid: false, error: 'Prefix must be uppercase letters only (A-Z)' };
  }

  if (prefix.length < 2) {
    return { valid: false, error: 'Prefix must be at least 2 characters' };
  }

  if (prefix.length > 4) {
    return { valid: false, error: 'Prefix must be at most 4 characters' };
  }

  return { valid: true };
}

/**
 * Check if a prefix is unique within an organization.
 * Reads all workspaces in the org and checks their workstream_prefix.
 *
 * @param prefix The prefix to check
 * @param orgName The organization name (null for global check)
 * @returns true if prefix is unique, false if already in use
 */
export function isPrefixUnique(prefix: string, orgName: string | null): boolean {
  const config = readMachineConfig();

  // Get workspaces to check
  const workspacesToCheck = orgName
    ? getOrganizationWorkspaces(orgName)
    : config.workspaces;

  for (const ws of workspacesToCheck) {
    // Read workspace database to check prefix
    const dbPath = path.join(ws.path, '.proletariat', 'workspace.db');
    if (fs.existsSync(dbPath)) {
      try {
        const db = new Database(dbPath, { readonly: true });

        // Check if workspace table has workstream_prefix column
        const columns = db.pragma('table_info(workspace)') as Array<{ name: string }>;
        const hasPrefix = columns.some((c) => c.name === 'workstream_prefix');

        if (hasPrefix) {
          const row = db
            .prepare('SELECT workstream_prefix FROM workspace WHERE id = 1')
            .get() as { workstream_prefix: string | null } | undefined;

          db.close();

          if (row?.workstream_prefix?.toUpperCase() === prefix.toUpperCase()) {
            return false;
          }
        } else {
          db.close();
        }
      } catch {
        // Ignore errors reading individual workspace databases
      }
    }
  }

  return true;
}

/**
 * Get all prefixes in use within an organization.
 */
export function getUsedPrefixes(orgName: string | null): string[] {
  const config = readMachineConfig();

  const workspacesToCheck = orgName
    ? getOrganizationWorkspaces(orgName)
    : config.workspaces;

  const prefixes: string[] = [];

  for (const ws of workspacesToCheck) {
    const dbPath = path.join(ws.path, '.proletariat', 'workspace.db');
    if (fs.existsSync(dbPath)) {
      try {
        const db = new Database(dbPath, { readonly: true });

        // Check if workspace table has workstream_prefix column
        const columns = db.pragma('table_info(workspace)') as Array<{ name: string }>;
        const hasPrefix = columns.some((c) => c.name === 'workstream_prefix');

        if (hasPrefix) {
          const row = db
            .prepare('SELECT workstream_prefix FROM workspace WHERE id = 1')
            .get() as { workstream_prefix: string | null } | undefined;

          if (row?.workstream_prefix) {
            prefixes.push(row.workstream_prefix);
          }
        }

        db.close();
      } catch {
        // Ignore errors
      }
    }
  }

  return prefixes;
}
