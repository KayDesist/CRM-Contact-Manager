import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SlackHandlerLambdaProps {
  contactsTable: dynamodb.Table;
  finalStatusTable: dynamodb.Table;
  imageBucket: s3.Bucket;
}

export class SlackHandlerLambda extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: SlackHandlerLambdaProps) {
    super(scope, id);

    const region = cdk.Stack.of(this).region;
    const account = cdk.Stack.of(this).account;

    this.function = new lambda.Function(this, "Function", {
      functionName: "CrmContactManager-SlackHandler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../../lambda/slack-handler"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: [
              "bash",
              "-c",
              [
                "npm install",
                "npm install -g esbuild",
                "esbuild index.ts --bundle --platform=node --target=node22 --external:'@aws-sdk/*' --sourcemap --outfile=/asset-output/index.js",
              ].join(" && "),
            ],
            user: "root",
          },
        },
      ),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        CONTACTS_TABLE: props.contactsTable.tableName,
        FINAL_STATUS_TABLE: props.finalStatusTable.tableName,
        IMAGE_BUCKET: props.imageBucket.bucketName,
        NODE_OPTIONS: "--enable-source-maps",
      },
    });

    props.contactsTable.grantReadWriteData(this.function);
    props.finalStatusTable.grantReadWriteData(this.function);
    props.imageBucket.grantReadWrite(this.function);

    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: [
          "arn:aws:bedrock:*::foundation-model/*",
          `arn:aws:bedrock:${region}:${account}:inference-profile/*`,
        ],
      }),
    );

    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "textract:DetectDocumentText",
          "textract:AnalyzeDocument",
          "textract:StartDocumentAnalysis",
          "textract:GetDocumentAnalysis",
        ],
        resources: ["*"],
      }),
    );

    new cdk.CfnOutput(this, "FunctionName", {
      value: this.function.functionName,
    });
  }
}
