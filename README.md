# CRM Contact Manager - Slack Bot

A serverless Slack bot that uses AI to extract contact information from messages and business cards, then saves them to Monday.com. Built with AWS CDK, Lambda, and Amazon Bedrock (Claude AI).

## 📋 Table of Contents
- [Project Overview](#project-overview)
- [Infrastructure as Code (CDK)](#infrastructure-as-code-cdk)
- [Code Architecture](#code-architecture)
- [Deployment Guide](#deployment-guide)

---

## 🎯 Project Overview

### What This Bot Does

1. **Receives messages** in Slack (text or images like business cards)
2. **Extracts contact info** using Claude AI (Amazon Bedrock)
3. **Shows a preview** and lets users approve, reject, or edit
4. **Sends approved contacts** to Monday.com CRM

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                            AWS CLOUD                                │
│                                                                     │
│  ┌──────────────┐      ┌─────────────────────────────────────┐   │
│  │              │      │                                       │   │
│  │ API Gateway  │──────│  Lambda Function                     │   │
│  │ (REST API)   │      │  (Node.js 22 / ARM64)                │   │
│  │              │      │                                       │   │
│  └──────┬───────┘      │  • Slack event handler                │   │
│         │              │  • AI extraction logic                │   │
│         │              │  • Contact state management          │   │
│         │              │                                       │   │
│         │              └────────┬────┬────────┬───────────────┘   │
│         │                       │    │        │                    │
│  ┌──────▼───────────────────────▼────▼────────▼───────────────┐  │
│  │                                                              │  │
│  │  AWS Services Used by Lambda:                               │  │
│  │                                                              │  │
│  │  ┌────────────────┐  ┌──────────────┐  ┌────────────────┐ │  │
│  │  │   DynamoDB     │  │   Bedrock    │  │      S3        │ │  │
│  │  │                │  │              │  │                │ │  │
│  │  │ • ContactsTable│  │ Claude Sonnet│  │ Image Storage  │ │  │
│  │  │ • StatusTable  │  │ (AI Model)   │  │ (temporary)    │ │  │
│  │  └────────────────┘  └──────────────┘  └────────────────┘ │  │
│  │                                                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
         ▲                                              │
         │                                              │
         │ Webhook Events                               │ GraphQL API
         │                                              │
    ┌────┴──────┐                                  ┌────▼──────────┐
    │           │                                  │               │
    │   Slack   │                                  │  Monday.com   │
    │           │                                  │   (CRM)       │
    └───────────┘                                  └───────────────┘
```

### Data Flow Step-by-Step

1. **User sends message** to Slack with contact info or uploads a business card image
2. **Slack forwards event** to API Gateway webhook
3. **API Gateway triggers** Lambda function
4. **Lambda verifies** the request is from Slack (signature validation)
5. **Lambda extracts contact** info using Claude AI:
   - For text: Natural language processing
   - For images: Claude Vision analyzes the business card
6. **Lambda saves contact** to DynamoDB (temporary, 24hr TTL)
7. **Lambda sends preview** back to Slack with approve/reject/edit options
8. **User responds** with "yes", "no", or "edit [field] to [value]"
9. **If approved**: Lambda sends contact to Monday.com via GraphQL API
10. **Lambda saves final status** to DynamoDB (permanent record)

---

## 🏗️ Infrastructure as Code (CDK)

### What is AWS CDK?

**AWS CDK (Cloud Development Kit)** lets you define cloud infrastructure using programming languages (TypeScript in this case) instead of JSON/YAML templates.

**Benefits:**
- Type safety and autocomplete in your IDE
- Reusable components ("Constructs")
- Familiar programming concepts (classes, loops, conditions)
- Automatically generates CloudFormation templates

### The Stack: How Everything Connects

The main entry point is **`cdk/lib/stacks/CrmContactManagerStack.ts`**:

```typescript
export class CrmContactManagerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Create DynamoDB tables
    const contactsTable = new ContactsTable(this, "ContactsTable");
    const finalStatusTable = new FinalStatusTable(this, "FinalStatusTable");

    // 2. Create S3 bucket
    const imageBucket = new ImageBucket(this, "ImageBucket");

    // 3. Create Lambda function (passes tables and bucket as props)
    const slackHandlerLambda = new SlackHandlerLambda(this, "SlackHandlerLambda", {
      contactsTable: contactsTable.table,
      finalStatusTable: finalStatusTable.table,
      imageBucket: imageBucket.bucket,
    });

    // 4. Create API Gateway (connects to Lambda)
    const slackApiGateway = new SlackApiGateway(this, "SlackApiGateway", {
      slackHandlerFunction: slackHandlerLambda.function,
    });
  }
}
```

### The "Construct" Pattern

Each AWS resource is wrapped in a **Construct** (a reusable component):

#### 1. **ContactsTable** (`cdk/lib/constructs/ContactsTable.ts`)
```typescript
// Creates a DynamoDB table for temporary contact storage
- Primary Key: message_id (Slack message timestamp)
- GSI: UserChannelIndex (for querying pending contacts by user)
- TTL: Auto-deletes contacts after 24 hours if not approved
```

#### 2. **FinalStatusTable** (`cdk/lib/constructs/FinalStatusTable.ts`)
```typescript
// Creates a DynamoDB table for permanent records
- Primary Key: contactId (UUID)
- Stores: Success/failure status, Monday.com item ID, timestamps
- No TTL: Keeps records forever for reporting
```

#### 3. **ImageBucket** (`cdk/lib/constructs/ImageBucket.ts`)
```typescript
// Creates an S3 bucket for temporary image storage
- Lifecycle rule: Auto-deletes files after 1 day
- Used for: Downloading business card images from Slack
```

#### 4. **SlackHandlerLambda** (`cdk/lib/constructs/SlackHandlerLambda.ts`)
```typescript
// Creates the Lambda function that runs your bot code
- Runtime: Node.js 22 on ARM64 (faster & cheaper)
- Memory: 512 MB
- Timeout: 60 seconds
- Bundles TypeScript code with esbuild
- Grants permissions: DynamoDB read/write, S3 read/write, Bedrock invoke
```

#### 5. **SlackApiGateway** (`cdk/lib/constructs/SlackApiGateway.ts`)
```typescript
// Creates REST API endpoint for Slack to call
- Endpoint: POST /slack/events
- Integrates directly with Lambda
- Returns URL you configure in Slack app settings
```

### How CDK Creates Real AWS Resources

When you run `cdk deploy`:

1. **Synthesizes** your TypeScript code into CloudFormation JSON
2. **Uploads** Lambda code bundle to S3
3. **Creates/updates** AWS resources in order:
   - DynamoDB tables
   - S3 bucket
   - IAM roles and policies
   - Lambda function
   - API Gateway
4. **Outputs** the API Gateway URL you need for Slack

---

## 🔧 Code Architecture

### Project Structure

```
agents/crm-contact-manager/
├── cdk/
│   ├── bin/
│   │   └── app.ts                    # CDK app entry point
│   ├── lib/
│   │   ├── stacks/
│   │   │   └── CrmContactManagerStack.ts  # Main stack
│   │   └── constructs/
│   │       ├── ContactsTable.ts      # DynamoDB for temp contacts
│   │       ├── FinalStatusTable.ts   # DynamoDB for final records
│   │       ├── ImageBucket.ts        # S3 bucket
│   │       ├── SlackHandlerLambda.ts # Lambda function
│   │       └── SlackApiGateway.ts    # API Gateway
│   ├── lambda/
│   │   └── slack-handler/
│   │       ├── index.ts              # Main Lambda handler
│   │       ├── types.ts              # TypeScript types
│   │       ├── BedrockExtractor.ts   # AI extraction logic
│   │       ├── ContactStorage.ts     # DynamoDB operations
│   │       ├── SlackClient.ts        # Slack API calls
│   │       └── MondayClient.ts       # Monday.com API calls
│   ├── package.json
│   └── tsconfig.json
└── README.md (this file)
```

### Lambda Function Files

#### **`index.ts`** - The Brain 🧠

The main Lambda handler that orchestrates everything:

```typescript
export const handler = async (event: APIGatewayProxyEvent) => {
  // 1. Parse incoming request from API Gateway
  const body = JSON.parse(event.body || "{}");

  // 2. Handle Slack URL verification (one-time setup)
  if (body.type === "url_verification") {
    return { statusCode: 200, body: body.challenge };
  }

  // 3. Verify request signature (security)
  if (!verifySlackRequest(event)) {
    return { statusCode: 401, body: "Invalid signature" };
  }

  // 4. Process the message
  await handleSlackMessage(body.event);

  return { statusCode: 200, body: "OK" };
};
```

**Key Functions:**

- **`handleSlackMessage()`**: Routes messages based on state
  - Checks if user has a pending contact
  - If yes: Handle approve/reject/edit response
  - If no: Extract new contact from message

#### **`BedrockExtractor.ts`** - The AI 🤖

Uses Amazon Bedrock to call Claude AI:

```typescript
// Extract contact from text
export async function extractContactInfo(text: string): Promise<ContactInfo | null> {
  // Sends text to Claude with a detailed prompt
  // Claude returns JSON with firstName, lastName, email, phone, etc.
}

// Extract contact from business card image
export async function extractContactFromVision(fileUrl: string): Promise<ContactInfo | null> {
  // Downloads image from Slack
  // Sends image to Claude Vision
  // Claude analyzes the card and returns structured data
}

// Understand edit commands
export async function extractEditRequest(text: string): Promise<EditRequest | null> {
  // Examples: "edit email to john@example.com"
  // Claude extracts: { field: "email", value: "john@example.com" }
}
```

**Why Claude?** It can:
- Understand natural language ("Met John from Acme Corp")
- Read business cards (even with complex layouts)
- Handle ambiguity (inferring priority from job titles)
- Parse edit commands in plain English

#### **`ContactStorage.ts`** - The Memory 💾

All DynamoDB operations:

```typescript
// Save new contact (temporary, 24hr TTL)
await saveContact(messageId, contactData);

// Get pending contact for a user
const pending = await getPendingContactForUser(userId, channel);

// Update contact fields
await updateContact(messageId, { email: "new@email.com" });

// Delete contact (after approval/rejection)
await deleteContact(messageId);

// Save final status (permanent record)
await saveFinalStatus(contact, mondayItemId, userId, "SUCCESS");
```

**Why Two Tables?**
- **ContactsTable**: Temporary working memory (pending approvals)
- **FinalStatusTable**: Permanent audit log (what was processed)

#### **`SlackClient.ts`** - The Messenger 💬

Handles all Slack communication:

```typescript
// Send a message to Slack
await sendSlackMessage(channel, blocks, "Preview");

// Create contact preview (uses Slack Block Kit)
const blocks = createContactPreviewBlocks(contact);

// Create success message
const blocks = createSuccessBlocks("John Smith");

// Create error message
const blocks = createErrorBlocks("API error");
```

**Slack Block Kit**: JSON-based UI framework for rich messages (buttons, fields, dividers)

#### **`MondayClient.ts`** - The CRM Bridge 📊

Sends contacts to Monday.com:

```typescript
export async function sendToMonday(contact: ContactInfo): Promise<string> {
  // 1. Build column values object
  const columnValues = {
    first_name__1: contact.firstName,
    last_name__1: contact.lastName,
    contact_email: { email: contact.email },
    contact_phone: { phone: cleanPhone, countryShortName: "US" },
    status: { label: "Lead" },
    // ... more fields
  };

  // 2. Build GraphQL mutation
  const mutation = `mutation {
    create_item(
      board_id: ${MONDAY_BOARD_ID},
      item_name: "${fullName}",
      column_values: ${JSON.stringify(columnValues)}
    ) { id }
  }`;

  // 3. Send to Monday.com API
  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { Authorization: MONDAY_API_TOKEN },
    body: JSON.stringify({ query: mutation }),
  });

  return itemId;
}
```

#### **`types.ts`** - The Contracts 📝

TypeScript interfaces for type safety:

```typescript
// Contact information structure
export interface ContactInfo {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  priority?: string;
  linkedin?: string;
  notes?: string;
}

