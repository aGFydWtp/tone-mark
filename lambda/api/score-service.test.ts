import assert from "node:assert/strict";
import test from "node:test";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createAwsScoreService } from "./score-service.js";

test("createUploadUrl writes created item and returns upload URL", async () => {
  const sentCommands: object[] = [];
  const dynamoClient = createRecordingClient(sentCommands);
  const service = createAwsScoreService({
    bucketName: "scores-bucket",
    tableName: "score_jobs",
    omrQueueUrl: "https://sqs.example.com/omr",
    dynamoClient,
    sqsClient: createRecordingClient([]),
    signUrl: async () => "https://example.com/upload",
    now: () => new Date("2026-05-20T12:45:30.000Z"),
  });

  const result = await service.createUploadUrl({
    filename: "score.pdf",
    content_type: "application/pdf",
  });

  assert.equal(result.ok, true);
  assert.match(result.ok ? result.value.score_id : "", /^score_20260520124530_[a-f0-9]{12}$/);
  assert.match(
    result.ok ? result.value.object_key : "",
    /^scores\/score_20260520124530_[a-f0-9]{12}\/original\.pdf$/,
  );
  assert.equal(result.ok ? result.value.upload_url : "", "https://example.com/upload");
  assert.equal(sentCommands.length, 1);
  assert.ok(sentCommands[0] instanceof PutCommand);
});

test("createScoreJob updates queued status and sends SQS message", async () => {
  const dynamoCommands: object[] = [];
  const sqsCommands: object[] = [];
  const service = createAwsScoreService({
    bucketName: "scores-bucket",
    tableName: "score_jobs",
    omrQueueUrl: "https://sqs.example.com/omr",
    dynamoClient: createRecordingClient(dynamoCommands),
    sqsClient: createRecordingClient(sqsCommands),
    signUrl: async () => "https://example.com/upload",
    now: () => new Date("2026-05-20T12:45:30.000Z"),
  });

  const result = await service.createScoreJob({
    score_id: "score_20260520124530_a1b2c3d4e5f6",
    original_key: "scores/score_20260520124530_a1b2c3d4e5f6/original.pdf",
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      score_id: "score_20260520124530_a1b2c3d4e5f6",
      status: "queued",
    },
  });
  assert.equal(dynamoCommands.length, 1);
  assert.ok(dynamoCommands[0] instanceof UpdateCommand);
  assert.equal(sqsCommands.length, 1);
  assert.ok(sqsCommands[0] instanceof SendMessageCommand);
});

test("getScoreJob reads DynamoDB item", async () => {
  const sentCommands: object[] = [];
  const service = createAwsScoreService({
    bucketName: "scores-bucket",
    tableName: "score_jobs",
    omrQueueUrl: "https://sqs.example.com/omr",
    dynamoClient: {
      async send(command) {
        sentCommands.push(command);
        return {
          Item: {
            pk: "SCORE#score_1",
            sk: "META",
            score_id: "score_1",
            status: "created",
            original_key: "scores/score_1/original.pdf",
            created_at: "2026-05-20T00:00:00.000Z",
            updated_at: "2026-05-20T00:00:00.000Z",
          },
        };
      },
    },
    sqsClient: createRecordingClient([]),
    signUrl: async () => "https://example.com/upload",
  });

  const result = await service.getScoreJob("score_1");

  assert.equal(result?.score_id, "score_1");
  assert.equal(sentCommands.length, 1);
  assert.ok(sentCommands[0] instanceof GetCommand);
});

test("createUploadUrl passes content type to S3 presigner command", async () => {
  const service = createAwsScoreService({
    bucketName: "scores-bucket",
    tableName: "score_jobs",
    omrQueueUrl: "https://sqs.example.com/omr",
    dynamoClient: createRecordingClient([]),
    sqsClient: createRecordingClient([]),
    signUrl: async (_client, command) => {
      assert.ok(command instanceof PutObjectCommand);
      assert.equal(command.input.ContentType, "image/png");
      assert.equal(command.input.Bucket, "scores-bucket");
      return "https://example.com/upload";
    },
    now: () => new Date("2026-05-20T12:45:30.000Z"),
  });

  const result = await service.createUploadUrl({
    filename: "score.png",
    content_type: "image/png",
  });

  assert.equal(result.ok, true);
});

function createRecordingClient(commands: object[]) {
  return {
    async send(command: object) {
      commands.push(command);
      return {};
    },
  };
}
