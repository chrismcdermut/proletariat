# Directive (Planned)

This folder will house the orchestration/PMO layer that coordinates multiple agent packages:

- agent lifecycle orchestration (start/stop workflows across repos)
- shared automation and task routing
- higher-level project dashboards that build on the worktree primitives in `apps/proletariat`

When development begins, this package will live alongside the CLI and ship as `@proletariat/directive`.
