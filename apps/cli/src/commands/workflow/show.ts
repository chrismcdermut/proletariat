import { Args } from '@oclif/core';
import { pmoBaseFlags } from '../../lib/pmo/index.js';
import WorkflowView from './view.js';

export default class WorkflowShow extends WorkflowView {
  static description = 'View details of a workflow (alias for workflow view)';
  static hidden = true;

  static args = {
    id: Args.string({
      description: 'Workflow ID - prompts with dropdown if not provided',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };
}
