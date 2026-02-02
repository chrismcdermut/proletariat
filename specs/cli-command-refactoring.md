# CLI Command Refactoring Specification

This document contains fully specified tickets for refactoring the CLI to a clean resource-verb-flag structure. Each ticket is self-contained and can be executed independently by an agent.

---

## Ticket 1: Consolidate Ticket Link Commands

### Summary
Replace 4 separate ticket link commands with a single `ticket link` command using a `--type` flag, and add `ticket unlink` for removal.

### Current State
```
apps/cli/src/commands/ticket/link/block.ts
apps/cli/src/commands/ticket/link/relates.ts
apps/cli/src/commands/ticket/link/duplicates.ts
apps/cli/src/commands/ticket/link/remove.ts
apps/cli/src/commands/ticket/link/index.ts
```

### Target State
```
apps/cli/src/commands/ticket/link.ts
apps/cli/src/commands/ticket/unlink.ts
```

### Implementation Details

#### `ticket/link.ts`
```typescript
// Command: prlt ticket link <source> <target> --type <type>
//
// Args:
//   source: string (required) - Source ticket ID
//   target: string (required) - Target ticket ID
//
// Flags:
//   --type: enum (required) - One of: blocks, relates, duplicates
//   --json: boolean - Output as JSON for AI agents
//   + pmoBaseFlags
//
// Behavior:
//   1. Resolve both ticket IDs
//   2. Validate both exist
//   3. Create link of specified type in storage
//   4. Output success message with link details
//
// JSON mode:
//   - If tickets not found, output error JSON
//   - On success, output result JSON with link details
//
// Examples:
//   prlt ticket link TKT-1 TKT-2 --type blocks
//   prlt ticket link TKT-1 TKT-2 --type relates
//   prlt ticket link TKT-1 TKT-2 --type duplicates
```

#### `ticket/unlink.ts`
```typescript
// Command: prlt ticket unlink <source> <target>
//
// Args:
//   source: string (required) - Source ticket ID
//   target: string (required) - Target ticket ID
//
// Flags:
//   --type: enum (optional) - Specific type to remove, or all if not specified
//   --force: boolean - Skip confirmation
//   --json: boolean - Output as JSON for AI agents
//   + pmoBaseFlags
//
// Behavior:
//   1. Resolve both ticket IDs
//   2. Find existing link(s) between them
//   3. If --type specified, remove only that type
//   4. If no --type, remove all links between the two tickets
//   5. Confirm before removal unless --force
//
// Examples:
//   prlt ticket unlink TKT-1 TKT-2
//   prlt ticket unlink TKT-1 TKT-2 --type blocks
```

### Files to Delete
- `apps/cli/src/commands/ticket/link/block.ts`
- `apps/cli/src/commands/ticket/link/relates.ts`
- `apps/cli/src/commands/ticket/link/duplicates.ts`
- `apps/cli/src/commands/ticket/link/remove.ts`
- `apps/cli/src/commands/ticket/link/index.ts`
- `apps/cli/src/commands/ticket/link/` (directory)

### Files to Create
- `apps/cli/src/commands/ticket/link.ts`
- `apps/cli/src/commands/ticket/unlink.ts`

### Testing
1. `prlt ticket link TKT-1 TKT-2 --type blocks` creates a blocks link
2. `prlt ticket link TKT-1 TKT-2 --type relates` creates a relates link
3. `prlt ticket link TKT-1 TKT-2 --type duplicates` creates a duplicates link
4. `prlt ticket unlink TKT-1 TKT-2` removes all links
5. `prlt ticket unlink TKT-1 TKT-2 --type blocks` removes only blocks link
6. JSON mode outputs correct structure for all operations
7. Error cases: missing tickets, invalid type, no existing link

### Acceptance Criteria
- [ ] Old commands deleted
- [ ] New `ticket link` command works with --type flag
- [ ] New `ticket unlink` command works
- [ ] JSON mode supported on both commands
- [ ] Build passes
- [ ] Help text is clear and includes examples

---

## Ticket 2: Consolidate Epic Link Commands

### Summary
Replace 4 separate epic link commands with a single `epic link` command using a `--type` flag, and add `epic unlink` for removal.

### Current State
```
apps/cli/src/commands/epic/link/block.ts
apps/cli/src/commands/epic/link/relates.ts
apps/cli/src/commands/epic/link/duplicates.ts
apps/cli/src/commands/epic/link/remove.ts
apps/cli/src/commands/epic/link/index.ts
```

### Target State
```
apps/cli/src/commands/epic/link.ts
apps/cli/src/commands/epic/unlink.ts
```