// Stored contact with metadata
export interface StoredContact extends ContactInfo {
  message_id: string;
  channel: string;
  user_id: string;
  status: "pending" | "editing" | "approved" | "rejected";
  ttl: number;
  created_at: string;
  updated_at: string;
}

// Slack event structure
export interface SlackEvent {
  type: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  files?: SlackFile[];
}
```

### AWS Service Interactions

#### DynamoDB Operations
```typescript
// Query by user + channel (uses GSI)
await dynamodb.send(new QueryCommand({
  TableName: CONTACTS_TABLE,
  IndexName: "UserChannelIndex",
  KeyConditionExpression: "user_id = :userId AND channel = :channel"
}));

// Get item by primary key
await dynamodb.send(new GetCommand({
  TableName: CONTACTS_TABLE,
  Key: { message_id: messageId }
}));

// Update specific fields
await dynamodb.send(new UpdateCommand({
  TableName: CONTACTS_TABLE,
  Key: { message_id: messageId },
  UpdateExpression: "SET email = :email",
  ExpressionAttributeValues: { ":email": "new@example.com" }
}));
```

#### Bedrock (Claude AI) API
```typescript
const response = await bedrockClient.send(new ConverseCommand({
  modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  messages: [{
    role: "user",
    content: [{ text: userMessage }]
  }],
  inferenceConfig: {
    maxTokens: 2000,
    temperature: 0.7
  }
}));
```

#### S3 Operations
```typescript
// Upload file
await s3Client.send(new PutObjectCommand({
  Bucket: IMAGE_BUCKET,
  Key: `business-cards/${uuid}.jpg`,
  Body: imageBuffer
}));

