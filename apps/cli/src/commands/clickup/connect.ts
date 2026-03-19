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
  ClickUpClient,
  clearClickUpConfig,
  getClickUpApiKey,
  isClickUpConfigured,
  loadClickUpConfig,
  saveClickUpApiKey,
  saveClickUpWorkspace,
  saveClickUpSpace,
  saveClickUpList,
} from '../../lib/clickup/index.js'
import { upsertProviderSource, removeProviderSourcesByProvider } from '../../lib/work-source/provider-sources.js'

export default class ClickUpConnect extends PMOCommand {
  static description = 'Authenticate with ClickUp and configure workspace/space/list defaults'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --check',
    '<%= config.bin %> <%= command.id %> --workspace "My Workspace" --list "Sprint Backlog"',
    'CLICKUP_API_KEY=... <%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...pmoBaseFlags,
    check: Flags.boolean({
      description: 'Only check if ClickUp credentials exist (do not prompt)',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Force re-authentication even if credentials exist',
      default: false,
    }),
    disconnect: Flags.boolean({
      description: 'Remove stored ClickUp credentials',
      default: false,
    }),
    workspace: Flags.string({
      description: 'Default workspace ID or name',
    }),
    space: Flags.string({
      description: 'Default space ID or name',
    }),
    list: Flags.string({
      description: 'Default list ID or name',
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ClickUpConnect)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (flags.disconnect) {
      clearClickUpConfig(db)
      removeProviderSourcesByProvider(db, 'clickup')
      if (jsonMode) {
        outputSuccessAsJson({ disconnected: true, message: 'ClickUp credentials removed.' }, createMetadata('clickup connect', flags))
        return
      }
      this.log(colors.success('ClickUp credentials removed.'))
      return
    }

    if (flags.check) {
      if (!isClickUpConfigured(db)) {
        if (jsonMode) {
          outputErrorAsJson('CLICKUP_NOT_CONFIGURED', 'ClickUp is not configured. Run "prlt clickup connect".', createMetadata('clickup connect', flags))
          return
        }
        this.log(colors.warning('ClickUp is not configured.'))
        this.log(colors.textMuted('Run "prlt clickup connect" to authenticate.'))
        this.exit(1)
      }

      const config = loadClickUpConfig(db)!
      try {
        const client = new ClickUpClient(config.apiKey)
        const user = await client.verify()
        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            user: user.username,
            email: user.email ?? null,
            workspace: config.workspaceName ?? config.workspaceId ?? null,
            space: config.spaceName ?? config.spaceId ?? null,
            list: config.listName ?? config.listId ?? null,
          }, createMetadata('clickup connect', flags))
          return
        }

