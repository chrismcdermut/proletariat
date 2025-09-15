#!/usr/bin/env python3
"""
Slack Adapter for Proletariat Switchboard
"""

from flask import Flask, request, jsonify
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
import json
import subprocess
import os

app = Flask(__name__)

# Slack tokens
SLACK_BOT_TOKEN = os.environ.get('SLACK_BOT_TOKEN')
SLACK_SIGNING_SECRET = os.environ.get('SLACK_SIGNING_SECRET')

slack_client = WebClient(token=SLACK_BOT_TOKEN)

@app.route('/slack/commands', methods=['POST'])
def handle_slack_command():
    """Handle Slack slash commands like /prlt status"""
    
    command = request.form.get('command')  # /prlt
    text = request.form.get('text')        # "status" or "hire bezos"
    user_id = request.form.get('user_id')
    channel_id = request.form.get('channel_id')
    
    # Route to orchestrator
    if text == 'status':
        response = get_orchestrator_status()
    elif text.startswith('hire'):
        agent = text.split(' ')[1]
        response = orchestrator_hire(agent)
    elif 'implement' in text or 'build' in text:
        response = orchestrator_assign(text)
    else:
        response = f"Unknown command: {text}"
    
    # Slack expects response in 3 seconds, so return immediately
    # and post actual response async
    return jsonify({
        'response_type': 'in_channel',
        'text': f"🤖 Processing: {text}..."
    })
    
    # Post actual result (would be async in production)
    slack_client.chat_postMessage(
        channel=channel_id,
        text=response
    )

@app.route('/slack/events', methods=['POST'])
def handle_slack_events():
    """Handle mentions: @proletariat status"""
    
    data = request.json
    
    if data.get('type') == 'url_verification':
        # Slack verification
        return jsonify({'challenge': data['challenge']})
    
    event = data.get('event', {})
    
    if event.get('type') == 'app_mention':
        # Someone said "@proletariat ..."
        text = event.get('text', '').replace('<@BOT_ID>', '').strip()
        channel = event['channel']
        
        # Process command
        response = process_command(text)
        
        # Reply in thread
        slack_client.chat_postMessage(
            channel=channel,
            thread_ts=event['ts'],
            text=response
        )
    
    return jsonify({'status': 'ok'})

def process_command(text):
    """Route to orchestrator or direct agent"""
    
    # Check if targeting specific agent
    if text.startswith('@'):
        # "@bezos fix the login" → Route directly to bezos
        agent, task = text[1:].split(' ', 1)
        return direct_agent_command(agent, task)
    
    # Otherwise route to orchestrator
    return orchestrator_command(text)

def orchestrator_command(text):
    """Smart orchestrator that decides who does what"""
    
    if 'frontend' in text.lower():
        agent = 'musk'  # Musk handles frontend
    elif 'backend' in text.lower():
        agent = 'bezos'  # Bezos handles backend
    elif 'test' in text.lower():
        agent = 'gates'  # Gates handles testing
    else:
        # Orchestrator decides based on workload
        agent = get_least_busy_agent()
    
    return f"📋 Assigned to {agent.upper()}: {text}"

def get_orchestrator_status():
    """Get status from all agents"""
    
    status = []
    for agent in ['bezos', 'musk', 'gates']:
        result = subprocess.run(
            ['prlt', 'status', agent],
            capture_output=True,
            text=True
        )
        status.append(f"💼 {agent.upper()}: {result.stdout.strip()}")
    
    return '\n'.join(status)

# Slack formatting helpers
def format_rich_response(title, fields, color='good'):
    """Create rich Slack message with attachments"""
    
    return {
        'attachments': [{
            'color': color,
            'title': title,
            'fields': [
                {'title': k, 'value': v, 'short': True}
                for k, v in fields.items()
            ]
        }]
    }

# Usage in Slack:
# /prlt status
# /prlt hire bezos
# @proletariat implement payment system
# @bezos fix the login bug
# 
# Or natural language:
# "Hey @proletariat, can you add dark mode to the app?"
# "Hey @proletariat, what's everyone working on?"