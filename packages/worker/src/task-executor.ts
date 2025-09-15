import { execa } from 'execa';
import fs from 'fs/promises';
import path from 'path';
import { logger } from './utils/logger';

export class TaskExecutor {
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  async execute(task: any): Promise<any> {
    logger.info(`🔧 Executing task: ${task.title}`);
    
    const result = {
      success: false,
      output: '',
      files: [] as string[],
      errors: [] as string[]
    };

    try {
      // Parse task description to understand what needs to be done
      const actions = this.parseTaskDescription(task.description);
      
      for (const action of actions) {
        logger.info(`  → ${action.type}: ${action.description}`);
        
        switch (action.type) {
          case 'create_file':
            await this.createFile(action.path!, action.content!);
            result.files.push(action.path!);
            break;
            
          case 'modify_file':
            await this.modifyFile(action.path!, action.content!);
            result.files.push(action.path!);
            break;
            
          case 'run_command':
            const cmdResult = await this.runCommand(action.command!);
            result.output += cmdResult.stdout + '\n';
            break;
            
          case 'implement_feature':
            await this.implementFeature(action.feature!);
            break;
            
          default:
            logger.warn(`Unknown action type: ${action.type}`);
        }
      }
      
      result.success = true;
    } catch (error) {
      logger.error('Task execution failed:', error);
      result.errors.push(String(error));
    }
    
    return result;
  }

  private parseTaskDescription(description: string): any[] {
    const actions = [];
    
    // Simple keyword-based parsing
    const lines = description.split('\n');
    for (const line of lines) {
      const lower = line.toLowerCase();
      
      if (lower.includes('create') && lower.includes('file')) {
        actions.push({
          type: 'create_file',
          description: line,
          path: this.extractPath(line),
          content: '// TODO: Implement'
        });
      } else if (lower.includes('implement')) {
        actions.push({
          type: 'implement_feature',
          description: line,
          feature: line
        });
      } else if (lower.includes('run') || lower.includes('execute')) {
        actions.push({
          type: 'run_command',
          description: line,
          command: this.extractCommand(line)
        });
      } else if (lower.includes('modify') || lower.includes('update')) {
        actions.push({
          type: 'modify_file',
          description: line,
          path: this.extractPath(line),
          content: '// Modified content'
        });
      }
    }
    
    // Default action if no specific actions found
    if (actions.length === 0) {
      actions.push({
        type: 'implement_feature',
        description: description,
        feature: description
      });
    }
    
    return actions;
  }

  private extractPath(text: string): string {
    // Extract file path from text
    const match = text.match(/['"](.*?)['"]/);
    if (match) return match[1];
    
    // Look for common file patterns
    const fileMatch = text.match(/\b(\w+\.\w+)\b/);
    if (fileMatch) return fileMatch[1];
    
    return 'file.ts';
  }

  private extractCommand(text: string): string {
    // Extract command from text
    const match = text.match(/['"](.*?)['"]/);
    if (match) return match[1];
    
    // Look for npm commands
    if (text.includes('npm')) {
      return text.substring(text.indexOf('npm'));
    }
    
    return 'echo "Command executed"';
  }

  async createFile(filePath: string, content: string) {
    const fullPath = path.join(this.workDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    logger.info(`  ✅ Created file: ${filePath}`);
  }

  async modifyFile(filePath: string, content: string) {
    const fullPath = path.join(this.workDir, filePath);
    
    // Read existing content
    let existingContent = '';
    try {
      existingContent = await fs.readFile(fullPath, 'utf-8');
    } catch {
      // File doesn't exist, create it
      return this.createFile(filePath, content);
    }
    
    // Append or modify content
    const newContent = existingContent + '\n' + content;
    await fs.writeFile(fullPath, newContent, 'utf-8');
    logger.info(`  ✅ Modified file: ${filePath}`);
  }

  async runCommand(command: string): Promise<any> {
    try {
      const result = await execa(command, {
        cwd: this.workDir,
        shell: true
      });
      logger.info(`  ✅ Command executed: ${command}`);
      return result;
    } catch (error) {
      logger.error(`  ❌ Command failed: ${command}`, error);
      throw error;
    }
  }

  async implementFeature(feature: string): Promise<void> {
    // Simplified feature implementation
    // In a real system, this would use AI or more sophisticated code generation
    
    logger.info(`  🚧 Implementing feature: ${feature}`);
    
    // Create a basic implementation file
    const fileName = feature.toLowerCase().replace(/\s+/g, '-') + '.ts';
    const content = `/**
 * Implementation for: ${feature}
 * Generated by Worker: ${process.env.WORKER_NAME || 'unknown'}
 * Date: ${new Date().toISOString()}
 */

export class ${this.toPascalCase(feature)} {
  constructor() {
    // TODO: Initialize
  }

  execute(): void {
    console.log('Executing: ${feature}');
    // TODO: Implement feature logic
  }
}

// Export for use
export default new ${this.toPascalCase(feature)}();
`;
    
    await this.createFile(`src/${fileName}`, content);
    
    // Create a test file
    const testContent = `import { ${this.toPascalCase(feature)} } from './${fileName}';

describe('${feature}', () => {
  it('should execute successfully', () => {
    const instance = new ${this.toPascalCase(feature)}();
    expect(instance).toBeDefined();
    // TODO: Add more tests
  });
});
`;
    
    await this.createFile(`tests/${fileName}.test.ts`, testContent);
    
    logger.info(`  ✅ Feature implementation created`);
  }

  private toPascalCase(text: string): string {
    return text
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  async runTests(): Promise<{ success: boolean; output: string }> {
    try {
      // Try different test commands
      const testCommands = [
        'npm test',
        'npm run test',
        'yarn test',
        'pnpm test',
        'jest',
        'mocha'
      ];
      
      for (const cmd of testCommands) {
        try {
          const result = await execa(cmd, {
            cwd: this.workDir,
            shell: true
          });
          return { success: true, output: result.stdout };
        } catch {
          // Try next command
        }
      }
      
      logger.warn('No test command found');
      return { success: true, output: 'No tests configured' };
    } catch (error) {
      logger.error('Tests failed:', error);
      return { success: false, output: String(error) };
    }
  }
}