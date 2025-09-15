# Switchboard MVP - Local Machine (1 Week Sprint)

## Goal
Text your phone → Proletariat executes → Claude Code writes code → You get PR link via SMS

## Architecture (Simplest Possible)
```
[Your Phone]
     ↓ SMS
[Twilio Phone Number]
     ↓ webhook
[ngrok tunnel] 
     ↓ https
[localhost:5000 - Flask server]
     ↓ executes
[Proletariat CLI + Claude Code]
     ↓ responds
[SMS back to you]
```

## Quick Implementation

### Step 1: Twilio Setup (30 min)
```bash
# Sign up for Twilio
# Get phone number ($1/month)
# Note: Account SID, Auth Token, Phone Number
```

### Step 2: Flask Webhook Server (2 hours)
```python
# switchboard.py
from flask import Flask, request
from twilio.rest import Client
import subprocess
import os

app = Flask(__name__)
client = Client(ACCOUNT_SID, AUTH_TOKEN)

@app.route('/sms', methods=['POST'])
def receive_sms():
    sender = request.form['From']
    message = request.form['Body'].lower().strip()
    
    # Parse commands
    if message.startswith('status'):
        result = subprocess.run(['prlt', 'staff'], 
                              capture_output=True, text=True)
        reply = result.stdout[:160]  # SMS length limit
        
    elif message.startswith('hire'):
        # "hire bezos" → prlt hire bezos
        _, agent = message.split(' ', 1)
        subprocess.run(['prlt', 'hire', agent])
        reply = f"Hired {agent}"
        
    elif 'implement' in message:
        # "bezos implement dark mode"
        agent, _, task = message.partition(' implement ')
        
        # Create spec file
        spec = f"Implement {task}"
        with open(f'pmo/specs/{task.replace(" ", "-")}.md', 'w') as f:
            f.write(spec)
        
        # Start Claude Code in that worktree
        os.chdir(f'../proletariat-staff/{agent}')
        subprocess.Popen(['claude', 'code', spec])  # Non-blocking
        
        reply = f"{agent} started on {task}"
    
    # Send reply
    client.messages.create(
        to=sender,
        from_=TWILIO_NUMBER,
        body=reply
    )
    
    return "OK"

if __name__ == '__main__':
    app.run(port=5000)
```

### Step 3: Ngrok Tunnel (5 min)
```bash
# Install ngrok
brew install ngrok

# Start tunnel
ngrok http 5000
# Copy the https URL (like https://abc123.ngrok.io)

# Set as Twilio webhook
# Twilio Console → Phone Number → Messaging → Webhook
# Set to: https://abc123.ngrok.io/sms
```

### Step 4: Test It!
```
You: "status"
Twilio: "BEZOS: idle, MUSK: idle"

You: "hire gates"  
Twilio: "Hired gates"

You: "bezos implement dark mode"
Twilio: "bezos started on dark mode"
[Claude Code starts working on your laptop]
```

## Demo Script for Denver

```bash
# Before talk:
1. Start Flask server
2. Start ngrok  
3. Have Proletariat ready
4. Test SMS works

# On stage:
"Let me show you something nobody has seen before."
*Pull out phone*

"I'm going to text my company to build a feature."
*Type: "bezos implement user authentication"*
*Send*

"Bezos just received his assignment."
*Show laptop screen - Claude Code working*

"While he's working, let's check on Musk"
*Type: "musk status"*
*Get reply: "MUSK: reviewing PRs"*

"In 30 seconds, we'll have a PR ready."
*Phone buzzes*
"PR #42 ready: github.com/..."

"I just shipped a feature from my phone."
*Audience loses their minds*
```

## Why This MVP Wins

1. **Buildable this week** - No VM complexity
2. **Actually useful** - You can use it daily
3. **Demo-able** - Works live on stage
4. **Evolvable** - Add VM later
5. **Viral moment** - "Text your company" is unforgettable

## Next Steps After MVP

- Add more commands (fire, assign, review)
- Parse natural language ("hey bezos, fix that bug")
- Add scheduler ("every morning, status")
- Move webhook server to VM (laptop can sleep)
- Eventually: Full cloud agents

## Start Now

Today: Set up Twilio
Tomorrow: Build Flask server
Day 3: Test with real tasks
Day 4: Polish demo
Day 5: Practice talk
Day 6: Final prep
Day 7: Denver 🚀