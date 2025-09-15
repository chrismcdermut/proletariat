import { App } from '@slack/bolt';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
}

export class SlackChannel extends EventEmitter {
  private app: App;
  private config: SlackConfig;

  constructor(config: SlackConfig) {
    super();
    this.config = config;
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true
    });
    this.setupHandlers();
  }

  private setupHandlers() {
    // Handle mentions
    this.app.event('app_mention', async ({ event, say }) => {
      logger.info(`Slack mention from ${event.user}: ${event.text}`);
      this.emit('message', {
        text: event.text.replace(/<@[A-Z0-9]+>/g, '').trim(),
        user: event.user,
        channel: event.channel,
        context: { thread_ts: event.ts }
      });
    });

    // Handle direct messages
    this.app.message(async ({ message, say }) => {
      if (message.subtype === undefined) {
        const msg = message as any;
        logger.info(`Slack DM from ${msg.user}: ${msg.text}`);
        this.emit('message', {
          text: msg.text,
          user: msg.user,
          channel: msg.channel,
          context: { thread_ts: msg.ts }
        });
      }
    });

    // Handle slash commands
    this.app.command('/prlt', async ({ command, ack, respond }) => {
      await ack();
      logger.info(`Slack command from ${command.user_id}: ${command.text}`);
      
      this.emit('message', {
        text: command.text,
        user: command.user_id,
        channel: command.channel_id,
        context: { respond }
      });
    });

    // Status command
    this.app.command('/prlt-status', async ({ command, ack, respond }) => {
      await ack();
      this.emit('message', {
        text: 'status',
        user: command.user_id,
        channel: command.channel_id,
        context: { respond }
      });
    });

    // Assign command
    this.app.command('/prlt-assign', async ({ command, ack, respond }) => {
      await ack();
      this.emit('message', {
        text: `assign ${command.text}`,
        user: command.user_id,
        channel: command.channel_id,
        context: { respond }
      });
    });

    // Report command
    this.app.command('/prlt-report', async ({ command, ack, respond }) => {
      await ack();
      this.emit('message', {
        text: 'report',
        user: command.user_id,
        channel: command.channel_id,
        context: { respond }
      });
    });
  }

  async init() {
    logger.info('Initializing Slack channel...');
  }

  async start() {
    await this.app.start();
    logger.info('💬 Slack bot is running!');
  }

  async stop() {
    await this.app.stop();
  }

  async send(to: string, message: string) {
    try {
      // If 'to' is a channel ID
      if (to.startsWith('C') || to.startsWith('D')) {
        await this.app.client.chat.postMessage({
          token: this.config.botToken,
          channel: to,
          text: message,
          mrkdwn: true
        });
      } else {
        // If 'to' is a user ID, open DM and send
        const result = await this.app.client.conversations.open({
          token: this.config.botToken,
          users: to
        });
        
        if (result.channel?.id) {
          await this.app.client.chat.postMessage({
            token: this.config.botToken,
            channel: result.channel.id,
            text: message,
            mrkdwn: true
          });
        }
      }
    } catch (error) {
      logger.error('Failed to send Slack message:', error);
      throw error;
    }
  }

  async broadcast(message: string) {
    // Get all channels the bot is in
    const result = await this.app.client.conversations.list({
      token: this.config.botToken
    });

    if (result.channels) {
      for (const channel of result.channels) {
        if (channel.is_member && channel.id) {
          await this.send(channel.id, message);
        }
      }
    }
  }

  async handleWebhook(req: any, res: any) {
    // Slack doesn't use traditional webhooks with socket mode
    res.status(200).send('OK');
  }
}