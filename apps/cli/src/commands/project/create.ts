import { Flags, Args } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { createBoardContent, createSpecFolders, PMOCommand, pmoBaseFlags, BUILTIN_TEMPLATES } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { slugify } from '../../lib/pmo/utils.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputSuccessAsJson,
  outputDryRunSuccessAsJson,
  outputDryRunErrorsAsJson,
  createMetadata,
  buildFormPromptConfig,
  FormField,
} from '../../lib/prompt-json.js';

// Build template options dynamically from shared definitions
const TEMPLATE_IDS = BUILTIN_TEMPLATES.map(t => t.id);

export default class ProjectCreate extends PMOCommand {
  static description = 'Create a new project in the PMO';

  static examples = [
    '<%= config.bin %> <%= command.id %> "My New Project"',
    '<%= config.bin %> <%= command.id %> --name "Mobile App" --description "iOS and Android app"',
    '<%= config.bin %> <%= command.id %> -i  # Interactive mode',
    '<%= config.bin %> <%= command.id %> --name "Test" --dry-run --json  # Validate without creating',
  ];

  static args = {
    name: Args.string({
      description: 'Project name',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    name: Flags.string({
      char: 'n',
      description: 'Project name [required for non-interactive]',
    }),
    id: Flags.string({
      description: 'Custom project ID (auto-generated from name if not provided)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Project description',
    }),
    template: Flags.string({
      char: 't',
      description: 'Workflow template',
      options: TEMPLATE_IDS,
      default: 'kanban',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Validate inputs without creating project (use with --json for structured output)',
      default: false,
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(ProjectCreate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Get project data first (before storage so prompts work)
    let projectData: {
      name: string;
      id?: string;
      description?: string;
      template: string;
    };

    if (flags.interactive || (!args.name && !flags.name)) {
      // Build choices dynamically from shared template definitions
      const templateChoices = BUILTIN_TEMPLATES.map(t => ({
        name: `${t.name} - ${t.statuses.map(s => s.name).join(' → ')}`,
        value: t.id,
      }));

      // Define fields once - single source of truth for both JSON and interactive modes
      const fields: FormField[] = [
        { type: 'input', name: 'name', message: 'Project name:', default: flags.name },
        { type: 'input', name: 'id', message: 'Project ID (leave blank to auto-generate):' },
        { type: 'input', name: 'description', message: 'Description (optional):', default: flags.description },
        { type: 'list', name: 'template', message: 'Workflow template:', choices: templateChoices, default: flags.template || 'kanban' },
      ];

      // In JSON mode, output form prompt for project creation
      if (jsonMode) {
        outputPromptAsJson(
          buildFormPromptConfig(fields),
          createMetadata('project create', flags)
        );
      }

      projectData = await this.promptProjectData(fields);
    } else {
      projectData = {
        name: args.name || flags.name!,
        id: flags.id,
        description: flags.description,
        template: flags.template || 'kanban',
      };
    }

    const projectId = projectData.id || slugify(projectData.name);

    // Check if project already exists
    const existing = await this.storage.getProject(projectId);
    if (existing) {
      if (flags['dry-run']) {
        if (jsonMode) {
          outputDryRunErrorsAsJson(
            [{ field: 'id', error: `Project "${projectId}" already exists` }],
            createMetadata('project create', flags)
          );
        }
      }
      this.error(`Project "${projectId}" already exists.`);
    }

    // Get the statuses from the workflow (for dry-run preview)
    const statuses = await this.storage.listStatuses(projectData.template);

    // Handle dry-run: show what would be created without actually creating
    if (flags['dry-run']) {
      const wouldCreate = {
        id: projectId,
        name: projectData.name,
        template: projectData.template,
        statuses: statuses.map(s => s.name),
        ...(projectData.description && { description: projectData.description }),
      };

      if (jsonMode) {
        outputDryRunSuccessAsJson('project', wouldCreate, createMetadata('project create', flags));
      }

      // Human-readable dry-run output
      this.log(styles.warning('\n[DRY RUN] Would create project:'));
      this.log(styles.muted(`   ID: ${projectId}`));
      this.log(styles.muted(`   Name: ${projectData.name}`));
      this.log(styles.muted(`   Template: ${projectData.template}`));
      this.log(styles.muted(`   Statuses: ${statuses.map(s => s.name).join(' → ')}`));
      if (projectData.description) {
        this.log(styles.muted(`   Description: ${projectData.description}`));
      }
      this.log(styles.muted('\n(No project was created)'));
      return;
    }

    // Create project in database
    const project = await this.storage.createProject({
      id: projectId,
      name: projectData.name,
      description: projectData.description,
      template: projectData.template,
    });

    // Create project folder structure: pmo/projects/{projectId}/
    const projectPath = path.join(this.pmoPath, 'projects', projectId);
    fs.mkdirSync(projectPath, { recursive: true });

    // Create kanban.md in project directory with project name as board name
    const boardContent = createBoardContent(projectData.template, projectData.name);
    const boardPath = path.join(projectPath, 'kanban.md');
    fs.writeFileSync(boardPath, boardContent);

    // Create spec folders in project directory
    const specsPath = createSpecFolders(this.pmoPath, projectId);

    // In JSON mode, output success with project details
    if (jsonMode) {
      outputSuccessAsJson(
        {
          id: project.id,
          name: project.name,
          template: projectData.template,
          statuses: statuses.map(s => s.name),
          boardPath: path.relative(process.cwd(), boardPath),
          specsPath: path.relative(process.cwd(), specsPath),
        },
        createMetadata('project create', flags)
      );
      return;
    }

    this.log(styles.success(`\nCreated project "${styles.emphasis(project.name)}"`));
    this.log(styles.muted(`  ID: ${project.id}`));
    this.log(styles.muted(`  Template: ${projectData.template}`));
    this.log(styles.muted(`  Statuses: ${statuses.map(s => s.name).join(' → ')}`));
    this.log(styles.muted(`  Board: ${path.relative(process.cwd(), boardPath)}`));
    this.log(styles.muted(`  Specs: ${path.relative(process.cwd(), specsPath)}/`));
    this.log(styles.muted(`\nSwitch to this project:`));
    this.log(styles.muted(`  prlt ticket list --project ${project.id}`));
    this.log(styles.muted(`  prlt project view ${project.id}`));
  }

  private async promptProjectData(
    fields: FormField[]
  ): Promise<{
    name: string;
    id?: string;
    description?: string;
    template: string;
  }> {
    // Build inquirer prompts from fields, adding validators and dynamic defaults
    const answers = await inquirer.prompt<{
      name: string;
      id: string;
      description: string;
      template: string;
    }>(fields.map(field => ({
      ...field,
      validate: field.name === 'name'
        ? ((input: string) => input.length > 0 || 'Name is required')
        : undefined,
      // Dynamic default for id based on name
      default: field.name === 'id'
        ? ((answers: { name: string }) => slugify(answers.name))
        : field.default,
    })));

    return {
      name: answers.name,
      id: answers.id || undefined,
      description: answers.description || undefined,
      template: answers.template,
    };
  }
}
