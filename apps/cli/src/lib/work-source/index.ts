export {
  WORK_SOURCE_PROVIDERS,
  type WorkSourceProvider,
  type WorkSourceRef,
  isWorkSourceProvider,
  isLocalTicketId,
  parseWorkSourceRef,
  formatWorkSourceRef,
  saveDefaultWorkSource,
  clearDefaultWorkSource,
  loadDefaultWorkSource,
  /** @deprecated Use saveDefaultWorkSource */
  saveActiveWorkSource,
  /** @deprecated Use clearDefaultWorkSource */
  clearActiveWorkSource,
  /** @deprecated Use loadDefaultWorkSource */
  loadActiveWorkSource,
  getRegisteredWorkSources,
  getConnectedIntegrations,
} from './config.js'
export {
  type WorkSourceClient,
  getWorkSourceClient,
} from './client.js'
export {
  type ProviderSourceEntry,
  type ProviderSourceValidationError,
  validateProviderSourceEntry,
  loadProviderSources,
  saveProviderSources,
  addProviderSource,
  updateProviderSource,
  removeProviderSource,
  getProviderSourceById,
  resolveProviderByPrefix,
  resolveProviderByPrefixFromList,
  getRoutingTable,
  resolveApiKey,
  upsertProviderSource,
  removeProviderSourcesByProvider,
} from './provider-sources.js'
