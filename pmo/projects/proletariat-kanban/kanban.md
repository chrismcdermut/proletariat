---

kanban-plugin: board

---

## proletariat-kanban



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
- [ ] **remove-storage-type-question-from-pmo-init** [[remove-storage-type-question-from-pmo-init]] Remove storage type question from PMO init
	  **Priority:** HIGH
	  **Category:** BUG
	  ***
	  The storage type question shouldn't be asked during PMO init. It should be a sync question instead, not a storage decision. SQLite is always used for storage.
- [ ] **pmo-init-should-ask-about-location-in-repo-vs-separate-git-repo** [[pmo-init-should-ask-about-location-in-repo-vs-separate-git-repo]] PMO init should ask about location (in-repo vs separate git repo)
	  **Priority:** HIGH
	  **Category:** BUG
	  ***
	  PMO init should ask where to put the PMO: inside one of the coding repos at the root, or in the root of HQ as its own git repo. This location choice is important for version control strategy.
- [ ] **default-board-name-should-be-hqname-kanban** [[default-board-name-should-be-hqname-kanban]] Default board name should be {hqname}-kanban
	  **Priority:** HIGH
	  **Category:** BUG
	  ***
	  When initializing PMO, the default board name should be named after the HQ. For example, if HQ is named 'myproject-hq', the default board name should be 'myproject-kanban', not generic 'Project Board'.
- [ ] **both-boards-getting-same-name-despite-different-input** [[both-boards-getting-same-name-despite-different-input]] Both boards getting same name despite different input
	  **Priority:** HIGH
	  **Category:** BUG
	  ***
	  When creating multiple boards, they both get the same name 'Board' even though the first one started with its own name. Board names should be preserved correctly from user input.
- [ ] **board-filename-should-be-projectname-kanbanmd-not-boardmd** [[board-filename-should-be-projectname-kanbanmd-not-boardmd]] Board filename should be projectname-kanban.md not board.md
	  **Priority:** MEDIUM
	  **Category:** BUG
	  ***
	  The board markdown file should be named after the project (e.g., 'proletariat-kanban.md') instead of generic 'board.md'. This makes it clearer which board is which when viewing files directly, unless this breaks routing logic.
- [ ] **bug-pmo-location-choice-missing-from-init-prompts** [[bug-pmo-location-choice-missing-from-init-prompts]] BUG: PMO location choice missing from init prompts
	  **Priority:** HIGH
	  **Category:** BUG
	  ***
	  PMO init should ask where to put the PMO: inside one of the coding repos at the root, or in the root of HQ as its own git repo. This location choice is important for version control strategy.
- [ ] **bug-default-board-name-should-use-hqname-kanban-pattern** [[bug-default-board-name-should-use-hqname-kanban-pattern]] BUG: Default board name should use hqname-kanban pattern
	  **Priority:** HIGH
	  **Category:** BUG
	  ***
	  When initializing PMO, the default board name should be named after the HQ. For example, if HQ is named 'myproject-hq', the default board name should be 'myproject-kanban', not generic 'Project Board'.
- [ ] **bug-multiple-boards-get-same-name-despite-user-input** [[bug-multiple-boards-get-same-name-despite-user-input]] BUG: Multiple boards get same name despite user input
	  **Priority:** HIGH
	  **Category:** BUG
	  ***
	  When creating multiple boards, they both get the same name 'Board' even though the first one started with its own name. Board names should be preserved correctly from user input.
- [ ] **bug-board-file-should-use-project-kanbanmd-naming** [[bug-board-file-should-use-project-kanbanmd-naming]] BUG: Board file should use project-kanban.md naming
	  **Priority:** MEDIUM
	  **Category:** BUG
	  ***
	  The board markdown file should be named after the project (e.g., 'proletariat-kanban.md') instead of generic 'board.md'. This makes it clearer which board is which when viewing files directly, unless this breaks routing logic.


## GROW BL



## SUPPORT BL



## ️ BIZOPS BL



## STRATEGY BL



## Ready

- [ ] **test-readme-001** [[test-readme-001]] Add comment to README
	  **Priority:** LOW
	  **Category:** test
	  ***
	  Add a comment line to the README.md file in the proletariat repo root
- [ ] **test-readme-002** [[test-readme-002]] Add comment to README
	  **Priority:** LOW
	  **Category:** test
	  ***
	  Add a comment line to the README.md file in the proletariat repo root
- [ ] **test-readme-003** [[test-readme-003]] Add comment to README
	  **Priority:** LOW
	  **Category:** test
	  ***
	  Add a comment line to the README.md file in the proletariat repo root
- [ ] **test-readme-004** [[test-readme-004]] Add comment to README
	  **Priority:** LOW
	  **Category:** test
	  ***
	  Add a comment line to the README.md file in the proletariat repo root
- [ ] **test-readme-005** [[test-readme-005]] Add comment to README
	  **Priority:** LOW
	  **Category:** test
	  ***
	  Add a comment line to the README.md file in the proletariat repo root
- [ ] **test-readme-006** [[test-readme-006]] Add comment to README
	  **Priority:** LOW
	  **Category:** test
	  ***
	  Add a comment line to the README.md file in the proletariat repo root



## In Progress



## In Review



## Merged

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


## Published



## ️ Dropped





%% kanban:settings
```
{"kanban-plugin":"board"}
```
%%