### Implementation Details

#### `epic/link.ts`
```typescript
// Command: prlt epic link <source> <target> --type <type>
//
// Args:
//   source: string (required) - Source epic ID
//   target: string (required) - Target epic ID
//
// Flags:
//   --type: enum (required) - One of: blocks, relates, duplicates
//   --json: boolean - Output as JSON for AI agents
//   + pmoBaseFlags
//
// Behavior:
//   1. Resolve both epic IDs
//   2. Validate both exist
//   3. Create link of specified type in storage
//   4. Output success message with link details
//
// Examples:
//   prlt epic link EPIC-1 EPIC-2 --type blocks
//   prlt epic link EPIC-1 EPIC-2 --type relates
```

#### `epic/unlink.ts`
```typescript
// Command: prlt epic unlink <source> <target>
//
// Args:
//   source: string (required) - Source epic ID
//   target: string (required) - Target epic ID
//
// Flags:
//   --type: enum (optional) - Specific type to remove
//   --force: boolean - Skip confirmation
//   --json: boolean - Output as JSON for AI agents
//   + pmoBaseFlags
```

### Files to Delete
- `apps/cli/src/commands/epic/link/block.ts`
- `apps/cli/src/commands/epic/link/relates.ts`
- `apps/cli/src/commands/epic/link/duplicates.ts`
- `apps/cli/src/commands/epic/link/remove.ts`
- `apps/cli/src/commands/epic/link/index.ts`
- `apps/cli/src/commands/epic/link/` (directory)

### Files to Create
- `apps/cli/src/commands/epic/link.ts`
- `apps/cli/src/commands/epic/unlink.ts`

### Testing
1. All link types work via --type flag
2. Unlink removes links correctly
3. JSON mode works
4. Error handling for missing epics

### Acceptance Criteria
- [ ] Old commands deleted
- [ ] New commands work with --type flag
- [ ] JSON mode supported
- [ ] Build passes

---

## Ticket 3: Consolidate Spec Link Commands

### Summary
Replace 4 separate spec link commands with a single `spec link` command using a `--type` flag, and add `spec unlink` for removal.

### Current State
```
apps/cli/src/commands/spec/link/depends.ts
apps/cli/src/commands/spec/link/relates.ts
apps/cli/src/commands/spec/link/duplicates.ts
apps/cli/src/commands/spec/link/remove.ts
apps/cli/src/commands/spec/link/index.ts
```

### Target State
```
apps/cli/src/commands/spec/link.ts
apps/cli/src/commands/spec/unlink.ts
```

### Implementation Details

#### `spec/link.ts`
```typescript
// Command: prlt spec link <source> <target> --type <type>
//
// Args:
//   source: string (required) - Source spec ID
//   target: string (required) - Target spec ID
//
// Flags:
//   --type: enum (required) - One of: depends, relates, duplicates
//   --json: boolean - Output as JSON for AI agents
//   + pmoBaseFlags
//
// Note: Specs use "depends" instead of "blocks" (different semantics)
//
// Examples:
//   prlt spec link SPEC-1 SPEC-2 --type depends
//   prlt spec link SPEC-1 SPEC-2 --type relates
```

#### `spec/unlink.ts`
```typescript
// Command: prlt spec unlink <source> <target>
//
// Same pattern as ticket/epic unlink
```

### Files to Delete
- `apps/cli/src/commands/spec/link/depends.ts`
- `apps/cli/src/commands/spec/link/relates.ts`
- `apps/cli/src/commands/spec/link/duplicates.ts`
- `apps/cli/src/commands/spec/link/remove.ts`
- `apps/cli/src/commands/spec/link/index.ts`
- `apps/cli/src/commands/spec/link/` (directory)

### Files to Create
- `apps/cli/src/commands/spec/link.ts`
- `apps/cli/src/commands/spec/unlink.ts`

### Acceptance Criteria
- [ ] Old commands deleted
- [ ] New commands work with --type flag (including "depends")
- [ ] JSON mode supported
- [ ] Build passes

---

## Ticket 4: Merge Project Archive/Unarchive

### Summary
Combine `project archive` and `project unarchive` into a single command with an `--undo` flag.

### Current State
```
apps/cli/src/commands/project/archive.ts
apps/cli/src/commands/project/unarchive.ts
```

### Target State
```
apps/cli/src/commands/project/archive.ts (modified)
```

### Implementation Details

