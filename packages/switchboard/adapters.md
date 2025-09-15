# Switchboard Adapters Architecture

## The Pattern

```
[External Input] → [Adapter] → [Normalized Command] → [Executor]
```

## Adapter Responsibilities

Each adapter:
1. **Receives** external input (SMS, Slack, etc.)
2. **Parses** into normalized command format
3. **Executes** via shell/subprocess
4. **Formats** response for that channel
5. **Sends** back through appropriate channel

## Normalized Command Structure

```typescript
interface Command {
  source: 'sms' | 'slack' | 'discord' | 'cli' | 'web';
  sender: string;
  raw: string;
  parsed: {
    action: 'hire' | 'fire' | 'assign' | 'status' | 'help';
    agent?: string;
    task?: string;
    params?: Record<string, any>;
  };
  timestamp: Date;
}

interface Response {
  command: Command;
  output: string;
  success: boolean;
  duration: number;
}
```

## Adapter Implementations

### SMS Adapter (Twilio)
```python
# adapters/sms.py
class SMSAdapter:
    def receive(self, request):
        """Webhook from Twilio"""
        return Command(
            source='sms',
            sender=request.form['From'],
            raw=request.form['Body']
        )
    
    def send(self, response: Response):
        """Send SMS back"""
        # Truncate to 160 chars
        # Add emoji for context
        return sms_client.send(response.output[:160])
```

### Slack Adapter
```python
# adapters/slack.py  
class SlackAdapter:
    def receive(self, request):
        """Webhook from Slack"""
        return Command(
            source='slack',
            sender=request['user_id'],
            raw=request['text']
        )
    
    def send(self, response: Response):
        """Post to Slack"""
        # Rich formatting with markdown
        # Thread responses
        # Add reactions
        return slack_client.post(response.output)
```

### Discord Adapter
```python
# adapters/discord.py
class DiscordAdapter:
    def receive(self, message):
        """Discord bot message"""
        return Command(
            source='discord',
            sender=message.author,
            raw=message.content
        )
    
    def send(self, response: Response):
        """Discord embed"""
        # Rich embeds with colors
        # Progress bars
        # Reactions
        return discord.Embed(response.output)
```

### CLI Adapter (Direct)
```python
# adapters/cli.py
class CLIAdapter:
    def receive(self, args):
        """Direct terminal input"""
        return Command(
            source='cli',
            sender=os.getenv('USER'),
            raw=' '.join(args)
        )
    
    def send(self, response: Response):
        """Terminal output"""
        # Full output, colored
        # Progress indicators
        print(response.output)
```

## The Executor (Common to All)

```python
# executor.py
class Executor:
    def execute(self, command: Command) -> Response:
        """Execute normalized command regardless of source"""
        
        if command.parsed.action == 'hire':
            result = subprocess.run(
                ['prlt', 'hire', command.parsed.agent],
                capture_output=True
            )
            
        elif command.parsed.action == 'assign':
            # Start Claude Code
            # Create spec
            # Trigger agent
            
        return Response(
            command=command,
            output=result.stdout,
            success=result.returncode == 0
        )
```

## Multi-Adapter Server

```python
# switchboard.py
app = Flask(__name__)
executor = Executor()
adapters = {
    'sms': SMSAdapter(),
    'slack': SlackAdapter(),
    'discord': DiscordAdapter()
}

@app.route('/webhook/<source>', methods=['POST'])
def handle_webhook(source):
    """Universal webhook endpoint"""
    adapter = adapters[source]
    command = adapter.receive(request)
    response = executor.execute(command)
    return adapter.send(response)
```

## Why "Adapter" Is The Right Term

1. **Design Pattern**: Adapter pattern from Gang of Four
2. **Clear Purpose**: Adapts external formats to internal
3. **Bidirectional**: Handles both input and output
4. **Pluggable**: Easy to add new channels
5. **Familiar**: Developers know this pattern

## Alternative Terms Considered

- ~~Transformer~~ - Implies data transformation only
- ~~Middleware~~ - Implies request/response chain
- ~~Bridge~~ - Good but implies connecting two systems
- ~~Gateway~~ - Good but implies network boundary
- ~~Translator~~ - Too narrow, just language conversion
- **Adapter** ✓ - Perfect: adapts interfaces

## The Beautiful Part

Each adapter can have channel-specific features:
- **SMS**: 160 char limit, emoji responses
- **Slack**: Threads, reactions, rich formatting
- **Discord**: Embeds, colors, long messages
- **Voice**: Speech-to-text, confirmations
- **WhatsApp**: Media attachments, buttons

But they all speak the same Command/Response language internally.