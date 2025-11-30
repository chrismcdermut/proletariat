---
kanban-plugin: basic
---

## BUILD BL

- [ ] **pmo-ticket-commands-001** [[pmo-ticket-commands-001]] Implement prlt ticket list command
      **Priority:** HIGH
      **Category:** feature
      **Spec:** [[pmo/projects/proletariat-kanban/specs/active/pmo-ticket-commands.md|pmo-ticket-commands]]
      ***
      Create command to list all tickets with filtering by column, priority, category, and assignee

- [ ] **pmo-ticket-commands-002** [[pmo-ticket-commands-002]] Implement prlt ticket view command
      **Priority:** HIGH
      **Category:** feature
      **Spec:** [[pmo/projects/proletariat-kanban/specs/active/pmo-ticket-commands.md|pmo-ticket-commands]]
      ***
      Create command to view detailed ticket information including metadata, subtasks, and linked specs

- [ ] **pmo-ticket-commands-003** [[pmo-ticket-commands-003]] Implement prlt ticket bulk move command
      **Priority:** MEDIUM
      **Category:** feature
      **Spec:** [[pmo/projects/proletariat-kanban/specs/active/pmo-ticket-commands.md|pmo-ticket-commands]]
      ***
      Multi-select tickets and move them to a different column

- [ ] **pmo-ticket-commands-004** [[pmo-ticket-commands-004]] Implement prlt ticket bulk delete command
      **Priority:** MEDIUM
      **Category:** feature
      **Spec:** [[pmo/projects/proletariat-kanban/specs/active/pmo-ticket-commands.md|pmo-ticket-commands]]
      ***
      Multi-select tickets and delete them

- [ ] **pmo-ticket-commands-005** [[pmo-ticket-commands-005]] Implement prlt ticket bulk reassign command
      **Priority:** MEDIUM
      **Category:** feature
      **Spec:** [[pmo/projects/proletariat-kanban/specs/active/pmo-ticket-commands.md|pmo-ticket-commands]]
      ***
      Multi-select tickets and reassign to different spec

- [ ] **pmo-ticket-commands-006** [[pmo-ticket-commands-006]] Implement prlt ticket bulk update command
      **Priority:** LOW
      **Category:** feature
      **Spec:** [[pmo/projects/proletariat-kanban/specs/active/pmo-ticket-commands.md|pmo-ticket-commands]]
      ***
      Multi-select tickets and update priority/category

- [ ] **pmo-schema-refactor-001** [[pmo-schema-refactor-001]] Remove epic_id and pmo_epics table
      **Priority:** HIGH
      **Category:** schema
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-schema-refactor.md|pmo-schema-refactor]]
      ***
      Epics are replaced by specs - remove epic concept entirely

- [ ] **pmo-schema-refactor-002** [[pmo-schema-refactor-002]] Add status field to pmo_tickets
      **Priority:** HIGH
      **Category:** schema
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-schema-refactor.md|pmo-schema-refactor]]
      ***
      Add lifecycle status separate from column position (backlog, ready, in_progress, blocked, review, done, cancelled)

- [ ] **pmo-schema-refactor-003** [[pmo-schema-refactor-003]] Add owner and assignee fields to pmo_tickets
      **Priority:** HIGH
      **Category:** schema
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-schema-refactor.md|pmo-schema-refactor]]
      ***
      Add owner (human responsible) and assignee (executor - human or agent) fields

- [ ] **pmo-schema-refactor-004** [[pmo-schema-refactor-004]] Create pmo_board_tickets table
      **Priority:** HIGH
      **Category:** schema
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-schema-refactor.md|pmo-schema-refactor]]
      ***
      Normalize board view state into separate table (column_id, position)

- [ ] **pmo-schema-refactor-005** [[pmo-schema-refactor-005]] Add sync tracking fields
      **Priority:** HIGH
      **Category:** schema
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-schema-refactor.md|pmo-schema-refactor]]
      ***
      Add last_synced_from_spec and last_synced_from_board timestamps for conflict detection

- [ ] **pmo-schema-refactor-006** [[pmo-schema-refactor-006]] Update Ticket TypeScript interface
      **Priority:** HIGH
      **Category:** types
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-schema-refactor.md|pmo-schema-refactor]]
      ***
      Update types.ts to match new schema (remove epicId/column/position, add status/owner/assignee/sync fields)

