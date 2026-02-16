#!/usr/bin/env node
/**
 * Script to replace explicit json: Flags.boolean({ aliases: ['machine'] })
 * definitions across command files.
 *
 * For files that already have pmoBaseFlags or machineOutputFlags:
 *   -> Remove the explicit json flag (base flags now provide both json + machine)
 *
 * For files WITHOUT base flags:
 *   -> Replace explicit json flag with ...machineOutputFlags spread
 *   -> Add import for machineOutputFlags if not already present
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const cmdDir = 'src/commands';

// Find all files with the machine alias pattern
const files = execSync(`grep -rl "aliases: \\['machine'\\]" ${cmdDir}`, { encoding: 'utf-8' })
  .trim()
  .split('\n')
  .filter(Boolean);

console.log(`Found ${files.length} files to process`);

let hasBaseCount = 0;
let noBaseCount = 0;

for (const file of files) {
  let content = readFileSync(file, 'utf-8');
  const hasBase = /pmoBaseFlags|\.\.\.machineOutputFlags/.test(content);

  // Match the explicit json flag block with aliases: ['machine']
  // This regex matches the json flag definition with various description texts
  // Pattern: json: Flags.boolean({ ... aliases: ['machine'] ... }),
  const jsonFlagRegex = /\s*json: Flags\.boolean\(\{[^}]*aliases: \['machine'\][^}]*\}\),?\n/s;

  if (hasBase) {
    // Remove the explicit json flag - base flags provide both json and machine
    if (jsonFlagRegex.test(content)) {
      content = content.replace(jsonFlagRegex, '\n');
      writeFileSync(file, content);
      hasBaseCount++;
      console.log(`[HAS_BASE] Removed explicit json flag from: ${file}`);
    } else {
      console.log(`[HAS_BASE] WARN: Pattern not matched in: ${file}`);
    }
  } else {
    // Replace explicit json flag with ...machineOutputFlags
    if (jsonFlagRegex.test(content)) {
      content = content.replace(jsonFlagRegex, '\n    ...machineOutputFlags,\n');

      // Add import for machineOutputFlags if not already imported
      if (!content.includes('machineOutputFlags')) {
        // This shouldn't happen since we just added the spread, but just in case
      }

      // Add import - find the right import location
      if (!content.includes("import") || !content.includes("machineOutputFlags")) {
        // Check if there's already an import from pmo/base-command or pmo/index
        if (content.includes("from '../../lib/pmo/index.js'") || content.includes("from '../../lib/pmo/base-command.js'")) {
          // Add machineOutputFlags to existing import
          content = content.replace(
            /import \{([^}]*)\} from '(\.\.\/)*lib\/pmo\/(index|base-command)\.js'/,
            (match, imports, dots, mod) => {
              if (imports.includes('machineOutputFlags')) return match;
              return `import {${imports}, machineOutputFlags } from '${dots}lib/pmo/${mod}.js'`;
            }
          );
        } else if (content.includes("from '../lib/pmo/index.js'") || content.includes("from '../lib/pmo/base-command.js'")) {
          content = content.replace(
            /import \{([^}]*)\} from '(\.\.\/)*lib\/pmo\/(index|base-command)\.js'/,
            (match, imports, dots, mod) => {
              if (imports.includes('machineOutputFlags')) return match;
              return `import {${imports}, machineOutputFlags } from '${dots}lib/pmo/${mod}.js'`;
            }
          );
        } else {
          // Need to add a new import line
          // Find the right relative path based on file depth
          const depth = file.split('/').length - 2; // relative to src/commands
          let relPath;
          if (depth === 1) {
            relPath = '../lib/pmo/index.js';
          } else {
            relPath = '../../lib/pmo/index.js';
          }

          // Add import after the last import statement
          const lastImportIdx = content.lastIndexOf("import ");
          if (lastImportIdx !== -1) {
            const endOfLine = content.indexOf('\n', lastImportIdx);
            // Find the end of this import (might be multi-line)
            let importEnd = endOfLine;
            // Check if it's a multi-line import
            const fromIdx = content.indexOf("from ", lastImportIdx);
            if (fromIdx > endOfLine) {
              importEnd = content.indexOf('\n', fromIdx);
            } else {
              importEnd = content.indexOf('\n', fromIdx !== -1 ? fromIdx : lastImportIdx);
            }
            content = content.slice(0, importEnd + 1) +
              `import { machineOutputFlags } from '${relPath}';\n` +
              content.slice(importEnd + 1);
          }
        }
      }

      writeFileSync(file, content);
      noBaseCount++;
      console.log(`[NO_BASE] Replaced json flag with machineOutputFlags in: ${file}`);
    } else {
      console.log(`[NO_BASE] WARN: Pattern not matched in: ${file}`);
    }
  }
}

console.log(`\nProcessed ${files.length} files:`);
console.log(`  ${hasBaseCount} files had base flags (removed explicit json)`);
console.log(`  ${noBaseCount} files needed machineOutputFlags added`);
