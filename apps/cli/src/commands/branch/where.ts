import { Args, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import { isGitRepo, isTicketId } from '../../lib/branch/index.js'
import { openWorkspaceDatabase, AgentWorktree } from '../../lib/database/index.js'

interface WorktreeInfo {
  path: string
  branch: string
  commit: string
  bare?: boolean
  detached?: boolean
}

export default class BranchWhere extends PMOCommand {
  static description = 'Find which directory a branch is checked out in'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-468',
    '<%= config.bin %> <%= command.id %> feat/chris/add-auth',
    '<%= config.bin %> <%= command.id %> TKT-468 --json',
  ]

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
  }

  static args = {
    search: Args.string({
      description: 'Branch name or ticket ID to search for',
      required: true,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(BranchWhere)
    const search = args.search

    // Check if in git repo
    if (!isGitRepo()) {
      this.error('Not in a git repository.')
    }

    // Get all worktrees from git
    const worktrees = this.getGitWorktrees()

    // Search for matching branches
    const matches = this.findMatchingWorktrees(worktrees, search)

    // Also check the database for agent worktrees
    const dbMatches = this.findDatabaseWorktrees(search)

    // Combine results, preferring git worktree info
    const allMatches = this.mergeResults(matches, dbMatches)

    if (allMatches.length === 0) {
      if (flags.json) {
        this.log(JSON.stringify({ found: false, search, matches: [] }, null, 2))
      } else {
        this.log(styles.muted(`\nNo worktree found for "${search}"\n`))
      }
      return
    }

    if (flags.json) {
      this.log(JSON.stringify({
        found: true,
        search,
        matches: allMatches.map(m => ({
          path: m.path,
          branch: m.branch,
          commit: m.commit,
        })),
      }, null, 2))
    } else {
      this.log('')
      if (allMatches.length === 1) {
        const match = allMatches[0]
        this.log(styles.header(`Branch: ${match.branch}`))
        this.log(`Path: ${styles.success(match.path)}`)
        if (match.commit) {
          this.log(`Commit: ${styles.muted(match.commit)}`)
        }
      } else {
        this.log(styles.header(`Found ${allMatches.length} matching worktrees:`))
        this.log('')
        for (const match of allMatches) {
          this.log(`  ${styles.success(match.branch)}`)
          this.log(`    ${match.path}`)
          if (match.commit) {
            this.log(`    ${styles.muted(`commit: ${match.commit}`)}`)
          }
          this.log('')
        }
      }
      this.log('')
    }
  }

  private getGitWorktrees(): WorktreeInfo[] {
    try {
      const output = execSync('git worktree list --porcelain', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const worktrees: WorktreeInfo[] = []
      let current: Partial<WorktreeInfo> = {}

      for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (current.path) {
            worktrees.push(current as WorktreeInfo)
          }
          current = { path: line.substring(9) }
        } else if (line.startsWith('HEAD ')) {
          current.commit = line.substring(5)
        } else if (line.startsWith('branch refs/heads/')) {
          current.branch = line.substring(18)
        } else if (line === 'bare') {
          current.bare = true
        } else if (line === 'detached') {
          current.detached = true
        }
      }

      // Don't forget the last entry
      if (current.path) {
        worktrees.push(current as WorktreeInfo)
      }

      return worktrees.filter(w => w.branch && !w.bare)
    } catch {
      return []
    }
  }

  private findMatchingWorktrees(worktrees: WorktreeInfo[], search: string): WorktreeInfo[] {
    const searchLower = search.toLowerCase()
    const isTicket = isTicketId(search)

    return worktrees.filter(w => {
      if (!w.branch) return false
      const branchLower = w.branch.toLowerCase()

      // Exact match
      if (branchLower === searchLower) return true

      // If searching by ticket ID, match branches that start with it
      if (isTicket && branchLower.startsWith(searchLower + '/')) {
        return true
      }

      // Partial match: branch contains the search term
      if (branchLower.includes(searchLower)) return true

      return false
    })
  }

  private findDatabaseWorktrees(search: string): WorktreeInfo[] {
    try {
      const workspacePath = this.getWorkspacePath()
      if (!workspacePath) return []

      const db = openWorkspaceDatabase(workspacePath)
      const searchLower = search.toLowerCase()
      const isTicket = isTicketId(search)

      // Query for matching branches
      let query: string
      let params: string[]

      if (isTicket) {
        // Match branches starting with ticket ID
        query = 'SELECT * FROM agent_worktrees WHERE LOWER(branch) LIKE ?'
        params = [`${searchLower}/%`]
      } else {
        // Match branches containing the search term
        query = 'SELECT * FROM agent_worktrees WHERE LOWER(branch) LIKE ?'
        params = [`%${searchLower}%`]
      }

      const rows = db.prepare(query).all(...params) as AgentWorktree[]
      db.close()

      return rows.map(row => ({
        path: path.join(workspacePath, row.worktree_path),
        branch: row.branch,
        commit: row.last_commit_hash || '',
      }))
    } catch {
      return []
    }
  }

  private getWorkspacePath(): string | null {
    // Try to find workspace by looking for .proletariat directory
    let current = process.cwd()
    const root = path.parse(current).root

    while (current !== root) {
      try {
        const dbPath = path.join(current, '.proletariat', 'workspace.db')
        // eslint-disable-next-line unicorn/prefer-module
        const fs = require('node:fs')
        if (fs.existsSync(dbPath)) {
          return current
        }
      } catch {
        // Continue searching
      }
      current = path.dirname(current)
    }

    return null
  }

  private mergeResults(gitWorktrees: WorktreeInfo[], dbWorktrees: WorktreeInfo[]): WorktreeInfo[] {
    // Use git worktrees as primary source, add any db-only entries
    const seen = new Set(gitWorktrees.map(w => w.branch))
    const merged = [...gitWorktrees]

    for (const dbw of dbWorktrees) {
      if (!seen.has(dbw.branch)) {
        merged.push(dbw)
        seen.add(dbw.branch)
      }
    }

    return merged
  }
}