#### Modified `project/archive.ts`
```typescript
// Command: prlt project archive <id> [--undo]
//
// Args:
//   id: string (required) - Project ID
//
// Flags:
//   --undo: boolean - Unarchive instead of archive
//   --force: boolean - Skip confirmation
//   --json: boolean - Output as JSON for AI agents
//   + pmoBaseFlags
//
// Behavior:
//   If --undo:
//     1. Check project exists and is archived
//     2. Confirm unarchive (unless --force)
//     3. Call storage.unarchiveProject(id)
//     4. Output success message
//   Else:
//     1. Check project exists and is not archived
//     2. Confirm archive (unless --force)
//     3. Call storage.archiveProject(id)
//     4. Output success message with hint about --undo
//
// Examples:
//   prlt project archive my-project
//   prlt project archive my-project --undo
//   prlt project archive my-project --force
//
// Help text should mention:
//   "Use --undo to restore an archived project"
```

### Files to Delete
- `apps/cli/src/commands/project/unarchive.ts`

### Files to Modify
- `apps/cli/src/commands/project/archive.ts` - Add --undo flag

### Migration Notes
- Update any documentation referencing `prlt project unarchive`
- The hint message in archive output should change from:
  `'Unarchive: prlt project unarchive ' + args.id`
  to:
  `'Unarchive: prlt project archive ' + args.id + ' --undo'`

### Testing
1. `prlt project archive <id>` archives a project
2. `prlt project archive <id> --undo` unarchives a project
3. Archiving already-archived project shows appropriate message
4. Unarchiving non-archived project shows appropriate message
5. JSON mode works for both operations
6. --force skips confirmation in both cases

### Acceptance Criteria
- [ ] `project/unarchive.ts` deleted
- [ ] `project/archive.ts` supports --undo flag
- [ ] Help text updated
- [ ] Hint messages updated
- [ ] JSON mode works
- [ ] Build passes

---

## Ticket 5: Merge Epic Archive/Activate

### Summary
Combine `epic archive` and `epic activate` into a single command with an `--undo` flag.

### Current State
```
apps/cli/src/commands/epic/archive.ts
apps/cli/src/commands/epic/activate.ts
```

### Target State
```
apps/cli/src/commands/epic/archive.ts (modified)
```

### Implementation Details

#### Modified `epic/archive.ts`
```typescript
// Command: prlt epic archive <id> [--undo]
//
// Args:
//   id: string (required) - Epic ID
//
// Flags:
//   --undo: boolean - Activate (unarchive) instead of archive
//   --force: boolean - Skip confirmation
//   --json: boolean - Output as JSON for AI agents
//   + pmoBaseFlags
//
// Behavior:
//   Same pattern as project archive
//
// Examples:
//   prlt epic archive EPIC-1
//   prlt epic archive EPIC-1 --undo
```

### Files to Delete
- `apps/cli/src/commands/epic/activate.ts`

### Files to Modify
- `apps/cli/src/commands/epic/archive.ts` - Add --undo flag

### Acceptance Criteria
- [ ] `epic/activate.ts` deleted
- [ ] `epic/archive.ts` supports --undo flag
- [ ] JSON mode works
- [ ] Build passes

---

## Ticket 6: Remove Ticket Cross-Reference Commands

### Summary
Remove standalone commands for setting ticket relationships (epic, project, spec, status) and fold them into `ticket update` as flags.

### Current State
```
apps/cli/src/commands/ticket/epic.ts
apps/cli/src/commands/ticket/project.ts
apps/cli/src/commands/ticket/spec.ts
apps/cli/src/commands/ticket/status.ts
```

### Target State
These commands are deleted. Functionality moves to `ticket update`:
```
prlt ticket update <id> --epic <epic-id>
prlt ticket update <id> --project <project-id>
prlt ticket update <id> --spec <spec-id>
prlt ticket update <id> --status <status-id>
```

### Implementation Details

#### Modified `ticket/update.ts`

Add these flags:
```typescript
static flags = {
  // ... existing flags ...
  epic: Flags.string({
    description: 'Set the epic for this ticket',
    required: false,
  }),
  project: Flags.string({
    description: 'Set the project for this ticket',
    required: false,
  }),
  spec: Flags.string({
    description: 'Set the spec for this ticket',
    required: false,
  }),
  status: Flags.string({
    description: 'Set the status for this ticket',
    required: false,
  }),
  // Allow clearing with empty string or special value
  'clear-epic': Flags.boolean({
    description: 'Remove epic association',
    required: false,
  }),
  'clear-project': Flags.boolean({
    description: 'Remove project association',
    required: false,
  }),
  'clear-spec': Flags.boolean({
    description: 'Remove spec association',
    required: false,
  }),
}
```

