import { expect } from 'chai';
import {
  CLICommandBuilder,
  formatCLICommand,
  formatCLICommandInline,
} from '../../src/lib/cli-command-builder.js';

describe('cli-command-builder', () => {
  describe('CLICommandBuilder', () => {
    describe('constructor', () => {
      it('creates builder with base command', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        expect(builder.toString()).to.equal('prlt work spawn');
      });
    });

    describe('addArg', () => {
      it('adds a positional argument', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addArg('TKT-001');
        expect(builder.toString()).to.equal('prlt work spawn TKT-001');
      });

      it('returns this for chaining', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        const result = builder.addArg('TKT-001');
        expect(result).to.equal(builder);
      });

      it('quotes arguments with spaces', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addArg('some value with spaces');
        expect(builder.toString()).to.equal('prlt work spawn "some value with spaces"');
      });
    });

    describe('addArgs', () => {
      it('adds multiple positional arguments', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addArgs(['TKT-001', 'TKT-002', 'TKT-003']);
        expect(builder.toString()).to.equal('prlt work spawn TKT-001 TKT-002 TKT-003');
      });

      it('returns this for chaining', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        const result = builder.addArgs(['TKT-001']);
        expect(result).to.equal(builder);
      });
    });

    describe('addFlag', () => {
      it('adds a flag with string value', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addFlag('mode', 'devcontainer');
        expect(builder.toString()).to.equal('prlt work spawn --mode devcontainer');
      });

      it('adds a flag with numeric value', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addFlag('limit', 10);
        expect(builder.toString()).to.equal('prlt work spawn --limit 10');
      });

      it('quotes values with spaces', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addFlag('column', 'In Progress');
        expect(builder.toString()).to.equal('prlt work spawn --column "In Progress"');
      });

      it('returns this for chaining', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        const result = builder.addFlag('mode', 'terminal');
        expect(result).to.equal(builder);
      });
    });

    describe('addBooleanFlag', () => {
      it('adds a boolean flag without value', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addBooleanFlag('create-pr');
        expect(builder.toString()).to.equal('prlt work spawn --create-pr');
      });

      it('returns this for chaining', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        const result = builder.addBooleanFlag('yes');
        expect(result).to.equal(builder);
      });
    });

    describe('addFlagIf', () => {
      it('adds flag when value is truthy string', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addFlagIf('mode', 'terminal');
        expect(builder.toString()).to.equal('prlt work spawn --mode terminal');
      });

      it('adds flag when value is truthy number', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addFlagIf('limit', 5);
        expect(builder.toString()).to.equal('prlt work spawn --limit 5');
      });

      it('does not add flag when value is undefined', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addFlagIf('mode', undefined);
        expect(builder.toString()).to.equal('prlt work spawn');
      });

      it('does not add flag when value is null', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addFlagIf('mode', null);
        expect(builder.toString()).to.equal('prlt work spawn');
      });

      it('does not add flag when value is empty string', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addFlagIf('mode', '');
        expect(builder.toString()).to.equal('prlt work spawn');
      });

      it('returns this for chaining', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        const result = builder.addFlagIf('mode', undefined);
        expect(result).to.equal(builder);
      });
    });

    describe('addBooleanFlagIf', () => {
      it('adds flag when condition is true', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addBooleanFlagIf('yes', true);
        expect(builder.toString()).to.equal('prlt work spawn --yes');
      });

      it('does not add flag when condition is false', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addBooleanFlagIf('yes', false);
        expect(builder.toString()).to.equal('prlt work spawn');
      });

      it('does not add flag when condition is undefined', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addBooleanFlagIf('yes', undefined);
        expect(builder.toString()).to.equal('prlt work spawn');
      });

      it('returns this for chaining', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        const result = builder.addBooleanFlagIf('yes', true);
        expect(result).to.equal(builder);
      });
    });

    describe('hasFlag', () => {
      it('returns true if flag exists', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addFlag('mode', 'terminal');
        expect(builder.hasFlag('mode')).to.be.true;
      });

      it('returns true if boolean flag exists', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addBooleanFlag('yes');
        expect(builder.hasFlag('yes')).to.be.true;
      });

      it('returns false if flag does not exist', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        expect(builder.hasFlag('mode')).to.be.false;
      });
    });

    describe('count', () => {
      it('returns 0 for no parts', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        expect(builder.count).to.equal(0);
      });

      it('counts args and flags', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addArg('TKT-001');
        builder.addFlag('mode', 'terminal');
        builder.addBooleanFlag('yes');
        expect(builder.count).to.equal(3);
      });
    });

    describe('toString', () => {
      it('builds complete command with args and flags', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addArg('TKT-001');
        builder.addFlag('action', 'implement');
        builder.addFlag('mode', 'devcontainer');
        builder.addBooleanFlag('create-pr');
        builder.addBooleanFlag('yes');

        expect(builder.toString()).to.equal(
          'prlt work spawn TKT-001 --action implement --mode devcontainer --create-pr --yes'
        );
      });

      it('places positional arguments before flags', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addFlag('mode', 'terminal');
        builder.addArg('TKT-001');
        builder.addBooleanFlag('yes');
        builder.addArg('TKT-002');

        // Args should come before flags regardless of order added
        expect(builder.toString()).to.equal(
          'prlt work spawn TKT-001 TKT-002 --mode terminal --yes'
        );
      });

      it('matches ticket example command format', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addArg('TKT-419');
        builder.addFlag('action', 'implement');
        builder.addFlag('mode', 'devcontainer');
        builder.addBooleanFlag('skip-permissions');
        builder.addBooleanFlag('create-pr');

        expect(builder.toString()).to.equal(
          'prlt work spawn TKT-419 --action implement --mode devcontainer --skip-permissions --create-pr'
        );
      });
    });

    describe('clone', () => {
      it('creates a copy of the builder', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addArg('TKT-001');
        builder.addFlag('mode', 'terminal');

        const cloned = builder.clone();
        expect(cloned.toString()).to.equal(builder.toString());
      });

      it('changes to clone do not affect original', () => {
        const builder = new CLICommandBuilder('prlt work spawn');
        builder.addArg('TKT-001');

        const cloned = builder.clone();
        cloned.addBooleanFlag('yes');

        expect(builder.toString()).to.equal('prlt work spawn TKT-001');
        expect(cloned.toString()).to.equal('prlt work spawn TKT-001 --yes');
      });
    });
  });

  describe('formatCLICommand', () => {
    it('formats command with box drawing', () => {
      const result = formatCLICommand('prlt work spawn TKT-001');
      expect(result).to.include('prlt work spawn TKT-001');
      expect(result).to.include('Equivalent CLI command:');
      expect(result).to.include('┌');
      expect(result).to.include('└');
    });
  });

  describe('formatCLICommandInline', () => {
    it('formats command inline', () => {
      const result = formatCLICommandInline('prlt work spawn TKT-001');
      expect(result).to.equal('Equivalent command: prlt work spawn TKT-001');
    });
  });
});
