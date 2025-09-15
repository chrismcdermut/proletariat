#!/usr/bin/env python3
"""
Proletariat Switchboard - SMS to Code Pipeline
Run: python switchboard.py
Ngrok: ngrok http 5000
"""

from flask import Flask, request, Response
from twilio.rest import Client
from twilio.twiml.messaging_response import MessagingResponse
import subprocess
import os
from datetime import datetime

app = Flask(__name__)

# TODO: Add your Twilio credentials
ACCOUNT_SID = 'YOUR_ACCOUNT_SID'
AUTH_TOKEN = 'YOUR_AUTH_TOKEN'
TWILIO_NUMBER = '+1234567890'

# Initialize Twilio client (optional for sending SMS)
# client = Client(ACCOUNT_SID, AUTH_TOKEN)

@app.route('/sms', methods=['POST'])
def handle_sms():
    """Receive SMS, execute Proletariat commands, respond"""
    
    # Get incoming message
    sender = request.form.get('From', '')
    body = request.form.get('Body', '').lower().strip()
    
    print(f"\n📱 SMS from {sender}: {body}")
    
    # Create TwiML response
    resp = MessagingResponse()
    
    try:
        # Parse and execute commands
        if body == 'status' or body == 'staff':
            # Check agent status
            result = subprocess.run(
                ['prlt', 'staff'],
                capture_output=True,
                text=True,
                cwd=os.path.expanduser('~/Projects/proletariat')
            )
            reply = result.stdout[:160] if result.stdout else "No agents active"
            
        elif body.startswith('hire '):
            # hire bezos → prlt hire bezos
            agent = body.split(' ', 1)[1]
            result = subprocess.run(
                ['prlt', 'hire', agent],
                capture_output=True,
                text=True,
                cwd=os.path.expanduser('~/Projects/proletariat')
            )
            reply = f"💰 Hired {agent.upper()}"
            
        elif body.startswith('fire '):
            # fire bezos → prlt fire bezos  
            agent = body.split(' ', 1)[1]
            result = subprocess.run(
                ['prlt', 'fire', agent],
                capture_output=True,
                text=True,
                cwd=os.path.expanduser('~/Projects/proletariat')
            )
            reply = f"🔥 Fired {agent.upper()}"
            
        elif 'implement' in body or 'build' in body or 'fix' in body:
            # "bezos implement dark mode"
            parts = body.split(' ', 1)
            if len(parts) > 1:
                agent = parts[0]
                task = parts[1]
                
                # Create a spec file
                spec_path = os.path.expanduser(f'~/Projects/proletariat/pmo/specs/{task.replace(" ", "-")}-{datetime.now().strftime("%Y%m%d-%H%M%S")}.md')
                with open(spec_path, 'w') as f:
                    f.write(f"# Task: {task}\n\nAssigned to: {agent}\n\nImplement: {task}")
                
                # Start Claude Code in background (non-blocking)
                agent_dir = os.path.expanduser(f'~/Projects/proletariat-staff/{agent}')
                if os.path.exists(agent_dir):
                    # This would start Claude Code - adjust command as needed
                    # subprocess.Popen(['claude', 'code'], cwd=agent_dir)
                    reply = f"💰 {agent.upper()}: Starting '{task}'"
                else:
                    reply = f"❌ {agent} not hired yet. Run 'hire {agent}' first"
            else:
                reply = "Format: [agent] implement [task]"
                
        elif body == 'help':
            reply = "Commands: status, hire [agent], fire [agent], [agent] implement [task]"
            
        else:
            reply = f"Unknown command: '{body}'. Text 'help' for commands"
            
    except Exception as e:
        print(f"Error: {e}")
        reply = "Error processing command"
    
    # Send response
    resp.message(reply[:160])  # SMS length limit
    print(f"📤 Reply: {reply}")
    
    return Response(str(resp), mimetype='application/xml')

@app.route('/', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return "Proletariat Switchboard is running! ⚒️"

if __name__ == '__main__':
    print("""
    ⚒️  PROLETARIAT SWITCHBOARD ⚒️
    ═══════════════════════════════
    SMS → Code Pipeline Active
    
    1. Start ngrok: ngrok http 5000
    2. Update Twilio webhook URL
    3. Text your Twilio number
    
    Ready for commands...
    """)
    
    app.run(port=5000, debug=True)