In execute():
```typescript
// Handle relationship updates
if (flags.epic) {
  const epic = await this.storage.getEpic(flags.epic);
  if (!epic) {
    return handleError('EPIC_NOT_FOUND', `Epic "${flags.epic}" not found.`);
  }
  await this.storage.setTicketEpic(args.id, flags.epic);
}

if (flags['clear-epic']) {
  await this.storage.setTicketEpic(args.id, null);
}

// Similar for project, spec, status...
```

### Files to Delete
- `apps/cli/src/commands/ticket/epic.ts`
- `apps/cli/src/commands/ticket/project.ts`
- `apps/cli/src/commands/ticket/spec.ts`
- `apps/cli/src/commands/ticket/status.ts`

### Files to Modify
- `apps/cli/src/commands/ticket/update.ts`

### Migration Notes
Before deleting, review each file to ensure all functionality is captured:
- `ticket/epic.ts` - Check for any special validation or prompts
- `ticket/project.ts` - Check for project resolution logic
- `ticket/spec.ts` - Check for spec validation
- `ticket/status.ts` - This might have workflow validation; consider keeping `ticket move` as an alias

### Note on `ticket status` vs `ticket move`
If `ticket/status.ts` has workflow transition logic (e.g., validating allowed status transitions), consider keeping `ticket move` as the primary command for status changes, and only adding `--status` to update for simple cases. Review the implementation before deciding.

### Testing
1. `prlt ticket update TKT-1 --epic EPIC-1` sets epic
2. `prlt ticket update TKT-1 --project proj-1` sets project
3. `prlt ticket update TKT-1 --clear-epic` removes epic
4. Multiple flags work together: `prlt ticket update TKT-1 --epic EPIC-1 --project proj-1`
5. Invalid references produce clear errors
6. JSON mode works

### Acceptance Criteria
- [ ] Cross-reference commands deleted
- [ ] `ticket update` supports --epic, --project, --spec, --status flags
- [ ] Clear flags work (--clear-epic, etc.)
- [ ] JSON mode supported
- [ ] Build passes

---

## Ticket 7: Remove Epic Cross-Reference Commands

### Summary
Remove standalone commands for setting epic relationships and fold them into `epic update` as flags.

### Current State
```
apps/cli/src/commands/epic/project.ts
apps/cli/src/commands/epic/spec.ts
apps/cli/src/commands/epic/ticket.ts
```

### Target State
- `epic/project.ts` and `epic/spec.ts` become flags on `epic update`
- `epic/ticket.ts` is redundant with `ticket create --epic` (verify and delete)

### Implementation Details

#### Modified `epic/update.ts`
```typescript
static flags = {
  // ... existing flags ...
  project: Flags.string({
    description: 'Set the project for this epic',
  }),
  spec: Flags.string({
    description: 'Set the spec for this epic',
  }),
  'clear-project': Flags.boolean({
    description: 'Remove project association',
  }),
  'clear-spec': Flags.boolean({
    description: 'Remove spec association',
  }),
}
```

#### Regarding `epic/ticket.ts`
This command likely creates a ticket under an epic. Verify that `ticket create --epic <id>` provides the same functionality. If so, delete. If `epic ticket` has additional features (like bulk creation or a different UX), document what would be lost.

### Files to Delete
- `apps/cli/src/commands/epic/project.ts`
- `apps/cli/src/commands/epic/spec.ts`
- `apps/cli/src/commands/epic/ticket.ts` (after verification)

### Files to Modify
- `apps/cli/src/commands/epic/update.ts`

### Acceptance Criteria
- [ ] Cross-reference commands deleted
- [ ] `epic update` supports --project, --spec flags
- [ ] Verified `ticket create --epic` covers `epic ticket` use case
- [ ] Build passes

---

## Ticket 8: Remove Project/Spec Cross-Reference Commands

### Summary
Remove standalone commands for setting project-spec relationships.

### Current State
```
apps/cli/src/commands/project/spec.ts
apps/cli/src/commands/spec/ticket.ts
```

### Target State
- `project/spec.ts` becomes `--spec` flag on `project update`
- `spec/ticket.ts` is redundant with `ticket create --spec` (verify and delete)

### Files to Delete
- `apps/cli/src/commands/project/spec.ts`
- `apps/cli/src/commands/spec/ticket.ts` (after verification)

### Files to Modify
- `apps/cli/src/commands/project/update.ts` (if it exists, otherwise create or skip)

### Acceptance Criteria
- [ ] Commands deleted
- [ ] Functionality available via update flags or create flags
- [ ] Build passes

