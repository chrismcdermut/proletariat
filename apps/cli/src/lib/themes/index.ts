import { Theme, ThemeCollection } from '../../types/index.js';

const THEMES: ThemeCollection = {
  billionaires: {
    name: 'billionaires',
    displayName: 'Billionaire Staff',
    description: '⚒️ Put billionaires on payroll duty for your project.',
    emoji: '💰',
    directory: 'staff',
    agents: ['altman', 'amodei', 'andreesen', 'arnault', 'benioff', 'bezos', 'blakely', 'bloomberg', 'branson', 'brin', 'buffett', 'cook', 'gates', 'horowitz', 'jobs', 'larry', 'ma', 'munger', 'musk', 'oprah', 'page', 'perkins', 'sandberg', 'satya', 'swift', 'whitney', 'wojcicki', 'zuck'],
    commands: {
      create: 'hire',
      remove: 'fire', 
      list: 'staff'
    },
    messages: {
      create: 'Putting billionaires on the payroll',
      remove: 'Firing billionaires who slack off',
      list: 'Current billionaire roll call',
      slogan: 'They finally work for us.'
    }
  },
  toyotas: {
    name: 'toyotas',
    displayName: 'Toyota Garage',
    description: '🚗 Manufacturing\'s finest wrenching for your project.',
    emoji: '🚗',
    directory: 'garage',
    agents: ['4runner', 'camry', 'fj40', 'highlander', 'hilux', 'ironpig', 'landcruiser', 'prius', 'sierra', 'tacoma', 'tercel', 'troopy', 'tundra'],
    commands: {
      create: 'drive',
      remove: 'park',
      list: 'garage'
    },
    messages: {
      create: 'Rolling the fleet onto the line',
      remove: 'Parking rigs back in the bay',
      list: 'Fleet inventory',
      slogan: 'The fleet that never breaks down.'
    }
  },
  companies: {
    name: 'companies',
    displayName: 'Company Portfolio',
    description: '🏢 Own the boardroom: your favorite companies now report to you.',
    emoji: '🏢',
    directory: 'portfolio',
    agents: ['adobe', 'amazon', 'apple', 'atlassian', 'cisco', 'google', 'ibm', 'meta', 'microsoft', 'netflix', 'nvidia', 'oracle', 'shopify', 'snowflake', 'tesla', 'zoom'],
    commands: {
      create: 'buy',
      remove: 'sell',
      list: 'portfolio'
    },
    messages: {
      create: 'Closing fresh acquisitions',
      remove: 'Cutting underperformers loose',
      list: 'Portfolio under management',
      slogan: 'Now they\re the consumer.'
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
