import { Args, Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';

export default class ProjectSpec extends Command {
  static description = 'Manage specs associated with a project (many-to-many)';

  static examples = [
    '<%= config.bin %> <%= command.id %> my-project',
    '<%= config.bin %> <%= command.id %> my-project --add SPEC-001',
    '<%= config.bin %> <%= command.id %> my-project --remove SPEC-001',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    projectId: Args.string({
      description: 'Project ID',
      required: false,
    }),
  };

  static flags = {
    add: Flags.string({
      char: 'a',
      description: 'Add a spec to this project',
    }),
    remove: Flags.string({
      char: 'r',
      description: 'Remove a spec from this project',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ProjectSpec);

    const { storage } = await getPMOContext(
      undefined,
      (msg) => this.log(styles.muted(msg)),
      true
    );

    try {
      // Get all projects
      const projects = await storage.listProjects();
      if (projects.length === 0) {
        this.log(styles.muted('\nNo projects found. Create one with: prlt project create'));
        await storage.close();
        return;
      }

      let projectId = args.projectId;

      // If no project ID provided, prompt for selection
      if (!projectId) {
        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select project:',
          choices: projects.map(p => ({
            name: `${p.id} - ${p.name} (${p.status})`,
            value: p.id,
          })),
        }]);
        projectId = selected;
      }

      // Validate project exists
      const project = projects.find(p => p.id === projectId);
      if (!project) {
        await storage.close();
        this.error(`Project not found: ${projectId}`);
      }

      // Get specs currently associated with this project
      const projectSpecs = await storage.getSpecsForProject(projectId!);
      const projectSpecIds = new Set(projectSpecs.map(s => s.id));

      // Handle add flag
      if (flags.add) {
        const spec = await storage.getSpec(flags.add);
        if (!spec) {
          await storage.close();
          this.error(`Spec not found: ${flags.add}`);
        }

        if (projectSpecIds.has(flags.add)) {
          this.log(styles.muted(`\nSpec "${flags.add}" is already associated with project "${projectId}".`));
        } else {
          await storage.linkProjectToSpec(projectId!, flags.add);
          this.log(styles.success(`\n✅ Added spec ${styles.emphasis(flags.add)} to project ${styles.emphasis(projectId!)}`));
          this.log(styles.muted(`   Spec: ${spec.title}`));
        }
        await storage.close();
        return;
      }

      // Handle remove flag
      if (flags.remove) {
        if (!projectSpecIds.has(flags.remove)) {
          this.log(styles.muted(`\nSpec "${flags.remove}" is not associated with project "${projectId}".`));
        } else {
          await storage.unlinkProjectFromSpec(projectId!, flags.remove);
          this.log(styles.success(`\n✅ Removed spec ${styles.emphasis(flags.remove)} from project ${styles.emphasis(projectId!)}`));
        }
        await storage.close();
        return;
      }

      // Interactive mode: show menu
      let continueLoop = true;
      while (continueLoop) {
        // Refresh project specs each iteration
        const currentSpecs = await storage.getSpecsForProject(projectId!);
        const currentSpecIds = new Set(currentSpecs.map(s => s.id));

        this.log(styles.title(`\n📚 Specs for project "${project.name}" (${projectId})`));
        if (currentSpecs.length === 0) {
          this.log(styles.muted('  No specs associated with this project.'));
        } else {
          for (const spec of currentSpecs) {
            this.log(`  ${styles.code(spec.id)} - ${spec.title} (${spec.status})`);
          }
        }

        const { action } = await inquirer.prompt([{
          type: 'list',
          name: 'action',
          message: `Manage specs for ${projectId}:`,
          choices: [
            { name: 'Add spec to project', value: 'add' },
            { name: 'Remove spec from project', value: 'remove' },
            new inquirer.Separator(),
            { name: 'Done', value: 'done' },
          ],
        }]);

        if (action === 'done') {
          continueLoop = false;
          continue;
        }

        if (action === 'add') {
          // Get all specs not already associated
          const allSpecs = await storage.listSpecs();
          const availableSpecs = allSpecs.filter(s => !currentSpecIds.has(s.id));

          if (availableSpecs.length === 0) {
            this.log(styles.muted('\n  All specs are already associated with this project.'));
            continue;
          }

          const { selected } = await inquirer.prompt([{
            type: 'checkbox',
            name: 'selected',
            message: 'Select specs to add:',
            choices: availableSpecs.map(s => ({
              name: `${s.id} - ${s.title} (${s.status})`,
              value: s.id,
            })),
          }]);

          if (selected.length === 0) {
            this.log(styles.muted('  No specs selected.'));
            continue;
          }

          for (const specId of selected) {
            await storage.linkProjectToSpec(projectId!, specId);
            this.log(styles.success(`  Added ${specId}`));
          }
          continue;
        }

        if (action === 'remove') {
          if (currentSpecs.length === 0) {
            this.log(styles.muted('\n  No specs to remove.'));
            continue;
          }

          const { selected } = await inquirer.prompt([{
            type: 'checkbox',
            name: 'selected',
            message: 'Select specs to remove:',
            choices: currentSpecs.map(s => ({
              name: `${s.id} - ${s.title} (${s.status})`,
              value: s.id,
            })),
          }]);

          if (selected.length === 0) {
            this.log(styles.muted('  No specs selected.'));
            continue;
          }

          for (const specId of selected) {
            await storage.unlinkProjectFromSpec(projectId!, specId);
            this.log(styles.success(`  Removed ${specId}`));
          }
          continue;
        }
      }

      await storage.close();
      this.log(styles.muted(`\nView project: prlt project view ${projectId}`));

    } catch (error) {
      await storage.close();
      throw error;
    }
  }
}
