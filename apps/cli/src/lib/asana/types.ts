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
  assignee?: { gid: string; name: string } | null
  tags?: Array<{ gid: string; name: string }>
  memberships?: Array<{ project: { gid: string; name: string }; section?: { gid: string; name: string } }>
  due_on?: string | null
  permalink_url?: string
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
