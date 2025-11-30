import { SQLiteStorage } from './apps/cli/dist/lib/pmo/storage-sqlite.js';
import { generateTicketsFromSpec } from './apps/cli/dist/lib/pmo/spec-parser.js';
import fs from 'fs';
import path from 'path';

const dbPath = '/Users/chrismcdermut/Projects/proletariat-hq/.proletariat/workspace.db';
const storage = new SQLiteStorage(dbPath);
storage.setCurrentProject('proletariat-kanban');

const specs = [
  'pmo-schema-refactor',
  'pmo-board-commands',
  'pmo-ticket-commands',
  'pmo-project-commands',
  'pmo-spec-commands'
];

console.log('Regenerating tickets from all specs...\n');

for (const specId of specs) {
  const spec = await storage.getSpec(specId);
  if (!spec) {
    console.log(`⚠️  Spec not found: ${specId}`);
    continue;
  }

  const specPath = path.join('/Users/chrismcdermut/Projects/proletariat-hq/repos/proletariat', spec.path);

  if (!fs.existsSync(specPath)) {
    console.log(`⚠️  Spec file not found: ${specPath}`);
    continue;
  }

  const content = fs.readFileSync(specPath, 'utf-8');
  const tickets = generateTicketsFromSpec(content, specId);

  console.log(`📄 ${spec.title || specId}: ${tickets.length} tickets`);

  for (const ticket of tickets) {
    try {
      await storage.createTicket(ticket);
      console.log(`  ✅ ${ticket.id}: ${ticket.title}`);
    } catch (error) {
      console.log(`  ❌ ${ticket.id}: ${error.message}`);
    }
  }
  console.log();
}

const count = await storage.db.prepare('SELECT COUNT(*) as count FROM pmo_tickets').get();
console.log(`\n✅ Total tickets created: ${count.count}`);

await storage.close();
