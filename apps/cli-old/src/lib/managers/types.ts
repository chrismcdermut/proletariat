/**
 * Core types for manager classes
 */

export interface HQConfig {
  version: string;
  type: 'hq';
  name: string;
  theme: string;
  themeDirectory: string;
  agents: string[];
  repos: string[];
  agentRepoMode: 'all' | 'ask' | 'manual';
  agentAccess?: Record<string, string[]>;
  initialized: string;
}

export interface SimpleConfig {
  version: string;
  configVersion: number;
  projectName: string;
  themeName: string;
  workspaceDir: string;
  activeAgents: string[];
  initialized: string;
  layout?: {
    mode: 'sibling' | 'custom';
    baseDir: string;
  };
}

export type WorkspaceConfig = HQConfig | SimpleConfig;

export function isHQConfig(config: any): config is HQConfig {
  return config?.type === 'hq';
}

export interface IAgentManager {
  add(agents?: string[]): Promise<void>;
  remove(agents?: string[]): Promise<void>;
  list(): Promise<void>;
  grant(): Promise<void>;
  revoke(): Promise<void>;
  switch(agent: string): void;
}

export interface IRepoManager {
  add(repo?: string): Promise<void>;
  remove(repo?: string): Promise<void>;
  list(): Promise<void>;
}

export interface IPMOManager {
  init(): Promise<void>;
  create(): Promise<void>;
  claim(ticketId?: string): Promise<void>;
  complete(ticketId: string): Promise<void>;
  assign(ticketId?: string, agentName?: string): Promise<void>;
  reassign(ticketId?: string, agentName?: string): Promise<void>;
  unassign(ticketId?: string): Promise<void>;
  list(): Promise<void>;
}