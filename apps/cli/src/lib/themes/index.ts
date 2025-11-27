import inquirer from 'inquirer';
import { THEMES } from '../themes.js';

/**
 * Prompt user for theme selection
 */
export async function promptForTheme(): Promise<string> {
  const { theme } = await inquirer.prompt([{
    type: 'list',
    name: 'theme',
    message: 'Choose agent naming theme:',
    choices: Object.entries(THEMES).map(([key, theme]) => ({
      name: `${theme.emoji} ${theme.displayName} - ${theme.description}`,
      value: key,
    })),
  }]);

  return theme;
}

/**
 * Get theme configuration by name
 */
export function getTheme(themeName: string) {
  return THEMES[themeName];
}

/**
 * Get all available themes
 */
export function getAllThemes() {
  return THEMES;
}

/**
 * Get theme names
 */
export function getThemeNames(): string[] {
  return Object.keys(THEMES);
}

/**
 * Validate theme name
 */
export function isValidTheme(themeName: string): boolean {
  return themeName in THEMES;
}