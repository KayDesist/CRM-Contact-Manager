import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { ContactsTable } from "../constructs/ContactsTable.js";
import { FinalStatusTable } from "../constructs/FinalStatusTable.js";
import { ImageBucket } from "../constructs/ImageBucket.js";
import { SlackHandlerLambda } from "../constructs/SlackHandlerLambda.js";
import { SlackApiGateway } from "../constructs/SlackApiGateway.js";

export class CrmContactManagerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //Create DynamoDB tables for storing data
    const contactsTable = new ContactsTable(this, "ContactsTable");
    const finalStatusTable = new FinalStatusTable(this, "FinalStatusTable");

    //Create S3 bucket for temporary image storage
    const imageBucket = new ImageBucket(this, "ImageBucket");

    //Create Lambda function (the bot's brain!)
    const slackHandlerLambda = new SlackHandlerLambda(
      this,
      "SlackHandlerLambda",
      {
        contactsTable: contactsTable.table,
        finalStatusTable: finalStatusTable.table,
        imageBucket: imageBucket.bucket,
      },
    );

    //Create API Gateway (the door Slack knocks on)
    const slackApiGateway = new SlackApiGateway(this, "SlackApiGateway", {
      slackHandlerFunction: slackHandlerLambda.function,
    });

    // Outputs - shown after deployment to help with setup
    new cdk.CfnOutput(this, "StackName", {
      value: this.stackName,
      description: "CDK Stack Name",
    });

    new cdk.CfnOutput(this, "Region", {
      value: this.region,
      description: "AWS Region where resources were deployed",
    });

    new cdk.CfnOutput(this, "NextSteps", {
      value:
        "📚 Next: (1) Set Lambda env vars (2) Configure Slack app (3) Test! See DEPLOYMENT.md",
      description: "Deployment Instructions",
    });
  }
}
