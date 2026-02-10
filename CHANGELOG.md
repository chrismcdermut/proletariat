# Changelog

All notable changes to this project will be documented in this file.

## [0.3.27] - 2026-02-10

### Added
- TKT-932: Add JSON output and non-TTY auto-detection to remaining commands
- TKT-933: Add `--description-file` flag to `ticket create`
- TKT-937: Add `--label` as alias for `--labels` on `ticket create`
- TKT-931: Add git tagging to npm publish script

### Fixed
- TKT-936: Add strict parameter validation to all MCP tools
- TKT-940: Orphaned default project causes ticket command crashes
- TKT-934: Devcontainer should set git config to user's GitHub identity
- TKT-938: `workspace prune` needs confirmation or dry-run default
- TKT-939: Execution list table formatting broken by emoji characters
- TKT-935: `pmo init --json` still triggers interactive prompt for board template

## [0.3.24] - 2026-02-06

### Changed
- TKT-877: Version bump and maintenance release

## [0.3.17] - 2025-01-30

### Added
- TKT-713: Automatic version update notifications via `@oclif/plugin-warn-if-update-available`

### Changed
- TKT-723: Configure pnpm to use container-local store to prevent contention in containerized environments
- TKT-670: Upgrade better-sqlite3 to v12.6.2 for Node 23+ support

### Removed
- TKT-209: Remove legacy `apps/cli-old` directory

## [0.3.16] - 2025-01-28

### Changed
- TKT-706: Version bump and maintenance release

## [0.3.15] - 2025-01-27

### Added
- TKT-681: Add setup help CTA to post-init success message

### Fixed
- TKT-704: Update README image URLs for npm
- TKT-701: Add PRLT_MOUNT_MODE=worktree env var to raw Docker runner
- TKT-696: Add missing repo worktree mounts to raw Docker runner

### Changed
- TKT-699: Extract repoWorktrees detection into shared context.ts module

## [0.3.14] - 2025-01-26

### Added
- TKT-686: Git worktree support for live file sync with host

### Fixed
- TKT-691: Remove unset DEVCONTAINER from tmux script
- TKT-677: Add rule for agents to use globally installed prlt command

## [0.3.13] - 2025-01-25

### Changed
- README CTA update

## [0.3.12] - 2025-01-24

### Changed
- README consolidation and support CTA updates

## [0.3.11] - 2025-01-23

### Added
- TKT-496: Open terminal tabs in background + fix execution ID collisions

### Fixed
- TKT-454: Use tmux -CC control mode for iTerm native scrolling
