import { EventEmitter } from 'events';

export interface Message {
  text: string;
  user: string;
  channel: string;
  context?: any;
}

export interface Intent {
  type: 'status' | 'assign' | 'create' | 'report' | 'help' | 'unknown';
  confidence: number;
  entities: Record<string, any>;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

export interface RoutingContext {
  channel: string;
  user: string;
  context?: any;
}

export abstract class CommunicationChannel extends EventEmitter {
  abstract init(): Promise<void>;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(to: string, message: string): Promise<void>;
  abstract broadcast(message: string): Promise<void>;
  abstract handleWebhook(req: any, res: any): Promise<void>;
}