import { CommunicationAgent } from './communication-agent';
import { SlackChannel } from './channels/slack';
import { SMSChannel } from './channels/sms';
import { logger } from './utils/logger';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  logger.info('📡 PROLETARIAT COMMUNICATOR STARTING 📡');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const communicator = new CommunicationAgent({
    orchestratorUrl: process.env.ORCHESTRATOR_URL || 'http://localhost:3000',
    port: parseInt(process.env.PORT || '3001')
  });

  // Initialize Slack channel if configured
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    const slackChannel = new SlackChannel({
      botToken: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET!
    });
    await communicator.addChannel('slack', slackChannel);
    logger.info('💬 Slack channel initialized');
  } else {
    logger.warn('⚠️ Slack credentials not found, skipping Slack integration');
  }

  // Initialize SMS channel if configured
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const smsChannel = new SMSChannel({
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER!,
      whitelistedNumbers: process.env.SMS_WHITELIST?.split(',') || []
    });
    await communicator.addChannel('sms', smsChannel);
    logger.info('📱 SMS channel initialized');
  } else {
    logger.warn('⚠️ Twilio credentials not found, skipping SMS integration');
  }

  await communicator.start();
  
  logger.info('📡 Communication channels are open!');
  logger.info('🚩 Messages from the masses will be heard!');
}

main().catch(err => {
  logger.error('Communicator failed to start:', err);
  process.exit(1);
});