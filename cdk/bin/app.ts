import * as cdk from "aws-cdk-lib";
import { CrmContactManagerStack } from "../lib/stacks/CrmContactManagerStack.js";

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || "us-east-2";

new CrmContactManagerStack(app, "CrmContactManagerStack", {
  env: account && region ? { account, region } : undefined,
  description:
    "CRM Contact Manager - AI-powered Slack bot for extracting and managing contact information",
  tags: {
    Project: "CrmContactManager",
    ManagedBy: "CDK",
    Application: "SlackBot",
    Environment: process.env.ENVIRONMENT || "production",
  },
});

app.synth();
