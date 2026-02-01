# Contributing to Proletariat

This guide covers development patterns and best practices for contributing to the proletariat CLI.

## Development Setup

```bash
# Install dependencies
pnpm install

# Build the CLI
cd apps/cli && pnpm build

# Run tests
./test-cli.sh
```

## FlagResolver Pattern

The `FlagResolver` is a unified abstraction for handling interactive prompts in both human and machine (JSON) modes. It ensures consistent behavior across both modes while reducing code duplication.

### The Problem

Previously, commands had two separate code paths:
- **Human interactive mode:** Uses inquirer prompts, collects input, executes action
- **Machine/JSON mode:** Outputs prompt schema as JSON, exits without executing

This led to duplicated logic and potential inconsistencies when prompts changed.

### The Solution

Both modes now use the same underlying pattern: **prompts PRODUCE flags**. The execution logic only sees flags, not prompt results.

```typescript
import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';

// Check if JSON mode is active
const jsonMode = shouldOutputJson(flags);

// Create resolver
const resolver = new FlagResolver<{ column?: string; title?: string }>({
  commandName: 'ticket create',
  baseCommand: 'prlt ticket create',
  jsonMode,
  flags,
  context: { projectId },
});

// Add prompts for missing flags
resolver.addPrompt({
  flagName: 'column',
  type: 'list',
  message: 'Select column:',
  choices: () => columns.map(c => ({ name: c, value: c })),
  when: (ctx) => !ctx.flags.column,  // Only prompt if flag not provided
});

resolver.addPrompt({
  flagName: 'title',
  type: 'input',
  message: 'Enter title:',
  when: (ctx) => !ctx.flags.title && ctx.flags.column !== undefined,
  validate: (value) => (value as string).length > 0 || 'Title is required',
});

// Resolve missing flags
// - In JSON mode: outputs first unresolved prompt as JSON and exits
// - In interactive mode: prompts user for each missing flag
const resolvedFlags = await resolver.resolve();

// Now use resolvedFlags.column and resolvedFlags.title
```

### FlagResolver API

#### Constructor Options

| Option | Type | Description |
|--------|------|-------------|
| `commandName` | `string` | Command name for metadata (e.g., "ticket create") |
| `baseCommand` | `string` | Base command for building commands (e.g., "prlt ticket create") |
| `jsonMode` | `boolean` | Whether JSON mode is active |
| `flags` | `Partial<TFlags>` | Initial flags from CLI parsing |
| `args` | `Record<string, unknown>` | Command args (optional) |
| `context` | `Record<string, unknown>` | Additional custom context (optional) |

#### Prompt Definition

```typescript
interface PromptDefinition<TValue, TFlags> {
  flagName: string;                    // Flag this prompt resolves
  type: 'list' | 'checkbox' | 'input' | 'confirm' | 'editor';
  message: string | ((ctx) => string); // Prompt message
  choices?: (ctx) => ResolverChoice[]; // For list/checkbox (can be async)
  default?: TValue | ((ctx) => TValue);
  validate?: (value, ctx) => boolean | string;
  when?: (ctx) => boolean;             // Conditional prompt
  transform?: (value, ctx) => unknown; // Transform value before storing
  context?: Record<string, unknown>;   // Additional context for JSON mode
  getCommand?: (value, ctx) => string; // Custom command builder
}
```

#### Context Object

The `ctx` object passed to functions contains:

```typescript
interface ResolverContext<TFlags> {
  flags: TFlags;           // Currently resolved flags
  args: Record<string, unknown>;
  commandName: string;
  baseCommand: string;
  projectId?: string;
  [key: string]: unknown;  // Custom context
}
```

### Best Practices

#### 1. Use FlagResolver for prompts that should work in JSON mode

```typescript
// Good - works in both modes
const resolver = new FlagResolver({ jsonMode, flags, ... });
resolver.addPrompt({ flagName: 'column', ... });
const resolved = await resolver.resolve();

// Avoid - requires separate JSON mode handling
if (jsonMode) {
  outputPromptAsJson(buildPromptConfig(...));
  return;
}
const { column } = await inquirer.prompt([...]);
```

#### 2. Keep complex interactive flows separate

Some prompts have complex conditional logic that doesn't fit the flag resolution pattern. For example, retry loops with Docker checks. These can remain as interactive-only flows.

```typescript
// Complex interactive flow - keep as-is
let environmentSelected = false;
while (!environmentSelected) {
  if (!isDockerRunning()) {
    // Show warning, offer retry
    continue;
  }
  // ...
}
```

#### 3. Use the `when` option for conditional prompts

```typescript
resolver.addPrompt({
  flagName: 'title',
  type: 'input',
  message: 'Enter title:',
  // Only prompt for title after column is selected
  when: (ctx) => !ctx.flags.title && ctx.flags.column !== undefined,
});
```

#### 4. Provide helpful context for input prompts

```typescript
resolver.addPrompt({
  flagName: 'title',
  type: 'input',
  message: 'Enter title:',
  context: (ctx) => ({
    hint: `Provide with: ${ctx.baseCommand} --title "Your title"`,
    requiredFields: ['--title'],
    optionalFields: ['--priority', '--category'],
  }),
});
```

### JSON Mode Output

In JSON mode, FlagResolver outputs prompt configuration and exits:

```json
{
  "prompt": {
    "type": "list",
    "name": "column",
    "message": "Select column:",
    "choices": [
      { "name": "Backlog", "value": "Backlog", "command": "prlt ticket create --column \"Backlog\" --json" }
    ]
  },
  "metadata": {
    "command": "ticket create",
    "flags": { "json": true },
    "timestamp": "2024-01-30T..."
  }
}
```

AI agents can parse this, make selections, and call the next command with the appropriate flag.

### Migration Guide

To migrate a command to use FlagResolver:

1. Import FlagResolver:
   ```typescript
   import { FlagResolver, shouldOutputJson } from '../../lib/flags/index.js';
   ```

2. Identify prompts that have both JSON mode and interactive handling

3. Create a FlagResolver with command info and current flags

4. Add prompts using `addPrompt()` for each missing flag

5. Call `resolve()` to get complete flags

6. Remove the old separate JSON mode and interactive handling

## JSON Mode Guidelines

From CLAUDE.md - always follow these patterns:

### Always include JSON output pattern for prompts

```typescript
// 1. Define choices and message ONCE (reuse for both modes)
const choices = [
  { name: 'Option A', value: 'a' },
  { name: 'Option B', value: 'b' },
];
const message = 'Select an option:';

// 2. Use FlagResolver instead of manual handling
const resolver = new FlagResolver({ jsonMode, flags, ... });
resolver.addPrompt({
  flagName: 'fieldName',
  type: 'list',
  message,
  choices: () => choices,
});
const resolved = await resolver.resolve();
```

### Never use Y/n confirm prompts

Always use list selection (Yes/No choices) instead of typing y/n:

```typescript
// Good
resolver.addPrompt({
  flagName: 'confirmed',
  type: 'list',
  message: 'Continue?',
  choices: () => [
    { name: 'Yes', value: true },
    { name: 'No', value: false },
  ],
});
```

## Testing

After making changes:

```bash
# Build the CLI
cd apps/cli && pnpm build

# Run tests
./test-cli.sh
```

Verify:
- JSON output matches expected format
- Interactive prompts work correctly
- All existing tests pass