// Files auto-delete after 1 day (lifecycle policy)
```

---

## 🚀 Deployment Guide

### Prerequisites

Before you begin, make sure you have:

- [ ] **AWS Account** with appropriate permissions
- [ ] **AWS CLI** configured (`aws configure`)
- [ ] **Node.js 22+** installed
- [ ] **AWS CDK** installed globally (`npm install -g aws-cdk`)
- [ ] **Slack Workspace** (with permission to create apps)
- [ ] **Monday.com Account** (with API access)

### Step 1: Clone and Install

```bash
# Navigate to the project
cd agents/crm-contact-manager/cdk

# Install dependencies
npm install
```

### Step 2: Bootstrap CDK (First Time Only)

If this is your first time using CDK in this AWS account/region:

```bash
# Bootstrap CDK (creates S3 bucket for CDK assets)
cdk bootstrap

# Expected output:
# ✅ Environment aws://ACCOUNT-ID/REGION bootstrapped
```

### Step 3: Deploy Infrastructure

```bash
# Build TypeScript
npm run build

# Preview changes (optional)
cdk diff

# Deploy stack
cdk deploy

# Expected output:
# ✨ Deployment time: 120s
# Outputs:
# CrmContactManagerStack.ApiGatewayUrl = https://abc123.execute-api.us-east-2.amazonaws.com/prod/
```

**Save the API Gateway URL** - you'll need it for Slack!

### Step 4: Configure Lambda Environment Variables

After deployment, you need to set environment variables in the Lambda console:

1. Go to **AWS Lambda Console** → Find function `CrmContactManager-SlackHandler`
2. Go to **Configuration** → **Environment variables** → **Edit**
3. Add these variables:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
MONDAY_API_TOKEN=your-monday-api-token-here
MONDAY_BOARD_ID=1234567890
```

