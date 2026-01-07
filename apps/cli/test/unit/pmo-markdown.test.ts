import { expect } from 'chai';
import { parseBoard, generateBoardMarkdown, findAddedTickets, findRemovedTickets, findModifiedTickets } from '../../src/lib/pmo/markdown.js';
import { Board, Ticket } from '../../src/lib/pmo/types.js';

describe('PMO Markdown', () => {
  describe('parseBoard', () => {
    it('parses empty board with columns', () => {
      const markdown = `---
kanban-plugin: basic
---

## Backlog

## In Progress

## Done
`;
      const board = parseBoard(markdown);
      expect(board.columns).to.have.length(3);
      expect(board.columns[0].name).to.equal('Backlog');
      expect(board.columns[1].name).to.equal('In Progress');
      expect(board.columns[2].name).to.equal('Done');
    });

    it('parses board title', () => {
      const markdown = `# My Project Board

## Backlog
`;
      const board = parseBoard(markdown);
      expect(board.name).to.equal('My Project Board');
    });

    it('strips emoji from column names', () => {
      const markdown = `## 📥 Backlog

## 🚀 In Progress
`;
      const board = parseBoard(markdown);
      expect(board.columns[0].name).to.equal('Backlog');
      expect(board.columns[1].name).to.equal('In Progress');
    });

    it('parses tickets with wikilinks', () => {
      const markdown = `## Backlog

- [ ] [[implement-auth]]
- [ ] [[fix-bug-123]]
`;
      const board = parseBoard(markdown);
      expect(board.columns[0].tickets).to.have.length(2);
      expect(board.columns[0].tickets[0].id).to.equal('implement-auth');
      expect(board.columns[0].tickets[1].id).to.equal('fix-bug-123');
    });

    it('parses tickets with plain text', () => {
      const markdown = `## Backlog

- [ ] Implement user authentication
- [ ] Fix bug #123
`;
      const board = parseBoard(markdown);
      expect(board.columns[0].tickets).to.have.length(2);
      expect(board.columns[0].tickets[0].title).to.equal('Implement user authentication');
    });

    it('parses ticket metadata', () => {
      const markdown = `## Backlog

- [ ] [[implement-auth]]
      **Priority:** URGENT
      **Category:** feature
`;
      const board = parseBoard(markdown);
      const ticket = board.columns[0].tickets[0];
      expect(ticket.priority).to.equal('URGENT');
      expect(ticket.category).to.equal('feature');
    });

    it('parses subtasks', () => {
      const markdown = `## Backlog

- [ ] [[implement-auth]]
      ***
      - [ ] Design API
      - [x] Write tests
`;
      const board = parseBoard(markdown);
      const ticket = board.columns[0].tickets[0];
      expect(ticket.subtasks).to.have.length(2);
      expect(ticket.subtasks[0].title).to.equal('Design API');
      expect(ticket.subtasks[0].done).to.be.false;
      expect(ticket.subtasks[1].title).to.equal('Write tests');
      expect(ticket.subtasks[1].done).to.be.true;
    });

    it('parses description after separator', () => {
      const markdown = `## Backlog

- [ ] [[implement-auth]]
      ***
      This is the description
      for the ticket.
`;
      const board = parseBoard(markdown);
      const ticket = board.columns[0].tickets[0];
      expect(ticket.description).to.equal('This is the description\nfor the ticket.');
    });

    it('sets correct column and position for tickets', () => {
      const markdown = `## Backlog

- [ ] [[ticket-1]]
- [ ] [[ticket-2]]

## In Progress

- [ ] [[ticket-3]]
`;
      const board = parseBoard(markdown);
      expect(board.columns[0].tickets[0].column).to.equal('Backlog');
      expect(board.columns[0].tickets[0].position).to.equal(0);
      expect(board.columns[0].tickets[1].position).to.equal(1);
      expect(board.columns[1].tickets[0].column).to.equal('In Progress');
      expect(board.columns[1].tickets[0].position).to.equal(0);
    });
  });

  describe('generateBoardMarkdown', () => {
    it('generates frontmatter', () => {
      const board: Board = {
        id: 'test',
        name: 'Test Board',
        columns: [],
        updatedAt: new Date(),
      };
      const markdown = generateBoardMarkdown(board);
      expect(markdown).to.include('---');
      expect(markdown).to.include('kanban-plugin: basic');
    });

    it('generates column headers', () => {
      const board: Board = {
        id: 'test',
        name: 'Test Board',
        columns: [
          { id: 'backlog', name: 'Backlog', position: 0, tickets: [] },
          { id: 'done', name: 'Done', position: 1, tickets: [] },
        ],
        updatedAt: new Date(),
      };
      const markdown = generateBoardMarkdown(board);
      expect(markdown).to.include('## Backlog');
      expect(markdown).to.include('## Done');
    });

    it('generates tickets with wikilinks', () => {
      const board: Board = {
        id: 'test',
        name: 'Test Board',
        columns: [
          {
            id: 'backlog',
            name: 'Backlog',
            position: 0,
            tickets: [
              {
                id: 'implement-auth',
                title: 'implement-auth',
                status: 'backlog',
                statusId: 'status-backlog',
                column: 'Backlog',
                position: 0,
                subtasks: [],
                metadata: {},
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          },
        ],
        updatedAt: new Date(),
      };
      const markdown = generateBoardMarkdown(board);
      // New format: bold ID + wikilink + title
      expect(markdown).to.include('- [ ] **implement-auth** [[implement-auth]] implement-auth');
    });

    it('generates ticket metadata', () => {
      const board: Board = {
        id: 'test',
        name: 'Test Board',
        columns: [
          {
            id: 'backlog',
            name: 'Backlog',
            position: 0,
            tickets: [
              {
                id: 'ticket-1',
                title: 'ticket-1',
                status: 'backlog',
                statusId: 'status-backlog',
                column: 'Backlog',
                position: 0,
                priority: 'URGENT',
                category: 'feature',
                subtasks: [],
                metadata: { Assignee: 'John' },
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          },
        ],
        updatedAt: new Date(),
      };
      const markdown = generateBoardMarkdown(board);
      expect(markdown).to.include('**Priority:** URGENT');
      expect(markdown).to.include('**Category:** feature');
      expect(markdown).to.include('**Assignee:** John');
    });

    it('generates subtasks', () => {
      const board: Board = {
        id: 'test',
        name: 'Test Board',
        columns: [
          {
            id: 'backlog',
            name: 'Backlog',
            position: 0,
            tickets: [
              {
                id: 'ticket-1',
                title: 'ticket-1',
                status: 'backlog',
                statusId: 'status-backlog',
                column: 'Backlog',
                position: 0,
                subtasks: [
                  { id: 'sub-1', title: 'Task 1', done: false },
                  { id: 'sub-2', title: 'Task 2', done: true },
                ],
                metadata: {},
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          },
        ],
        updatedAt: new Date(),
      };
      const markdown = generateBoardMarkdown(board);
      expect(markdown).to.include('- [ ] Task 1');
      expect(markdown).to.include('- [x] Task 2');
    });

    it('generates description', () => {
      const board: Board = {
        id: 'test',
        name: 'Test Board',
        columns: [
          {
            id: 'backlog',
            name: 'Backlog',
            position: 0,
            tickets: [
              {
                id: 'ticket-1',
                title: 'ticket-1',
                status: 'backlog',
                statusId: 'status-backlog',
                column: 'Backlog',
                position: 0,
                description: 'This is the description',
                subtasks: [],
                metadata: {},
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          },
        ],
        updatedAt: new Date(),
      };
      const markdown = generateBoardMarkdown(board);
      expect(markdown).to.include('***');
      expect(markdown).to.include('This is the description');
    });
  });

  describe('roundtrip parse/generate', () => {
    it('preserves board structure through roundtrip', () => {
      const originalMarkdown = `---
kanban-plugin: basic
---

## Backlog

- [ ] [[implement-auth]]
      **Priority:** URGENT
      **Category:** feature
      ***
      - [ ] Design API
      - [x] Write tests

## In Progress

- [ ] [[fix-bug]]

## Done

`;
      const board = parseBoard(originalMarkdown);
      const regenerated = generateBoardMarkdown(board);
      const reparsed = parseBoard(regenerated);

      expect(reparsed.columns).to.have.length(board.columns.length);
      expect(reparsed.columns[0].tickets).to.have.length(board.columns[0].tickets.length);
      expect(reparsed.columns[0].tickets[0].priority).to.equal('URGENT');
      expect(reparsed.columns[0].tickets[0].subtasks).to.have.length(2);
    });
  });

  describe('diff utilities', () => {
    const createBoard = (tickets: Partial<Ticket>[]): Board => ({
      id: 'test',
      name: 'Test',
      columns: [
        {
          id: 'backlog',
          name: 'Backlog',
          position: 0,
          tickets: tickets.map((t, i) => ({
            id: t.id || `ticket-${i}`,
            title: t.title || `Ticket ${i}`,
            status: 'backlog' as const,
            statusId: 'status-backlog',
            column: 'Backlog',
            position: i,
            subtasks: [],
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            ...t,
          })),
        },
      ],
      updatedAt: new Date(),
    });

    describe('findAddedTickets', () => {
      it('finds tickets added to new board', () => {
        const oldBoard = createBoard([{ id: 'ticket-1' }]);
        const newBoard = createBoard([{ id: 'ticket-1' }, { id: 'ticket-2' }]);

        const added = findAddedTickets(oldBoard, newBoard);
        expect(added).to.have.length(1);
        expect(added[0].id).to.equal('ticket-2');
      });

      it('returns empty array when no tickets added', () => {
        const oldBoard = createBoard([{ id: 'ticket-1' }]);
        const newBoard = createBoard([{ id: 'ticket-1' }]);

        const added = findAddedTickets(oldBoard, newBoard);
        expect(added).to.have.length(0);
      });
    });

    describe('findRemovedTickets', () => {
      it('finds tickets removed from old board', () => {
        const oldBoard = createBoard([{ id: 'ticket-1' }, { id: 'ticket-2' }]);
        const newBoard = createBoard([{ id: 'ticket-1' }]);

        const removed = findRemovedTickets(oldBoard, newBoard);
        expect(removed).to.have.length(1);
        expect(removed[0].id).to.equal('ticket-2');
      });
    });

    describe('findModifiedTickets', () => {
      it('finds tickets with changed properties', () => {
        const oldBoard = createBoard([{ id: 'ticket-1', title: 'Old Title' }]);
        const newBoard = createBoard([{ id: 'ticket-1', title: 'New Title' }]);

        const modified = findModifiedTickets(oldBoard, newBoard);
        expect(modified).to.have.length(1);
        expect(modified[0].old.title).to.equal('Old Title');
        expect(modified[0].new.title).to.equal('New Title');
      });

      it('returns empty when tickets unchanged', () => {
        const oldBoard = createBoard([{ id: 'ticket-1', title: 'Same' }]);
        const newBoard = createBoard([{ id: 'ticket-1', title: 'Same' }]);

        const modified = findModifiedTickets(oldBoard, newBoard);
        expect(modified).to.have.length(0);
      });
    });
  });
});
