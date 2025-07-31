import { Theme, ThemeCollection } from '../../types/index.js';

const THEMES: ThemeCollection = {
  billionaires: {
    name: 'billionaires',
    displayName: 'Billionaire Staff',
    description: '⚒️ Making billionaires work as your git worktrees!',
    emoji: '💰',
    directory: 'staff',
    agents: ['bezos', 'musk', 'gates', 'buffett', 'zuckerberg', 'cook', 'ellison', 'page'],
    commands: {
      create: 'hire',
      remove: 'fire', 
      list: 'staff',
      session: 'work',
      proxy: 'serve'
    },
    messages: {
      create: 'Hiring billionaire workers',
      remove: 'Firing lazy billionaires',
      list: 'Current billionaire staff',
      slogan: 'Workers of the codebase, unite! ✊'
    }
  },
  cars: {
    name: 'cars',
    displayName: 'Car Garage',
    description: '🚗 Your development garage with classic rides!',
    emoji: '🚗',
    directory: 'garage',
    agents: ['tesla', 'prius', 'mustang', 'camry', 'accord', 'civic', 'hdj81', 'landcruiser'],
    commands: {
      create: 'drive',
      remove: 'park',
      list: 'garage',
      session: 'ride',
      proxy: 'cruise'
    },
    messages: {
      create: 'Taking cars for a drive',
      remove: 'Parking cars in the garage',
      list: 'Cars in your garage',
      slogan: 'Start your engines! 🏁'
    }
  },
  companies: {
    name: 'companies',
    displayName: 'Company Portfolio',
    description: '🏢 Building your corporate empire, one acquisition at a time!',
    emoji: '🏢',
    directory: 'portfolio',
    agents: ['apple', 'microsoft', 'google', 'amazon', 'meta', 'tesla', 'nvidia', 'oracle'],
    commands: {
      create: 'buy',
      remove: 'sell',
      list: 'portfolio',
      session: 'manage',
      proxy: 'host'
    },
    messages: {
      create: 'Acquiring companies',
      remove: 'Selling off companies',
      list: 'Your company portfolio',
      slogan: 'Time to make some acquisitions! 💼'
    }
  }
};

export function getTheme(themeName: string): Theme {
  return THEMES[themeName] || THEMES.billionaires;
}

export function getAllThemes(): ThemeCollection {
  return THEMES;
}

export function getThemeNames(): string[] {
  return Object.keys(THEMES);
}

export function isValidTheme(themeName: string): boolean {
  return themeName in THEMES;
}

export { THEMES };