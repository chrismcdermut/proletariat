# Compatibility Analysis: Old Configs vs New Managers

## The Problem

The new manager pattern **DOES break compatibility** with old configs because:

### 1. Managers Require HQ Structure
```typescript
// Managers expect these fields:
interface HQConfig {
  type: 'hq';        // Old configs don't have this
  repos: string[];   // Old configs don't have this
  agentAccess: {};   // Old configs don't have this
}
```

### 2. Old Commands Won't Work
Simple mode users (v0.1.x - v0.2.x) would lose functionality:
- ❌ `prlt hire` - AgentManager expects HQ
- ❌ `prlt fire` - AgentManager expects HQ  
- ❌ `prlt staff` - AgentManager expects HQ

## Solutions

### Option 1: Two Code Paths (Recommended)
Keep both old and new code, choose based on config:

```typescript
// In prlt.ts
if (isHQMode()) {
  // Use new managers
  const managers = getManagers();
  managers.agent.add(agents);
} else {
  // Use old functions
  await hireAgents(agents); // Keep old implementation
}
```

**Pros:**
- ✅ Nothing breaks
- ✅ Old users keep working
- ✅ New users get new features

**Cons:**
- ❌ Duplicate code
- ❌ More maintenance

### Option 2: Force Migration (Breaking)
Require all users to upgrade:

```typescript
// On any command
if (!isHQMode()) {
  console.error('Please run: prlt migrate MyHQ');
  process.exit(1);
}
```

**Pros:**
- ✅ Clean codebase
- ✅ Single code path

**Cons:**
- ❌ **Breaks all existing users**
- ❌ Bad user experience
- ❌ Could lose users

### Option 3: Adapter Pattern (Hybrid)
Create adapters that make old configs work with managers:

```typescript
class SimpleAgentAdapter {
  // Mimics AgentManager but for simple mode
  add(agents: string[]) {
    // Old worktree logic
  }
}

function getManagers() {
  if (config.type === 'hq') {
    return new AgentManager();
  } else {
    return new SimpleAgentAdapter(); // Same interface
  }
}
```

**Pros:**
- ✅ Single interface
- ✅ Gradual migration
- ✅ Type safety

**Cons:**
- ❌ Complex adapters
- ❌ Some features impossible in simple mode

## What Actually Breaks

### For Simple Mode Users (Most Users?)

Currently working:
```bash
prlt init                # Creates simple config
prlt hire bezos         # Creates worktree
prlt staff              # Shows agents
```

Would break with managers:
```bash
prlt hire bezos         # ERROR: Not in HQ mode
prlt staff              # ERROR: No HQ config
```

### For HQ Users (New Feature)
No one has HQ mode yet, so nothing breaks for them.

## Recommendation

### Short Term (v0.3.0)
**Keep both code paths:**

```typescript
// Check mode and route appropriately
const managers = getManagers(); // Returns null for simple mode

if (managers) {
  // New manager code for HQ
  await managers.agent.add(agents);
} else {
  // Old code for simple mode
  await hireAgents(agents);
}
```

### Long Term (v1.0.0)
1. Add telemetry to see usage
2. Deprecation warnings in v0.4.0
3. Migration tools
4. Remove old code in v1.0.0

## The Reality Check

**We don't know:**
- How many users have simple mode
- If anyone uses this at all
- What commands they rely on

**Safe approach:**
1. **Don't break anything** in minor versions
2. **Add new features** alongside old
3. **Measure usage** (with consent)
4. **Plan deprecation** based on data

## Immediate Action

For the current refactor:
1. ✅ Keep old functions (`hireAgents`, `fireAgents`, etc.)
2. ✅ Use managers only for HQ mode
3. ✅ Route based on config type
4. ✅ Test both paths

This means:
- Old users: Everything still works
- New users: Get HQ features
- Codebase: More complex but safe