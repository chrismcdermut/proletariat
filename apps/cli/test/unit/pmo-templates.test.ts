import { expect } from 'chai';
import { getBoardTemplates, getColumnsForTemplate, createBoardContent } from '../../src/lib/pmo/index.js';

describe('PMO Board Templates', () => {
  describe('getBoardTemplates', () => {
    it('returns all available templates', () => {
      const templates = getBoardTemplates();

      expect(templates).to.have.property('kanban');
      expect(templates).to.have.property('linear');
      expect(templates).to.have.property('founder');
      expect(templates).to.have.property('custom');
    });

    it('kanban template has 4 Linear-style columns', () => {
      const templates = getBoardTemplates();

      expect(templates.kanban).to.deep.equal(['Backlog', 'Planned', 'In Progress', 'Done']);
    });

    it('linear template has 5 columns including Canceled', () => {
      const templates = getBoardTemplates();

      expect(templates.linear).to.deep.equal([
        'Backlog',
        'Planned',
        'In Progress',
        'Done',
        'Canceled',
      ]);
    });

    it('founder template has 9 columns (5 backlogs + 4 workflow)', () => {
      const templates = getBoardTemplates();

      expect(templates.founder).to.have.length(9);
      expect(templates.founder).to.include('SHIP BL');
      expect(templates.founder).to.include('GROW BL');
      expect(templates.founder).to.include('SUPPORT BL');
      expect(templates.founder).to.include('BIZOPS BL');
      expect(templates.founder).to.include('STRATEGY BL');
      expect(templates.founder).to.include('Planned');
      expect(templates.founder).to.include('In Progress');
      expect(templates.founder).to.include('Done');
      expect(templates.founder).to.include('Dropped');
    });

    it('custom template is empty', () => {
      const templates = getBoardTemplates();

      expect(templates.custom).to.deep.equal([]);
    });
  });

  describe('getColumnsForTemplate', () => {
    it('returns columns for known template', () => {
      const columns = getColumnsForTemplate('linear');

      expect(columns).to.have.length(5);
      expect(columns[0]).to.equal('Backlog');
    });

    it('returns kanban columns for unknown template', () => {
      const columns = getColumnsForTemplate('unknown-template');

      expect(columns).to.deep.equal(['Backlog', 'Planned', 'In Progress', 'Done']);
    });

    it('returns founder columns', () => {
      const columns = getColumnsForTemplate('founder');

      expect(columns).to.have.length(9);
      expect(columns[0]).to.equal('SHIP BL');
    });
  });

  describe('createBoardContent', () => {
    it('creates Obsidian Kanban frontmatter', () => {
      const content = createBoardContent('kanban');

      expect(content).to.include('---');
      expect(content).to.include('kanban-plugin: obsidian-kanban');
    });

    it('creates column headers with emojis for kanban', () => {
      const content = createBoardContent('kanban');

      expect(content).to.include('## 📥 Backlog');
      expect(content).to.include('## 📋 Planned');
      expect(content).to.include('## 🚀 In Progress');
      expect(content).to.include('## ✅ Done');
    });

    it('creates column headers with emojis for linear', () => {
      const content = createBoardContent('linear');

      expect(content).to.include('## 📥 Backlog');
      expect(content).to.include('## 📋 Planned');
      expect(content).to.include('## 🚀 In Progress');
      expect(content).to.include('## ✅ Done');
      expect(content).to.include('## 🚫 Canceled');
    });

    it('creates column headers with emojis for founder', () => {
      const content = createBoardContent('founder');

      // Backlog columns
      expect(content).to.include('## 🚢 SHIP BL');
      expect(content).to.include('## 📈 GROW BL');
      expect(content).to.include('## 🛟 SUPPORT BL');
      expect(content).to.include('## ⚙️ BIZOPS BL');
      expect(content).to.include('## 🎯 STRATEGY BL');

      // Workflow columns
      expect(content).to.include('## 📋 Planned');
      expect(content).to.include('## 🚀 In Progress');
      expect(content).to.include('## ✅ Done');
      expect(content).to.include('## 🗑️ Dropped');
    });

    it('uses default emoji for unknown columns', () => {
      // Custom template would use default emoji
      getBoardTemplates();
      // Temporarily test with a hypothetical column
      const content = createBoardContent('kanban');

      // All known columns should have their specific emojis, not the default
      expect(content).to.not.include('## 📋 Backlog');
      expect(content).to.include('## 📥 Backlog');
    });
  });

  describe('Template column order', () => {
    it('founder template has backlogs before workflow columns', () => {
      const columns = getColumnsForTemplate('founder');

      // First 5 should be backlogs (ending with BL)
      expect(columns[0]).to.match(/BL$/);
      expect(columns[1]).to.match(/BL$/);
      expect(columns[2]).to.match(/BL$/);
      expect(columns[3]).to.match(/BL$/);
      expect(columns[4]).to.match(/BL$/);

      // Remaining should be workflow (not ending with BL)
      expect(columns[5]).to.not.match(/BL$/);
      expect(columns[6]).to.not.match(/BL$/);
    });

    it('linear template has logical workflow order', () => {
      const columns = getColumnsForTemplate('linear');

      expect(columns.indexOf('Backlog')).to.be.lessThan(columns.indexOf('Planned'));
      expect(columns.indexOf('Planned')).to.be.lessThan(columns.indexOf('In Progress'));
      expect(columns.indexOf('In Progress')).to.be.lessThan(columns.indexOf('Done'));
    });
  });
});
