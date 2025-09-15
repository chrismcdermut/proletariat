import { Intent, RoutingContext } from './types';
import { logger } from './utils/logger';
import axios from 'axios';

export class MessageRouter {
  private routes: Map<string, (intent: Intent, context: RoutingContext) => Promise<any>>;
  private orchestratorUrl: string;

  constructor(orchestratorUrl: string = 'http://localhost:3000') {
    this.orchestratorUrl = orchestratorUrl;
    this.routes = new Map();
    this.setupRoutes();
  }

  private setupRoutes() {
    // Status route
    this.routes.set('status', async (intent, context) => {
      try {
        const { data } = await axios.get(`${this.orchestratorUrl}/api/status`);
        return {
          success: true,
          data
        };
      } catch (error) {
        logger.error('Failed to get status:', error);
        return {
          success: false,
          error: 'Failed to retrieve status'
        };
      }
    });

    // Assignment route
    this.routes.set('assign', async (intent, context) => {
      try {
        const { agent, task } = intent.entities;
        const { data } = await axios.post(`${this.orchestratorUrl}/api/tasks`, {
          title: task,
          assignedTo: agent,
          priority: intent.priority,
          createdBy: context.user,
          channel: context.channel
        });
        return {
          success: true,
          data
        };
      } catch (error) {
        logger.error('Failed to assign task:', error);
        return {
          success: false,
          error: 'Failed to assign task'
        };
      }
    });

    // Create task route
    this.routes.set('create', async (intent, context) => {
      try {
        const { title, description } = intent.entities;
        const { data } = await axios.post(`${this.orchestratorUrl}/api/tasks`, {
          title,
          description,
          priority: intent.priority,
          createdBy: context.user,
          channel: context.channel
        });
        return {
          success: true,
          data
        };
      } catch (error) {
        logger.error('Failed to create task:', error);
        return {
          success: false,
          error: 'Failed to create task'
        };
      }
    });

    // Report route
    this.routes.set('report', async (intent, context) => {
      try {
        const [statusRes, workersRes] = await Promise.all([
          axios.get(`${this.orchestratorUrl}/api/status`),
          axios.get(`${this.orchestratorUrl}/api/workers`)
        ]);
        
        return {
          success: true,
          data: {
            status: statusRes.data,
            workers: workersRes.data
          }
        };
      } catch (error) {
        logger.error('Failed to generate report:', error);
        return {
          success: false,
          error: 'Failed to generate report'
        };
      }
    });

    // Help route
    this.routes.set('help', async (intent, context) => {
      return {
        success: true,
        data: {
          commands: [
            { command: 'status', description: 'Get system status' },
            { command: 'assign @agent "task"', description: 'Assign task to agent' },
            { command: 'create task: description', description: 'Create new task' },
            { command: 'report', description: 'Get detailed report' },
            { command: 'help', description: 'Show this help message' }
          ]
        }
      };
    });
  }

  async route(intent: Intent, context: RoutingContext): Promise<any> {
    const handler = this.routes.get(intent.type);
    
    if (handler) {
      logger.info(`Routing ${intent.type} intent from ${context.channel}`);
      return await handler(intent, context);
    }
    
    logger.warn(`No route found for intent type: ${intent.type}`);
    return {
      success: false,
      error: `Unknown intent: ${intent.type}`
    };
  }

  // Direct routing for specific commands
  async routeCommand(command: string, args: string[], context: RoutingContext): Promise<any> {
    const commandMap: Record<string, string> = {
      'status': 'status',
      'assign': 'assign',
      'create': 'create',
      'report': 'report',
      'help': 'help',
      'list': 'list',
      'hire': 'hire',
      'fire': 'fire',
      'workers': 'workers',
      'tasks': 'tasks'
    };

    const intentType = commandMap[command.toLowerCase()];
    if (intentType) {
      const intent: Intent = {
        type: intentType as Intent['type'],
        confidence: 1.0,
        entities: { args }
      };
      return this.route(intent, context);
    }

    return {
      success: false,
      error: `Unknown command: ${command}`
    };
  }

  // Webhook routing for external integrations
  async routeWebhook(source: string, payload: any): Promise<any> {
    logger.info(`Received webhook from ${source}`);
    
    // Route based on webhook source
    switch (source) {
      case 'github':
        return this.handleGithubWebhook(payload);
      case 'jira':
        return this.handleJiraWebhook(payload);
      case 'pagerduty':
        return this.handlePagerDutyWebhook(payload);
      default:
        logger.warn(`Unknown webhook source: ${source}`);
        return { success: false, error: 'Unknown webhook source' };
    }
  }

  private async handleGithubWebhook(payload: any): Promise<any> {
    // Handle GitHub events (PR, issues, etc.)
    if (payload.action === 'opened' && payload.pull_request) {
      // Create a task for PR review
      const task = {
        title: `Review PR: ${payload.pull_request.title}`,
        description: `PR #${payload.pull_request.number} by ${payload.pull_request.user.login}`,
        priority: 'medium',
        requiredSkills: ['code-review']
      };
      
      const { data } = await axios.post(`${this.orchestratorUrl}/api/tasks`, task);
      return { success: true, taskId: data.task.id };
    }
    
    return { success: true };
  }

  private async handleJiraWebhook(payload: any): Promise<any> {
    // Handle JIRA events
    // Convert JIRA issues to tasks
    return { success: true };
  }

  private async handlePagerDutyWebhook(payload: any): Promise<any> {
    // Handle PagerDuty incidents
    // Create urgent tasks for incidents
    return { success: true };
  }
}