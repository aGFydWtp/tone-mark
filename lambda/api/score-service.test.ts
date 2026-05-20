import assert from "node:assert/strict";
import test from "node:test";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
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

test("createMusicXmlDownloadUrl signs existing MusicXML object", async () => {
  const service = createAwsScoreService({
    bucketName: "scores-bucket",
    tableName: "score_jobs",
    omrQueueUrl: "https://sqs.example.com/omr",
    dynamoClient: {
      async send(command) {
        assert.ok(command instanceof GetCommand);
        return {
          Item: {
            pk: "SCORE#score_1",
            sk: "META",
            score_id: "score_1",
            status: "needs_review",
            original_key: "scores/score_1/original.pdf",
            musicxml_key: "scores/score_1/result.musicxml",
            created_at: "2026-05-20T00:00:00.000Z",
            updated_at: "2026-05-20T00:00:00.000Z",
          },
        };
      },
    },
    sqsClient: createRecordingClient([]),
    signUrl: async (_client, command, options) => {
      assert.ok(command instanceof GetObjectCommand);
      assert.equal(command.input.Bucket, "scores-bucket");
      assert.equal(command.input.Key, "scores/score_1/result.musicxml");
      assert.equal(options.expiresIn, 900);
      return "https://example.com/musicxml";
    },
  });

  const result = await service.createMusicXmlDownloadUrl("score_1");

  assert.deepEqual(result, {
    ok: true,
    value: {
      score_id: "score_1",
      musicxml_key: "scores/score_1/result.musicxml",
      download_url: "https://example.com/musicxml",
      expires_in: 900,
    },
  });
});

