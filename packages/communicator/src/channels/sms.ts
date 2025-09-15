import twilio from 'twilio';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

interface SMSConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  whitelistedNumbers: string[];
}

export class SMSChannel extends EventEmitter {
  private client: twilio.Twilio;
  private config: SMSConfig;
  private conversationContext: Map<string, any>;

  constructor(config: SMSConfig) {
    super();
    this.config = config;
    this.client = twilio(config.accountSid, config.authToken);
    this.conversationContext = new Map();
  }

  async init() {
    logger.info('Initializing SMS channel...');
    logger.info(`📱 SMS number: ${this.config.phoneNumber}`);
    logger.info(`📋 Whitelisted numbers: ${this.config.whitelistedNumbers.join(', ')}`);
  }

  async start() {
    logger.info('📱 SMS channel is ready!');
  }

  async stop() {
    logger.info('SMS channel stopped');
  }

  async send(to: string, message: string) {
    try {
      // Check if number is whitelisted
      if (this.config.whitelistedNumbers.length > 0 && 
          !this.config.whitelistedNumbers.includes(to)) {
        logger.warn(`Attempted to send SMS to non-whitelisted number: ${to}`);
        return;
      }

      // Truncate message if too long (SMS limit)
      const truncatedMessage = message.length > 1600 
        ? message.substring(0, 1597) + '...' 
        : message;

      await this.client.messages.create({
        body: truncatedMessage,
        from: this.config.phoneNumber,
        to: to
      });

      logger.info(`📤 SMS sent to ${to}`);
    } catch (error) {
      logger.error('Failed to send SMS:', error);
      throw error;
    }
  }

  async broadcast(message: string) {
    for (const number of this.config.whitelistedNumbers) {
      try {
        await this.send(number, message);
      } catch (error) {
        logger.error(`Failed to send SMS to ${number}:`, error);
      }
    }
  }

  async handleWebhook(req: any, res: any) {
    try {
      const { Body, From } = req.body;
      
      // Validate webhook signature (security)
      const twilioSignature = req.headers['x-twilio-signature'];
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      
      if (!twilio.validateRequest(
        this.config.authToken,
        twilioSignature,
        url,
        req.body
      )) {
        logger.warn('Invalid Twilio webhook signature');
        res.status(403).send('Forbidden');
        return;
      }

      // Check if number is whitelisted
      if (this.config.whitelistedNumbers.length > 0 && 
          !this.config.whitelistedNumbers.includes(From)) {
        logger.warn(`Received SMS from non-whitelisted number: ${From}`);
        res.status(200).send('OK');
        return;
      }

      logger.info(`📥 SMS received from ${From}: ${Body}`);

      // Get or create conversation context
      let context = this.conversationContext.get(From);
      if (!context) {
        context = { history: [] };
        this.conversationContext.set(From, context);
      }
      context.history.push({ text: Body, timestamp: new Date() });

      // Emit message event
      this.emit('message', {
        text: Body,
        user: From,
        channel: 'sms',
        context: context
      });

      // Acknowledge receipt
      res.status(200).send('OK');
    } catch (error) {
      logger.error('Error handling SMS webhook:', error);
      res.status(500).send('Internal error');
    }
  }

  // Parse SMS commands (simpler format for SMS)
  parseCommand(text: string): { command: string; args: string[] } {
    const parts = text.trim().toUpperCase().split(' ');
    const command = parts[0];
    const args = parts.slice(1);

    // Map short commands to full commands
    const commandMap: Record<string, string> = {
      'S': 'STATUS',
      'A': 'ASSIGN',
      'C': 'CREATE',
      'R': 'REPORT',
      'H': 'HELP',
      '?': 'HELP'
    };

    return {
      command: commandMap[command] || command,
      args: args
    };
  }

  // Format message for SMS (shorter, no markdown)
  formatForSMS(message: string): string {
    // Remove markdown formatting
    let formatted = message
      .replace(/\*/g, '')
      .replace(/```/g, '')
      .replace(/`/g, '')
      .replace(/━/g, '-')
      .replace(/✅/g, '[OK]')
      .replace(/❌/g, '[ERR]')
      .replace(/📋/g, '[TASK]')
      .replace(/💰/g, '[WORKER]')
      .replace(/🚩/g, '')
      .replace(/📊/g, '[STATUS]')
      .replace(/•/g, '-');

    // Compress whitespace
    formatted = formatted.replace(/\n\n+/g, '\n').trim();

    return formatted;
  }
}