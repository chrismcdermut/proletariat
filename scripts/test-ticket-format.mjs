import { SQLiteStorage } from './apps/cli/dist/lib/pmo/storage-sqlite.js';

const dbPath = '/Users/chrismcdermut/Projects/proletariat-hq/.proletariat/workspace.db';
const storage = new SQLiteStorage(dbPath);

// Create a test ticket
const ticket = await storage.createTicket({
  id: 'TEST-001',
  title: 'Test ticket with new format',
  description: 'This ticket should have **TEST-001** as bold header',
  priority: 'HIGH',
  category: 'test',
  status: 'backlog',
  column: 'build-bl'
});

console.log('Created ticket:', ticket.id);

// Export to markdown
const markdown = await storage.getBoardMarkdown();

// Show just the ticket line
const lines = markdown.split('\n');
const testTicketLine = lines.find(line => line.includes('TEST-001'));
console.log('\nTicket line in markdown:');
console.log(testTicketLine);

// Clean up
await storage.deleteTicket('TEST-001');
console.log('\nTest ticket deleted');

await storage.close();