- [ ] **pmo-schema-refactor-007** [[pmo-schema-refactor-007]] Create BoardTicket interface
      **Priority:** MEDIUM
      **Category:** types
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-schema-refactor.md|pmo-schema-refactor]]
      ***
      Add new interface for board view state

- [ ] **pmo-schema-refactor-008** [[pmo-schema-refactor-008]] Refactor storage-sqlite.ts schema creation
      **Priority:** HIGH
      **Category:** storage
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-schema-refactor.md|pmo-schema-refactor]]
      ***
      Update ensurePMOTables() with new schema

- [ ] **pmo-schema-refactor-009** [[pmo-schema-refactor-009]] Update createTicket to use new schema
      **Priority:** HIGH
      **Category:** storage
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-schema-refactor.md|pmo-schema-refactor]]
      ***
      Create ticket in pmo_tickets, then create board position in pmo_board_tickets

- [ ] **pmo-schema-refactor-010** [[pmo-schema-refactor-010]] Update getBoard to join pmo_board_tickets
      **Priority:** HIGH
      **Category:** storage
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-schema-refactor.md|pmo-schema-refactor]]
      ***
      Query must join tickets with board_tickets to get column/position

- [ ] **pmo-schema-refactor-011** [[pmo-schema-refactor-011]] Add updateBoardPosition method
      **Priority:** MEDIUM
      **Category:** storage
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-schema-refactor.md|pmo-schema-refactor]]
      ***
      New method to update ticket position on board without touching ticket data

- [ ] **pmo-schema-refactor-012** [[pmo-schema-refactor-012]] Test ticket creation flow
      **Priority:** HIGH
      **Category:** testing
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-schema-refactor.md|pmo-schema-refactor]]
      ***
      Verify prlt spec generate-tickets works with new schema

- [ ] **pmo-board-commands-001** [[pmo-board-commands-001]] Enhance prlt board view with filtering
      **Priority:** LOW
      **Category:** feature
      **Spec:** [[pmo/projects/proletariat-kanban/specs/active/pmo-board-commands.md|pmo-board-commands]]
      ***
      Add --assignee and --priority filters to board view

- [ ] **pmo-board-views-001** [[pmo-board-views-001]] Add assignee filter to board view
      **Priority:** MEDIUM
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-board-views.md|pmo-board-views]]
      ***
      Filter board by assignee with --assignee flag

- [ ] **pmo-board-views-002** [[pmo-board-views-002]] Add priority filter to board view
      **Priority:** MEDIUM
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-board-views.md|pmo-board-views]]
      ***
      Filter board by priority with --priority flag

- [ ] **pmo-board-views-003** [[pmo-board-views-003]] Add column filter to board view
      **Priority:** LOW
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-board-views.md|pmo-board-views]]
      ***
      Show only specific columns with --column flag

- [ ] **pmo-board-views-004** [[pmo-board-views-004]] Add status filter to board view
      **Priority:** LOW
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-board-views.md|pmo-board-views]]
      ***
      Filter by ticket status (backlog, in_progress, etc)

- [ ] **pmo-board-views-005** [[pmo-board-views-005]] Add combined filters support
      **Priority:** MEDIUM
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-board-views.md|pmo-board-views]]
      ***
      Allow multiple filters at once (e.g., --assignee alice --priority HIGH)

- [ ] **pmo-board-views-006** [[pmo-board-views-006]] Implement board grouping by assignee
      **Priority:** LOW
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-board-views.md|pmo-board-views]]
      ***
      Group tickets by assignee instead of column

- [ ] **pmo-board-views-007** [[pmo-board-views-007]] Implement board grouping by priority
      **Priority:** LOW
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-board-views.md|pmo-board-views]]
      ***
      Group tickets by priority level

- [ ] **pmo-board-views-008** [[pmo-board-views-008]] Add board sorting options
      **Priority:** LOW
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-board-views.md|pmo-board-views]]
      ***
      Sort tickets within columns by updated, created, priority

## GROW BL

## SUPPORT BL

## ️ BIZOPS BL

## STRATEGY BL

## Ready

## In Progress

## In Review

## Merged

## Published

## ️ Dropped
