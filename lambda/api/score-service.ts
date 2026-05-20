import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const scoreMetaSortKey = "META";
const uploadUrlExpiresInSeconds = 900;
const musicXmlDownloadUrlExpiresInSeconds = uploadUrlExpiresInSeconds;
const musicXmlContentType = "application/vnd.recordare.musicxml+xml; charset=utf-8";

const contentTypeToExtension = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
} as const;

type AllowedContentType = keyof typeof contentTypeToExtension;

export type CreateUploadUrlInput = {
  filename?: unknown;
  content_type?: unknown;
};

export type CreateScoreJobInput = {
  score_id?: unknown;
  original_key?: unknown;
};

export type ScoreJob = {
  pk: string;
  sk: typeof scoreMetaSortKey;
  score_id: string;
  status: "created" | "queued" | "processing_omr" | "needs_review" | "failed";
  original_key: string;
  musicxml_key?: string;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
};

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type CreateUploadUrlOutput = {
  score_id: string;
  upload_url: string;
  object_key: string;
};

export type CreateScoreJobOutput = {
  score_id: string;
  status: "queued";
};

export type CreateMusicXmlDownloadUrlOutput = {
  score_id: string;
  musicxml_key: string;
  download_url: string;
  expires_in: number;
};

export type PutMusicXmlOutput = {
  score_id: string;
  status: "needs_review";
  musicxml_key: string;
};

export type ScoreService = {
  createUploadUrl(input: CreateUploadUrlInput): Promise<ServiceResult<CreateUploadUrlOutput>>;
  createScoreJob(input: CreateScoreJobInput): Promise<ServiceResult<CreateScoreJobOutput>>;
  getScoreJob(scoreId: string): Promise<ScoreJob | null>;
  createMusicXmlDownloadUrl(
    scoreId: string,
  ): Promise<ServiceResult<CreateMusicXmlDownloadUrlOutput>>;
  putMusicXml(scoreId: string, musicXml: string): Promise<ServiceResult<PutMusicXmlOutput>>;
};

type SendableClient = {
  send(command: object): Promise<unknown>;
};

type CreateAwsScoreServiceOptions = {
  bucketName?: string;
  tableName?: string;
  omrQueueUrl?: string;
  s3Client?: S3Client;
  dynamoClient?: SendableClient;
  sqsClient?: SendableClient;
  signUrl?: (
    client: S3Client,
    command: PutObjectCommand | GetObjectCommand,
    options: { expiresIn: number },
  ) => Promise<string>;
  now?: () => Date;
};

