import { Command } from '@oclif/core';
import chalk from 'chalk';

export default class Agent extends Command {
  static description = 'Manage agents (workers)';

  static examples = [
    '<%= config.bin %> <%= command.id %> add camry tacoma',
    '<%= config.bin %> <%= command.id %> list',
    '<%= config.bin %> <%= command.id %> remove camry',
    '<%= config.bin %> <%= command.id %> switch tacoma',
  ];

  async run(): Promise<void> {
    this.log(chalk.cyan('🤖 Agent Management'));
    this.log('');
    this.log('Available commands:');
    this.log(chalk.white('  prlt agent add [names...]    ') + chalk.gray('Add new agents'));
    this.log(chalk.white('  prlt agent list              ') + chalk.gray('List all agents'));
    this.log(chalk.white('  prlt agent remove [names...] ') + chalk.gray('Remove agents'));
    this.log(chalk.white('  prlt agent switch <name>     ') + chalk.gray('Switch to agent directory'));
    this.log(chalk.white('  prlt agent grant             ') + chalk.gray('Grant permissions to agent'));
    this.log(chalk.white('  prlt agent revoke            ') + chalk.gray('Revoke permissions from agent'));
    this.log('');
    this.log(chalk.gray('Run "prlt agent <command> --help" for more details'));
  }
}