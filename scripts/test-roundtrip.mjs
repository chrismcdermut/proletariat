import { parseBoard } from './apps/cli/dist/lib/pmo/markdown.js';

const markdown = `---
kanban-plugin: basic
---

## TODO

- [ ] **pmo-test-001** [[pmo-test-001]] Test ticket with wikilink
      **Priority:** HIGH
      ***
      This should parse correctly

## DONE
`;

const board = parseBoard(markdown, 'test-project');
console.log('Parsed board:');
console.log(JSON.stringify(board, null, 2));

const ticket = board.columns[0]?.tickets[0];
if (ticket) {
  console.log('\nFirst ticket:');
  console.log(`  ID: ${ticket.id}`);
  console.log(`  Title: ${ticket.title}`);
  console.log(`  Priority: ${ticket.priority}`);
}