---

## Ticket 9: Merge Ticket Edit into Update

### Summary
Remove `ticket edit` as a separate command; ensure `ticket update` handles all editing functionality.

### Current State
```
apps/cli/src/commands/ticket/edit.ts
apps/cli/src/commands/ticket/update.ts
```

### Target State
```
apps/cli/src/commands/ticket/update.ts (handles all edit functionality)
```

### Implementation Details

1. First, read both files and compare functionality
2. Identify any features in `edit.ts` not present in `update.ts`
3. Migrate missing features to `update.ts`
4. Delete `edit.ts`

Common differences to look for:
- `edit` might open an editor ($EDITOR) for description
- `update` might be flag-based only

If `edit` opens an editor, add `--edit` flag to `update`:
```typescript
static flags = {
  // ... existing flags ...
  edit: Flags.boolean({
    char: 'e',
    description: 'Open description in $EDITOR',
  }),
}
```

### Files to Delete
- `apps/cli/src/commands/ticket/edit.ts`

### Files to Modify
- `apps/cli/src/commands/ticket/update.ts`

### Acceptance Criteria
- [ ] All `edit` functionality available in `update`
- [ ] `edit.ts` deleted
- [ ] Build passes

---

## Ticket 10: Consolidate Roadmap Project Commands

### Summary
Remove `roadmap add-project` and `roadmap remove-project` as separate commands; add flags to `roadmap update`.

### Current State
```
apps/cli/src/commands/roadmap/add-project.ts
apps/cli/src/commands/roadmap/remove-project.ts
```

### Target State
```
apps/cli/src/commands/roadmap/update.ts (with --add-project and --remove-project flags)
```

### Implementation Details

#### Modified `roadmap/update.ts`
```typescript
static flags = {
  // ... existing flags ...
  'add-project': Flags.string({
    description: 'Add a project to this roadmap',
    multiple: true,  // Allow adding multiple projects at once
  }),
  'remove-project': Flags.string({
    description: 'Remove a project from this roadmap',
    multiple: true,
  }),
}

// In execute():
if (flags['add-project']) {
  for (const projectId of flags['add-project']) {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      return handleError('PROJECT_NOT_FOUND', `Project "${projectId}" not found.`);
    }
    await this.storage.addProjectToRoadmap(args.id, projectId);
  }
}

if (flags['remove-project']) {
  for (const projectId of flags['remove-project']) {
    await this.storage.removeProjectFromRoadmap(args.id, projectId);
  }
}
```

### Files to Delete
- `apps/cli/src/commands/roadmap/add-project.ts`
- `apps/cli/src/commands/roadmap/remove-project.ts`

### Files to Modify
- `apps/cli/src/commands/roadmap/update.ts`

### Testing
1. `prlt roadmap update ROADMAP-1 --add-project proj-1`
2. `prlt roadmap update ROADMAP-1 --remove-project proj-1`
3. Multiple projects: `prlt roadmap update ROADMAP-1 --add-project proj-1 --add-project proj-2`
4. Combined with other updates: `prlt roadmap update ROADMAP-1 --name "New Name" --add-project proj-1`

### Acceptance Criteria
- [ ] Old commands deleted
- [ ] `roadmap update` supports --add-project and --remove-project
- [ ] Multiple projects can be added/removed in one command
- [ ] Build passes

---

## Ticket 11: Consolidate Work Spawn Commands

### Summary
Remove `work spawn-all` as a separate command; add `--all` flag to `work spawn`.

### Current State
```
apps/cli/src/commands/work/spawn.ts
apps/cli/src/commands/work/spawn-all.ts
```

### Target State
```
apps/cli/src/commands/work/spawn.ts (with --all flag)
```

### Implementation Details

#### Modified `work/spawn.ts`
```typescript
static flags = {
  // ... existing flags ...
  all: Flags.boolean({
    description: 'Spawn work for all eligible tickets',
    default: false,
  }),
}

// In execute():
if (flags.all) {
  // Logic from spawn-all.ts
  const eligibleTickets = await this.getEligibleTickets();
  for (const ticket of eligibleTickets) {
    await this.spawnWork(ticket);
  }
} else {
  // Existing single-spawn logic
}
```

### Files to Delete
- `apps/cli/src/commands/work/spawn-all.ts`

### Files to Modify
- `apps/cli/src/commands/work/spawn.ts`

### Acceptance Criteria
- [ ] `spawn-all.ts` deleted
- [ ] `work spawn --all` provides same functionality
- [ ] Build passes

---

