# Proletariat as THE Monorepo Spec

## Vision
Transform Proletariat from a worktree manager into the complete "Company Operating System" monorepo.

## Proposed Structure

```
/proletariat (THE monorepo)
├── /packages
│   ├── cli/                    # Current proletariat CLI
│   │   ├── package.json        # @proletariat/cli
│   │   └── src/
│   ├── orchestrator/            # Cloud agent orchestrator
│   │   ├── package.json        # @proletariat/orchestrator
│   │   └── src/
│   ├── agent-runtime/           # What runs in each VM
│   │   ├── package.json        # @proletariat/agent
│   │   └── src/
│   └── sms-gateway/             # Text interface
│       ├── package.json        # @proletariat/sms
│       └── src/
├── /apps
│   ├── dashboard/               # Web dashboard (optional)
│   ├── docs/                    # Documentation site
│   └── examples/                # Example companies
│       ├── saas-startup/
│       ├── agency/
│       └── open-source/
├── /templates                   # Company templates
│   ├── default/
│   │   ├── pmo/
│   │   │   ├── kanban.md
│   │   │   └── specs/
│   │   ├── context/
│   │   └── .proletariat/
│   └── ai-first/
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

## Why This Architecture

1. **Proletariat IS the platform** - Not just a tool, but the entire system
2. **npm scope**: `@proletariat/cli`, `@proletariat/orchestrator`, etc.
3. **Templates included**: "Create company" templates ship with it
4. **Dogfooding**: Proletariat itself runs on Proletariat
5. **Single source**: Everything about the state machine company in one place

## Migration Path

```bash
# Current state
/proletariat                    # Just the CLI tool
/inflow-project                 # Separate project using proletariat

# Future state  
/proletariat                    # The entire platform
  ├── packages/cli              # The CLI (current code)
  ├── packages/orchestrator     # Cloud agents
  ├── apps/examples/careerops  # CareerOps as example
  └── templates/saas/           # Template for others
```

## Publishing Strategy

```json
{
  "name": "proletariat",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "publish:cli": "pnpm -F @proletariat/cli publish",
    "publish:all": "pnpm -r publish"
  }
}
```

Individual packages:
- `npm install -g @proletariat/cli` - Just the CLI
- `npm install @proletariat/orchestrator` - For cloud setup
- `npx create-proletariat my-company` - Bootstrap new company

## The Bigger Vision

```
Proletariat Platform
├── CLI (local worktrees)         ✅ Done
├── Cloud Orchestrator             🚧 Next
├── SMS Gateway                    🚧 Next  
├── Company Templates              📋 Planned
├── Agent Marketplace              🔮 Future
└── Hosted Service                 🔮 Future
```

## Benefits of This Approach

1. **Clear product**: "Proletariat" = complete solution
2. **Modular**: Use just CLI or full cloud platform
3. **Examples included**: Real companies as examples
4. **Template ecosystem**: Share company structures
5. **Path to SaaS**: Monorepo → Self-hosted → Cloud service

## Next Steps

1. Move current proletariat code to `/packages/cli`
2. Create workspace structure
3. Add first template from CareerOps learnings
4. Build orchestrator package
5. Document the vision in root README

## This Changes The Narrative

Instead of:
> "I use Proletariat to manage worktrees"

To:
> "My company runs on Proletariat"

It's not a tool anymore - it's an operating system for companies.