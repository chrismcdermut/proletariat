import { Command, Flags, Args } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { findPMO, getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { slugify } from '../../lib/pmo/utils.js';
import { SpecType } from '../../lib/pmo/types.js';

export default class SpecCreate extends Command {
  static description = 'Create a new spec document';

  static examples = [
    '<%= config.bin %> <%= command.id %> "User Authentication"',
    '<%= config.bin %> <%= command.id %> --name "API Design" --status active',
    '<%= config.bin %> <%= command.id %> -i  # Interactive mode',
    '<%= config.bin %> <%= command.id %> --type domain --domain tickets',
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
    type: Flags.string({
      char: 't',
      description: 'Spec type (domain or infrastructure)',
      options: ['domain', 'infrastructure'],
    }),
    domain: Flags.string({
      char: 'd',
      description: 'Domain name (e.g., tickets, epics, agents)',
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
    const { storage, projectId, projectName } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true // prompt if multiple projects
    );

    // Get spec data
    let specData: {
      name: string;
      status: string;
      specType: SpecType;
      domain?: string;
    };

    if (flags.interactive || (!args.name && !flags.name && !flags.type)) {
      specData = await this.promptSpecData(flags);
    } else {
      specData = {
        name: args.name || flags.name || this.inferName(flags),
        status: flags.status || 'active',
        specType: (flags.type as SpecType) || 'domain',
        domain: flags.domain,
      };
    }

    // Determine file path based on spec type
    const specsBasePath = path.join(path.dirname(pmoPath), 'specs');
    let specPath: string;

    switch (specData.specType) {
      case 'domain':
        specPath = path.join(specsBasePath, 'domain', `${specData.domain || slugify(specData.name)}.md`);
        break;
      case 'infrastructure':
        specPath = path.join(specsBasePath, 'infrastructure', `${slugify(specData.name)}.md`);
        break;
    }

    // Check if spec already exists
    if (fs.existsSync(specPath)) {
      this.error(`Spec already exists at ${path.relative(process.cwd(), specPath)}`);
    }

    // Ensure directory exists
    fs.mkdirSync(path.dirname(specPath), { recursive: true });

    // Create spec file with appropriate template
    const specContent = this.createSpecTemplate(specData);
    fs.writeFileSync(specPath, specContent);

    // Register in database
    const specId = this.generateSpecId(specData);
    try {
      await storage.createSpec({
        id: specId,
        path: path.relative(process.cwd(), specPath),
        title: specData.name,
        status: specData.status as 'draft' | 'active' | 'deprecated',
        specType: specData.specType,
        domain: specData.domain,
      });
    } catch {
      // Spec might already exist in DB, that's ok
    }

    await storage.close();

    this.log(styles.success(`\n✅ Created ${specData.specType} spec "${styles.emphasis(specData.name)}"`));
    this.log(styles.muted(`  Type: ${specData.specType}`));
    if (specData.domain) this.log(styles.muted(`  Domain: ${specData.domain}`));
    this.log(styles.muted(`  File: ${path.relative(process.cwd(), specPath)}`));
    this.log(styles.muted(`\nNext steps:`));
    this.log(styles.muted(`  1. Edit the spec file to add details`));
    if (specData.specType === 'domain') {
      this.log(styles.muted(`  2. Add abilities using the new format`));
      this.log(styles.muted(`  3. Run: prlt spec sync && prlt system-card generate`));
    }
  }

  private inferName(flags: { domain?: string; type?: string }): string {
    if (flags.domain) {
      return flags.domain;
    }
    return 'New Spec';
  }

  private generateSpecId(specData: { specType: SpecType; domain?: string; name: string }): string {
    if (specData.domain) {
      return specData.domain;
    }
    return slugify(specData.name);
  }

  private async promptSpecData(flags: {
    name?: string;
    status?: string;
    type?: string;
    domain?: string;
  }): Promise<{
    name: string;
    status: string;
    specType: SpecType;
    domain?: string;
  }> {
    // First, ask for spec type
    const typeAnswer = await inquirer.prompt<{ specType: SpecType }>([
      {
        type: 'list',
        name: 'specType',
        message: 'Spec type:',
        choices: [
          { name: 'Domain (what - abilities, data model, business rules)', value: 'domain' },
          { name: 'Infrastructure (technical internals)', value: 'infrastructure' },
        ],
        default: flags.type || 'domain',
      },
    ]);

    // Domain prompt for domain specs
    let domain: string | undefined;
    if (typeAnswer.specType === 'domain') {
      const domainAnswer = await inquirer.prompt<{ domain: string }>([
        {
          type: 'input',
          name: 'domain',
          message: 'Domain name (e.g., tickets, epics, agents):',
          default: flags.domain,
          validate: (input: string) => input.length > 0 || 'Domain is required',
        },
      ]);
      domain = domainAnswer.domain;
    }

    // Name - auto-generate for domain, ask for infrastructure
    let name: string;
    if (typeAnswer.specType === 'infrastructure') {
      const nameAnswer = await inquirer.prompt<{ name: string }>([
        {
          type: 'input',
          name: 'name',
          message: 'Spec name:',
          default: flags.name,
          validate: (input: string) => input.length > 0 || 'Name is required',
        },
      ]);
      name = nameAnswer.name;
    } else {
      name = domain!;
    }

    // Status
    const statusAnswer = await inquirer.prompt<{ status: string }>([
      {
        type: 'list',
        name: 'status',
        message: 'Spec status:',
        choices: [
          { name: 'Active (currently in use)', value: 'active' },
          { name: 'Draft (planning phase)', value: 'draft' },
          { name: 'Deprecated (no longer used)', value: 'deprecated' },
        ],
        default: flags.status || 'active',
      },
    ]);

    return {
      name,
      status: statusAnswer.status,
      specType: typeAnswer.specType,
      domain,
    };
  }

  private createSpecTemplate(specData: {
    name: string;
    specType: SpecType;
    domain?: string;
  }): string {
    switch (specData.specType) {
      case 'domain':
        return this.createDomainTemplate(specData.name, specData.domain!);
      case 'infrastructure':
        return this.createInfrastructureTemplate(specData.name);
    }
  }

  private createDomainTemplate(name: string, domain: string): string {
    const title = name.charAt(0).toUpperCase() + name.slice(1);
    const singular = domain.endsWith('s') ? domain.slice(0, -1) : domain;
    const singularTitle = singular.charAt(0).toUpperCase() + singular.slice(1);
    return `---
title: ${title}
domain: ${domain}
---

# ${title}

## Overview

[Describe what this domain covers]

## Abilities

### Create ${singular}

Create a new ${singular}.

| Modality | Signature |
|----------|-----------|
| storage | \`create${singularTitle}()\` |
| cli | \`prlt ${singular} create\` |
| api | \`POST /api/${domain}\` |
| web | \`Create${singularTitle}Modal\` |

### List ${domain}

List all ${domain}.

| Modality | Signature |
|----------|-----------|
| storage | \`list${title}()\` |
| cli | \`prlt ${singular} list\` |
| api | \`GET /api/${domain}\` |
| web | \`${title}List\` |

### View ${singular}

View a ${singular}'s details.

| Modality | Signature |
|----------|-----------|
| storage | \`get${singularTitle}()\` |
| cli | \`prlt ${singular} view\` |
| api | \`GET /api/${domain}/:id\` |
| web | \`/${domain}/:id\` |

### Update ${singular}

Update ${singular} fields.

| Modality | Signature |
|----------|-----------|
| storage | \`update${singularTitle}()\` |
| cli | \`prlt ${singular} edit\` |
| api | \`PATCH /api/${domain}/:id\` |
| web | \`Edit${singularTitle}Modal\` |

### Delete ${singular}

Delete a ${singular}.

| Modality | Signature |
|----------|-----------|
| storage | \`delete${singularTitle}()\` |
| cli | \`prlt ${singular} delete\` |
| api | \`DELETE /api/${domain}/:id\` |
| web | \`DeleteButton\` |

## Data Model

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| id | string | auto | - | Unique identifier |
| title | string | ✓ | - | Display name |
| created_at | timestamp | auto | now | Creation time |
| updated_at | timestamp | auto | now | Last modified |

## Business Rules

- **Title required**: Cannot create without title
- **Auto-ID**: IDs are auto-generated

## Related Domains

- [Related Domain](related.md) - Description of relationship
`;
  }

  private createInfrastructureTemplate(name: string): string {
    return `---
title: ${name}
---

# ${name}

## Overview

[Describe what this infrastructure component does]

## Architecture

[Describe the technical architecture]

## Configuration

\`\`\`yaml
# Example configuration
\`\`\`

## Implementation

[Implementation details]

## Related

- [Related Component](related.md)
`;
  }
}
