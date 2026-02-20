import { Args } from '@oclif/core';
import { pmoBaseFlags } from '../../lib/pmo/index.js';
import EpicView from './view.js';

export default class EpicShow extends EpicView {
  static description = 'View epic details and linked tickets (alias for epic view)';
  static hidden = true;

  static args = {
    id: Args.string({
      description: 'Epic ID',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };
}
