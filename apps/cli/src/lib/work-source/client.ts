import {
  buildAsanaMetadata,
  buildAsanaSpawnContextMessage,
  buildAsanaTicketDescription,
  getAsanaTaskByGid,
} from '../external-issues/asana.js'
import {
  buildJiraMetadata,
  buildJiraSpawnContextMessage,
  buildJiraTicketDescription,
  getJiraIssueByKey,
} from '../external-issues/jira.js'
import {
  buildLinearMetadata,
  buildLinearSpawnContextMessage,
  buildLinearTicketDescription,
  getLinearIssueByIdentifier,
} from '../external-issues/linear.js'
import {
  buildShortcutMetadata,
  buildShortcutSpawnContextMessage,
  buildShortcutTicketDescription,
  getShortcutStoryByKey,
} from '../external-issues/shortcut.js'
import {
  buildTrelloMetadata,
  buildTrelloSpawnContextMessage,
  buildTrelloTicketDescription,
  getTrelloCardById,
} from '../external-issues/trello.js'
import type { NormalizedIssueEnvelope } from '../external-issues/types.js'
import type { WorkSourceProvider } from './config.js'

export interface WorkSourceClient {
  readonly provider: WorkSourceProvider
  fetchByKey(key: string): Promise<NormalizedIssueEnvelope | null>
  buildTicketDescription(envelope: NormalizedIssueEnvelope): string
  buildMetadata(envelope: NormalizedIssueEnvelope): Record<string, string>
  buildSpawnContextMessage(envelope: NormalizedIssueEnvelope, additionalMessage?: string): string
}

class LinearWorkSourceClient implements WorkSourceClient {
  readonly provider: WorkSourceProvider = 'linear'

  async fetchByKey(key: string): Promise<NormalizedIssueEnvelope | null> {
    return getLinearIssueByIdentifier({}, key)
  }

  buildTicketDescription(envelope: NormalizedIssueEnvelope): string {
    return buildLinearTicketDescription(envelope)
  }

  buildMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
    return buildLinearMetadata(envelope)
  }

  buildSpawnContextMessage(envelope: NormalizedIssueEnvelope, additionalMessage?: string): string {
    return buildLinearSpawnContextMessage(envelope, additionalMessage)
  }
}

class JiraWorkSourceClient implements WorkSourceClient {
  readonly provider: WorkSourceProvider = 'jira'

  async fetchByKey(key: string): Promise<NormalizedIssueEnvelope | null> {
    return getJiraIssueByKey({}, key)
  }

  buildTicketDescription(envelope: NormalizedIssueEnvelope): string {
    return buildJiraTicketDescription(envelope)
  }

  buildMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
    return buildJiraMetadata(envelope)
  }

  buildSpawnContextMessage(envelope: NormalizedIssueEnvelope, additionalMessage?: string): string {
    return buildJiraSpawnContextMessage(envelope, additionalMessage)
  }
}

class AsanaWorkSourceClient implements WorkSourceClient {
  readonly provider: WorkSourceProvider = 'asana'

  async fetchByKey(key: string): Promise<NormalizedIssueEnvelope | null> {
    return getAsanaTaskByGid({}, key)
  }

  buildTicketDescription(envelope: NormalizedIssueEnvelope): string {
    return buildAsanaTicketDescription(envelope)
  }

  buildMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
    return buildAsanaMetadata(envelope)
  }

  buildSpawnContextMessage(envelope: NormalizedIssueEnvelope, additionalMessage?: string): string {
    return buildAsanaSpawnContextMessage(envelope, additionalMessage)
  }
}

class ShortcutWorkSourceClient implements WorkSourceClient {
  readonly provider: WorkSourceProvider = 'shortcut'

  async fetchByKey(key: string): Promise<NormalizedIssueEnvelope | null> {
    return getShortcutStoryByKey({}, key)
  }

  buildTicketDescription(envelope: NormalizedIssueEnvelope): string {
    return buildShortcutTicketDescription(envelope)
  }

  buildMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
    return buildShortcutMetadata(envelope)
  }

  buildSpawnContextMessage(envelope: NormalizedIssueEnvelope, additionalMessage?: string): string {
    return buildShortcutSpawnContextMessage(envelope, additionalMessage)
  }
}

class TrelloWorkSourceClient implements WorkSourceClient {
  readonly provider: WorkSourceProvider = 'trello'

  async fetchByKey(key: string): Promise<NormalizedIssueEnvelope | null> {
    return getTrelloCardById({}, key)
  }

  buildTicketDescription(envelope: NormalizedIssueEnvelope): string {
    return buildTrelloTicketDescription(envelope)
  }

  buildMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
    return buildTrelloMetadata(envelope)
  }

  buildSpawnContextMessage(envelope: NormalizedIssueEnvelope, additionalMessage?: string): string {
    return buildTrelloSpawnContextMessage(envelope, additionalMessage)
  }
}

const SOURCE_CLIENTS: Partial<Record<WorkSourceProvider, WorkSourceClient>> = {
  linear: new LinearWorkSourceClient(),
  jira: new JiraWorkSourceClient(),
  asana: new AsanaWorkSourceClient(),
  shortcut: new ShortcutWorkSourceClient(),
  trello: new TrelloWorkSourceClient(),
}

export function getWorkSourceClient(provider: WorkSourceProvider): WorkSourceClient | null {
  return SOURCE_CLIENTS[provider] ?? null
}

