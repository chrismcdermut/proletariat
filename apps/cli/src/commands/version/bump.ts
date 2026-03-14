import { Command, Args } from '@oclif/core'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { styles } from '../../lib/styles.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  createMetadata,
  outputSuccessAsJson,
  outputErrorAsJson,
} from '../../lib/prompt-json.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

type BumpType = 'major' | 'minor' | 'patch'

function bumpVersion(current: string, type: BumpType): string {
  const parts = current.split('.').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver version: ${current}`)
  }
  const [major, minor, patch] = parts
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
  }
}

export default class VersionBump extends Command {
  static description = 'Bump the CLI version (major, minor, or patch), commit, push, and create a PR'

  static examples = [
    '<%= config.bin %> version bump patch',
    '<%= config.bin %> version bump minor',
    '<%= config.bin %> version bump major',
    '<%= config.bin %> version bump patch --json',
  ]

  static args = {
    type: Args.string({
      description: 'Version bump type',
      required: true,
      options: ['major', 'minor', 'patch'],
    }),
  }

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(VersionBump)
    const jsonMode = shouldOutputJson(flags)
    const bumpType = args.type as BumpType

    // Read current version from package.json
    const pkgPath = resolve(__dirname, '..', '..', '..', 'package.json')
    let pkg: { version: string; [key: string]: unknown }
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    } catch {
      const msg = `Failed to read package.json at ${pkgPath}`
      if (jsonMode) {
        outputErrorAsJson('PACKAGE_READ_ERROR', msg, createMetadata('version bump', flags))
      }
      this.error(msg)
    }

    const oldVersion = pkg.version
    const newVersion = bumpVersion(oldVersion, bumpType)
    const branchName = `chore/bump-version-to-${newVersion}`

    if (!jsonMode) {
      this.log(`\n${styles.header('Version Bump')}`)
      this.log('─'.repeat(50))
      this.log(`  ${styles.muted('Current:')} ${oldVersion}`)
      this.log(`  ${styles.muted('New:')}     ${newVersion}`)
      this.log(`  ${styles.muted('Type:')}    ${bumpType}`)
      this.log('')
    }

    // Update package.json
    pkg.version = newVersion
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

    if (!jsonMode) {
      this.log(`${styles.success('Updated')} package.json`)
    }

    // Git operations
    try {
      const gitOpts = { encoding: 'utf-8' as const, stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'] }

      execSync(`git checkout -b ${branchName}`, gitOpts)
      if (!jsonMode) {
        this.log(`${styles.success('Created')} branch ${styles.code(branchName)}`)
      }

      execSync(`git add ${pkgPath}`, gitOpts)
      execSync(`git commit -m "chore: bump version to ${newVersion}"`, gitOpts)
      if (!jsonMode) {
        this.log(`${styles.success('Committed')} version bump`)
      }

      execSync(`git push -u origin ${branchName}`, gitOpts)
      if (!jsonMode) {
        this.log(`${styles.success('Pushed')} to origin`)
      }

      // Create PR
      const prTitle = `chore: bump version to ${newVersion}`
      const prBody = [
        '## Summary',
        `- Bump CLI version from ${oldVersion} to ${newVersion} (${bumpType})`,
        '',
        'Automated version bump via `prlt version bump`.',
      ].join('\n')
      const prUrl = execSync(
        `gh pr create --title "${prTitle}" --body ${JSON.stringify(prBody)} --base main`,
        gitOpts,
      ).trim()

      if (jsonMode) {
        outputSuccessAsJson(
          {
            oldVersion,
            newVersion,
            bumpType,
            branch: branchName,
            prUrl,
          },
          createMetadata('version bump', flags),
        )
      }

      this.log(`\n${styles.success('PR created:')} ${prUrl}\n`)
    } catch (error) {
      // Revert package.json on failure
      pkg.version = oldVersion
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

      const msg = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson('GIT_ERROR', msg, createMetadata('version bump', flags))
      }
      this.error(`Git operation failed: ${msg}`)
    }
  }
}
