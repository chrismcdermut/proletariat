# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2024-10-24

### Breaking Changes
- **Terminology Update**: Changed "workspace" to "HQ" for top-level directories to avoid confusion with individual agent workspaces
- CLI flags renamed: `--workspace` → `--hq`, `--workspace-root` → `--hq-root`
- Configuration field renamed: `workspaceName` → `hqName`, layout mode `"workspace"` → `"hq"`

### Added
- **Smart Repair Command**: Automatically detects and fixes broken worktree references after directory moves
- **Orphaned Worktree Discovery**: Repair command now finds and re-registers worktree directories that exist but aren't tracked by git
- **Post-Upgrade Detection**: Repair command detects when running from old `-workspace` directories and uses correct `-hq` paths
- **Directory Rename Option**: `prlt upgrade` can optionally rename `-workspace` directories to `-hq` during upgrade
- **Missing File Creation**: Repair command creates missing `commondir` files essential for worktree functionality
- **Backwards Compatibility**: Legacy `--workspace` flags still work (will be removed in v1.0)

### Fixed
- **Worktree Path Issues**: Fixed broken git worktree references when repositories are moved or renamed
- **Missing Metadata**: Ensure all required git worktree metadata files are created during repair
- **Configuration Migration**: Automatic migration from old `config.json` to new `repo.json` format

### Changed
- **Upgrade Workflow**: `prlt upgrade` now automatically fixes worktrees after directory renames
- **Error Messages**: Improved error handling and user feedback during upgrades and repairs

### Migration Notes
- Run `prlt upgrade` in existing repositories to migrate configuration and optionally rename directories
- Old `--workspace` flags are deprecated but still functional for backwards compatibility
- All worktree functionality is preserved - only terminology and organization has changed

## [0.1.4] - 2024-10-22

### Added
- Initial repair and health check commands
- Configuration migration from config.json to repo.json format
- Workspace layout support for organizing multiple repositories

### Fixed
- Worktree reference issues after repository moves
- Configuration compatibility between versions

## [0.1.3] - 2024-10-21

### Added
- Multiple theme support (billionaires, toyotas, companies)
- Themed command interface (hire/fire, drive/park, buy/sell)
- Agent workspace management with git worktrees

### Changed
- Improved CLI help and documentation
- Enhanced error handling

## [0.1.2] - 2024-10-20

### Fixed
- Package distribution and installation issues
- CLI command registration

## [0.1.1] - 2024-10-19

### Added
- Basic worktree creation and management
- Theme-based agent organization
- Git worktree integration

## [0.1.0] - 2024-10-18

### Added
- Initial release of PROLETARIAT CLI
- Basic worktree management functionality
- Theme system for organizing development workspaces