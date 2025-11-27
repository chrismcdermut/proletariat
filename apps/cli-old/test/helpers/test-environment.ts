/**
 * Test Environment Helper
 * Sets up isolated test environments for integration testing
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

export class TestEnvironment {
  private tempDir: string;
  private originalCwd: string;
  private gitInitialized: boolean = false;

  constructor(prefix: string = 'prlt-test') {
    this.originalCwd = process.cwd();
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  }

  /**
   * Get the temp directory path
   */
  get dir(): string {
    return this.tempDir;
  }

  /**
   * Change to the test directory
   */
  enter(): void {
    process.chdir(this.tempDir);
  }

  /**
   * Return to original directory
   */
  leave(): void {
    process.chdir(this.originalCwd);
  }

  /**
   * Initialize git repository
   */
  initGit(): void {
    if (!this.gitInitialized) {
      this.enter();
      execSync('git init', { stdio: 'pipe' });
      execSync('git config user.email "test@example.com"', { stdio: 'pipe' });
      execSync('git config user.name "Test User"', { stdio: 'pipe' });
      this.gitInitialized = true;
      this.leave();
    }
  }

  /**
   * Create a test file
   */
  createFile(relativePath: string, content: string = ''): void {
    const fullPath = path.join(this.tempDir, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content);
  }

  /**
   * Read a file from test environment
   */
  readFile(relativePath: string): string {
    return fs.readFileSync(path.join(this.tempDir, relativePath), 'utf-8');
  }

  /**
   * Check if file/directory exists
   */
  exists(relativePath: string): boolean {
    return fs.existsSync(path.join(this.tempDir, relativePath));
  }

  /**
   * List directory contents
   */
  listDir(relativePath: string = '.'): string[] {
    const fullPath = path.join(this.tempDir, relativePath);
    if (!fs.existsSync(fullPath)) return [];
    return fs.readdirSync(fullPath);
  }

  /**
   * Execute command in test environment
   */
  exec(command: string, options?: any): string {
    try {
      return execSync(command, {
        cwd: this.tempDir,
        encoding: 'utf-8',
        stdio: 'pipe',
        ...options
      });
    } catch (error: any) {
      throw new Error(`Command failed: ${command}\n${error.stderr || error.message}`);
    }
  }

  /**
   * Execute prlt command
   */
  prlt(args: string, options?: any): string {
    const prltPath = path.join(this.originalCwd, 'dist', 'bin', 'prlt.js');
    return this.exec(`node ${prltPath} ${args}`, options);
  }

  /**
   * Clean up test environment
   */
  cleanup(): void {
    this.leave();
    if (fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Create an HQ structure
   */
  setupHQ(hqName: string, theme: string = 'billionaires'): void {
    const hqPath = path.join(this.tempDir, hqName);
    const configPath = path.join(hqPath, '.proletariat', 'config.json');
    
    fs.mkdirSync(path.join(hqPath, '.proletariat'), { recursive: true });
    fs.mkdirSync(path.join(hqPath, 'repos'), { recursive: true });
    fs.mkdirSync(path.join(hqPath, '.proletariat', 'agents', 'staff'), { recursive: true });
    fs.mkdirSync(path.join(hqPath, 'pmo'), { recursive: true });
    
    const config = {
      version: '3.0.0',
      type: 'hq',
      name: hqName,
      theme: theme,
      themeDirectory: 'staff',
      agents: [],
      repos: [],
      agentAccess: {},
      agentRepoMode: 'all'
    };
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Create a simple repo structure
   */
  setupSimpleRepo(repoName: string, theme: string = 'billionaires'): void {
    const configPath = path.join(this.tempDir, '.proletariat', 'repo.json');
    
    fs.mkdirSync(path.join(this.tempDir, '.proletariat'), { recursive: true });
    
    const config = {
      version: '3.0.0',
      type: 'simple',
      projectName: repoName,
      theme: theme,
      agents: [],
      workspaceRoot: path.join(this.tempDir, '..', `${repoName}-staff`)
    };
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Add a test repository to HQ
   */
  addRepoToHQ(hqName: string, repoName: string): void {
    const repoPath = path.join(this.tempDir, hqName, 'repos', repoName);
    fs.mkdirSync(repoPath, { recursive: true });
    
    // Initialize as git repo
    execSync('git init', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: repoPath, stdio: 'pipe' });
    
    // Create a test file and commit
    fs.writeFileSync(path.join(repoPath, 'README.md'), `# ${repoName}`);
    execSync('git add .', { cwd: repoPath, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: repoPath, stdio: 'pipe' });
    
    // Update HQ config
    const configPath = path.join(this.tempDir, hqName, '.proletariat', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.repos.push(repoName);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Create a mock agent workspace
   */
  createAgentWorkspace(hqName: string, agentName: string, repoName?: string): void {
    const basePath = path.join(this.tempDir, hqName, '.proletariat', 'agents', 'staff', agentName);
    
    if (repoName) {
      const workspacePath = path.join(basePath, repoName);
      fs.mkdirSync(workspacePath, { recursive: true });
      
      // Create a marker file
      fs.writeFileSync(
        path.join(workspacePath, '.git'),
        `gitdir: ${path.join(this.tempDir, hqName, 'repos', repoName, '.git', 'worktrees', agentName)}`
      );
    } else {
      fs.mkdirSync(basePath, { recursive: true });
    }
    
    // Update HQ config
    const configPath = path.join(this.tempDir, hqName, '.proletariat', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    if (!config.agents.includes(agentName)) {
      config.agents.push(agentName);
    }
    
    if (repoName) {
      if (!config.agentAccess[agentName]) {
        config.agentAccess[agentName] = [];
      }
      if (!config.agentAccess[agentName].includes(repoName)) {
        config.agentAccess[agentName].push(repoName);
      }
    }
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Create a test ticket
   */
  createTicket(hqName: string, ticket: any): void {
    const ticketsPath = path.join(this.tempDir, hqName, 'pmo', 'tickets.json');
    let tickets = [];
    
    if (fs.existsSync(ticketsPath)) {
      tickets = JSON.parse(fs.readFileSync(ticketsPath, 'utf-8'));
    }
    
    tickets.push({
      id: ticket.id || `TKT-${String(tickets.length + 1).padStart(3, '0')}`,
      title: ticket.title || 'Test ticket',
      description: ticket.description || 'Test description',
      queue: ticket.queue || 'build',
      priority: ticket.priority || 'medium',
      status: ticket.status || 'todo',
      assignee: ticket.assignee || undefined,
      created: ticket.created || new Date().toISOString(),
      updated: ticket.updated || new Date().toISOString()
    });
    
    fs.writeFileSync(ticketsPath, JSON.stringify(tickets, null, 2));
  }
}