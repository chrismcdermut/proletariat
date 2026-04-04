import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests for the ClawHub SKILL.md file.
 * Validates frontmatter structure and markdown body content
 * for the OpenClaw integration skill.
 *
 * PRLT-1243: Publish prlt ClawHub skill for OpenClaw integration
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path from apps/cli/test/unit/ to repo root
const SKILL_PATH = resolve(__dirname, '..', '..', '..', '..', 'skills', 'openclaw', 'SKILL.md');

function parseSkillFile(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('SKILL.md must have YAML frontmatter delimited by ---');
  const rawYaml = match[1];
  const body = match[2];

  // Simple YAML parser for the flat/nested structure we expect
  const frontmatter: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const line of rawYaml.split('\n')) {
    // Nested list item (e.g. "    - prlt")
    const nestedListMatch = line.match(/^ {4}- (.+)$/);
    if (nestedListMatch && currentKey) {
      if (!currentList) currentList = [];
      currentList.push(nestedListMatch[1].trim());
      continue;
    }

    // Top-level list item (e.g. "  - orchestration")
    const topListMatch = line.match(/^ {2}- (.+)$/);
    if (topListMatch && currentKey) {
      if (!currentList) currentList = [];
      currentList.push(topListMatch[1].trim());
      continue;
    }

    // Flush previous list
    if (currentList && currentKey) {
      // Assign list to the right path
      frontmatter[currentKey] = currentList;
      currentList = null;
      currentKey = null;
    }

    // Top-level key: value (e.g. "name: proletariat")
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value) {
        frontmatter[key] = value;
        currentKey = null;
      } else {
        currentKey = key;
      }
      continue;
    }

    // Nested key (e.g. "  bins:")
    const nestedKeyMatch = line.match(/^\s+(\w+):\s*(.*)$/);
    if (nestedKeyMatch) {
      const nestedKey = nestedKeyMatch[1];
      const nestedValue = nestedKeyMatch[2].trim();
      if (nestedValue) {
        frontmatter[`${currentKey}.${nestedKey}`] = nestedValue;
      } else {
        // bins: (with list below) — update currentKey to track nested path
        currentKey = `${currentKey}.${nestedKey}`;
      }
    }
  }

  // Flush any trailing list
  if (currentList && currentKey) {
    frontmatter[currentKey] = currentList;
  }

  return { frontmatter, body };
}

describe('ClawHub SKILL.md', () => {
  let content: string;
  let frontmatter: Record<string, unknown>;
  let body: string;

  before(() => {
    content = readFileSync(SKILL_PATH, 'utf-8');
    const parsed = parseSkillFile(content);
    frontmatter = parsed.frontmatter;
    body = parsed.body;
  });

  describe('file structure', () => {
    it('exists and is non-empty', () => {
      expect(content.length).to.be.greaterThan(0);
    });

    it('has valid YAML frontmatter delimiters', () => {
      expect(content).to.match(/^---\n[\s\S]*?\n---\n/);
    });
  });

  describe('frontmatter', () => {
    it('has name field set to proletariat', () => {
      expect(frontmatter.name).to.equal('proletariat');
    });

    it('has a description', () => {
      expect(frontmatter.description).to.be.a('string');
      expect((frontmatter.description as string).length).to.be.greaterThan(10);
    });

    it('has a semver version', () => {
      expect(frontmatter.version).to.match(/^\d+\.\d+\.\d+$/);
    });

    it('requires prlt binary', () => {
      const bins = frontmatter['requires.bins'] as string[];
      expect(bins).to.be.an('array');
      expect(bins).to.include('prlt');
    });

    it('has tags array with required tags', () => {
      const tags = frontmatter.tags as string[];
      expect(tags).to.be.an('array');
      const requiredTags = ['orchestration', 'agents', 'devops', 'git', 'docker'];
      for (const tag of requiredTags) {
        expect(tags, `missing tag: ${tag}`).to.include(tag);
      }
    });
  });

  describe('markdown body — command documentation', () => {
    it('documents prlt work start', () => {
      expect(body).to.include('prlt work start');
    });

    it('documents prlt work ship', () => {
      expect(body).to.include('prlt work ship');
    });

    it('documents prlt session list', () => {
      expect(body).to.include('prlt session list');
    });

    it('documents prlt session peek', () => {
      expect(body).to.include('prlt session peek');
    });

    it('documents prlt session poke', () => {
      expect(body).to.include('prlt session poke');
    });

    it('documents prlt ticket list', () => {
      expect(body).to.include('prlt ticket list');
    });

    it('documents prlt ticket create', () => {
      expect(body).to.include('prlt ticket create');
    });

    it('documents prlt ticket move', () => {
      expect(body).to.include('prlt ticket move');
    });

    it('documents prlt pr checks', () => {
      expect(body).to.include('prlt pr checks');
    });
  });

  describe('markdown body — workflow examples', () => {
    it('includes start work example with flags', () => {
      expect(body).to.include('prlt work start PRLT-123 --skip-permissions --create-pr --yes');
    });

    it('includes peek example', () => {
      expect(body).to.include('prlt session peek');
    });

    it('includes ship --when-green example', () => {
      expect(body).to.include('prlt work ship');
      expect(body).to.include('--when-green');
    });
  });

  describe('markdown body — structure', () => {
    it('has a top-level heading', () => {
      expect(body).to.match(/^#\s+/m);
    });

    it('has command tables with pipe-separated columns', () => {
      expect(body).to.include('| Command | Description |');
    });

    it('has code blocks with examples', () => {
      expect(body).to.include('```bash');
    });
  });
});