## Ticket 12: Consolidate Agent Temp Commands

### Summary
Remove `agent temp list` and `agent temp cleanup` as nested commands; add `--temp` flag to `agent list` and create `agent clean` command.

### Current State
```
apps/cli/src/commands/agent/temp/list.ts
apps/cli/src/commands/agent/temp/cleanup.ts
apps/cli/src/commands/agent/temp/index.ts
```

### Target State
```
apps/cli/src/commands/agent/list.ts (with --temp flag)
apps/cli/src/commands/agent/clean.ts (new)
```

### Implementation Details

#### Modified `agent/list.ts`
```typescript
static flags = {
  // ... existing flags ...
  temp: Flags.boolean({
    description: 'Show only temporary agents',
    default: false,
  }),
  all: Flags.boolean({
    description: 'Show all agents including temporary',
    default: false,
  }),
}

// In execute():
let agents = await this.storage.getAgents();
if (flags.temp) {
  agents = agents.filter(a => a.isTemporary);
} else if (!flags.all) {
  agents = agents.filter(a => !a.isTemporary);  // Default: hide temp
}
```

#### New `agent/clean.ts`
```typescript
// Command: prlt agent clean [--temp] [--all] [--force]
//
// Flags:
//   --temp: boolean - Clean only temporary agents (default behavior)
//   --stale: boolean - Clean stale/inactive agents
//   --all: boolean - Clean all cleanable agents
//   --force: boolean - Skip confirmation
//   --json: boolean - Output as JSON
//
// Behavior:
//   1. Find agents matching criteria
//   2. Show list of agents to be cleaned
//   3. Confirm (unless --force)
//   4. Remove agents and their resources
//   5. Output summary
```

### Files to Delete
- `apps/cli/src/commands/agent/temp/list.ts`
- `apps/cli/src/commands/agent/temp/cleanup.ts`
- `apps/cli/src/commands/agent/temp/index.ts`
- `apps/cli/src/commands/agent/temp/` (directory)

### Files to Modify
- `apps/cli/src/commands/agent/list.ts`

### Files to Create
- `apps/cli/src/commands/agent/clean.ts`

### Acceptance Criteria
- [ ] Temp directory and commands deleted
- [ ] `agent list --temp` shows temporary agents
- [ ] `agent clean` handles cleanup
- [ ] Build passes

---

## Ticket 13: Merge Agent Auth and Login

### Summary
Consolidate `agent auth` and `agent login` into a single `agent login` command.

### Current State
```
apps/cli/src/commands/agent/auth.ts
apps/cli/src/commands/agent/login.ts
```

### Target State
```
apps/cli/src/commands/agent/login.ts (handles both)
```

### Implementation Details

1. Read both files to understand the difference between auth and login
2. Common patterns:
   - `login` might initiate OAuth/authentication flow
   - `auth` might check/display current auth status
3. Consolidate:
   - `agent login` - Perform login
   - `agent login --status` - Check auth status (what `auth` did)
   - Or `agent login --check` to verify credentials

```typescript
static flags = {
  status: Flags.boolean({
    description: 'Check current authentication status',
    default: false,
  }),
  refresh: Flags.boolean({
    description: 'Force re-authentication',
    default: false,
  }),
}
```

### Files to Delete
- `apps/cli/src/commands/agent/auth.ts`

### Files to Modify
- `apps/cli/src/commands/agent/login.ts`

### Acceptance Criteria
- [ ] `auth.ts` deleted
- [ ] `agent login` handles authentication
- [ ] `agent login --status` shows auth status
- [ ] Build passes

---

## Ticket 14: Consolidate GH Token Command

### Summary
Remove `gh token` as a separate command; add `--show-token` flag to `gh status`.

### Current State
```
apps/cli/src/commands/gh/login.ts
apps/cli/src/commands/gh/status.ts
apps/cli/src/commands/gh/token.ts
```

### Target State
```
apps/cli/src/commands/gh/login.ts
apps/cli/src/commands/gh/status.ts (with --show-token flag)
```

### Implementation Details

#### Modified `gh/status.ts`
```typescript
static flags = {
  // ... existing flags ...
  'show-token': Flags.boolean({
    description: 'Display the current GitHub token',
    default: false,
  }),
}

// In execute():
if (flags['show-token']) {
  const token = await this.getGitHubToken();
  if (token) {
    this.log(`Token: ${token}`);
  } else {
    this.log('No token configured. Run: prlt gh login');
  }
}
```

### Files to Delete
- `apps/cli/src/commands/gh/token.ts`