export function createAwsScoreService(options: CreateAwsScoreServiceOptions = {}): ScoreService {
  const bucketName = options.bucketName ?? requiredEnv("SCORE_BUCKET_NAME");
  const tableName = options.tableName ?? requiredEnv("SCORE_JOBS_TABLE_NAME");
  const omrQueueUrl = options.omrQueueUrl ?? requiredEnv("OMR_JOB_QUEUE_URL");
  const s3Client = options.s3Client ?? new S3Client({});
  const dynamoClient =
    options.dynamoClient ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  const sqsClient = options.sqsClient ?? new SQSClient({});
  const signUrl = options.signUrl ?? getSignedUrl;
  const now = options.now ?? (() => new Date());

  return {
    async createUploadUrl(input) {
      const validated = validateCreateUploadUrlInput(input);
      if (!validated.ok) {
        return validated;
      }

      const currentDate = now();
      const createdAt = currentDate.toISOString();
      const scoreId = createScoreId(currentDate);
      const objectKey = createOriginalObjectKey(scoreId, validated.value.contentType);

      await dynamoClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: scorePartitionKey(scoreId),
            sk: scoreMetaSortKey,
            score_id: scoreId,
            status: "created",
            original_key: objectKey,
            created_at: createdAt,
            updated_at: createdAt,
          } satisfies ScoreJob,
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );

      const uploadUrl = await signUrl(
        s3Client,
        new PutObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
          ContentType: validated.value.contentType,
        }),
        { expiresIn: uploadUrlExpiresInSeconds },
      );

      return {
        ok: true,
        value: {
          score_id: scoreId,
          upload_url: uploadUrl,
          object_key: objectKey,
        },
      };
    },

    async createScoreJob(input) {
      const validated = validateCreateScoreJobInput(input);
      if (!validated.ok) {
        return validated;
      }

      const { scoreId, originalKey } = validated.value;
      if (!originalKey.startsWith(`scores/${scoreId}/`)) {
        return {
          ok: false,
          error: "original_key must belong to score_id.",
        };
      }

      const updatedAt = now().toISOString();

      await dynamoClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: {
            pk: scorePartitionKey(scoreId),
            sk: scoreMetaSortKey,
          },
          UpdateExpression:
            "SET #status = :status, original_key = :originalKey, updated_at = :updatedAt",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":status": "queued",
            ":originalKey": originalKey,
            ":updatedAt": updatedAt,
          },
        }),
      );

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: omrQueueUrl,
          MessageBody: JSON.stringify({
            job_type: "omr",
            score_id: scoreId,
            original_key: originalKey,
          }),
        }),
      );

      return {
        ok: true,
        value: {
          score_id: scoreId,
          status: "queued",
        },
      };
    },

    async getScoreJob(scoreId) {
      if (!isNonEmptyString(scoreId)) {
        return null;
      }

      const response = (await dynamoClient.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            pk: scorePartitionKey(scoreId),
            sk: scoreMetaSortKey,
          },
        }),
      )) as { Item?: ScoreJob };

      return response.Item ?? null;
    },

    async createMusicXmlDownloadUrl(scoreId) {
      const score = await this.getScoreJob(scoreId);
      if (!score) {
        return {
          ok: false,
          error: "Score not found.",
        };
      }

      if (!score.musicxml_key) {
        return {
          ok: false,
          error: "MusicXML not found.",
        };
      }

      const downloadUrl = await signUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: bucketName,
          Key: score.musicxml_key,
        }),
        { expiresIn: musicXmlDownloadUrlExpiresInSeconds },
      );

      return {
        ok: true,
        value: {
          score_id: score.score_id,
          musicxml_key: score.musicxml_key,
          download_url: downloadUrl,
          expires_in: musicXmlDownloadUrlExpiresInSeconds,
        },
      };
    },

    async putMusicXml(scoreId, musicXml) {
      if (!isNonEmptyString(scoreId)) {
        return {
          ok: false,
          error: "Score not found.",
        };
      }

      if (!isLikelyMusicXml(musicXml)) {
        return {
          ok: false,
          error: "Invalid MusicXML.",
        };
      }

      const score = await this.getScoreJob(scoreId);
      if (!score) {
        return {
          ok: false,
          error: "Score not found.",
        };
      }

      const musicXmlKey = createMusicXmlObjectKey(scoreId);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: musicXmlKey,
          Body: musicXml,
          ContentType: musicXmlContentType,
        }),
      );

      const updatedAt = now().toISOString();
      await dynamoClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: {
            pk: scorePartitionKey(scoreId),
            sk: scoreMetaSortKey,
          },
          UpdateExpression:
            "SET #status = :status, musicxml_key = :musicXmlKey, updated_at = :updatedAt REMOVE error_message",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":status": "needs_review",
            ":musicXmlKey": musicXmlKey,
            ":updatedAt": updatedAt,
          },
        }),
      );

      return {
        ok: true,
        value: {
          score_id: scoreId,
          status: "needs_review",
          musicxml_key: musicXmlKey,
        },
      };
    },
  };
}

export function createScoreId(date = new Date()): string {
  const timestamp = date
    .toISOString()
    .replaceAll(/[-:TZ.]/g, "")
    .slice(0, 14);
  const randomSuffix = randomUUID().replaceAll("-", "").slice(0, 12);

  return `score_${timestamp}_${randomSuffix}`;
}

function createOriginalObjectKey(scoreId: string, contentType: AllowedContentType): string {
  return `scores/${scoreId}/original.${contentTypeToExtension[contentType]}`;
}

function createMusicXmlObjectKey(scoreId: string): string {
  return `scores/${scoreId}/result.musicxml`;
}

function validateCreateUploadUrlInput(
  input: CreateUploadUrlInput,
): ServiceResult<{ filename: string; contentType: AllowedContentType }> {
  if (!isNonEmptyString(input.filename)) {
    return {
      ok: false,
      error: "filename is required.",
    };
  }

  if (!isAllowedContentType(input.content_type)) {
    return {
      ok: false,
      error: "content_type must be application/pdf, image/png, or image/jpeg.",
    };
  }

  return {
    ok: true,
    value: {
      filename: input.filename,
      contentType: input.content_type,
    },
  };
}

function validateCreateScoreJobInput(
  input: CreateScoreJobInput,
): ServiceResult<{ scoreId: string; originalKey: string }> {
  if (!isNonEmptyString(input.score_id)) {
    return {
      ok: false,
      error: "score_id is required.",
    };
  }

  if (!isNonEmptyString(input.original_key)) {
    return {
      ok: false,
      error: "original_key is required.",
    };
  }

  return {
    ok: true,
    value: {
      scoreId: input.score_id,
      originalKey: input.original_key,
    },
  };
}

function isAllowedContentType(value: unknown): value is AllowedContentType {
  return typeof value === "string" && Object.hasOwn(contentTypeToExtension, value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isLikelyMusicXml(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const trimmed = value.trim();
  return (
    trimmed.startsWith("<") &&
    (trimmed.includes("<score-partwise") || trimmed.includes("<score-timewise"))
  );
}

function scorePartitionKey(scoreId: string): string {
  return `SCORE#${scoreId}`;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}