test("createMusicXmlDownloadUrl returns missing MusicXML error when key is absent", async () => {
  const service = createAwsScoreService({
    bucketName: "scores-bucket",
    tableName: "score_jobs",
    omrQueueUrl: "https://sqs.example.com/omr",
    dynamoClient: {
      async send() {
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
    signUrl: async () => "https://example.com/musicxml",
  });

  const result = await service.createMusicXmlDownloadUrl("score_1");

  assert.deepEqual(result, {
    ok: false,
    error: "MusicXML not found.",
  });
});

test("putMusicXml writes S3 object and updates DynamoDB status", async () => {
  const dynamoCommands: object[] = [];
  const s3Commands: object[] = [];
  const service = createAwsScoreService({
    bucketName: "scores-bucket",
    tableName: "score_jobs",
    omrQueueUrl: "https://sqs.example.com/omr",
    s3Client: createRecordingClient(s3Commands) as never,
    dynamoClient: {
      async send(command) {
        dynamoCommands.push(command);
        if (command instanceof GetCommand) {
          return {
            Item: {
              pk: "SCORE#score_1",
              sk: "META",
              score_id: "score_1",
              status: "needs_review",
              original_key: "scores/score_1/original.pdf",
              created_at: "2026-05-20T00:00:00.000Z",
              updated_at: "2026-05-20T00:00:00.000Z",
            },
          };
        }
        return {};
      },
    },
    sqsClient: createRecordingClient([]),
    signUrl: async () => "https://example.com/upload",
    now: () => new Date("2026-05-20T12:45:30.000Z"),
  });

  const result = await service.putMusicXml(
    "score_1",
    '<?xml version="1.0"?><score-partwise version="4.0"></score-partwise>',
  );

  assert.deepEqual(result, {
    ok: true,
    value: {
      score_id: "score_1",
      status: "needs_review",
      musicxml_key: "scores/score_1/result.musicxml",
    },
  });
  assert.equal(s3Commands.length, 1);
  assert.ok(s3Commands[0] instanceof PutObjectCommand);
  assert.equal((s3Commands[0] as PutObjectCommand).input.Key, "scores/score_1/result.musicxml");
  assert.equal(dynamoCommands.length, 2);
  assert.ok(dynamoCommands[0] instanceof GetCommand);
  assert.ok(dynamoCommands[1] instanceof UpdateCommand);
});

test("putMusicXml rejects invalid MusicXML before writing", async () => {
  const dynamoCommands: object[] = [];
  const s3Commands: object[] = [];
  const service = createAwsScoreService({
    bucketName: "scores-bucket",
    tableName: "score_jobs",
    omrQueueUrl: "https://sqs.example.com/omr",
    s3Client: createRecordingClient(s3Commands) as never,
    dynamoClient: createRecordingClient(dynamoCommands),
    sqsClient: createRecordingClient([]),
    signUrl: async () => "https://example.com/upload",
  });

  const result = await service.putMusicXml("score_1", "");

  assert.deepEqual(result, {
    ok: false,
    error: "Invalid MusicXML.",
  });
  assert.equal(s3Commands.length, 0);
  assert.equal(dynamoCommands.length, 0);
});

test("analyzeScore reads MusicXML, writes analysis JSON, and updates DynamoDB", async () => {
  const dynamoCommands: object[] = [];
  const s3Commands: object[] = [];
  const musicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Music</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>D</step><alter>1</alter><octave>5</octave></pitch><duration>1</duration></note>
      <note><rest/><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>`;
  const service = createAwsScoreService({
    bucketName: "scores-bucket",
    tableName: "score_jobs",
    omrQueueUrl: "https://sqs.example.com/omr",
    s3Client: {
      async send(command: object) {
        s3Commands.push(command);
        if (command instanceof GetObjectCommand) {
          return {
            Body: {
              async transformToString() {
                return musicXml;
              },
            },
          };
        }

        return {};
      },
    } as never,
    dynamoClient: {
      async send(command) {
        dynamoCommands.push(command);
        if (command instanceof GetCommand) {
          return {
            Item: {
              pk: "SCORE#score_1",
              sk: "META",
              score_id: "score_1",
              status: "needs_review",
              original_key: "scores/score_1/original.pdf",
              musicxml_key: "scores/score_1/result.musicxml",
              created_at: "2026-05-20T00:00:00.000Z",
              updated_at: "2026-05-20T00:00:00.000Z",
            },
          };
        }
        return {};
      },
    },
    sqsClient: createRecordingClient([]),
    signUrl: async () => "https://example.com/upload",
    now: () => new Date("2026-05-20T12:45:30.000Z"),
  });

  const result = await service.analyzeScore("score_1");

  assert.deepEqual(result, {
    ok: true,
    value: {
      score_id: "score_1",
      status: "analyzed",
      notes_json_key: "scores/score_1/notes.json",
      pitch_counts_key: "scores/score_1/pitch_counts.json",
      pitch_counts: {
        C4: 2,
        "D#5": 1,
      },
    },
  });
  assert.equal(s3Commands.length, 3);
  assert.ok(s3Commands[0] instanceof GetObjectCommand);
  assert.ok(s3Commands[1] instanceof PutObjectCommand);
  assert.equal((s3Commands[1] as PutObjectCommand).input.Key, "scores/score_1/notes.json");
  const notesJson = JSON.parse(String((s3Commands[1] as PutObjectCommand).input.Body)) as {
    notes: { part_id?: string }[];
  };
  assert.equal(notesJson.notes.length, 3);
  assert.ok(
    notesJson.notes.every((note) => note.part_id === "P1"),
    "part_id must survive the <part-list> element",
  );
  assert.ok(s3Commands[2] instanceof PutObjectCommand);
  assert.equal((s3Commands[2] as PutObjectCommand).input.Key, "scores/score_1/pitch_counts.json");
  assert.equal(dynamoCommands.length, 2);
  assert.ok(dynamoCommands[0] instanceof GetCommand);
  assert.ok(dynamoCommands[1] instanceof UpdateCommand);
});

test("analyzeScore returns missing MusicXML error when key is absent", async () => {
  const s3Commands: object[] = [];
  const service = createAwsScoreService({
    bucketName: "scores-bucket",
    tableName: "score_jobs",
    omrQueueUrl: "https://sqs.example.com/omr",
    s3Client: createRecordingClient(s3Commands) as never,
    dynamoClient: {
      async send() {
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

  const result = await service.analyzeScore("score_1");

  assert.deepEqual(result, {
    ok: false,
    error: "MusicXML not found.",
  });
  assert.equal(s3Commands.length, 0);
});

function createRecordingClient(commands: object[]) {
  return {
    async send(command: object) {
      commands.push(command);
      return {};
    },
  };
}
