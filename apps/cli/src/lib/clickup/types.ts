export interface ClickUpConfig {
  apiKey: string
  workspaceId?: string
  workspaceName?: string
  spaceId?: string
  spaceName?: string
  listId?: string
  listName?: string
}

export interface ClickUpWorkspace {
  id: string
  name: string
}

export interface ClickUpSpace {
  id: string
  name: string
  statuses: ClickUpStatus[]
}

export interface ClickUpList {
  id: string
  name: string
  statuses?: ClickUpStatus[]
}

export interface ClickUpFolder {
  id: string
  name: string
  lists: ClickUpList[]
}

export interface ClickUpStatus {
  status: string
  type: string
  orderindex: number
  color: string
}

export interface ClickUpUser {
  id: number
  username: string
  email: string
}

export interface ClickUpTask {
  id: string
  custom_id?: string | null
  name: string
  description?: string
  status: { status: string; type: string; color: string }
  priority?: { id: string; priority: string; color: string; orderindex: string } | null
  assignees: Array<{ id: number; username: string; email: string }>
  tags: Array<{ name: string }>
  url: string
  list: { id: string; name: string }
  space: { id: string }
  folder?: { id: string; name: string }
  date_created: string
  date_updated: string
  due_date?: string | null
}

export interface ClickUpTaskCreateInput {
  name: string
  description?: string
  priority?: number | null
  status?: string
  assignees?: number[]
  tags?: string[]
  due_date?: number | null
}

export interface ClickUpTaskUpdateInput {
  name?: string
  description?: string
  priority?: number | null
  status?: string
  assignees?: { add?: number[]; rem?: number[] }
}

export interface ClickUpTaskMap {
  pmoTicketId: string
  clickupTaskId: string
  clickupListId?: string
  lastSyncedAt?: Date
  createdAt: Date
}

/**
 * ClickUp priorities: 1=Urgent, 2=High, 3=Normal, 4=Low, null=None
 * PMO priorities: P0=Critical, P1=High, P2=Medium, P3=Low
 */
export const CLICKUP_PRIORITY_TO_PMO: Record<string, string> = {
  '1': 'P0',
  '2': 'P1',
  '3': 'P2',
  '4': 'P3',
}

export const PMO_PRIORITY_TO_CLICKUP: Record<string, number> = {
  P0: 1,
  P1: 2,
  P2: 3,
  P3: 4,
}
