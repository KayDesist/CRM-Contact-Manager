import * as cdk from "aws-cdk-lib";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export interface SlackApiGatewayProps {
  slackHandlerFunction: lambda.Function;
}

export class SlackApiGateway extends Construct {
  public readonly api: apigatewayv2.HttpApi;

  constructor(scope: Construct, id: string, props: SlackApiGatewayProps) {
    super(scope, id);

    const lambdaIntegration = new HttpLambdaIntegration(
      "SlackHandlerIntegration",
      props.slackHandlerFunction,
    );

    this.api = new apigatewayv2.HttpApi(this, "HttpApi", {
      apiName: "CrmContactManager-SlackApi",
      description: "HTTP API for Slack webhook",
    });

    this.api.addRoutes({
      path: "/slack/events",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: lambdaIntegration,
    });

    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: this.api.apiEndpoint,
      description: "HTTP API endpoint",
    });

    new cdk.CfnOutput(this, "WebhookUrl", {
      value: `${this.api.apiEndpoint}/slack/events`,
      description: "Slack webhook URL",
    });
  }
}
