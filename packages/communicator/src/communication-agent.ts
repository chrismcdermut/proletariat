import express from 'express';
import axios from 'axios';
import { EventEmitter } from 'events';
import { CommunicationChannel } from './types';
import { MessageRouter } from './message-router';
import { IntentParser } from './intent-parser';
import { logger } from './utils/logger';

interface CommunicatorConfig {
  orchestratorUrl: string;
  port: number;
}

export class CommunicationAgent extends EventEmitter {
  private channels: Map<string, CommunicationChannel>;
  private router: MessageRouter;
  private intentParser: IntentParser;
  private orchestratorUrl: string;
  private app: express.Application;
  private port: number;

  constructor(config: CommunicatorConfig) {
    super();
    this.channels = new Map();
    this.router = new MessageRouter();
    this.intentParser = new IntentParser();
    this.orchestratorUrl = config.orchestratorUrl;
    this.port = config.port;
    this.app = express();
    this.setupAPI();
  }

  private setupAPI() {
    this.app.use(express.json());

    // Webhook endpoint for SMS (Twilio)
    this.app.post('/webhooks/sms', async (req, res) => {
      try {
        const smsChannel = this.channels.get('sms');
        if (smsChannel) {
          await smsChannel.handleWebhook(req, res);
        } else {
          res.status(404).send('SMS channel not configured');
        }
      } catch (error) {
        logger.error('SMS webhook error:', error);
        res.status(500).send('Internal error');
      }
    });

    // Status endpoint
    this.app.get('/api/status', (req, res) => {
      const status = {
        channels: Array.from(this.channels.keys()),
        orchestrator: this.orchestratorUrl,
        uptime: process.uptime()
      };
      res.json(status);
    });

    // Send message endpoint (for testing/admin)
    this.app.post('/api/send', async (req, res) => {
      const { channel, to, message } = req.body;
      try {
        await this.sendMessage(channel, to, message);
        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to send message:', error);
        res.status(500).json({ success: false, error: String(error) });
      }
    });
  }

  async addChannel(name: string, channel: CommunicationChannel) {
    this.channels.set(name, channel);
    
    // Set up message handler
    channel.on('message', async (message) => {
      await this.handleIncomingMessage(name, message);
    });

    await channel.init();
  }

  private async handleIncomingMessage(channelName: string, message: any) {
    try {
      logger.info(`📨 Received message from ${channelName}: ${message.text}`);

      // Parse intent
      const intent = await this.intentParser.parse(message.text);
      logger.info(`🎯 Detected intent: ${intent.type}`);

      // Route message based on intent
      const response = await this.router.route(intent, {
        channel: channelName,
        user: message.user,
        context: message.context
      });

      // Process based on intent type
      switch (intent.type) {
        case 'status':
          await this.handleStatusRequest(channelName, message, response);
          break;
        case 'assign':
          await this.handleAssignment(channelName, message, intent);
          break;
        case 'create':
          await this.handleTaskCreation(channelName, message, intent);
          break;
        case 'report':
          await this.handleReportRequest(channelName, message);
          break;
        case 'help':
          await this.handleHelpRequest(channelName, message);
          break;
        default:
          await this.handleUnknownIntent(channelName, message);
      }
    } catch (error) {
      logger.error('Error handling message:', error);
      await this.sendMessage(channelName, message.user, 
        '❌ Sorry, I encountered an error processing your request.');
    }
  }

  private async handleStatusRequest(channel: string, message: any, response: any) {
    try {
      // Get status from orchestrator
      const { data } = await axios.get(`${this.orchestratorUrl}/api/status`);
      
      let statusMessage = '📊 *System Status*\n';
      statusMessage += `• Workers: ${data.workers} active\n`;
      statusMessage += `• Active Tasks: ${data.activeTasks}\n`;
      statusMessage += `• Pending Tasks: ${data.pendingTasks}\n`;
      statusMessage += `• Uptime: ${Math.floor(data.uptime / 60)} minutes`;

      await this.sendMessage(channel, message.user, statusMessage);
    } catch (error) {
      logger.error('Failed to get status:', error);
      await this.sendMessage(channel, message.user, 
        '❌ Failed to retrieve system status');
    }
  }

