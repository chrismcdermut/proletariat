export interface AsanaConfig {
  accessToken: string
  workspaceGid?: string
  workspaceName?: string
  projectGid?: string
  projectName?: string
}

export interface AsanaWorkspace {
  gid: string
  name: string
}

export interface AsanaProject {
  gid: string
  name: string
}

export interface AsanaUser {
  gid: string
  name: string
  email?: string
  workspaces: AsanaWorkspace[]
}

export interface AsanaTask {
  gid: string
  name: string
  completed: boolean
  notes?: string
}

export interface AsanaTaskMap {
  pmoTicketId: string
  asanaTaskGid: string
  asanaProjectGid?: string
  lastSyncedAt?: Date
  createdAt: Date
}

export interface AsanaTaskUpsertInput {
  name: string
  notes?: string
  completed?: boolean
  projects?: string[]
}
