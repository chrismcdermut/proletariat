import { Flags, Args } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { parseSpecFile, validateSpec } from '../../lib/pmo/spec-parser.js';
import { slugify } from '../../lib/pmo/utils.js';
import { SpecType, SpecStatus } from '../../lib/pmo/types.js';
import { ParsedSpec } from '../../lib/pmo/spec-types.js';

/**
 * Map folder name to spec type
 */
function folderToSpecType(folderName: string): SpecType | undefined {
  const typeMap: Record<string, SpecType> = {
    product: 'product',
    platform: 'platform',
    infra: 'infra',
    integrations: 'integration',
    integration: 'integration',
  };
  return typeMap[folderName.toLowerCase()];
}

/**
 * Extract spec ID from parsed spec or derive from file
 */
function getSpecId(parsedSpec: ParsedSpec, filePath: string): string {
  // Prefer ID from frontmatter
  if (parsedSpec.frontmatter.id) {
    return parsedSpec.frontmatter.id;
  }
  // Fall back to slugified title
  if (parsedSpec.title && parsedSpec.title !== 'Untitled') {
    return slugify(parsedSpec.title);
  }
  // Last resort: use filename
  const basename = path.basename(filePath, '.md');
  return slugify(basename);
}

export default class SpecImport extends PMOCommand {
  static description = 'Import spec markdown files into the database';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> specs/product/auth.md',
    '<%= config.bin %> <%= command.id %> --dir specs/',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ];

  static args = {
    file: Args.string({
      description: 'Specific spec file to import',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    dir: Flags.string({
      char: 'd',
      description: 'Directory to scan for spec files',
      default: 'specs',
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Import all spec files from directory',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be imported without making changes',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing specs without prompting',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecImport);
    const dryRun = flags['dry-run'];

    // Find spec files to import
    let files: string[] = [];

    if (args.file) {
      // Import specific file
      if (!fs.existsSync(args.file)) {
        this.error(`File not found: ${args.file}`);
      }
      files = [args.file];
    } else {
      // Scan directory for spec files
      const specsDir = path.resolve(flags.dir);
      if (!fs.existsSync(specsDir)) {
        this.log(styles.warning(`\nSpecs directory not found: ${specsDir}`));
        this.log(styles.muted('Create spec files in a specs/ directory, or use --dir to specify a different location.'));
        return;
      }

      files = this.findSpecFiles(specsDir);

      if (files.length === 0) {
        this.log(styles.warning(`\nNo markdown files found in ${specsDir}`));
        return;
      }

      // If not --all, let user select which files to import
      if (!flags.all) {
        const { selectedFiles } = await inquirer.prompt([{
          type: 'checkbox',
          name: 'selectedFiles',
          message: 'Select spec files to import:',
          choices: files.map(f => ({
            name: path.relative(process.cwd(), f),
            value: f,
            checked: true,
          })),
        }]);

        if (selectedFiles.length === 0) {
          this.log(styles.muted('No files selected.'));
          return;
        }
        files = selectedFiles;
      }
    }

    this.log(styles.title('\n📥 Import Specs from Markdown'));
    this.log(styles.muted('═'.repeat(60)));

    if (dryRun) {
      this.log(styles.warning('DRY RUN - No changes will be made\n'));
    }

    // Process each file
    const results = {
      imported: 0,
      skipped: 0,
      errors: 0,
      overwritten: 0,
    };

    for (const file of files) {
      await this.importFile(file, flags, dryRun, results);
    }

    // Summary
    this.log(styles.muted('\n' + '═'.repeat(60)));
    this.log(styles.emphasis('Summary:'));
    if (results.imported > 0) {
      this.log(styles.success(`  ✅ Imported: ${results.imported}`));
    }
    if (results.overwritten > 0) {
      this.log(styles.warning(`  🔄 Overwritten: ${results.overwritten}`));
    }
    if (results.skipped > 0) {
      this.log(styles.muted(`  ⏭️  Skipped: ${results.skipped}`));
    }
    if (results.errors > 0) {
      this.log(styles.error(`  ❌ Errors: ${results.errors}`));
    }

    if (!dryRun && results.imported + results.overwritten > 0) {
      this.log(styles.muted('\nView imported specs: prlt spec list'));
    }
  }

  /**
   * Find all markdown files in directory (recursively)
   */
  private findSpecFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.findSpecFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Skip README files
        if (entry.name.toLowerCase() !== 'readme.md') {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  /**
   * Import a single spec file
   */
  private async importFile(
    filePath: string,
    flags: { force: boolean },
    dryRun: boolean,
    results: { imported: number; skipped: number; errors: number; overwritten: number }
  ): Promise<void> {
    const relativePath = path.relative(process.cwd(), filePath);
    this.log(`\n${styles.code(relativePath)}`);

    // Parse the file
    let parsedSpec: ParsedSpec;
    try {
      parsedSpec = parseSpecFile(filePath);
    } catch (error) {
      this.log(styles.error(`  ❌ Parse error: ${(error as Error).message}`));
      results.errors++;
      return;
    }

    // Validate the spec
    const validationErrors = validateSpec(parsedSpec);

    // Get spec ID
    const specId = getSpecId(parsedSpec, filePath);

    // Infer type from folder structure if not in frontmatter
    let specType = parsedSpec.frontmatter.type;
    if (!specType) {
      const parentDir = path.basename(path.dirname(filePath));
      specType = folderToSpecType(parentDir);
    }

    // Log parsed info
    this.log(styles.muted(`  ID: ${specId}`));
    this.log(styles.muted(`  Title: ${parsedSpec.title}`));
    if (specType) {
      this.log(styles.muted(`  Type: ${specType}`));
    }

    // Check for validation errors (but allow missing id if we derived one)
    const criticalErrors = validationErrors.filter(e =>
      e !== 'Missing id in frontmatter'
    );

    if (criticalErrors.length > 0) {
      this.log(styles.warning(`  ⚠️  Validation warnings:`));
      for (const error of criticalErrors) {
        this.log(styles.warning(`     - ${error}`));
      }
      // Only skip if missing required content sections
      if (criticalErrors.some(e => e.includes('Missing title') || e.includes('Missing Problem') || e.includes('Missing Solution'))) {
        this.log(styles.error(`  ❌ Skipped: Missing required sections`));
        results.errors++;
        return;
      }
    }

    // Check if spec already exists
    const existingSpec = await this.storage.getSpec(specId);
    if (existingSpec) {
      if (dryRun) {
        this.log(styles.warning(`  🔄 Would overwrite existing spec`));
        results.overwritten++;
        return;
      }

      if (!flags.force) {
        // Prompt for action
        const { action } = await inquirer.prompt([{
          type: 'list',
          name: 'action',
          message: `Spec "${specId}" already exists. What would you like to do?`,
          choices: [
            { name: 'Overwrite with imported content', value: 'overwrite' },
            { name: 'Skip this file', value: 'skip' },
            { name: 'Import with different ID', value: 'rename' },
          ],
        }]);

        if (action === 'skip') {
          this.log(styles.muted(`  ⏭️  Skipped`));
          results.skipped++;
          return;
        }

        if (action === 'rename') {
          const { newId } = await inquirer.prompt([{
            type: 'input',
            name: 'newId',
            message: 'Enter new spec ID:',
            default: `${specId}-imported`,
            validate: (input: string) => {
              if (!input.trim()) return 'ID is required';
              return true;
            },
          }]);

          // Check if the new ID also exists
          const newExisting = await this.storage.getSpec(newId);
          if (newExisting) {
            this.log(styles.error(`  ❌ ID "${newId}" also exists. Skipping.`));
            results.skipped++;
            return;
          }

          await this.createSpec(parsedSpec, newId, specType, dryRun);
          this.log(styles.success(`  ✅ Imported as "${newId}"`));
          results.imported++;
          return;
        }

        // Overwrite
        await this.updateSpec(existingSpec.id, parsedSpec, specType, dryRun);
        this.log(styles.warning(`  🔄 Overwritten`));
        results.overwritten++;
        return;
      }

      // Force mode - overwrite without prompting
      await this.updateSpec(existingSpec.id, parsedSpec, specType, dryRun);
      this.log(styles.warning(`  🔄 Overwritten`));
      results.overwritten++;
      return;
    }

    // Create new spec
    if (dryRun) {
      this.log(styles.success(`  ✅ Would import as "${specId}"`));
      results.imported++;
      return;
    }

    await this.createSpec(parsedSpec, specId, specType, dryRun);
    this.log(styles.success(`  ✅ Imported`));
    results.imported++;
  }

  /**
   * Create a new spec from parsed content
   */
  private async createSpec(
    parsed: ParsedSpec,
    specId: string,
    specType: SpecType | undefined,
    dryRun: boolean
  ): Promise<void> {
    if (dryRun) return;

    await this.storage.createSpec({
      id: specId,
      title: parsed.title,
      status: parsed.frontmatter.status || 'draft' as SpecStatus,
      type: specType,
      tags: parsed.frontmatter.tags,
      problem: parsed.problem,
      solution: parsed.solution,
      decisions: parsed.decisions,
      notNow: parsed.notNow,
      uiUx: parsed.uiUx,
      acceptanceCriteria: parsed.acceptanceCriteria,
      openQuestions: parsed.openQuestions,
      requirementsFunctional: parsed.requirementsFunctional,
      requirementsTechnical: parsed.requirementsTechnical,
      context: parsed.context,
    });

    // Handle dependencies if specified
    if (parsed.frontmatter.depends_on && parsed.frontmatter.depends_on.length > 0) {
      for (const depId of parsed.frontmatter.depends_on) {
        const depSpec = await this.storage.getSpec(depId);
        if (depSpec) {
          await this.storage.addSpecDependency(specId, depId);
        }
      }
    }
  }

  /**
   * Update an existing spec with parsed content
   */
  private async updateSpec(
    specId: string,
    parsed: ParsedSpec,
    specType: SpecType | undefined,
    dryRun: boolean
  ): Promise<void> {
    if (dryRun) return;

    await this.storage.updateSpec(specId, {
      title: parsed.title,
      status: parsed.frontmatter.status,
      type: specType,
      tags: parsed.frontmatter.tags,
      problem: parsed.problem,
      solution: parsed.solution,
      decisions: parsed.decisions,
      notNow: parsed.notNow,
      uiUx: parsed.uiUx,
      acceptanceCriteria: parsed.acceptanceCriteria,
      openQuestions: parsed.openQuestions,
      requirementsFunctional: parsed.requirementsFunctional,
      requirementsTechnical: parsed.requirementsTechnical,
      context: parsed.context,
    });
  }
}
