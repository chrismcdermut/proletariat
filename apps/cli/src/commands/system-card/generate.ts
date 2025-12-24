import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { findPMO, getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { PMO_TABLES } from '../../lib/pmo/schema.js';
import {
  SystemCard,
  DomainCoverage,
  ModalityCoverage,
  SchemaTable,
} from '../../lib/pmo/spec-types.js';
import type Database from 'better-sqlite3';

export default class SystemCardGenerate extends Command {
  static description = 'Generate System Card from specs';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --output SYSTEM_CARD.md',
    '<%= config.bin %> <%= command.id %> --check-implementation',
  ];

  static flags = {
    output: Flags.string({
      char: 'o',
      description: 'Output file path (default: SYSTEM_CARD.md)',
      default: 'SYSTEM_CARD.md',
    }),
    specsDir: Flags.string({
      char: 's',
      description: 'Specs directory path',
    }),
    checkImplementation: Flags.boolean({
      char: 'c',
      description: 'Check if implementations exist in codebase',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output as JSON instead of markdown',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show verbose output',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SystemCardGenerate);

    // Find PMO and database
    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    const specsDir = flags.specsDir || path.dirname(pmoPath);

    // Get storage with auto-migrations applied
    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    const db = storage.getDatabase();

    this.log(styles.muted(`Reading specs from database`));

    try {
      // Get domain specs from DB
      const specs = db.prepare(`
        SELECT id, domain, title, overview, status
        FROM ${PMO_TABLES.specs}
        WHERE spec_type = 'domain'
        ORDER BY domain
      `).all() as { id: string; domain: string; title: string; overview: string; status: string }[];

      if (specs.length === 0) {
        this.error('No domain specs found in database. Run "prlt spec sync" first.');
      }

      this.log(styles.muted(`Found ${specs.length} domain specs`));

      // Generate System Card data from DB
      const systemCard = this.generateSystemCardFromDb(db, specs, specsDir, flags.checkImplementation, flags.verbose);

      if (flags.json) {
        this.log(JSON.stringify(systemCard, null, 2));
        return;
      }

      // Generate markdown
      const markdown = this.generateMarkdown(systemCard);

      // Write output
      const outputPath = path.isAbsolute(flags.output)
        ? flags.output
        : path.join(specsDir, flags.output);

      fs.writeFileSync(outputPath, markdown);
      this.log(styles.success(`\n✅ Generated System Card: ${path.relative(process.cwd(), outputPath)}`));

      // Print summary
      this.printSummary(systemCard);
    } finally {
      await storage.close();
    }
  }

  private generateSystemCardFromDb(
    db: Database.Database,
    specs: { id: string; domain: string; title: string }[],
    specsDir: string,
    checkImpl: boolean,
    verbose: boolean
  ): SystemCard {
    const domains: DomainCoverage[] = [];

    // Get abilities for each spec from DB (normalized schema)
    const getAbilities = db.prepare(`
      SELECT id, name, description, position
      FROM ${PMO_TABLES.spec_abilities}
      WHERE spec_id = ?
      ORDER BY position
    `);

    // Get implementations for an ability
    const getImplementations = db.prepare(`
      SELECT modality, signature
      FROM ${PMO_TABLES.spec_implementations}
      WHERE ability_id = ?
    `);

    for (const spec of specs) {
      const abilities = getAbilities.all(spec.id) as {
        id: number;
        name: string;
        description: string | null;
        position: number;
      }[];

      if (verbose) {
        this.log(styles.muted(`  ${spec.domain}: ${abilities.length} abilities`));
      }

      domains.push({
        domain: spec.domain,
        abilities: abilities.map(ability => {
          // Get implementations from normalized table
          const implementations = getImplementations.all(ability.id) as {
            modality: string;
            signature: string;
          }[];

          const implMap: DomainCoverage['abilities'][0]['implementations'] = {};
          for (const impl of implementations) {
            implMap[impl.modality] = {
              signature: impl.signature,
              implemented: !checkImpl, // Default to true unless checking
              tested: false, // TODO: Check test coverage
            };
          }

          return {
            name: ability.name,
            implementations: implMap,
          };
        }),
      });
    }

    const coverage = this.calculateCoverage(domains);
    const schema = this.getSchemaFromDb(db);

    return {
      generatedAt: new Date().toISOString(),
      domains,
      coverage,
      schema,
    };
  }

  private calculateCoverage(domains: DomainCoverage[]): ModalityCoverage[] {
    // Collect all unique modalities used across all domains
    const modalityCounts = new Map<string, { implemented: number; total: number }>();

    for (const domain of domains) {
      for (const ability of domain.abilities) {
        for (const [modality, impl] of Object.entries(ability.implementations)) {
          if (!modalityCounts.has(modality)) {
            modalityCounts.set(modality, { implemented: 0, total: 0 });
          }
          const counts = modalityCounts.get(modality)!;
          counts.total++;
          if (impl.implemented) {
            counts.implemented++;
          }
        }
      }
    }

    // Convert to array and sort by total count (most used first)
    const coverage: ModalityCoverage[] = [];
    for (const [modality, counts] of modalityCounts.entries()) {
      coverage.push({
        modality,
        implemented: counts.implemented,
        total: counts.total,
        percent: Math.round((counts.implemented / counts.total) * 100),
      });
    }

    return coverage.sort((a, b) => b.total - a.total);
  }

  private getSchemaFromDb(db: Database.Database): SchemaTable[] {
    const schema: SchemaTable[] = [];

    try {
      const tables = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name LIKE 'pmo_%'
        ORDER BY name
      `).all() as { name: string }[];

      for (const { name } of tables) {
        const columns = db.pragma(`table_info(${name})`) as {
          name: string;
          pk: number;
        }[];

        schema.push({
          name,
          primaryKey: columns.find(c => c.pk === 1)?.name || 'id',
          columns: columns.map(c => c.name),
        });
      }
    } catch {
      // Skip if can't read schema
    }

    return schema;
  }

  private generateMarkdown(card: SystemCard): string {
    const lines: string[] = [];

    lines.push('# System Card');
    lines.push('');
    lines.push(`> Auto-generated from specs on ${new Date(card.generatedAt).toLocaleDateString()}`);
    lines.push('> Run \`prlt system-card generate\` to regenerate');
    lines.push('');

    // Coverage Summary
    lines.push('## Coverage Summary');
    lines.push('');
    lines.push('| Modality | Implemented | Total | Coverage |');
    lines.push('|----------|-------------|-------|----------|');
    for (const cov of card.coverage) {
      const bar = this.progressBar(cov.percent);
      lines.push(`| ${cov.modality} | ${cov.implemented} | ${cov.total} | ${bar} ${cov.percent}% |`);
    }
    lines.push('');

    // Domain Coverage
    lines.push('## Domain Coverage');
    lines.push('');

    for (const domain of card.domains) {
      lines.push(`### ${this.capitalize(domain.domain)}`);
      lines.push('');

      // Build header dynamically based on what modalities are used
      const usedModalities = this.getUsedModalities(domain);
      const header = ['Ability', ...usedModalities.map(m => this.capitalize(m))];
      const separator = header.map(() => '---');

      lines.push(`| ${header.join(' | ')} |`);
      lines.push(`| ${separator.join(' | ')} |`);

      for (const ability of domain.abilities) {
        const row = [ability.name];
        for (const mod of usedModalities) {
          const impl = ability.implementations[mod];
          if (impl) {
            const status = impl.implemented ? '✅' : '❌';
            row.push(`${status} \`${impl.signature}\``);
          } else {
            row.push('-');
          }
        }
        lines.push(`| ${row.join(' | ')} |`);
      }
      lines.push('');
    }

    // Database Schema
    if (card.schema.length > 0) {
      lines.push('## Database Schema');
      lines.push('');
      for (const table of card.schema) {
        lines.push(`### ${table.name}`);
        lines.push('');
        lines.push(`Primary Key: \`${table.primaryKey}\``);
        lines.push('');
        lines.push('Columns:');
        for (const col of table.columns) {
          const isPk = col === table.primaryKey ? ' (PK)' : '';
          lines.push(`- \`${col}\`${isPk}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private getUsedModalities(domain: DomainCoverage): string[] {
    const used = new Set<string>();
    for (const ability of domain.abilities) {
      for (const mod of Object.keys(ability.implementations)) {
        used.add(mod);
      }
    }
    // Sort alphabetically for consistent output
    return Array.from(used).sort();
  }

  private progressBar(percent: number): string {
    const filled = Math.round(percent / 10);
    const empty = 10 - filled;
    return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private printSummary(card: SystemCard): void {
    this.log('');
    this.log(styles.emphasis('Coverage Summary:'));

    for (const cov of card.coverage) {
      const bar = this.progressBar(cov.percent);
      const color = cov.percent >= 80 ? styles.success : cov.percent >= 50 ? styles.warning : styles.error;
      this.log(`  ${cov.modality.padEnd(10)} ${bar} ${color(`${cov.percent}%`)}`);
    }

    // Total abilities
    const totalAbilities = card.domains.reduce((sum, d) => sum + d.abilities.length, 0);
    this.log('');
    this.log(styles.muted(`Total: ${card.domains.length} domains, ${totalAbilities} abilities`));
  }
}
