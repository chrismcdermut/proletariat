import { Command } from 'commander';
import { pmoInitCommand } from './init';
import { pmoStatusCommand } from './status';
import { pmoSyncCommand } from './sync';

export const pmoCommand = new Command('pmo')
  .description('Project Management Office (PMO) commands for "company as code" philosophy')
  .addCommand(pmoInitCommand)
  .addCommand(pmoStatusCommand)
  .addCommand(pmoSyncCommand);