### Files to Modify
- `apps/cli/src/commands/gh/status.ts`

### Acceptance Criteria
- [ ] `gh/token.ts` deleted
- [ ] `gh status --show-token` displays token
- [ ] Build passes

---

## Ticket 15: Flatten Template Hierarchy

### Summary
Consolidate duplicate template commands into a single `template/` namespace with `--type` flags.

### Current State (duplicated across 3 locations)
```
apps/cli/src/commands/ticket/template/
apps/cli/src/commands/phase/template/
apps/cli/src/commands/template/ticket/
apps/cli/src/commands/template/phase/
apps/cli/src/commands/template/
```

### Target State
```
apps/cli/src/commands/template/create.ts    --type ticket|phase
apps/cli/src/commands/template/list.ts      --type ticket|phase (optional filter)
apps/cli/src/commands/template/view.ts
apps/cli/src/commands/template/apply.ts
apps/cli/src/commands/template/update.ts
apps/cli/src/commands/template/delete.ts
apps/cli/src/commands/template/save.ts      --from ticket|phase <id>
```

### Implementation Details

#### `template/create.ts`
```typescript
// Command: prlt template create --type <type> [--name <name>]
//
// Flags:
//   --type: enum (required) - ticket | phase
//   --name: string - Template name
//   --description: string - Template description
//
// Behavior varies by type:
//   ticket: Prompt for ticket template fields
//   phase: Prompt for phase template fields
```

#### `template/list.ts`
```typescript
// Command: prlt template list [--type <type>]
//
// Flags:
//   --type: enum (optional) - Filter by ticket | phase
//
// If no --type, show all templates grouped by type
```

#### `template/apply.ts`
```typescript
// Command: prlt template apply <template-id> --to <resource-type> [target-id]
//
// Args:
//   template-id: The template to apply
//
// Flags:
//   --to: enum (required) - ticket | phase | project
//   --target: string - Existing resource to apply to (optional)
//
// If no --target, creates a new resource from the template
```

#### `template/save.ts`
```typescript
// Command: prlt template save --from <type> <id> [--name <name>]
//
// Flags:
//   --from: enum (required) - ticket | phase
//
// Args:
//   id: The resource ID to save as template
//
// Creates a new template from an existing resource
```

### Files to Delete
- `apps/cli/src/commands/ticket/template/` (entire directory)
- `apps/cli/src/commands/phase/template/` (entire directory)
- `apps/cli/src/commands/template/ticket/` (entire directory)
- `apps/cli/src/commands/template/phase/` (entire directory)

### Files to Create/Modify
- `apps/cli/src/commands/template/create.ts`
- `apps/cli/src/commands/template/list.ts`
- `apps/cli/src/commands/template/view.ts`
- `apps/cli/src/commands/template/apply.ts`
- `apps/cli/src/commands/template/update.ts`
- `apps/cli/src/commands/template/delete.ts`
- `apps/cli/src/commands/template/save.ts`

### Migration Notes
This is the largest refactoring. Recommended approach:
1. First, audit all template files to understand feature differences
2. Create the consolidated commands
3. Ensure all features are covered
4. Delete the old commands

### Acceptance Criteria
- [ ] All old template directories deleted
- [ ] Single `template/` namespace with type flags
- [ ] All template operations work for both ticket and phase types
- [ ] JSON mode supported
- [ ] Build passes

---

## Ticket 16: Add Relationship Flags to Create Commands

### Summary
All `create` commands should support setting relationships at creation time, not just via `update`.

### Affected Commands

#### `roadmap/create.ts`
```typescript
static flags = {
  // ... existing flags ...
  project: Flags.string({
    description: 'Add project(s) to this roadmap',
    multiple: true,
  }),
}

// Example:
// prlt roadmap create "Q1 2025" --project proj-1 --project proj-2
```

#### `ticket/create.ts`
```typescript
static flags = {
  // ... existing flags (may already exist) ...
  epic: Flags.string({
    description: 'Assign to epic',
  }),
  project: Flags.string({
    description: 'Assign to project',
  }),
  spec: Flags.string({
    description: 'Link to spec',
  }),
}

// Example:
// prlt ticket create --title "Fix bug" --epic EPIC-1 --project my-proj
```

#### `epic/create.ts`
```typescript
static flags = {
  // ... existing flags (may already exist) ...
  project: Flags.string({
    description: 'Assign to project',
  }),
  spec: Flags.string({
    description: 'Link to spec',
  }),
}

// Example:
// prlt epic create --title "User Auth" --project my-proj --spec SPEC-1
```

