import { execSync } from 'node:child_process';

export interface DetectedTool {
  name: string;
  command: string;
  path: string;
  displayName: string;
}

export interface ToolDetectionResult {
  tools: DetectedTool[];
  hasClaudeCode: boolean;
  hasCodex: boolean;
}

const TOOLS_TO_DETECT = [
  { name: 'claude-code', command: 'claude', displayName: 'Claude Code' },
  { name: 'codex', command: 'codex', displayName: 'Codex' },
] as const;

/**
 * Check if a command is available on the system PATH.
 * Returns the resolved path or null if not found.
 */
function whichCommand(command: string): string | null {
  try {
    const result = execSync(`which ${command}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Detect which AI tools are installed on the system.
 */
export function detectAITools(): ToolDetectionResult {
  const tools: DetectedTool[] = [];

  for (const tool of TOOLS_TO_DETECT) {
    const toolPath = whichCommand(tool.command);
    if (toolPath) {
      tools.push({
        name: tool.name,
        command: tool.command,
        path: toolPath,
        displayName: tool.displayName,
      });
    }
  }

  return {
    tools,
    hasClaudeCode: tools.some(t => t.name === 'claude-code'),
    hasCodex: tools.some(t => t.name === 'codex'),
  };
}
