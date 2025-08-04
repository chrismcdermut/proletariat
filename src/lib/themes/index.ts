import { Theme, ThemeCollection } from '../../types/index.js';

const THEMES: ThemeCollection = {
  billionaires: {
    name: 'billionaires',
    displayName: 'Billionaire Staff',
    description: '⚒️ Making billionaires work a part of your staff.',
    emoji: '💰',
    directory: 'staff',
    agents: ['ballmer', 'beni', 'bezos', 'brin', 'buff', 'dell', 'elli', 'gates', 'huang', 'jobs', 'musk', 'page', 'thiel', 'zuck'],
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
  toyotas: {
    name: 'toyotas',
    displayName: 'Toyota Garage',
    description: '🚗 Your development garage with classic Toyotas!',
    emoji: '🚗',
    directory: 'garage',
    agents: ['4runner', 'camry', 'fj40', 'fj60', 'fj80', 'hdj81', 'hilux', 'pig', 'prius', 'taco', 'tercel', 'troopy'],
    commands: {
      create: 'drive',
      remove: 'park',
      list: 'garage',
      session: 'ride',
      proxy: 'cruise'
    },
    messages: {
      create: 'Taking Toyotas for a drive',
      remove: 'Parking Toyotas in the garage',
      list: 'Toyotas in your garage',
      slogan: 'Start your engines! 🏁'
    }
  },
  companies: {
    name: 'companies',
    displayName: 'Company Portfolio',
    description: '🏢 Now companies work for you.',
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