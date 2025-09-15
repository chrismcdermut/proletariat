export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
export type WorkerAvailability = 'idle' | 'busy' | 'offline';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: string;
  specId?: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo?: string;
  requiredSkills: string[];
  estimatedTime: number;
  actualTime?: number;
  dependencies: string[];
  acceptanceCriteria: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  retries: number;
  progress?: number;
  output?: any;
}

export interface Worker {
  id: string;
  name: string;
  theme: 'billionaires' | 'cars' | 'companies';
  skills: string[];
  languages: string[];
  availability: WorkerAvailability;
  currentTask?: string;
  endpoint?: string;
  lastHeartbeat: Date;
  performance: {
    tasksCompleted: number;
    averageTime: number;
    successRate: number;
  };
}

export interface PMOSpec {
  id: string;
  title: string;
  priority: TaskPriority;
  assignedTo?: string;
  requirements: Array<{
    description: string;
    skills?: string[];
    estimatedHours?: number;
    dependencies?: string[];
  }>;
  acceptanceCriteria: string[];
  dependencies?: string[];
  estimatedHours?: number;
  status: 'new' | 'in_progress' | 'completed';
}

export interface Message {
  id: string;
  from: string;
  to: string;
  channel: 'slack' | 'sms' | 'api';
  type: 'command' | 'query' | 'notification';
  content: string;
  context?: any;
  timestamp: Date;
}

export interface CommunicationChannel {
  type: 'slack' | 'sms' | 'api';
  enabled: boolean;
  config: any;
}