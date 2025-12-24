import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { findPMO, getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import { parseDomainSpec, parseDomainSpecs } from '../../lib/pmo/spec-parser.js';
import { DomainSpec } from '../../lib/pmo/spec-types.js';
import type Database from 'better-sqlite3';
import { PMO_TABLES } from '../../lib/pmo/schema.js';

export default class SpecSync extends Command {
  static description = 'Sync specs between markdown files and database';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --from-markdown',
    '<%= config.bin %> <%= command.id %> --spec tickets',
  ];

  static flags = {
    fromMarkdown: Flags.boolean({
      description: 'Sync from markdown files to database (default)',
      default: true,
    }),
    toMarkdown: Flags.boolean({
      description: 'Sync from database to markdown files',
      default: false,
    }),
    spec: Flags.string({
      char: 's',
      description: 'Sync specific spec by domain name',
    }),
    dryRun: Flags.boolean({
      char: 'n',
      description: 'Show what would be synced without making changes',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show verbose output',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SpecSync);

    const pmoPath = findPMO();
    if (!pmoPath) {
      this.error('PMO not found. Run "prlt pmo init" first.');
    }

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      false
    );

    // Find specs directory
    const specsPath = path.join(path.dirname(pmoPath), 'specs');
    if (!fs.existsSync(specsPath)) {
      await storage.close();
      this.error(`Specs directory not found: ${specsPath}`);
    }

    if (flags.toMarkdown) {
      this.log(styles.warning('Sync from DB to markdown not yet implemented'));
      await storage.close();
      return;
    }

    // Default: sync from markdown to DB
    this.log(styles.muted(`Syncing specs from: ${specsPath}`));

    let specs: DomainSpec[];
    if (flags.spec) {
      const specFile = path.join(specsPath, 'domain', `${flags.spec}.md`);
      if (!fs.existsSync(specFile)) {
        await storage.close();
        this.error(`Spec not found: ${specFile}`);
      }
      specs = [parseDomainSpec(specFile)];
    } else {
      specs = parseDomainSpecs(specsPath);
    }

    if (specs.length === 0) {
      this.log(styles.warning('No domain specs found'));
      await storage.close();
      return;
    }

    // Use storage's database connection (which has already run migrations)
    const db = storage.getDatabase();

    try {
      let synced = 0;
      for (const spec of specs) {
        if (flags.dryRun) {
          this.log(`Would sync: ${spec.frontmatter.domain}`);
          if (flags.verbose) {
            this.log(`  - ${spec.abilities.length} abilities`);
            this.log(`  - ${spec.dataModel.length} fields`);
            this.log(`  - ${spec.businessRules.length} rules`);
            this.log(`  - ${spec.relatedDomains.length} relations`);
          }
        } else {
          this.syncSpecToDb(db, spec, flags.verbose);
          synced++;
        }
      }

      if (flags.dryRun) {
        this.log(styles.muted(`\nDry run: would sync ${specs.length} specs`));
      } else {
        this.log(styles.success(`\n✅ Synced ${synced} specs to database`));
      }
    } finally {
      // Don't close db separately - storage.close() handles it
      await storage.close();
    }
  }

  private syncSpecToDb(db: Database.Database, spec: DomainSpec, verbose: boolean): void {
    const specId = spec.frontmatter.domain;
    const relativePath = path.relative(process.cwd(), spec.filePath);

    if (verbose) {
      this.log(`\nSyncing: ${specId}`);
    }

    // Use a transaction for atomic updates
    const transaction = db.transaction(() => {
      // 1. Upsert the spec itself
      db.prepare(`
        INSERT INTO ${PMO_TABLES.specs} (id, path, title, overview, status, spec_type, domain, updated_at)
        VALUES (?, ?, ?, ?, ?, 'domain', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          path = excluded.path,
          title = excluded.title,
          overview = excluded.overview,
          status = excluded.status,
          domain = excluded.domain,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        specId,
        relativePath,
        spec.frontmatter.title,
        spec.overview,
        spec.frontmatter.status || 'active',
        spec.frontmatter.domain
      );

      // 2. Sync abilities - delete and re-insert with normalized schema
      // First delete implementations (they reference abilities)
      db.prepare(`
        DELETE FROM ${PMO_TABLES.spec_implementations}
        WHERE ability_id IN (SELECT id FROM ${PMO_TABLES.spec_abilities} WHERE spec_id = ?)
      `).run(specId);
      // Then delete abilities
      db.prepare(`DELETE FROM ${PMO_TABLES.spec_abilities} WHERE spec_id = ?`).run(specId);

      const insertAbility = db.prepare(`
        INSERT INTO ${PMO_TABLES.spec_abilities}
        (spec_id, name, description, position)
        VALUES (?, ?, ?, ?)
      `);

      const insertImplementation = db.prepare(`
        INSERT INTO ${PMO_TABLES.spec_implementations}
        (ability_id, modality, signature)
        VALUES (?, ?, ?)
      `);

      let implementationCount = 0;
      spec.abilities.forEach((ability, index) => {
        // Insert ability
        const result = insertAbility.run(
          specId,
          ability.name,
          ability.description || null,
          index
        );

        const abilityId = result.lastInsertRowid;

        // Insert implementations for each modality
        for (const [modality, signature] of Object.entries(ability.implementations)) {
          if (signature) {
            insertImplementation.run(abilityId, modality, signature);
            implementationCount++;
          }
        }
      });

      if (verbose) {
        this.log(`  Synced ${spec.abilities.length} abilities with ${implementationCount} implementations`);
      }

      // 3. Sync data model fields
      db.prepare(`DELETE FROM ${PMO_TABLES.spec_fields} WHERE spec_id = ?`).run(specId);
      const insertField = db.prepare(`
        INSERT INTO ${PMO_TABLES.spec_fields}
        (spec_id, name, field_type, required, default_value, description, position)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      spec.dataModel.forEach((field, index) => {
        insertField.run(
          specId,
          field.name,
          field.type,
          field.required,
          field.default || null,
          field.description,
          index
        );
      });

      if (verbose) {
        this.log(`  Synced ${spec.dataModel.length} fields`);
      }

      // 4. Sync business rules
      db.prepare(`DELETE FROM ${PMO_TABLES.spec_rules} WHERE spec_id = ?`).run(specId);
      const insertRule = db.prepare(`
        INSERT INTO ${PMO_TABLES.spec_rules}
        (spec_id, name, description, position)
        VALUES (?, ?, ?, ?)
      `);

      spec.businessRules.forEach((rule, index) => {
        insertRule.run(specId, rule.name, rule.description, index);
      });

      if (verbose) {
        this.log(`  Synced ${spec.businessRules.length} rules`);
      }

      // 5. Sync related domains
      db.prepare(`DELETE FROM ${PMO_TABLES.spec_relations} WHERE spec_id = ?`).run(specId);
      const insertRelation = db.prepare(`
        INSERT INTO ${PMO_TABLES.spec_relations}
        (spec_id, related_domain, relationship)
        VALUES (?, ?, ?)
      `);

      spec.relatedDomains.forEach((domain) => {
        insertRelation.run(specId, domain, null);
      });

      if (verbose) {
        this.log(`  Synced ${spec.relatedDomains.length} relations`);
      }
    });

    transaction();
  }
}
