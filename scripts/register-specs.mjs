import { SQLiteStorage } from './apps/cli/dist/lib/pmo/storage-sqlite.js';

const dbPath = '/Users/chrismcdermut/Projects/proletariat-hq/.proletariat/workspace.db';
console.log('Registering spec files in database...\n');

const storage = new SQLiteStorage(dbPath);

// Register all the new spec files
const specs = [
  {
    id: 'pmo-board-commands',
    path: 'pmo/projects/proletariat-kanban/specs/active/pmo-board-commands.md',
    title: 'PMO Board Commands Specification',
    status: 'active'
  },
  {
    id: 'pmo-ticket-commands',
    path: 'pmo/projects/proletariat-kanban/specs/active/pmo-ticket-commands.md',
    title: 'PMO Ticket Commands Specification',
    status: 'active'
  },
  {
    id: 'pmo-project-commands',
    path: 'pmo/projects/proletariat-kanban/specs/active/pmo-project-commands.md',
    title: 'PMO Project Commands Specification',
    status: 'active'
  },
  {
    id: 'pmo-spec-commands',
    path: 'pmo/projects/proletariat-kanban/specs/active/pmo-spec-commands.md',
    title: 'PMO Spec Commands Specification',
    status: 'active'
  }
];

for (const spec of specs) {
  try {
    await storage.createSpec(spec);
    console.log(`✅ Registered: ${spec.title}`);
  } catch (error) {
    console.log(`⚠️  ${spec.id}: ${error.message}`);
  }
}

console.log('\n✅ Spec registration complete');

await storage.close();
