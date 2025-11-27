import * as fs from 'fs';
import * as path from 'path';

/**
 * Find PMO directory by searching:
 * 1. Current directory tree for .proletariat/config.json with pmoPath or type=hq
 * 2. Current directory tree for .pmo/ or pmo/ directories
 * 3. Global config (~/.proletariat/config.json) for defaultPMO
 */
export function findPMO(): string | null {
  let currentDir = process.cwd();

  while (currentDir !== '/') {
    const configPath = path.join(currentDir, '.proletariat', 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.type === 'hq') {
          const pmoPath = path.join(currentDir, 'pmo');
          if (fs.existsSync(path.join(pmoPath, 'config.json'))) {
            return pmoPath;
          }
        }
        if (config.pmoPath) {
          const absolutePath = path.isAbsolute(config.pmoPath)
            ? config.pmoPath
            : path.join(currentDir, config.pmoPath);
          if (fs.existsSync(path.join(absolutePath, 'config.json'))) {
            return absolutePath;
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    const dotPmoPath = path.join(currentDir, '.pmo');
    if (fs.existsSync(path.join(dotPmoPath, 'config.json'))) {
      return dotPmoPath;
    }

    const pmoPath = path.join(currentDir, 'pmo');
    if (fs.existsSync(path.join(pmoPath, 'config.json'))) {
      return pmoPath;
    }

    currentDir = path.dirname(currentDir);
  }

  const globalConfigPath = path.join(process.env.HOME || '', '.proletariat', 'config.json');
  if (fs.existsSync(globalConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
      if (config.defaultPMO && fs.existsSync(path.join(config.defaultPMO, 'config.json'))) {
        return config.defaultPMO;
      }
    } catch {
      // Ignore parse errors
    }
  }

  return null;
}
