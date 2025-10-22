export interface ThemeCommands {
  create: string;
  remove: string;
  list: string;
}

export interface ThemeMessages {
  create: string;
  remove: string;
  list: string;
  slogan: string;
}

export interface Theme {
  name: string;
  displayName: string;
  description: string;
  emoji: string;
  directory: string;
  agents: string[];
  commands: ThemeCommands;
  messages: ThemeMessages;
}

export interface ThemeCollection {
  [key: string]: Theme;
}

export interface WorkspaceLayout {
  mode: 'sibling' | 'workspace' | 'custom';
  baseDir: string;
  workspaceName?: string;
}

export interface ProjectConfig {
  version: string;
  projectName: string;
  themeName: string;
  workspaceDir: string;
  activeAgents: string[];
  initialized: string;
  theme?: Theme;
  layout?: WorkspaceLayout;
}

export interface InitOptions {
  theme?: string;
  workspace?: string;
  workspaceRoot?: string;
}

export interface ListOptions {
  theme?: string;
}

export interface Logger {
  theme: (theme: Theme, msg: string) => void;
  success: (msg: string) => void;
  warning: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
  agent: (agent: string, msg: string, theme: Theme) => void;
}