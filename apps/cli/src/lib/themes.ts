export interface Theme {
  name: string;
  displayName: string;
  description: string;
  emoji: string;
  workspaceDir: string;
  agents: string[];
  commands: {
    add: string;
    remove: string;
    list: string;
  };
}

export const THEMES: Record<string, Theme> = {
  billionaires: {
    name: 'billionaires',
    displayName: 'Billionaires & Tech Elite',
    description: 'The ultra-wealthy work for you',
    emoji: '💰',
    workspaceDir: 'staff',
    agents: ['altman', 'damodei', 'andreesen', 'bezos', 'branson', 'brin', 'buffett', 
             'cook', 'dorsey', 'ellison', 'gates', 'huang', 'jobs', 'kalanick', 
             'karpathy', 'lecun', 'ma', 'musk', 'nadella', 'page', 'sandberg', 
             'sutskever', 'swift', 'wojcicki', 'zuck'],
    commands: {
      add: 'hire',
      remove: 'fire',
      list: 'staff'
    }
  },
  toyotas: {
    name: 'toyotas',
    displayName: 'Toyota Garage',
    description: 'Reliable workhorses for your project',
    emoji: '🚗',
    workspaceDir: 'garage',
    agents: ['camry', 'corolla', 'tacoma', 'tundra', 'highlander', 'rav4', 'prius',
             'fj40', 'fj60', 'fj80', 'landcruiser', '4runner', 'hilux', 'sienna'],
    commands: {
      add: 'drive',
      remove: 'park',
      list: 'garage'
    }
  },
  companies: {
    name: 'companies',
    displayName: 'Company Portfolio',
    description: 'Your corporate portfolio',
    emoji: '🏢',
    workspaceDir: 'portfolio',
    agents: ['apple', 'google', 'meta', 'microsoft', 'amazon', 'netflix', 'nvidia',
             'tesla', 'oracle', 'salesforce', 'adobe', 'shopify', 'atlassian',
             'stripe', 'uber', 'airbnb', 'spotify', 'zoom'],
    commands: {
      add: 'buy',
      remove: 'sell',
      list: 'portfolio'
    }
  }
};