#### `spec/create.ts`
```typescript
static flags = {
  // ... existing flags ...
  project: Flags.string({
    description: 'Assign to project',
  }),
  depends: Flags.string({
    description: 'Add dependency on another spec',
    multiple: true,
  }),
}

// Example:
// prlt spec create --title "API Design" --project my-proj --depends SPEC-0
```

### The Full CRUD Pattern for Relationships

| Command | Relationship Handling |
|---------|----------------------|
| `create` | `--epic <id>`, `--project <id>` sets initial relationships |
| `view` | Displays all relationships (no flags needed) |
| `update` | `--epic <id>` replaces, `--add-project <id>` adds, `--remove-project <id>` removes, `--clear-epic` removes |
| `delete` | Removes resource and its relationships (cascade or error if dependencies) |

### Note on Singular vs Plural
- Use singular (`--project`) when only one relationship is allowed (ticket → epic)
- Use `multiple: true` when many relationships are allowed (roadmap → projects)
- Use `--add-X` / `--remove-X` in update for multi-value relationships
- Use just `--X` in update for single-value relationships (replaces)

### Files to Modify
- `apps/cli/src/commands/roadmap/create.ts`
- `apps/cli/src/commands/ticket/create.ts` (verify flags exist)
- `apps/cli/src/commands/epic/create.ts` (verify flags exist)
- `apps/cli/src/commands/spec/create.ts`

### Acceptance Criteria
- [ ] All create commands support relationship flags
- [ ] Relationships are validated (target exists)
- [ ] JSON mode supported
- [ ] Build passes

---

## Execution Order

Recommended order for minimal risk:

### Phase 1: Simple Flag Additions (Low Risk)
1. **Ticket 11** - Work spawn --all (simplest, isolated)
2. **Ticket 14** - GH token → gh status --show-token
3. **Ticket 13** - Agent auth/login merge
4. **Ticket 4** - Project archive --undo
5. **Ticket 5** - Epic archive --undo

### Phase 2: Link Consolidation (Medium Risk)
6. **Ticket 1** - Ticket link consolidation (12 → 2 commands)
7. **Ticket 2** - Epic link consolidation
8. **Ticket 3** - Spec link consolidation

### Phase 3: Update Flag Expansion (Medium Risk)
9. **Ticket 10** - Roadmap add/remove-project → update flags
10. **Ticket 16** - Add relationship flags to create commands
11. **Ticket 9** - Ticket edit → update merge

### Phase 4: Cross-Reference Removal (Higher Risk)
12. **Ticket 6** - Ticket cross-references → update flags
13. **Ticket 7** - Epic cross-references → update flags
14. **Ticket 8** - Project/spec cross-references → update flags

### Phase 5: Structural Changes (Highest Risk)
15. **Ticket 12** - Agent temp → agent list/clean flags
16. **Ticket 15** - Template hierarchy flattening (largest, do last)

---

## Global Requirements

All refactored commands must:

1. **Support JSON mode** - Use `outputPromptAsJson()` pattern from CLAUDE.md
2. **Use list prompts** - Never use Y/n confirms; always use list selection
3. **Include examples** - Static examples array with realistic usage
4. **Pass build** - Run `cd apps/cli && pnpm build` after changes
5. **Preserve functionality** - No feature regression from deleted commands

---

## Summary Table

| Ticket | Description | Files Deleted | Risk |
|--------|-------------|---------------|------|
| 1 | Ticket link consolidation | 5 | Medium |
| 2 | Epic link consolidation | 5 | Medium |
| 3 | Spec link consolidation | 5 | Medium |
| 4 | Project archive --undo | 1 | Low |
| 5 | Epic archive --undo | 1 | Low |
| 6 | Ticket cross-references → update | 4 | Medium |
| 7 | Epic cross-references → update | 3 | Medium |
| 8 | Project/spec cross-references | 2 | Medium |
| 9 | Ticket edit → update | 1 | Low |
| 10 | Roadmap project commands | 2 | Low |
| 11 | Work spawn --all | 1 | Low |
| 12 | Agent temp commands | 3 | Medium |
| 13 | Agent auth/login merge | 1 | Low |
| 14 | GH token → status flag | 1 | Low |
| 15 | Template hierarchy flattening | ~15 | High |
| 16 | Create command relationship flags | 0 (modify only) | Low |
| **Total** | | **~50 files** | |

### Net Result
- **Before:** 196 commands
- **After:** ~160 commands
- **Reduction:** ~36 commands (18% reduction)
- **Benefit:** Cleaner resource-verb-flag pattern, less duplication, easier discoverability