        this.log(colors.success('ClickUp connection is active'))
        this.log(colors.textMuted(`  User: ${user.username}${user.email ? ` (${user.email})` : ''}`))
        if (config.workspaceName || config.workspaceId) {
          this.log(colors.textMuted(`  Workspace: ${config.workspaceName ?? config.workspaceId}`))
        }
        if (config.spaceName || config.spaceId) {
          this.log(colors.textMuted(`  Space: ${config.spaceName ?? config.spaceId}`))
        }
        if (config.listName || config.listId) {
          this.log(colors.textMuted(`  List: ${config.listName ?? config.listId}`))
        }
      } catch {
        if (jsonMode) {
          outputErrorAsJson('CLICKUP_AUTH_INVALID', 'Stored ClickUp API key is invalid.', createMetadata('clickup connect', flags))
          return
        }
        this.log(colors.error('Stored ClickUp API key is invalid.'))
        this.log(colors.textMuted('Run "prlt clickup connect --force" to re-authenticate.'))
        this.exit(1)
      }
      return
    }

    const existingConfig = loadClickUpConfig(db)
    if (existingConfig && !flags.force) {
      try {
        const client = new ClickUpClient(existingConfig.apiKey)
        const user = await client.verify()

        if (jsonMode) {
          outputSuccessAsJson({
            authenticated: true,
            user: user.username,
            message: 'Already authenticated. Use --force to re-authenticate.',
          }, createMetadata('clickup connect', flags))
          return
        }

        this.log(colors.success('Already connected to ClickUp'))
        this.log(colors.textMuted(`  User: ${user.username}`))
        this.log(colors.textMuted('Use --force to re-authenticate.'))
        return
      } catch {
        // Continue to re-authenticate with a new key
      }
    }

    let apiKey = getClickUpApiKey(db)

    if (!apiKey) {
      if (jsonMode) {
        outputErrorAsJson(
          'API_KEY_REQUIRED',
          'ClickUp API key required. Set CLICKUP_API_KEY or PRLT_CLICKUP_API_KEY.',
          createMetadata('clickup connect', flags),
        )
        return
      }

      this.log('')
      this.log(colors.primary('ClickUp Authentication'))
      this.log('')
      this.log('Create a Personal API Token at:')
      this.log(colors.textSecondary('  https://app.clickup.com/settings/apps'))
      this.log('')

      const { inputToken } = await inquirer.prompt([{
        type: 'password',
        name: 'inputToken',
        message: 'Enter your ClickUp API key:',
        mask: '*',
        validate: (input: string) => input.trim().length > 0 || 'API key is required',
      }])
      apiKey = inputToken
    }

    if (!apiKey) {
      if (jsonMode) {
        outputErrorAsJson(
          'API_KEY_REQUIRED',
          'ClickUp API key required. Set CLICKUP_API_KEY or PRLT_CLICKUP_API_KEY.',
          createMetadata('clickup connect', flags),
        )
        return
      }
      this.log(colors.error('ClickUp API key is required.'))
      this.exit(1)
    }

    this.log('')
    this.log(colors.textMuted('Verifying ClickUp API key...'))

    const client = new ClickUpClient(apiKey)

    try {
      const user = await client.verify()
      saveClickUpApiKey(db, apiKey)

      let workspaceId: string | undefined
      let workspaceName: string | undefined
      let spaceId: string | undefined
      let spaceName: string | undefined
      let listId: string | undefined
      let listName: string | undefined

      // === Workspace selection ===
      const workspaces = await client.listWorkspaces()

      if (flags.workspace) {
        const isId = /^\d+$/.test(flags.workspace)
        if (isId) {
          const matched = workspaces.find((w) => w.id === flags.workspace)
          if (!matched) throw new Error(`Workspace ${flags.workspace} not found`)
          workspaceId = matched.id
          workspaceName = matched.name
        } else {
          const matched = workspaces.find((w) => w.name.toLowerCase() === flags.workspace!.toLowerCase())
          if (!matched) throw new Error(`Workspace "${flags.workspace}" not found`)
          workspaceId = matched.id
          workspaceName = matched.name
        }
      } else if (!jsonMode && workspaces.length === 1) {
        workspaceId = workspaces[0].id
        workspaceName = workspaces[0].name
      } else if (!jsonMode && workspaces.length > 1) {
        const { selectedWorkspace } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedWorkspace',
          message: 'Select default ClickUp workspace:',
          choices: workspaces.map((w) => ({
            name: w.name,
            value: w.id,
          })),
        }])
        const selected = workspaces.find((w) => w.id === selectedWorkspace)
        workspaceId = selected?.id
        workspaceName = selected?.name
      }

      if (workspaceId) {
        saveClickUpWorkspace(db, workspaceId, workspaceName ?? workspaceId)
      }

      // === Space selection ===
      if (workspaceId) {
        const spaces = await client.listSpaces(workspaceId)

        if (flags.space) {
          const isId = /^\d+$/.test(flags.space)
          if (isId) {
            const matched = spaces.find((s) => s.id === flags.space)
            if (!matched) throw new Error(`Space ${flags.space} not found`)
            spaceId = matched.id
            spaceName = matched.name
          } else {
            const matched = spaces.find((s) => s.name.toLowerCase() === flags.space!.toLowerCase())
            if (!matched) throw new Error(`Space "${flags.space}" not found`)
            spaceId = matched.id
            spaceName = matched.name
          }
        } else if (!jsonMode && spaces.length === 1) {
          spaceId = spaces[0].id
          spaceName = spaces[0].name
        } else if (!jsonMode && spaces.length > 1) {
          const { selectedSpace } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedSpace',
            message: 'Select default ClickUp space:',
            choices: [
              { name: 'Skip', value: null },
              ...spaces.map((s) => ({
                name: s.name,
                value: s.id,
              })),
            ],
            default: null,
          }])

          if (selectedSpace) {
            const selected = spaces.find((s) => s.id === selectedSpace)
            spaceId = selected?.id
            spaceName = selected?.name
          }
        }

        if (spaceId) {
          saveClickUpSpace(db, spaceId, spaceName ?? spaceId)
        }
      }

      // === List selection ===
      if (spaceId) {
        // Get lists from folders and folderless lists
        const allLists: Array<{ id: string; name: string; folder?: string }> = []

        const folderlessLists = await client.listFolderlessLists(spaceId)
        for (const list of folderlessLists) {
          allLists.push({ id: list.id, name: list.name })
        }

        const folders = await client.listFolders(spaceId)
        for (const folder of folders) {
          for (const list of folder.lists) {
            allLists.push({ id: list.id, name: list.name, folder: folder.name })
          }
        }

        if (flags.list) {
          const isId = /^\d+$/.test(flags.list)
          if (isId) {
            const matched = allLists.find((l) => l.id === flags.list)
            if (!matched) throw new Error(`List ${flags.list} not found`)
            listId = matched.id
            listName = matched.name
          } else {
            const matched = allLists.find((l) => l.name.toLowerCase() === flags.list!.toLowerCase())
            if (!matched) throw new Error(`List "${flags.list}" not found in selected space`)
            listId = matched.id
            listName = matched.name
          }
        } else if (!jsonMode && allLists.length > 0) {
          const { selectedList } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedList',
            message: 'Select default ClickUp list:',
            choices: [
              { name: 'Skip', value: null },
              ...allLists.map((l) => ({
                name: l.folder ? `${l.folder} / ${l.name}` : l.name,
                value: l.id,
              })),
            ],
            default: null,
          }])

          if (selectedList) {
            const selected = allLists.find((l) => l.id === selectedList)
            listId = selected?.id
            listName = selected?.name
          }
        }

        if (listId) {
          saveClickUpList(db, listId, listName ?? listId)
        }
      }

      // Register as provider source
      upsertProviderSource(db, {
        id: 'clickup',
        provider: 'clickup',
        apiKeyRef: 'clickup.api_key',
        teamProjectId: listId ?? spaceId ?? workspaceId ?? 'default',
        prefix: 'CU-',
        label: listName ?? spaceName ?? workspaceName ?? 'ClickUp',
      })

      if (jsonMode) {
        outputSuccessAsJson({
          authenticated: true,
          user: user.username,
          email: user.email ?? null,
          workspace: workspaceName ?? null,
          space: spaceName ?? null,
          list: listName ?? null,
        }, createMetadata('clickup connect', flags))
        return
      }

      this.log(colors.success('Connected to ClickUp'))
      this.log(colors.textMuted(`  User: ${user.username}${user.email ? ` (${user.email})` : ''}`))
      if (workspaceName) {
        this.log(colors.textMuted(`  Workspace: ${workspaceName}`))
      }
      if (spaceName) {
        this.log(colors.textMuted(`  Space: ${spaceName}`))
      }
      if (listName) {
        this.log(colors.textMuted(`  List: ${listName}`))
      }
      this.log('')
      this.log(colors.textMuted('Run "prlt clickup import" to import tasks, or "prlt clickup sync" to sync tickets.'))
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson(
          'CLICKUP_CONNECT_FAILED',
          `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
          createMetadata('clickup connect', flags),
        )
        return
      }

      this.error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
