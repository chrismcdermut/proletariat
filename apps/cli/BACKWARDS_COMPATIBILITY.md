# Backwards Compatibility Strategy

## Current Situation

**Published Versions**: 0.1.0, 0.1.1, 0.1.2, 0.1.3, 0.1.4, 0.2.0

**Problem**: We don't have a clear history of what commands existed in each version or how they've changed.

## Realistic Approach

### 1. Don't Break Existing Installations

Since we don't know exactly what people have installed, the safest approach is:

```typescript
// When reading configs, support multiple formats
function loadConfig() {
  // Try new format first
  if (fs.existsSync('.proletariat/repo.json')) {
    return JSON.parse(fs.readFileSync('.proletariat/repo.json'));
  }
  // Fall back to old format
  if (fs.existsSync('.proletariat/config.json')) {
    const oldConfig = JSON.parse(fs.readFileSync('.proletariat/config.json'));
    // Auto-migrate if needed
    return migrateConfig(oldConfig);
  }
}
```

### 2. Version Detection Without History

Since we don't know the command history, we should:

1. **Assume current structure** - The current commands are what we support
2. **Graceful fallbacks** - If a command doesn't exist, suggest alternatives
3. **Config-based detection** - Use config structure to determine capabilities

```typescript
function detectCapabilities(config: any) {
  // Check config structure to determine what's supported
  if (config.type === 'hq') {
    // HQ mode - full feature set
    return ['agents', 'repos', 'tickets', 'pmo'];
  } else if (config.agents && Array.isArray(config.agents)) {
    // Simple mode with agents
    return ['agents'];
  } else {
    // Minimal mode
    return [];
  }
}
```

### 3. Safe Upgrade Path

Instead of trying to support unknown old versions:

```bash
# Always provide a safe upgrade command
prlt upgrade --backup

# Which does:
1. Backs up current config
2. Migrates to latest format
3. Preserves all data
4. Can rollback if needed
```

### 4. Testing Strategy

Since we don't know historical commands, test what we CAN:

```typescript
describe('Config Migration', () => {
  it('should handle any JSON config without crashing', () => {
    const configs = [
      {}, // Empty
      { agents: [] }, // Partial
      { version: '0.0.1', random: 'field' }, // Unknown version
      { projectName: 'test' }, // Minimal
    ];
    
    configs.forEach(config => {
      expect(() => loadConfig(config)).not.toThrow();
    });
  });
  
  it('should preserve all data during migration', () => {
    const oldConfig = {
      customField: 'should-survive',
      agents: ['bezos'],
      anyField: { nested: 'data' }
    };
    
    const migrated = migrateConfig(oldConfig);
    
    // All data should be somewhere
    expect(JSON.stringify(migrated)).toContain('should-survive');
    expect(migrated.agents || migrated._legacy?.agents).toContain('bezos');
  });
});
```

## Practical Compatibility Rules

### ✅ DO:
1. **Always backup** before destructive changes
2. **Preserve unknown fields** in a `_legacy` object
3. **Auto-migrate** when safe to do so
4. **Warn clearly** when features aren't available
5. **Provide upgrade path** for new features

### ❌ DON'T:
1. **Delete user data** even if unknown
2. **Assume command history** we don't have
3. **Force upgrades** without user consent
4. **Break working setups** for purity

## Implementation Checklist

- [x] Support both `.proletariat/config.json` and `.proletariat/repo.json`
- [ ] Add `--backup` flag to all destructive commands
- [ ] Create rollback mechanism
- [ ] Add telemetry to understand usage (with consent)
- [ ] Document migration path clearly

## Version-Agnostic Features

Make commands work regardless of config version:

```typescript
// Instead of version checking:
if (config.version === '3.0.0') { /* ... */ }

// Use feature detection:
if (config.type === 'hq' && config.repos) { /* HQ features */ }
else if (config.agents) { /* Simple agent features */ }
else { /* Basic features */ }
```

## User Communication

When things might break:

```bash
$ prlt some-command

⚠️  This command requires upgrading your configuration.
    Current: Unknown/Legacy format
    Required: v3.0.0

    Your data will be preserved and backed up.
    
    Upgrade now? (Y/n): _
```

## The Reality

**We don't know**:
- What commands existed in v0.1.0 - v0.1.4
- How many people are using old versions
- What their configs look like

**We do know**:
- Current command structure
- Need to not break things
- Can provide upgrade paths

**Best approach**:
1. Make current version robust
2. Handle any config gracefully
3. Provide clear upgrade paths
4. Learn from telemetry (if added)
5. Don't pretend we know the history

## For New Development

Going forward:
1. **Semantic Versioning** - Breaking changes = major version
2. **Changelog** - Document every change
3. **Deprecation Warnings** - Give users time
4. **Feature Flags** - Roll out gradually
5. **Config Versions** - Always include version field