import { Flags, Args } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { parseSpecFile } from '../../lib/pmo/spec-parser.js';
import { ParsedSpec, SpecType, SpecStatus } from '../../lib/pmo/spec-types.js';
import { slugify } from '../../lib/pmo/utils.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js';

interface ImportResult {
  file: string;
  id: string;
  title: string;
  status: 'imported' | 'skipped' | 'error';
  reason?: string;
}

export default class SpecImport extends PMOCommand {
  static description = 'Import specs from markdown files into the database';

  static examples = [
    '<%= config.bin %> <%= command.id %>                    # Scan specs/ directory',
    '<%= config.bin %> <%= command.id %> specs/product      # Scan specific directory',
    '<%= config.bin %> <%= command.id %> specs/product/auth.md  # Import single file',
    '<%= config.bin %> <%= command.id %> --dry-run          # Preview without importing',
    '<%= config.bin %> <%= command.id %> --force            # Overwrite existing specs',
  ];

  static args = {
    path: Args.string({
      description: 'File or directory to import (default: specs/)',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Preview what would be imported without making changes',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing specs with the same ID',
      default: false,
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Import all valid specs without prompting',
      default: false,
    }),
  };

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SpecImport);
    const jsonMode = shouldOutputJson(flags);
    const dryRun = flags['dry-run'];

    // Determine the import path
    let importPath = args.path;
    if (!importPath) {
      // Default to specs/ directory relative to PMO path
      const specsDir = path.join(this.pmoPath, '..', 'specs');
      if (fs.existsSync(specsDir)) {
        importPath = specsDir;
      } else {
        // Try current working directory
        const cwdSpecs = path.join(process.cwd(), 'specs');
        if (fs.existsSync(cwdSpecs)) {
          importPath = cwdSpecs;
        } else {
          if (jsonMode) {
            outputErrorAsJson('NO_SPECS_DIR', 'No specs/ directory found. Create one or specify a path.', createMetadata('spec import', flags));
            return;
          }
          this.log(styles.warning('\nNo specs/ directory found.'));
          this.log(styles.muted('  Create a specs/ directory with markdown files, or specify a path:'));
          this.log(styles.muted('  prlt spec import /path/to/specs'));
          return;
        }
      }
    }

    // Resolve to absolute path
    importPath = path.resolve(importPath);

    // Check if path exists
    if (!fs.existsSync(importPath)) {
      if (jsonMode) {
        outputErrorAsJson('PATH_NOT_FOUND', `Path not found: ${importPath}`, createMetadata('spec import', flags));
        return;
      }
      this.error(`Path not found: ${importPath}`);
    }

    // Find markdown files to import
    const files = this.findMarkdownFiles(importPath);

    if (files.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_FILES', `No markdown files found in: ${importPath}`, createMetadata('spec import', flags));
        return;
      }
      this.log(styles.warning(`\nNo markdown files found in: ${importPath}`));
      return;
    }

    this.log(styles.title('\n📄 Spec Import'));
    this.log(styles.muted('═'.repeat(60)));
    this.log(styles.muted(`Scanning: ${importPath}`));
    this.log(styles.muted(`Found ${files.length} markdown file${files.length === 1 ? '' : 's'}\n`));

    // Parse and validate each file
    const candidates: Array<{
      file: string;
      parsed: ParsedSpec;
      specId: string;
      specType: SpecType | undefined;
      errors: string[];
      existsInDb: boolean;
    }> = [];

    for (const file of files) {
      try {
        const parsed = parseSpecFile(file);

        // Determine spec ID: use frontmatter id, or generate from title/filename
        let specId = parsed.frontmatter.id;
        if (!specId) {
          // Generate ID from title or filename
          const titleOrFilename = parsed.title && parsed.title !== 'Untitled'
            ? parsed.title
            : path.basename(file, '.md');
          specId = slugify(titleOrFilename);
        }

        // Custom validation that doesn't require frontmatter.id since we generate it
        const errors = this.validateSpecForImport(parsed, specId);

        // Infer type from directory structure
        let specType = parsed.frontmatter.type;
        if (!specType) {
          specType = this.inferTypeFromPath(file, importPath);
        }

        // Check if spec already exists in database
        const existingSpec = await this.storage.getSpec(specId);

        candidates.push({
          file,
          parsed,
          specId,
          specType,
          errors,
          existsInDb: !!existingSpec,
        });
      } catch (error) {
        candidates.push({
          file,
          parsed: null as unknown as ParsedSpec,
          specId: '',
          specType: undefined,
          errors: [`Parse error: ${(error as Error).message}`],
          existsInDb: false,
        });
      }
    }

    // Display candidates
    const validCandidates = candidates.filter(c => c.errors.length === 0 && c.parsed);
    const invalidCandidates = candidates.filter(c => c.errors.length > 0 || !c.parsed);
    const conflictCandidates = validCandidates.filter(c => c.existsInDb);
    const readyToImport = validCandidates.filter(c => !c.existsInDb || flags.force);

    // Show valid specs
    if (validCandidates.length > 0) {
      this.log(styles.emphasis('✓ Valid specs:'));
      for (const c of validCandidates) {
        const relativePath = path.relative(importPath, c.file);
        const conflict = c.existsInDb ? styles.warning(' [exists]') : '';
        const typeTag = c.specType ? ` (${c.specType})` : '';
        this.log(`  ${styles.code(c.specId)}: ${c.parsed.title}${typeTag}${conflict}`);
        this.log(styles.muted(`    ${relativePath}`));
      }
    }

    // Show invalid specs
    if (invalidCandidates.length > 0) {
      this.log(styles.warning('\n✗ Invalid specs (will be skipped):'));
      for (const c of invalidCandidates) {
        const relativePath = path.relative(importPath, c.file);
        this.log(`  ${relativePath}`);
        for (const error of c.errors) {
          this.log(styles.error(`    - ${error}`));
        }
      }
    }

    // Show conflict warning
    if (conflictCandidates.length > 0 && !flags.force) {
      this.log(styles.warning(`\n⚠ ${conflictCandidates.length} spec${conflictCandidates.length === 1 ? '' : 's'} already exist${conflictCandidates.length === 1 ? 's' : ''} in the database.`));
      this.log(styles.muted('  Use --force to overwrite existing specs.'));
    }

    if (readyToImport.length === 0) {
      this.log(styles.muted('\nNo specs to import.'));
      return;
    }

    this.log(styles.muted(`\n${readyToImport.length} spec${readyToImport.length === 1 ? '' : 's'} ready to import.`));

    // Dry run - stop here
    if (dryRun) {
      this.log(styles.muted('\n[Dry run - no changes made]'));
      return;
    }

    // Confirm import
    if (!flags.all) {
      const confirmMessage = 'Proceed with import?';
      const confirmChoices = [
        { name: 'Yes', value: true },
        { name: 'No', value: false },
      ];

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', 'confirmed', confirmMessage, confirmChoices),
          createMetadata('spec import', flags)
        );
      }

      const { confirmed } = await inquirer.prompt([{
        type: 'list',
        name: 'confirmed',
        message: confirmMessage,
        choices: confirmChoices,
      }]);

      if (!confirmed) {
        this.log(styles.muted('Import cancelled.'));
        return;
      }
    }

    // Perform import
    const results: ImportResult[] = [];

    for (const c of readyToImport) {
      try {
        const specData = {
          id: c.specId,
          title: c.parsed.title,
          status: (c.parsed.frontmatter.status || 'draft') as SpecStatus,
          type: c.specType,
          tags: c.parsed.frontmatter.tags,
          dependsOn: c.parsed.frontmatter.depends_on,
          problem: c.parsed.problem,
          solution: c.parsed.solution,
          decisions: c.parsed.decisions,
          notNow: c.parsed.notNow,
          uiUx: c.parsed.uiUx,
          acceptanceCriteria: c.parsed.acceptanceCriteria,
          openQuestions: c.parsed.openQuestions,
          requirementsFunctional: c.parsed.requirementsFunctional,
          requirementsTechnical: c.parsed.requirementsTechnical,
          context: c.parsed.context,
        };

        if (c.existsInDb) {
          // Update existing spec
          await this.storage.updateSpec(c.specId, specData);
          results.push({
            file: c.file,
            id: c.specId,
            title: c.parsed.title,
            status: 'imported',
            reason: 'updated',
          });
        } else {
          // Create new spec
          await this.storage.createSpec(specData);
          results.push({
            file: c.file,
            id: c.specId,
            title: c.parsed.title,
            status: 'imported',
          });
        }
      } catch (error) {
        results.push({
          file: c.file,
          id: c.specId,
          title: c.parsed?.title || 'Unknown',
          status: 'error',
          reason: (error as Error).message,
        });
      }
    }

    // Report results
    const imported = results.filter(r => r.status === 'imported');
    const errors = results.filter(r => r.status === 'error');

    this.log(styles.muted('\n' + '═'.repeat(60)));

    if (imported.length > 0) {
      this.log(styles.success(`\n✅ Imported ${imported.length} spec${imported.length === 1 ? '' : 's'}:`));
      for (const r of imported) {
        const action = r.reason === 'updated' ? ' (updated)' : '';
        this.log(`  ${styles.code(r.id)}: ${r.title}${action}`);
      }
    }

    if (errors.length > 0) {
      this.log(styles.error(`\n❌ Failed to import ${errors.length} spec${errors.length === 1 ? '' : 's'}:`));
      for (const r of errors) {
        this.log(`  ${styles.code(r.id)}: ${r.reason}`);
      }
    }

    this.log(styles.muted('\nNext steps:'));
    this.log(styles.primary('  prlt spec list        ') + styles.muted('View imported specs'));
    this.log(styles.primary('  prlt spec view <id>   ') + styles.muted('View spec details'));
  }

  /**
   * Find all markdown files in a path (file or directory)
   */
  private findMarkdownFiles(targetPath: string): string[] {
    const stat = fs.statSync(targetPath);

    if (stat.isFile()) {
      return targetPath.endsWith('.md') ? [targetPath] : [];
    }

    if (stat.isDirectory()) {
      const files: string[] = [];
      this.walkDirectory(targetPath, files);
      return files;
    }

    return [];
  }

  /**
   * Recursively walk a directory to find markdown files
   */
  private walkDirectory(dir: string, files: string[]): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and common non-spec directories
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          this.walkDirectory(fullPath, files);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Skip README files and other common non-spec files
        if (entry.name.toLowerCase() !== 'readme.md') {
          files.push(fullPath);
        }
      }
    }
  }

  /**
   * Validate a parsed spec for import.
   * Similar to validateSpec but doesn't require frontmatter.id since we generate it.
   */
  private validateSpecForImport(spec: ParsedSpec, generatedId: string): string[] {
    const errors: string[] = [];

    // Validate the generated/provided ID
    if (!generatedId) {
      errors.push('Could not determine spec ID from frontmatter, title, or filename');
    }

    // Title is required
    if (!spec.title || spec.title === 'Untitled') {
      errors.push('Missing title (H1 heading)');
    }

    // Problem and Solution sections are required
    if (!spec.problem) {
      errors.push('Missing Problem section');
    }
    if (!spec.solution) {
      errors.push('Missing Solution section');
    }

    return errors;
  }

  /**
   * Infer spec type from file path based on directory structure
   */
  private inferTypeFromPath(filePath: string, basePath: string): SpecType | undefined {
    const relativePath = path.relative(basePath, filePath).toLowerCase();
    const parts = relativePath.split(path.sep);

    // Check first directory level for type indicators
    const firstDir = parts[0];

    if (firstDir === 'product' || firstDir.startsWith('prod')) {
      return 'product';
    }
    if (firstDir === 'platform' || firstDir.startsWith('plat')) {
      return 'platform';
    }
    if (firstDir === 'infra' || firstDir === 'infrastructure') {
      return 'infra';
    }
    if (firstDir === 'integrations' || firstDir === 'integration') {
      return 'integration';
    }

    return undefined;
  }
}
