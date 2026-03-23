import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js';

describe('Roadmap Storage', () => {
  let testDir: string;
  let storage: SQLiteStorage;
  const projectId = 'default';

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-test-'));
    const dbPath = path.join(testDir, 'pmo.db');

    // Create empty database file first (SQLiteStorage now requires it to exist)
    const db = new Database(dbPath);
    db.close();

    storage = new SQLiteStorage(dbPath);

    // Create a project first (workflow is automatically assigned)
    await storage.createProject({
      id: projectId,
      name: 'Test Project',
      template: 'kanban',
    });
  });

  afterEach(async () => {
    await storage.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Roadmap CRUD Operations', () => {
    it('creates a roadmap', async () => {
      const roadmap = await storage.createRoadmap({
        id: 'public-roadmap',
        name: 'Public Roadmap',
        description: 'Our public roadmap',
        isDefault: false,
      });

      expect(roadmap.id).to.equal('public-roadmap');
      expect(roadmap.name).to.equal('Public Roadmap');
      expect(roadmap.description).to.equal('Our public roadmap');
      expect(roadmap.isDefault).to.be.false;
    });

    it('creates a roadmap with isDefault true', async () => {
      const roadmap = await storage.createRoadmap({
        id: 'default-roadmap',
        name: 'Default Roadmap',
        isDefault: true,
      });

      expect(roadmap.isDefault).to.be.true;
    });

    it('retrieves a roadmap by id', async () => {
      await storage.createRoadmap({
        id: 'my-roadmap',
        name: 'My Roadmap',
        description: 'Test description',
      });

      const roadmap = await storage.getRoadmap('my-roadmap');

      expect(roadmap).to.not.be.null;
      expect(roadmap!.name).to.equal('My Roadmap');
      expect(roadmap!.description).to.equal('Test description');
    });

    it('returns null for non-existent roadmap', async () => {
      const roadmap = await storage.getRoadmap('non-existent');
      expect(roadmap).to.be.null;
    });

    it('lists all roadmaps', async () => {
      await storage.createRoadmap({ id: 'roadmap-1', name: 'Roadmap 1' });
      await storage.createRoadmap({ id: 'roadmap-2', name: 'Roadmap 2' });
      await storage.createRoadmap({ id: 'roadmap-3', name: 'Roadmap 3' });

      const roadmaps = await storage.listRoadmaps();
      expect(roadmaps).to.have.length(3);
    });

    it('lists roadmaps filtered by isDefault', async () => {
      await storage.createRoadmap({ id: 'default', name: 'Default', isDefault: true });
      await storage.createRoadmap({ id: 'other', name: 'Other', isDefault: false });

      const defaultRoadmaps = await storage.listRoadmaps({ isDefault: true });
      expect(defaultRoadmaps).to.have.length(1);
      expect(defaultRoadmaps[0].name).to.equal('Default');
    });

    it('lists roadmaps filtered by search', async () => {
      await storage.createRoadmap({ id: 'public', name: 'Public Roadmap' });
      await storage.createRoadmap({ id: 'internal', name: 'Internal Roadmap' });

      const results = await storage.listRoadmaps({ search: 'public' });
      expect(results).to.have.length(1);
      expect(results[0].name).to.equal('Public Roadmap');
    });

    it('updates a roadmap', async () => {
      await storage.createRoadmap({
        id: 'test',
        name: 'Original Name',
        description: 'Original description',
      });

      const updated = await storage.updateRoadmap('test', {
        name: 'Updated Name',
        description: 'Updated description',
      });

      expect(updated.name).to.equal('Updated Name');
      expect(updated.description).to.equal('Updated description');
    });

    it('deletes a roadmap', async () => {
      await storage.createRoadmap({ id: 'to-delete', name: 'To Delete' });

      await storage.deleteRoadmap('to-delete');

      const roadmap = await storage.getRoadmap('to-delete');
      expect(roadmap).to.be.null;
    });
  });

  describe('Default Roadmap Operations', () => {
    it('gets the default roadmap', async () => {
      await storage.createRoadmap({ id: 'default', name: 'Default', isDefault: true });
      await storage.createRoadmap({ id: 'other', name: 'Other', isDefault: false });

      const defaultRoadmap = await storage.getDefaultRoadmap();

      expect(defaultRoadmap).to.not.be.null;
      expect(defaultRoadmap!.id).to.equal('default');
    });

    it('returns null when no default roadmap exists', async () => {
      await storage.createRoadmap({ id: 'r1', name: 'R1', isDefault: false });

      const defaultRoadmap = await storage.getDefaultRoadmap();
      expect(defaultRoadmap).to.be.null;
    });

    it('sets a roadmap as default', async () => {
      await storage.createRoadmap({ id: 'r1', name: 'R1', isDefault: true });
      await storage.createRoadmap({ id: 'r2', name: 'R2', isDefault: false });

      await storage.setDefaultRoadmap('r2');

      const r1 = await storage.getRoadmap('r1');
      const r2 = await storage.getRoadmap('r2');

      expect(r1!.isDefault).to.be.false;
      expect(r2!.isDefault).to.be.true;
    });

    it('clears previous default when setting new default', async () => {
      await storage.createRoadmap({ id: 'old-default', name: 'Old Default', isDefault: true });
      await storage.createRoadmap({ id: 'new-default', name: 'New Default', isDefault: false });

      await storage.setDefaultRoadmap('new-default');

      const oldDefault = await storage.getRoadmap('old-default');
      expect(oldDefault!.isDefault).to.be.false;
    });
  });

  describe('Roadmap Project Operations', () => {
    let project2Id: string;

    beforeEach(async () => {
      project2Id = 'project-2';
      await storage.createProject({
        id: project2Id,
        name: 'Project 2',
        template: 'kanban',
      });
    });

    it('adds a project to a roadmap', async () => {
      await storage.createRoadmap({ id: 'roadmap', name: 'Roadmap' });

      await storage.addProjectToRoadmap('roadmap', projectId);

      const projects = await storage.listRoadmapProjects('roadmap');
      expect(projects).to.have.length(1);
      expect(projects[0].id).to.equal(projectId);
    });

    it('adds projects in order', async () => {
      await storage.createRoadmap({ id: 'roadmap', name: 'Roadmap' });

      await storage.addProjectToRoadmap('roadmap', projectId);
      await storage.addProjectToRoadmap('roadmap', project2Id);

      const projects = await storage.listRoadmapProjects('roadmap');
      expect(projects).to.have.length(2);
      expect(projects[0].id).to.equal(projectId);
      expect(projects[1].id).to.equal(project2Id);
    });

    it('adds project at specific position', async () => {
      await storage.createRoadmap({ id: 'roadmap', name: 'Roadmap' });
      await storage.addProjectToRoadmap('roadmap', projectId);
      await storage.addProjectToRoadmap('roadmap', project2Id);

      const project3Id = 'project-3';
      await storage.createProject({ id: project3Id, name: 'Project 3', template: 'kanban' });
      await storage.addProjectToRoadmap('roadmap', project3Id, 0);

      const projects = await storage.listRoadmapProjects('roadmap');
      expect(projects[0].id).to.equal(project3Id);
    });

    it('removes a project from a roadmap', async () => {
      await storage.createRoadmap({ id: 'roadmap', name: 'Roadmap' });
      await storage.addProjectToRoadmap('roadmap', projectId);
      await storage.addProjectToRoadmap('roadmap', project2Id);

      await storage.removeProjectFromRoadmap('roadmap', projectId);

      const projects = await storage.listRoadmapProjects('roadmap');
      expect(projects).to.have.length(1);
      expect(projects[0].id).to.equal(project2Id);
    });

    it('reorders projects in a roadmap', async () => {
      await storage.createRoadmap({ id: 'roadmap', name: 'Roadmap' });
      await storage.addProjectToRoadmap('roadmap', projectId);
      await storage.addProjectToRoadmap('roadmap', project2Id);

      const project3Id = 'project-3';
      await storage.createProject({ id: project3Id, name: 'Project 3', template: 'kanban' });
      await storage.addProjectToRoadmap('roadmap', project3Id);

      // Move project 3 to position 0
      await storage.reorderRoadmapProject('roadmap', project3Id, 0);

      const projects = await storage.listRoadmapProjects('roadmap');
      expect(projects[0].id).to.equal(project3Id);
      expect(projects[1].id).to.equal(projectId);
      expect(projects[2].id).to.equal(project2Id);
    });

    it('gets roadmaps for a project', async () => {
      await storage.createRoadmap({ id: 'roadmap-1', name: 'Roadmap 1' });
      await storage.createRoadmap({ id: 'roadmap-2', name: 'Roadmap 2' });
      await storage.createRoadmap({ id: 'roadmap-3', name: 'Roadmap 3' });

      await storage.addProjectToRoadmap('roadmap-1', projectId);
      await storage.addProjectToRoadmap('roadmap-2', projectId);
      // Don't add to roadmap-3

      const roadmaps = await storage.getRoadmapsForProject(projectId);
      expect(roadmaps).to.have.length(2);
      const ids = roadmaps.map(r => r.id);
      expect(ids).to.include('roadmap-1');
      expect(ids).to.include('roadmap-2');
    });

    it('deletes project associations when roadmap is deleted', async () => {
      await storage.createRoadmap({ id: 'roadmap', name: 'Roadmap' });
      await storage.addProjectToRoadmap('roadmap', projectId);

      await storage.deleteRoadmap('roadmap');

      // Verify project still exists
      const project = await storage.getProject(projectId);
      expect(project).to.not.be.null;

      // Cannot list projects from deleted roadmap
      const roadmap = await storage.getRoadmap('roadmap');
      expect(roadmap).to.be.null;
    });
  });

  describe('Edge Cases', () => {
    it('handles creating roadmap with minimal data', async () => {
      const roadmap = await storage.createRoadmap({
        id: 'minimal',
        name: 'Minimal',
      });

      expect(roadmap.id).to.equal('minimal');
      expect(roadmap.description).to.be.undefined;
      expect(roadmap.isDefault).to.be.false;
    });

    it('handles empty roadmap (no projects)', async () => {
      await storage.createRoadmap({ id: 'empty', name: 'Empty' });

      const projects = await storage.listRoadmapProjects('empty');
      expect(projects).to.have.length(0);
    });

    it('handles project in multiple roadmaps', async () => {
      await storage.createRoadmap({ id: 'public', name: 'Public' });
      await storage.createRoadmap({ id: 'internal', name: 'Internal' });

      await storage.addProjectToRoadmap('public', projectId);
      await storage.addProjectToRoadmap('internal', projectId);

      const publicProjects = await storage.listRoadmapProjects('public');
      const internalProjects = await storage.listRoadmapProjects('internal');

      expect(publicProjects).to.have.length(1);
      expect(internalProjects).to.have.length(1);
    });

    it('updates roadmap with partial data', async () => {
      await storage.createRoadmap({
        id: 'test',
        name: 'Original',
        description: 'Original desc',
      });

      // Update only name
      const updated = await storage.updateRoadmap('test', {
        name: 'Updated',
      });

      expect(updated.name).to.equal('Updated');
      expect(updated.description).to.equal('Original desc');
    });
  });
});
