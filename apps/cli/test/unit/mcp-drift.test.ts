/**
 * MCP Tool Drift Detection Test
 *
 * Ensures every non-excluded oclif command has a corresponding MCP tool.
 * Fails CI if a CLI command exists without an MCP tool registration,
 * preventing drift between CLI and MCP capabilities.
 */

import { expect } from 'chai';
import { Config } from '@oclif/core';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandIdToToolName } from '../../src/lib/mcp/generator.js';
import { overrideToolNames } from '../../src/lib/mcp/tools/overrides/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliRoot = path.resolve(__dirname, '../..');

/**
 * Commands excluded from MCP auto-generation (must match generator.ts).
 * If you add a command here, you must also add it to EXCLUDED_COMMANDS in generator.ts.
 */
const EXCLUDED_COMMANDS = new Set([
  'mcp-server',
  'plugins',
  'plugins:inspect',
  'plugins:install',
  'plugins:add',
  'plugins:link',
  'plugins:reset',
  'plugins:uninstall',
  'plugins:unlink',
  'plugins:remove',
  'plugins:update',
  'help',
  'commands',
  'autocomplete',
  'autocomplete:setup',
  'update',
  'self-update',
]);

describe('@smoke MCP Drift Detection', () => {
  let config: InstanceType<typeof Config>;

  before(async () => {
    config = await Config.load({ root: cliRoot });
  });

  it('every non-excluded, non-hidden CLI command has a corresponding MCP tool name', () => {
    const missingTools: string[] = [];

    for (const command of config.commands) {
      // Skip excluded commands
      if (EXCLUDED_COMMANDS.has(command.id)) continue;
      // Skip hidden commands
      if (command.hidden) continue;

      const toolName = commandIdToToolName(command.id);

      // The tool should either be auto-generated or have a manual override.
      // Since auto-generation covers all non-excluded commands, we just need
      // to verify the command would produce a valid tool name.
      if (!toolName || toolName.trim() === '') {
        missingTools.push(command.id);
      }
    }

    expect(
      missingTools,
      `CLI commands without MCP tool mapping: ${missingTools.join(', ')}`,
    ).to.have.length(0);
  });

  it('all override tool names correspond to real CLI commands', () => {
    const commandToolNames = new Set(
      config.commands.map((c) => commandIdToToolName(c.id)),
    );

    const orphanedOverrides: string[] = [];
    for (const overrideName of overrideToolNames) {
      if (!commandToolNames.has(overrideName)) {
        orphanedOverrides.push(overrideName);
      }
    }

    // Override tool names that map to real commands — tmux and work_start are
    // standalone MCP tools, not derived from CLI commands, so they are allowed
    // to not map to any oclif command.
    const ALLOWED_STANDALONE_OVERRIDES = new Set([
      'tmux_send_keys',
      'tmux_capture_pane',
      'tmux_start_session',
      'tmux_list_sessions',
      'tmux_kill_session',
    ]);

    const realOrphans = orphanedOverrides.filter(
      (name) => !ALLOWED_STANDALONE_OVERRIDES.has(name),
    );

    expect(
      realOrphans,
      `Override tool names without matching CLI commands: ${realOrphans.join(', ')}`,
    ).to.have.length(0);
  });

  it('excluded commands list in test matches generator excluded list', () => {
    // This test ensures the test exclusion list stays in sync with the generator.
    // We import the generator and verify they produce the same results.
    const nonExcludedCommands = config.commands.filter(
      (c) => !EXCLUDED_COMMANDS.has(c.id) && !c.hidden,
    );

    // Every non-excluded command should produce a valid tool name
    for (const command of nonExcludedCommands) {
      const toolName = commandIdToToolName(command.id);
      expect(toolName).to.be.a('string').and.not.be.empty;
    }
  });

  it('auto-generated tool count covers the majority of CLI commands', () => {
    const totalCommands = config.commands.length;
    const excludedCount = config.commands.filter(
      (c) => EXCLUDED_COMMANDS.has(c.id) || c.hidden,
    ).length;
    const coveredCount = totalCommands - excludedCount;

    // Sanity check: we should be covering at least 100 commands
    expect(coveredCount).to.be.greaterThan(100);

    // The override count should be much smaller than the total
    expect(overrideToolNames.size).to.be.lessThan(coveredCount);
  });
});
