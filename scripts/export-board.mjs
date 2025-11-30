import { SQLiteStorage } from './apps/cli/dist/lib/pmo/storage-sqlite.js';

const dbPath = '/Users/chrismcdermut/Projects/proletariat-hq/.proletariat/workspace.db';
const storage = new SQLiteStorage(dbPath);
storage.setCurrentProject('proletariat-kanban');

const markdown = await storage.getBoardMarkdown();

// Show first 50 lines
const lines = markdown.split('\n').slice(0, 50);
console.log(lines.join('\n'));

await storage.close();
