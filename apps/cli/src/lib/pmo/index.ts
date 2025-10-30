import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { PMO_TEMPLATES, PMO_STRUCTURE } from './templates';

export interface PMOConfig {
  type: 'embedded' | 'consolidated' | 'hybrid';
  repos?: Array<{
    name: string;
    path: string;
    kanban: string;
  }>;
  sync?: {
    auto: boolean;
    interval: number;
  };
  kanban?: {
    columns: string[];
    card_template: string;
  };
}

export class PMOManager {
  private rootPath: string;

  constructor(rootPath: string = process.cwd()) {
    this.rootPath = rootPath;
  }

  async init(force: boolean = false): Promise<void> {
    const pmoPath = path.join(this.rootPath, 'pmo');
    
    if (fs.existsSync(pmoPath) && !force) {
      throw new Error('PMO directory already exists. Use --force to overwrite.');
    }

    // Create PMO directory structure
    await this.createStructure(pmoPath);
    
    console.log('✅ PMO structure initialized successfully');
    console.log(`📁 Created at: ${pmoPath}`);
    console.log('\nNext steps:');
    console.log('1. Open kanban.md in Obsidian with Kanban plugin');
    console.log('2. Run "prlt pmo status" to view project status');
    console.log('3. Create specs in pmo/specs/backlog/');
  }

  private async createStructure(pmoPath: string): Promise<void> {
    // Create directories
    for (const dir of PMO_STRUCTURE.directories) {
      const dirPath = path.join(pmoPath, dir);
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Create files from templates
    for (const file of PMO_STRUCTURE.files) {
      const filePath = path.join(pmoPath, file.path);
      const template = PMO_TEMPLATES[file.template as keyof typeof PMO_TEMPLATES];
      fs.writeFileSync(filePath, template);
    }

    // Create example spec
    const exampleSpecPath = path.join(pmoPath, 'specs/backlog/example-feature.md');
    fs.writeFileSync(exampleSpecPath, PMO_TEMPLATES.specTemplate);
  }

  async status(): Promise<void> {
    const pmoPath = path.join(this.rootPath, 'pmo');
    
    if (!fs.existsSync(pmoPath)) {
      throw new Error('No PMO found. Run "prlt pmo init" first.');
    }

    const kanbanPath = path.join(pmoPath, 'kanban.md');
    const kanbanContent = fs.readFileSync(kanbanPath, 'utf-8');
    
    // Parse kanban board
    const stats = this.parseKanbanStats(kanbanContent);
    
    console.log('\n📊 PMO Status\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    for (const [column, count] of Object.entries(stats)) {
      const emoji = this.getColumnEmoji(column);
      console.log(`${emoji} ${column}: ${count} items`);
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Show recent specs
    this.showRecentSpecs(pmoPath);
  }

  private parseKanbanStats(content: string): Record<string, number> {
    const stats: Record<string, number> = {};
    const lines = content.split('\n');
    let currentColumn = '';
    
    for (const line of lines) {
      if (line.startsWith('## ')) {
        currentColumn = line.substring(3).trim();
        stats[currentColumn] = 0;
      } else if (line.startsWith('- [ ]') && currentColumn) {
        stats[currentColumn]++;
      }
    }
    
    return stats;
  }

  private getColumnEmoji(column: string): string {
    const emojis: Record<string, string> = {
      'Backlog': '📋',
      'In Progress': '🚀',
      'In Review': '👀',
      'Complete': '✅',
      'Archived': '📦'
    };
    return emojis[column] || '📌';
  }

  private showRecentSpecs(pmoPath: string): void {
    const specsPath = path.join(pmoPath, 'specs');
    const categories = ['active', 'backlog', 'completed'];
    
    console.log('📄 Recent Specs:\n');
    
    for (const category of categories) {
      const categoryPath = path.join(specsPath, category);
      if (!fs.existsSync(categoryPath)) continue;
      
      const files = fs.readdirSync(categoryPath)
        .filter(f => f.endsWith('.md'))
        .slice(0, 3);
      
      if (files.length > 0) {
        console.log(`  ${category}:`);
        for (const file of files) {
          console.log(`    • ${file.replace('.md', '')}`);
        }
      }
    }
  }

  async sync(): Promise<void> {
    const configPath = path.join(this.rootPath, 'pmo', 'config.yml');
    
    if (!fs.existsSync(configPath)) {
      throw new Error('No PMO config found. This command is for consolidated PMOs.');
    }
    
    const config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as PMOConfig;
    
    if (config.type !== 'consolidated' && config.type !== 'hybrid') {
      throw new Error('Sync is only available for consolidated or hybrid PMO types.');
    }
    
    if (!config.repos || config.repos.length === 0) {
      throw new Error('No repos configured for sync. Edit pmo/config.yml');
    }
    
    console.log('🔄 Syncing kanbans from configured repos...\n');
    
    const allCards: Array<{ repo: string; content: string }> = [];
    
    for (const repo of config.repos) {
      const repoKanbanPath = path.join(this.rootPath, repo.path, repo.kanban);
      
      if (!fs.existsSync(repoKanbanPath)) {
        console.log(`⚠️  Skipping ${repo.name}: kanban not found`);
        continue;
      }
      
      const content = fs.readFileSync(repoKanbanPath, 'utf-8');
      const cards = this.extractCards(content);
      
      cards.forEach(card => {
        allCards.push({ repo: repo.name, content: card });
      });
      
      console.log(`✅ Synced ${cards.length} cards from ${repo.name}`);
    }
    
    // Create consolidated kanban
    this.createConsolidatedKanban(allCards);
    
    console.log(`\n📊 Total cards synced: ${allCards.length}`);
    console.log('✨ Consolidated kanban updated');
  }

  private extractCards(content: string): string[] {
    const cards: string[] = [];
    const lines = content.split('\n');
    let currentCard = '';
    let inCard = false;
    
    for (const line of lines) {
      if (line.startsWith('- [ ]')) {
        if (currentCard) {
          cards.push(currentCard.trim());
        }
        currentCard = line;
        inCard = true;
      } else if (inCard && line.startsWith('  ')) {
        currentCard += '\n' + line;
      } else if (inCard && !line.trim()) {
        if (currentCard) {
          cards.push(currentCard.trim());
        }
        currentCard = '';
        inCard = false;
      }
    }
    
    if (currentCard) {
      cards.push(currentCard.trim());
    }
    
    return cards;
  }

  private createConsolidatedKanban(cards: Array<{ repo: string; content: string }>): void {
    const kanbanPath = path.join(this.rootPath, 'pmo', 'kanban-consolidated.md');
    
    let content = `---

kanban-plugin: board

---

# Consolidated Project Kanban

_Last synced: ${new Date().toISOString()}_

## Backlog

`;

    // Group cards by repo
    const byRepo = cards.reduce((acc, card) => {
      if (!acc[card.repo]) acc[card.repo] = [];
      acc[card.repo].push(card.content);
      return acc;
    }, {} as Record<string, string[]>);

    for (const [repo, repoCards] of Object.entries(byRepo)) {
      content += `\n### ${repo}\n\n`;
      for (const card of repoCards) {
        content += card + '\n\n';
      }
    }

    content += `
## In Progress

## In Review

## Complete

## Archived


%% kanban:settings
\`\`\`
{"kanban-plugin":"board"}
\`\`\`
%%`;

    fs.writeFileSync(kanbanPath, content);
  }
}

export * from './templates';