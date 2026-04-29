# 📇 CRM Contact Manager

> A Slack bot that turns messages and business card photos into Monday.com contacts — powered by Claude AI.

---

## ✨ How it works

Send a message (or photo) in Slack — the bot handles the rest.

```
You:  "Met Sarah Johnson, VP of Sales at TechCorp — sarah@techcorp.com, 555-1234"

Bot:  📋 Contact Found
      ─────────────────────────
      Name     Sarah Johnson
      Title    VP of Sales
      Company  TechCorp
      Email    sarah@techcorp.com
      Phone    555-1234
      ─────────────────────────
      Add to Monday.com? yes · no · edit
```

**Under the hood:**

```
Slack Message
     │
     ▼
API Gateway  ──▶  Lambda Function
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       Bedrock      DynamoDB       S3
     (Claude AI)  (temp storage) (images)
          │
          ▼
      Monday.com
```

1. You send a message or upload a business card photo in Slack
2. Claude AI reads it and pulls out the contact details
3. The bot shows you a preview — approve, reject, or edit
4. On approval, the contact lands in your Monday.com board

---

## 🚀 Getting started

### Prerequisites

| Tool                      | Notes                             |
| ------------------------- | --------------------------------- |
| **AWS CLI**         | Configured with `aws configure` |
| **Node.js 22+**     | [nodejs.org](https://nodejs.org)     |
| **AWS CDK**         | `npm install -g aws-cdk`        |
| **Slack workspace** | With permission to create apps    |
| **Monday.com**      | With API access                   |

---

### 1 · Deploy to AWS

```bash
cd agents/crm-contact-manager/cdk
npm install
cdk bootstrap        # first time only — sets up CDK in your AWS account
npm run build
cdk deploy
```

> 💡 Save the **API Gateway URL** printed at the end — you'll need it in the next steps.

---

### 2 · Set environment variables

In the **AWS Lambda Console**, find `CrmContactManager-SlackHandler` → Configuration → Environment variables:

| Variable                 | Where to get it                                          |
| ------------------------ | -------------------------------------------------------- |
| `SLACK_BOT_TOKEN`      | Slack app → OAuth & Permissions → Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | Slack app → Basic Information → Signing Secret         |
| `MONDAY_API_TOKEN`     | Monday.com → Avatar → Developers → My Access Tokens   |
| `MONDAY_BOARD_ID`      | The number in your board's URL:`/boards/1234567890`    |

**Setting up Slack:** Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → add these bot token scopes:
`chat:write` · `files:read` · `channels:history` · `groups:history` · `im:history` · `mpim:history`

---

### 3 · Connect Slack to your API

In your Slack app settings → **Event Subscriptions**:

- Toggle **Enable Events** on
- Set the Request URL to your API Gateway URL + `/slack/events`
- Subscribe to bot events: `message.channels` · `message.groups` · `message.im` · `message.mpim`
- Save and reinstall the app when prompted

---

### 4 · Try it out

```
/invite @CRM Contact Manager
```

Then drop a message with contact info. Reply `yes` to save, `no` to discard, or `edit email to new@example.com` to tweak a field before saving.

Business cards work too — just upload a photo and the bot will read it.

---

## 🔧 Troubleshooting

**Bot not responding?**

```bash
aws logs tail /aws/lambda/CrmContactManager-SlackHandler --follow
```

| Symptom               | Likely cause                                                  |
| --------------------- | ------------------------------------------------------------- |
| `Invalid signature` | Wrong `SLACK_SIGNING_SECRET`                                |
| No response at all    | Missing env vars or Slack events not configured               |
| Monday.com error      | Token doesn't have board access, or wrong `MONDAY_BOARD_ID` |
| Lambda timeout        | Increase timeout to 60s in the Lambda console                 |

---

`</div>`
