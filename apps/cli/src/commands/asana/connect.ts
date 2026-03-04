import { Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  AsanaClient,
  clearAsanaConfig,
  getAsanaAccessToken,
  isAsanaConfigured,
  loadAsanaConfig,
  saveAsanaAccessToken,
  saveAsanaProject,
  saveAsanaWorkspace,
} from '../../lib/asana/index.js'

function isLikelyGid(value: string): boolean {
  return /^\d+$/.test(value)
}

export default class AsanaConnect extends PMOCommand {
  static description = 'Authenticate with Asana and configure workspace/project defaults'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --check',
    '<%= config.bin %> <%= command.id %> --workspace "Product Team" --project "Roadmap"',
    'ASANA_ACCESS_TOKEN=... <%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...pmoBaseFlags,
    check: Flags.boolean({
      description: 'Only check if Asana credentials exist (do not prompt)',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force re-authentication even if credentials exist',
      default: false,
    }),
    disconnect: Flags.boolean({
      description: 'Remove stored Asana credentials',
      default: false,
    }),
    workspace: Flags.string({
      description: 'Default workspace gid or name',
    }),
    project: Flags.string({
      description: 'Default project gid or name',
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(AsanaConnect)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (flags.disconnect) {
      clearAsanaConfig(db)
      if (jsonMode) {
        outputSuccessAsJson({ disconnected: true, message: 'Asana credentials removed.' }, createMetadata('asana connect', flags))
        return
      }
      this.log(colors.success('Asana credentials removed.'))
      return
    }

    if (flags.check) {
      if (!isAsanaConfigured(db)) {
        if (jsonMode) {
          outputErrorAsJson('ASANA_NOT_CONFIGURED', 'Asana is not configured. Run "prlt asana connect".', createMetadata('asana connect', flags))
          this.exit(1)
        }
        this.log(colors.warning('Asana is not configured.'))
        this.log(colors.textMuted('Run "prlt asana connect" to authenticate.'))
        this.exit(1)
      }

      const config = loadAsanaConfig(db)!
      try {
        const client = new AsanaClient(config.accessToken)
        const user = await client.verify()
        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            user: user.name,
            email: user.email ?? null,
            workspace: config.workspaceName ?? config.workspaceGid ?? null,
            project: config.projectName ?? config.projectGid ?? null,
          }, createMetadata('asana connect', flags))
          return
        }

        this.log(colors.success('Asana connection is active'))
        this.log(colors.textMuted(`  User: ${user.name}${user.email ? ` (${user.email})` : ''}`))
        if (config.workspaceName || config.workspaceGid) {
          this.log(colors.textMuted(`  Workspace: ${config.workspaceName ?? config.workspaceGid}`))
        }
        if (config.projectName || config.projectGid) {
          this.log(colors.textMuted(`  Project: ${config.projectName ?? config.projectGid}`))
        }
      } catch {
        if (jsonMode) {
          outputErrorAsJson('ASANA_AUTH_INVALID', 'Stored Asana token is invalid or expired.', createMetadata('asana connect', flags))
          this.exit(1)
        }
        this.log(colors.error('Stored Asana token is invalid or expired.'))
        this.log(colors.textMuted('Run "prlt asana connect --force" to re-authenticate.'))
        this.exit(1)
      }
      return
    }

    const existingConfig = loadAsanaConfig(db)
    if (existingConfig && !flags.force) {
      try {
        const client = new AsanaClient(existingConfig.accessToken)
        const user = await client.verify()

        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            user: user.name,
            message: 'Already authenticated. Use --force to re-authenticate.',
          }, createMetadata('asana connect', flags))
          return
        }

        this.log(colors.success('Already connected to Asana'))
        this.log(colors.textMuted(`  User: ${user.name}`))
        this.log(colors.textMuted('Use --force to re-authenticate.'))
        return
      } catch {
        // Continue to re-authenticate with a new token
      }
    }

    let accessToken = getAsanaAccessToken(db)

    if (!accessToken) {
      if (jsonMode) {
        outputErrorAsJson(
          'ACCESS_TOKEN_REQUIRED',
          'Asana access token required. Set ASANA_ACCESS_TOKEN or PRLT_ASANA_ACCESS_TOKEN.',
          createMetadata('asana connect', flags),
        )
        this.exit(1)
      }

      this.log('')
      this.log(colors.primary('Asana Authentication'))
      this.log('')
      this.log('Create a Personal Access Token at:')
      this.log(colors.textSecondary('  https://app.asana.com/0/my-apps'))
      this.log('')

      const { inputToken } = await inquirer.prompt([{
        type: 'password',
        name: 'inputToken',
        message: 'Enter your Asana access token:',
        mask: '*',
        validate: (input: string) => input.trim().length > 0 || 'Access token is required',
      }])
      accessToken = inputToken
    }

    if (!accessToken) {
      if (jsonMode) {
        outputErrorAsJson(
          'ACCESS_TOKEN_REQUIRED',
          'Asana access token required. Set ASANA_ACCESS_TOKEN or PRLT_ASANA_ACCESS_TOKEN.',
          createMetadata('asana connect', flags),
        )
      } else {
        this.log(colors.error('Asana access token is required.'))
      }
      this.exit(1)
    }

    this.log('')
    this.log(colors.textMuted('Verifying Asana access token...'))

    const client = new AsanaClient(accessToken)

    try {
      const user = await client.verify()
      saveAsanaAccessToken(db, accessToken)

      let workspaceGid: string | undefined
      let workspaceName: string | undefined
      let projectGid: string | undefined
      let projectName: string | undefined

      if (flags.workspace) {
        const workspaces = user.workspaces
        if (isLikelyGid(flags.workspace)) {
          const workspace = await client.getWorkspace(flags.workspace)
          if (!workspace) {
            throw new Error(`Workspace ${flags.workspace} not found`)
          }
          workspaceGid = workspace.gid
          workspaceName = workspace.name
        } else {
          const matched = workspaces.find((workspace) => workspace.name.toLowerCase() === flags.workspace!.toLowerCase())
          if (!matched) {
            throw new Error(`Workspace "${flags.workspace}" not found`)
          }
          workspaceGid = matched.gid
          workspaceName = matched.name
        }
      } else if (!jsonMode && user.workspaces.length === 1) {
        workspaceGid = user.workspaces[0].gid
        workspaceName = user.workspaces[0].name
      }

      if (!workspaceGid && !jsonMode && user.workspaces.length > 1) {
        const { selectedWorkspace } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedWorkspace',
          message: 'Select default Asana workspace (optional):',
          choices: [
            { name: 'Skip', value: null },
            ...user.workspaces.map((workspace) => ({
              name: workspace.name,
              value: workspace.gid,
            })),
          ],
          default: null,
        }])

        if (selectedWorkspace) {
          const selected = user.workspaces.find((workspace) => workspace.gid === selectedWorkspace)
          workspaceGid = selected?.gid
          workspaceName = selected?.name
        }
      }

      if (workspaceGid) {
        saveAsanaWorkspace(db, workspaceGid, workspaceName ?? workspaceGid)
      }

      if (flags.project) {
        const projectScope = workspaceGid ?? loadAsanaConfig(db)?.workspaceGid
        if (isLikelyGid(flags.project)) {
          const project = await client.getProject(flags.project)
          if (!project) {
            throw new Error(`Project ${flags.project} not found`)
          }
          projectGid = project.gid
          projectName = project.name
        } else if (projectScope) {
          const projects = await client.listProjects(projectScope)
          const matched = projects.find((project) => project.name.toLowerCase() === flags.project!.toLowerCase())
          if (!matched) {
            throw new Error(`Project "${flags.project}" not found in selected workspace`)
          }
          projectGid = matched.gid
          projectName = matched.name
        } else {
          throw new Error('A workspace must be configured before selecting a project by name.')
        }
      }

      if (projectGid) {
        saveAsanaProject(db, projectGid, projectName ?? projectGid)
      }

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          user: user.name,
          email: user.email ?? null,
          workspace: workspaceName ?? null,
          project: projectName ?? null,
        }, createMetadata('asana connect', flags))
        return
      }

      this.log(colors.success('Connected to Asana'))
      this.log(colors.textMuted(`  User: ${user.name}${user.email ? ` (${user.email})` : ''}`))
      if (workspaceName) {
        this.log(colors.textMuted(`  Workspace: ${workspaceName}`))
      }
      if (projectName) {
        this.log(colors.textMuted(`  Project: ${projectName}`))
      }
      this.log('')
      this.log(colors.textMuted('Run "prlt asana sync" to sync mapped tickets to Asana tasks.'))
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson(
          'ASANA_CONNECT_FAILED',
          `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
          createMetadata('asana connect', flags),
        )
        this.exit(1)
      }

      this.error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
