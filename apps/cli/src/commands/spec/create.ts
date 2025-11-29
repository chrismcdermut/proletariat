import { Command, Flags, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { findPMO, getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { slugify } from '../../lib/pmo/utils.js';

export default class SpecCreate extends Command {
  static description = 'Create a new spec document';

  static examples = [
    '<%= config.bin %> <%= command.id %> "User Authentication"',
    '<%= config.bin %> <%= command.id %> --name "API Design" --status active',
    '<%= config.bin %> <%= command.id %> -i  # Interactive mode',
  ];

  static args = {
    name: Args.string({
      description: 'Spec name',
      required: false,
    }),
  };

  static flags = {
    name: Flags.string({
      char: 'n',
      description: 'Spec name',
    }),
    status: Flags.string({
      char: 's',
      description: 'Spec status (active, draft, archived)',
      options: ['active', 'draft', 'archived'],
      default: 'active',
    }),
    project: Flags.string({
      char: 'p',
      description: 'Project ID (will prompt if not specified)',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SpecCreate);

    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    // Get PMO context (prompt for project if multiple exist)
    const { projectId, projectName } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true // prompt if multiple projects
    );

    // Get spec data
    let specData: {
      name: string;
      status: string;
    };

    if (flags.interactive || (!args.name && !flags.name)) {
      specData = await this.promptSpecData(flags);
    } else {
      specData = {
        name: args.name || flags.name!,
        status: flags.status || 'active',
      };
    }

    const specId = slugify(specData.name);
    const specsPath = path.join(pmoPath, 'projects', projectId, 'specs', specData.status);
    const specPath = path.join(specsPath, `${specId}.md`);

    // Check if spec already exists
    if (fs.existsSync(specPath)) {
      this.error(`Spec "${specId}" already exists at ${path.relative(process.cwd(), specPath)}`);
    }

    // Ensure specs directory exists
    fs.mkdirSync(specsPath, { recursive: true });

    // Create spec file with frontmatter template
    const specContent = this.createSpecTemplate(specData.name, projectName);
    fs.writeFileSync(specPath, specContent);

    this.log(styles.success(`\n✅ Created spec "${styles.emphasis(specData.name)}"`));
    this.log(styles.muted(`  Project: ${projectName}`));
    this.log(styles.muted(`  Status: ${specData.status}`));
    this.log(styles.muted(`  File: ${path.relative(process.cwd(), specPath)}`));
    this.log(styles.muted(`\nNext steps:`));
    this.log(styles.muted(`  1. Edit the spec file to add details`));
    this.log(styles.muted(`  2. Add ticket definitions in the frontmatter`));
    this.log(styles.muted(`  3. Run: prlt spec generate-tickets ${specId}`));
  }

  private async promptSpecData(flags: {
    name?: string;
    status?: string;
  }): Promise<{
    name: string;
    status: string;
  }> {
    const answers = await inquirer.prompt<{
      name: string;
      status: string;
    }>([
      {
        type: 'input',
        name: 'name',
        message: 'Spec name:',
        default: flags.name,
        validate: (input: string) => input.length > 0 || 'Name is required',
      },
      {
        type: 'list',
        name: 'status',
        message: 'Spec status:',
        choices: [
          { name: 'Active (currently working on)', value: 'active' },
          { name: 'Draft (planning phase)', value: 'draft' },
          { name: 'Archived (completed/deprecated)', value: 'archived' },
        ],
        default: flags.status || 'active',
      },
    ]);

    return answers;
  }

  private createSpecTemplate(name: string, projectName: string): string {
    return `---
title: ${name}
project: ${projectName}
created: ${new Date().toISOString()}
status: design
tickets:
  - id: SPEC-001
    title: Example ticket
    description: Replace this with actual ticket definitions
    column: Ready
    priority: medium
---

# ${name}

## Overview

[Describe what this spec covers and why it's important]

## Goals

- [ ] Goal 1
- [ ] Goal 2
- [ ] Goal 3

## Design

[Describe the approach, architecture, or implementation plan]

## Tickets

This spec defines the following tickets (see frontmatter above):

1. **SPEC-001**: Example ticket - Replace with actual tickets

Use \`prlt spec generate-tickets ${slugify(name)}\` to create these tickets in the kanban board.

## Success Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Notes

[Any additional notes, links, or references]
`;
  }
}
