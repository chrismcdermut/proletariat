# Switchboard Security Layers

## Layer 1: Basic Phone Number Allowlist

```python
# switchboard.py
ALLOWED_NUMBERS = [
    '+1234567890',  # Your phone
    '+0987654321'   # Backup phone
]

@app.route('/sms', methods=['POST'])
def handle_sms():
    sender = request.form.get('From', '')
    
    # Basic allowlist check
    if sender not in ALLOWED_NUMBERS:
        print(f"⚠️ Unauthorized SMS from {sender}")
        resp = MessagingResponse()
        # Don't reveal it's a valid endpoint
        return Response(str(resp), mimetype='application/xml')
```

**Vulnerability**: SMS sender can be spoofed ($10 tools exist)
**Protection Level**: Stops casual attackers, not determined ones

## Layer 2: PIN/Password Commands

```python
# Require PIN for destructive commands
DAILY_PIN = generate_daily_pin()  # Changes daily

def parse_command(body):
    # Format: "PIN:1234 fire bezos"
    if body.startswith('PIN:'):
        pin, command = body.split(' ', 1)
        if pin.split(':')[1] == DAILY_PIN:
            return command
    
    # Non-destructive commands don't need PIN
    if body in ['status', 'help', 'list']:
        return body
    
    return None
```

**Protection Level**: Even if spoofed, attacker needs PIN

## Layer 3: Twilio Verified Caller ID (Strongest)

```python
# Use Twilio Verify API
from twilio.rest import Client

client = Client(ACCOUNT_SID, AUTH_TOKEN)

def verify_sender(phone_number):
    # Send verification code
    verification = client.verify \
        .services(VERIFY_SERVICE_SID) \
        .verifications \
        .create(to=phone_number, channel='sms')
    
    # User replies with code
    # Check code before executing commands
```

**Protection Level**: Cryptographically secure

## Layer 4: Command Signing (Paranoid Mode)

```python
import hmac
import hashlib
from datetime import datetime

SECRET_KEY = os.environ['SWITCHBOARD_SECRET']

def sign_command(command):
    # Generate HMAC signature
    timestamp = str(int(datetime.now().timestamp()))
    message = f"{timestamp}:{command}"
    signature = hmac.new(
        SECRET_KEY.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()[:8]  # First 8 chars for SMS brevity
    
    return f"{signature}:{command}"

# Usage: "a3f2d1c8:hire bezos"
# Only you can generate valid signatures
```

## Layer 5: Rate Limiting & Alerts

```python
from collections import defaultdict
from datetime import datetime, timedelta

command_history = defaultdict(list)
RATE_LIMIT = 10  # commands per hour

def check_rate_limit(sender):
    now = datetime.now()
    history = command_history[sender]
    
    # Clean old entries
    history = [t for t in history if now - t < timedelta(hours=1)]
    
    if len(history) >= RATE_LIMIT:
        # Alert you of potential attack
        send_alert_sms(f"Rate limit hit from {sender}")
        return False
    
    history.append(now)
    command_history[sender] = history
    return True
```

## Layer 6: Command Restrictions

```python
# Different security levels
SAFE_COMMANDS = ['status', 'list', 'help']
WORK_COMMANDS = ['hire', 'assign', 'work']  
DANGEROUS_COMMANDS = ['fire', 'delete', 'reset', 'deploy']

def authorize_command(command, auth_level):
    if command in SAFE_COMMANDS:
        return True  # Anyone can check status
    
    if command in WORK_COMMANDS:
        return auth_level >= 'verified'
    
    if command in DANGEROUS_COMMANDS:
        return auth_level == 'owner' and has_valid_pin()
```

## Recommended Production Setup

```python
# Three-tier security
class SecureSwitchboard:
    def __init__(self):
        self.allowed_numbers = ['+1234567890']
        self.daily_pin = self.generate_pin()
        self.rate_limiter = RateLimiter()
    
    def handle_sms(self, request):
        sender = request.form['From']
        body = request.form['Body']
        
        # Tier 1: Number check
        if sender not in self.allowed_numbers:
            self.log_intrusion(sender, body)
            return self.silent_fail()
        
        # Tier 2: Rate limit
        if not self.rate_limiter.check(sender):
            self.alert_owner("Rate limit exceeded")
            return self.error_response("Too many requests")
        
        # Tier 3: Command authorization
        command = self.parse_command(body)
        
        if self.is_dangerous(command):
            if not self.verify_pin(body):
                self.alert_owner(f"Failed PIN for: {command}")
                return self.error_response("Invalid PIN")
        
        # Execute
        return self.execute(command)
```

## For Demo/Development

```python
# Simple but reasonable
DEV_MODE = os.environ.get('DEV_MODE', False)

if DEV_MODE:
    # Allow any number, log everything
    ALLOWED_NUMBERS = None
    print("⚠️ DEV MODE - No auth required")
else:
    # Production: strict
    ALLOWED_NUMBERS = [os.environ['MY_PHONE']]
    require_pin_for_destructive = True
```

## The Tradeoff

**Maximum Security**: 
- Twilio Verify for every command
- HMAC signatures
- Hardware token
- ✅ Unbreakable
- ❌ Annoying to use

**Reasonable Security**:
- Phone allowlist
- PIN for dangerous commands  
- Rate limiting
- ✅ Practical
- ✅ Stops 99% of attacks

**Demo Security**:
- Just phone allowlist
- ✅ Simple
- ✅ Good enough for demo
- ⚠️ Can be spoofed

## Recommendation

For your demo: **Phone allowlist + rate limiting**
For production: **Phone allowlist + PIN + Twilio Verify for dangerous commands**
For enterprise: **Everything above + audit logs + 2FA**

The key insight: Even basic security stops opportunistic attacks. Perfect security isn't needed for a demo, and you can always add more layers later.