**How to get these values:**

#### Slack Variables

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it "CRM Contact Manager" and select your workspace
4. Go to **OAuth & Permissions**:
   - Add **Bot Token Scopes**: `chat:write`, `files:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`
   - Click **Install to Workspace**
   - Copy the **Bot User OAuth Token** (`xoxb-...`)
5. Go to **Basic Information**:
   - Copy the **Signing Secret**

#### Monday.com Variables

1. Go to Monday.com → Your avatar → **Developers**
2. Click **My Access Tokens** → **Generate**
3. Copy the token
4. Open your CRM board → Copy the board ID from the URL:
   - URL: `https://company.monday.com/boards/1234567890`
   - Board ID: `1234567890`

### Step 5: Configure Slack App

1. Go back to your Slack app settings at [api.slack.com/apps](https://api.slack.com/apps)
2. Go to **Event Subscriptions**:
   - **Enable Events**: Toggle ON
   - **Request URL**: Paste your API Gateway URL from Step 3
     - Example: `https://abc123.execute-api.us-east-2.amazonaws.com/prod/slack/events`
   - Slack will verify the URL (should show ✅)
   - Under **Subscribe to bot events**, add:
     - `message.channels`
     - `message.groups`
     - `message.im`
     - `message.mpim`
   - Click **Save Changes**

3. **Reinstall your app** (Slack will prompt you since permissions changed)

### Step 6: Test the Bot

1. **Invite the bot** to a Slack channel:
   ```
   /invite @CRM Contact Manager
   ```

2. **Send a test message**:
   ```
   Met Sarah Johnson, VP of Sales at TechCorp
   Email: sarah@techcorp.com
   Phone: 555-1234
   ```

3. **Bot should respond** with a contact preview:
   ```
   Contact Information Found

   First Name: Sarah
   Last Name: Johnson
   Email: sarah@techcorp.com
   Phone: 555-1234
   Company: TechCorp
   Title: VP of Sales

   Should I add this to Monday.com?
   Type: yes | no | edit
   ```

4. **Type "yes"** and the contact should appear in Monday.com!

### Step 7: Test Business Card Upload

1. Upload a business card image to Slack
2. Bot should extract info using Claude Vision
3. Same approve/reject flow

### Troubleshooting

#### "Invalid signature" error

- Check `SLACK_SIGNING_SECRET` is correct
- Make sure timestamp isn't too old (>5 min)

#### "No response from bot"

1. Check Lambda logs in CloudWatch:
   ```bash
   aws logs tail /aws/lambda/CrmContactManager-SlackHandler --follow
   ```

2. Common issues:
   - Missing environment variables
   - Slack event permissions not configured
   - Lambda timeout (increase to 60 seconds)

#### "Monday.com error"

- Verify `MONDAY_API_TOKEN` has access to the board
- Check `MONDAY_BOARD_ID` is correct
- Ensure column IDs match (e.g., `first_name__1`)

#### Debugging with CloudWatch Logs

```bash
# View recent logs
aws logs tail /aws/lambda/CrmContactManager-SlackHandler --since 1h

# Filter for errors
aws logs tail /aws/lambda/CrmContactManager-SlackHandler --filter-pattern "ERROR"
```

### Updating the Code

After making changes:

```bash
# Rebuild and redeploy
npm run build
cdk deploy

# Or use watch mode during development
npm run watch
```

### Cleaning Up

To delete all resources:

```bash
cdk destroy

# Confirm with 'y'
```

This will delete:
- Lambda function
- API Gateway
- DynamoDB tables (and all data)
- S3 bucket (after emptying)
- IAM roles

---

## 🎓 What You're Learning

By working with this project, you'll gain hands-on experience with:

### AWS Services
- **Lambda**: Event-driven serverless compute
- **API Gateway**: RESTful API endpoints
- **DynamoDB**: NoSQL database with GSI and TTL
- **S3**: Object storage with lifecycle policies
- **Bedrock**: Managed AI/ML services
- **IAM**: Permissions and security policies
- **CloudWatch**: Logging and monitoring

### Development Concepts
- **Infrastructure as Code**: Managing cloud resources with code
- **Serverless Architecture**: Building apps without managing servers
- **Event-driven Design**: Responding to webhooks and async events
- **State Management**: Tracking multi-step workflows
- **Natural Language Processing**: Using AI for extraction tasks
- **API Integration**: Connecting multiple external services

### Real-World Skills
- Deploying production applications to AWS
- Working with third-party APIs (Slack, Monday.com)
- Debugging cloud applications with logs
- Handling errors and edge cases gracefully
- Writing maintainable TypeScript code

---

## 📚 Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS Lambda Developer Guide](https://docs.aws.amazon.com/lambda/)
- [Slack API Documentation](https://api.slack.com/)
- [Monday.com API Reference](https://developer.monday.com/api-reference/docs)
- [Amazon Bedrock User Guide](https://docs.aws.amazon.com/bedrock/)

---

## 🤝 Contributing

Found a bug or want to add a feature? Feel free to:
1. Check existing issues
2. Create a new branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

## 📄 License

See [LICENSE](../../LICENSE) file for details.

---

**Happy Learning!** 🚀

If you have questions, check the troubleshooting section or review the CloudWatch logs.
