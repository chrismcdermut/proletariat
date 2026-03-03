export interface MirrorResolutionInput {
  flagValue?: boolean
  envValue?: boolean | null
  configValue?: boolean | null
}

export interface MirrorResolution {
  enabled: boolean
  source: 'flag' | 'env' | 'config' | 'default'
}

export function resolveMirrorToPmo(input: MirrorResolutionInput): MirrorResolution {
  if (input.flagValue !== undefined) {
    return { enabled: input.flagValue, source: 'flag' }
  }
  if (input.envValue !== null && input.envValue !== undefined) {
    return { enabled: input.envValue, source: 'env' }
  }
  if (input.configValue !== null && input.configValue !== undefined) {
    return { enabled: input.configValue, source: 'config' }
  }
  return { enabled: true, source: 'default' }
}
