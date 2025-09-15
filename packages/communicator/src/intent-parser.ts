import { Intent } from './types';
import { logger } from './utils/logger';

export class IntentParser {
  private patterns: Map<string, RegExp[]>;

  constructor() {
    this.patterns = new Map();
    this.initializePatterns();
  }

  private initializePatterns() {
    // Status patterns
    this.patterns.set('status', [
      /\b(status|state|how are|what'?s happening|sitrep)\b/i,
      /\b(show|get|check)\s+(status|state)\b/i,
      /^status$/i
    ]);

    // Assignment patterns
    this.patterns.set('assign', [
      /assign\s+@?(\w+)\s+(?:to\s+)?(.+)/i,
      /give\s+@?(\w+)\s+(?:the\s+)?(?:task\s+)?(.+)/i,
      /@(\w+)\s+(?:please\s+)?(?:work on|handle|do)\s+(.+)/i
    ]);

    // Task creation patterns
    this.patterns.set('create', [
      /create\s+(?:a\s+)?(?:new\s+)?task:?\s*(.+)/i,
      /add\s+(?:a\s+)?(?:new\s+)?task:?\s*(.+)/i,
      /new\s+task:?\s*(.+)/i,
      /todo:?\s*(.+)/i
    ]);

    // Report patterns
    this.patterns.set('report', [
      /\b(report|summary|progress|update)\b/i,
      /\b(show|get|give)\s+(?:me\s+)?(?:a\s+)?report\b/i,
      /^report$/i
    ]);

    // Help patterns
    this.patterns.set('help', [
      /\b(help|commands?|usage|how to|what can)\b/i,
      /^(help|\?)$/i
    ]);
  }

  async parse(text: string): Promise<Intent> {
    const cleanText = text.trim();
    
    // Check each intent pattern
    for (const [intentType, patterns] of this.patterns) {
      for (const pattern of patterns) {
        const match = cleanText.match(pattern);
        if (match) {
          return this.createIntent(intentType, match, cleanText);
        }
      }
    }

    // Default to unknown intent
    return {
      type: 'unknown',
      confidence: 0,
      entities: { text: cleanText }
    };
  }

  private createIntent(type: string, match: RegExpMatchArray, text: string): Intent {
    const intent: Intent = {
      type: type as Intent['type'],
      confidence: 0.8,
      entities: {}
    };

    // Extract entities based on intent type
    switch (type) {
      case 'assign':
        if (match[1] && match[2]) {
          intent.entities.agent = match[1];
          intent.entities.task = match[2].trim();
        }
        break;
      
      case 'create':
        if (match[1]) {
          intent.entities.title = match[1].trim();
          intent.entities.description = match[1].trim();
        }
        break;
    }

    // Detect priority
    intent.priority = this.detectPriority(text);

    logger.info(`Parsed intent: ${type} with confidence ${intent.confidence}`);
    return intent;
  }

  private detectPriority(text: string): 'low' | 'medium' | 'high' | 'urgent' {
    const lowercaseText = text.toLowerCase();
    
    if (lowercaseText.includes('urgent') || lowercaseText.includes('asap') || 
        lowercaseText.includes('critical') || lowercaseText.includes('emergency')) {
      return 'urgent';
    }
    
    if (lowercaseText.includes('high priority') || lowercaseText.includes('important')) {
      return 'high';
    }
    
    if (lowercaseText.includes('low priority') || lowercaseText.includes('when you can')) {
      return 'low';
    }
    
    return 'medium';
  }

  // Advanced NLP features (placeholder for future enhancement)
  async enhancedParse(text: string): Promise<Intent> {
    // This could integrate with:
    // - OpenAI for better intent detection
    // - Named entity recognition
    // - Sentiment analysis
    // - Context awareness
    
    // For now, use basic parsing
    return this.parse(text);
  }
}