  private async handleAssignment(channel: string, message: any, intent: any) {
    try {
      const { agent, task } = intent.entities;
      
      // Create task via orchestrator
      const { data } = await axios.post(`${this.orchestratorUrl}/api/tasks`, {
        title: task,
        description: `Assigned via ${channel} by ${message.user}`,
        assignedTo: agent,
        priority: intent.priority || 'medium'
      });

      await this.sendMessage(channel, message.user,
        `✅ Task assigned to ${agent}: "${task}"\nTask ID: ${data.task.id}`);
    } catch (error) {
      logger.error('Failed to assign task:', error);
      await this.sendMessage(channel, message.user,
        '❌ Failed to assign task');
    }
  }

  private async handleTaskCreation(channel: string, message: any, intent: any) {
    try {
      const { title, description } = intent.entities;
      
      const { data } = await axios.post(`${this.orchestratorUrl}/api/tasks`, {
        title: title || 'New Task',
        description: description || message.text,
        priority: intent.priority || 'medium'
      });

      await this.sendMessage(channel, message.user,
        `✅ Task created: ${data.task.title}\nTask ID: ${data.task.id}`);
    } catch (error) {
      logger.error('Failed to create task:', error);
      await this.sendMessage(channel, message.user,
        '❌ Failed to create task');
    }
  }

  private async handleReportRequest(channel: string, message: any) {
    try {
      const { data } = await axios.get(`${this.orchestratorUrl}/api/status`);
      
      // Generate detailed report
      let report = '📋 *Proletariat Work Report*\n\n';
      report += '```\n';
      report += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
      report += ' WORKERS OF THE CODEBASE STATUS\n';
      report += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
      report += `Active Workers:    ${data.workers}\n`;
      report += `Tasks In Progress: ${data.activeTasks}\n`;
      report += `Tasks Pending:     ${data.pendingTasks}\n`;
      report += `System Uptime:     ${Math.floor(data.uptime / 3600)}h ${Math.floor((data.uptime % 3600) / 60)}m\n`;
      report += '```';

      await this.sendMessage(channel, message.user, report);
    } catch (error) {
      logger.error('Failed to generate report:', error);
      await this.sendMessage(channel, message.user,
        '❌ Failed to generate report');
    }
  }

  private async handleHelpRequest(channel: string, message: any) {
    const helpMessage = `
🚩 *Proletariat Commands* 🚩

*Status & Reports:*
• \`status\` - Get system status
• \`report\` - Get detailed work report

*Task Management:*
• \`assign @agent "task description"\` - Assign task to agent
• \`create task: description\` - Create new task
• \`list tasks\` - List all tasks

*Worker Management:*
• \`list workers\` - Show all workers
• \`hire bezos\` - Add new worker
• \`fire musk\` - Remove worker

*Examples:*
• "Hey, what's the status?"
• "Assign @bezos to implement authentication"
• "Create task: Fix bug in checkout flow"

Workers of the codebase, unite! ✊`;

    await this.sendMessage(channel, message.user, helpMessage);
  }

  private async handleUnknownIntent(channel: string, message: any) {
    await this.sendMessage(channel, message.user,
      "🤔 I didn't understand that. Type 'help' for available commands.");
  }

  async sendMessage(channel: string, to: string, message: string) {
    const channelInstance = this.channels.get(channel);
    if (!channelInstance) {
      throw new Error(`Channel ${channel} not found`);
    }
    
    await channelInstance.send(to, message);
  }

  async broadcast(message: string) {
    for (const [name, channel] of this.channels) {
      try {
        await channel.broadcast(message);
      } catch (error) {
        logger.error(`Failed to broadcast to ${name}:`, error);
      }
    }
  }

  async start() {
    // Start Express server
    this.app.listen(this.port, () => {
      logger.info(`🚀 Communicator API running on port ${this.port}`);
    });

    // Start all channels
    for (const [name, channel] of this.channels) {
      await channel.start();
      logger.info(`✅ ${name} channel started`);
    }
  }

  async stop() {
    for (const [name, channel] of this.channels) {
      await channel.stop();
    }
  }
}