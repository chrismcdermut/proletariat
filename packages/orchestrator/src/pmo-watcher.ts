import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import chokidar from 'chokidar';
import { PMOSpec } from './types';
import { TaskQueue } from './task-queue';
import { logger } from './utils/logger';

export class PMOWatcher extends EventEmitter {
  private watcher?: chokidar.FSWatcher;
  private pmoPath: string;
  private taskQueue: TaskQueue;
  private processedSpecs: Set<string>;

  constructor(taskQueue: TaskQueue, pmoPath?: string) {
    super();
    this.taskQueue = taskQueue;
    this.pmoPath = pmoPath || path.join(process.cwd(), 'pmo');
    this.processedSpecs = new Set();
  }

  async start() {
    // Ensure PMO directory structure exists
    await this.ensurePMOStructure();

    // Start watching for changes
    const watchPath = path.join(this.pmoPath, 'specs', 'active', '*.{yaml,yml,json}');
    
    this.watcher = chokidar.watch(watchPath, {
      persistent: true,
      ignoreInitial: false
    });

    this.watcher
      .on('add', (filePath) => this.handleNewSpec(filePath))
      .on('change', (filePath) => this.handleSpecChange(filePath))
      .on('unlink', (filePath) => this.handleSpecRemoval(filePath));

    logger.info(`👁️ Watching PMO directory: ${this.pmoPath}`);
  }

  async stop() {
    if (this.watcher) {
      await this.watcher.close();
    }
  }

  private async ensurePMOStructure() {
    const dirs = [
      'specs/active',
      'specs/backlog',
      'specs/completed',
      'templates'
    ];

    for (const dir of dirs) {
      const fullPath = path.join(this.pmoPath, dir);
      await fs.mkdir(fullPath, { recursive: true });
    }

    // Create sample template if it doesn't exist
    const templatePath = path.join(this.pmoPath, 'templates', 'spec-template.yaml');
    try {
      await fs.access(templatePath);
    } catch {
      await this.createSpecTemplate(templatePath);
    }

    // Create sample spec if directory is empty
    const activeDir = path.join(this.pmoPath, 'specs', 'active');
    const files = await fs.readdir(activeDir);
    if (files.length === 0) {
      await this.createSampleSpec(path.join(activeDir, 'SAMPLE-001.yaml'));
    }
  }

  private async createSpecTemplate(templatePath: string) {
    const template = {
      spec: {
        id: 'TEMPLATE-001',
        title: 'Template Title',
        priority: 'medium',
        assignedTo: 'auto',
        requirements: [
          {
            description: 'Requirement description',
            skills: ['skill1', 'skill2'],
            estimatedHours: 1,
            dependencies: []
          }
        ],
        acceptanceCriteria: [
          'Criterion 1',
          'Criterion 2'
        ],
        dependencies: [],
        estimatedHours: 8,
        status: 'new'
      }
    };

    await fs.writeFile(templatePath, yaml.stringify(template), 'utf-8');
    logger.info(`📝 Created spec template at ${templatePath}`);
  }

  private async createSampleSpec(specPath: string) {
    const sampleSpec = {
      spec: {
        id: 'SAMPLE-001',
        title: 'Sample Authentication Implementation',
        priority: 'high',
        assignedTo: 'auto',
        requirements: [
          {
            description: 'Implement JWT token generation endpoint',
            skills: ['backend', 'security'],
            estimatedHours: 2
          },
          {
            description: 'Add refresh token logic',
            skills: ['backend', 'security'],
            estimatedHours: 2
          },
          {
            description: 'Create authentication middleware',
            skills: ['backend'],
            estimatedHours: 1
          },
          {
            description: 'Write comprehensive tests',
            skills: ['testing'],
            estimatedHours: 2
          }
        ],
        acceptanceCriteria: [
          'All tests pass with 90% coverage',
          'Documentation updated',
          'Security review completed',
          'Performance benchmarks met'
        ],
        dependencies: [],
        estimatedHours: 7,
        status: 'new'
      }
    };

    await fs.writeFile(specPath, yaml.stringify(sampleSpec), 'utf-8');
    logger.info(`📋 Created sample spec at ${specPath}`);
  }

  private async handleNewSpec(filePath: string) {
    try {
      const spec = await this.parseSpec(filePath);
      if (spec && !this.processedSpecs.has(spec.id)) {
        this.processedSpecs.add(spec.id);
        logger.info(`📋 New spec detected: ${spec.id} - ${spec.title}`);
        this.emit('spec:new', spec);
      }
    } catch (error) {
      logger.error(`Failed to parse spec ${filePath}:`, error);
    }
  }

  private async handleSpecChange(filePath: string) {
    try {
      const spec = await this.parseSpec(filePath);
      if (spec) {
        logger.info(`📝 Spec updated: ${spec.id}`);
        this.emit('spec:updated', spec);
      }
    } catch (error) {
      logger.error(`Failed to parse spec ${filePath}:`, error);
    }
  }

  private handleSpecRemoval(filePath: string) {
    const fileName = path.basename(filePath, path.extname(filePath));
    logger.info(`🗑️ Spec removed: ${fileName}`);
    this.emit('spec:removed', fileName);
  }

  private async parseSpec(filePath: string): Promise<PMOSpec | null> {
    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();

    let data: any;
    if (ext === '.json') {
      data = JSON.parse(content);
    } else if (ext === '.yaml' || ext === '.yml') {
      data = yaml.parse(content);
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    if (!data.spec) {
      throw new Error('Invalid spec format: missing "spec" field');
    }

    const spec = data.spec as PMOSpec;
    
    // Validate required fields
    if (!spec.id || !spec.title) {
      throw new Error('Invalid spec: missing required fields (id, title)');
    }

    // Set defaults
    spec.priority = spec.priority || 'medium';
    spec.status = spec.status || 'new';
    spec.requirements = spec.requirements || [];
    spec.acceptanceCriteria = spec.acceptanceCriteria || [];

    return spec;
  }

  async moveSpecToCompleted(specId: string) {
    const activeDir = path.join(this.pmoPath, 'specs', 'active');
    const completedDir = path.join(this.pmoPath, 'specs', 'completed');

    const files = await fs.readdir(activeDir);
    for (const file of files) {
      if (file.includes(specId)) {
        const sourcePath = path.join(activeDir, file);
        const destPath = path.join(completedDir, file);
        await fs.rename(sourcePath, destPath);
        logger.info(`✅ Moved spec ${specId} to completed`);
        break;
      }
    }
  }

  async getActiveSpecs(): Promise<PMOSpec[]> {
    const activeDir = path.join(this.pmoPath, 'specs', 'active');
    const files = await fs.readdir(activeDir);
    const specs: PMOSpec[] = [];

    for (const file of files) {
      if (file.match(/\.(yaml|yml|json)$/)) {
        const filePath = path.join(activeDir, file);
        const spec = await this.parseSpec(filePath);
        if (spec) {
          specs.push(spec);
        }
      }
    }

    return specs;
  }
}