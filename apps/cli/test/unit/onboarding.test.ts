import { expect } from 'chai';

describe('onboarding', () => {
  describe('isFirstTimeUser', () => {
    let isFirstTimeUser: typeof import('../../src/lib/onboarding/wizard.js').isFirstTimeUser;

    before(async () => {
      const mod = await import('../../src/lib/onboarding/wizard.js');
      isFirstTimeUser = mod.isFirstTimeUser;
    });

    it('returns true when no HQs and no active HQ', () => {
      expect(isFirstTimeUser(0, null)).to.be.true;
    });

    it('returns false when HQs exist', () => {
      expect(isFirstTimeUser(1, null)).to.be.false;
    });

    it('returns false when active HQ is set', () => {
      expect(isFirstTimeUser(0, '/some/path')).to.be.false;
    });

    it('returns false when both HQs and active HQ exist', () => {
      expect(isFirstTimeUser(2, '/some/path')).to.be.false;
    });
  });

  describe('detectAITools', () => {
    let detectAITools: typeof import('../../src/lib/onboarding/detect-tools.js').detectAITools;

    before(async () => {
      const mod = await import('../../src/lib/onboarding/detect-tools.js');
      detectAITools = mod.detectAITools;
    });

    it('returns a ToolDetectionResult with tools array', () => {
      const result = detectAITools();
      expect(result).to.have.property('tools').that.is.an('array');
      expect(result).to.have.property('hasClaudeCode').that.is.a('boolean');
      expect(result).to.have.property('hasCodex').that.is.a('boolean');
    });

    it('detected tools have required properties', () => {
      const result = detectAITools();
      for (const tool of result.tools) {
        expect(tool).to.have.property('name').that.is.a('string');
        expect(tool).to.have.property('command').that.is.a('string');
        expect(tool).to.have.property('path').that.is.a('string');
        expect(tool).to.have.property('displayName').that.is.a('string');
      }
    });

    it('hasClaudeCode matches tools array', () => {
      const result = detectAITools();
      const hasClaude = result.tools.some(t => t.name === 'claude-code');
      expect(result.hasClaudeCode).to.equal(hasClaude);
    });

    it('hasCodex matches tools array', () => {
      const result = detectAITools();
      const hasCodex = result.tools.some(t => t.name === 'codex');
      expect(result.hasCodex).to.equal(hasCodex);
    });
  });

  describe('PMO_PROVIDERS', () => {
    let PMO_PROVIDERS: typeof import('../../src/lib/onboarding/wizard.js').PMO_PROVIDERS;

    before(async () => {
      const mod = await import('../../src/lib/onboarding/wizard.js');
      PMO_PROVIDERS = mod.PMO_PROVIDERS;
    });

    it('has all five supported providers', () => {
      expect(PMO_PROVIDERS).to.have.length(5);
      const values = PMO_PROVIDERS.map(p => p.value);
      expect(values).to.include('linear');
      expect(values).to.include('jira');
      expect(values).to.include('trello');
      expect(values).to.include('monday');
      expect(values).to.include('asana');
    });

    it('each provider has required fields', () => {
      for (const provider of PMO_PROVIDERS) {
        expect(provider).to.have.property('name').that.is.a('string');
        expect(provider).to.have.property('value').that.is.a('string');
        expect(provider).to.have.property('connectCommand').that.is.a('string');
        expect(provider).to.have.property('apiKeyEnvVar').that.is.a('string');
        expect(provider).to.have.property('apiKeyUrl').that.is.a('string');
        expect(provider).to.have.property('apiKeyInstructions').that.is.a('string');
      }
    });

    it('each provider connectCommand starts with prlt', () => {
      for (const provider of PMO_PROVIDERS) {
        expect(provider.connectCommand).to.match(/^prlt /);
      }
    });
  });
});
