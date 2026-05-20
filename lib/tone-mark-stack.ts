import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as eventSources from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

export class ToneMarkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:5174",
    ];

    const scoreBucket = new s3.Bucket(this, "ScoreBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins,
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const scoreJobsTable = new dynamodb.Table(this, "ScoreJobsTable", {
      tableName: "score_jobs",
      partitionKey: {
        name: "pk",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "sk",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const omrJobDeadLetterQueue = new sqs.Queue(this, "OmrJobDeadLetterQueue", {
      retentionPeriod: cdk.Duration.days(14),
    });

    const markGenerationDeadLetterQueue = new sqs.Queue(this, "MarkGenerationDeadLetterQueue", {
      retentionPeriod: cdk.Duration.days(14),
    });

    const workerTimeout = cdk.Duration.minutes(15);
    const queueVisibilityTimeout = cdk.Duration.minutes(16);

    const omrJobQueue = new sqs.Queue(this, "OmrJobQueue", {
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: omrJobDeadLetterQueue,
      },
      visibilityTimeout: queueVisibilityTimeout,
    });

    const markGenerationQueue = new sqs.Queue(this, "MarkGenerationQueue", {
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: markGenerationDeadLetterQueue,
      },
      visibilityTimeout: queueVisibilityTimeout,
    });

    const apiFunction = new NodejsFunction(this, "ApiFunction", {
      entry: path.join(projectRoot, "lambda/api/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: new logs.LogGroup(this, "ApiFunctionLogGroup", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        SCORE_BUCKET_NAME: scoreBucket.bucketName,
        SCORE_JOBS_TABLE_NAME: scoreJobsTable.tableName,
        OMR_JOB_QUEUE_URL: omrJobQueue.queueUrl,
        MARK_GENERATION_QUEUE_URL: markGenerationQueue.queueUrl,
      },
      bundling: {
        externalModules: [],
        target: "node24",
      },
    });

    const workerFunction = new lambda.DockerImageFunction(this, "WorkerFunction", {
      architecture: lambda.Architecture.ARM_64,
      code: lambda.DockerImageCode.fromImageAsset(path.join(projectRoot, "lambda/worker")),
      timeout: workerTimeout,
      memorySize: 3072,
      ephemeralStorageSize: cdk.Size.gibibytes(10),
      logGroup: new logs.LogGroup(this, "WorkerFunctionLogGroup", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        SCORE_BUCKET_NAME: scoreBucket.bucketName,
        SCORE_JOBS_TABLE_NAME: scoreJobsTable.tableName,
        OMR_JOB_QUEUE_URL: omrJobQueue.queueUrl,
        MARK_GENERATION_QUEUE_URL: markGenerationQueue.queueUrl,
      },
    });

    workerFunction.addEventSource(
      new eventSources.SqsEventSource(omrJobQueue, {
        batchSize: 1,
      }),
    );
    workerFunction.addEventSource(
      new eventSources.SqsEventSource(markGenerationQueue, {
        batchSize: 1,
      }),
    );

    scoreBucket.grantReadWrite(apiFunction);
    scoreBucket.grantReadWrite(workerFunction);
    scoreJobsTable.grantReadWriteData(apiFunction);
    scoreJobsTable.grantReadWriteData(workerFunction);
    omrJobQueue.grantSendMessages(apiFunction);
    markGenerationQueue.grantSendMessages(apiFunction);
    omrJobQueue.grantConsumeMessages(workerFunction);
    markGenerationQueue.grantConsumeMessages(workerFunction);

    const apiIntegration = new HttpLambdaIntegration("ApiIntegration", apiFunction);
    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: "tone-mark-api",
      defaultIntegration: apiIntegration,
      corsPreflight: {
        allowHeaders: ["content-type", "authorization"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: allowedOrigins,
      },
    });

    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: httpApi.apiEndpoint,
    });
    new cdk.CfnOutput(this, "ScoreBucketName", {
      value: scoreBucket.bucketName,
    });
    new cdk.CfnOutput(this, "ScoreJobsTableName", {
      value: scoreJobsTable.tableName,
    });
    new cdk.CfnOutput(this, "OmrJobQueueUrl", {
      value: omrJobQueue.queueUrl,
    });
    new cdk.CfnOutput(this, "MarkGenerationQueueUrl", {
      value: markGenerationQueue.queueUrl,
    });
  }
}
