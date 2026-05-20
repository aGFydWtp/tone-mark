import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { handle } from "hono/aws-lambda";
import type { ScoreService } from "./score-service.js";

type AppDependencies = {
  scoreService: ScoreService;
};

const ErrorSchema = z
  .object({
    error: z.string().openapi({
      example: "Score not found.",
    }),
  })
  .openapi("Error");

const HealthResponseSchema = z
  .object({
    ok: z.boolean().openapi({
      example: true,
    }),
    service: z.string().openapi({
      example: "tone-mark-api",
    }),
  })
  .openapi("HealthResponse");

const UploadUrlRequestSchema = z
  .object({
    filename: z.string().min(1).openapi({
      example: "score.pdf",
    }),
    content_type: z.string().min(1).openapi({
      example: "application/pdf",
    }),
  })
  .openapi("CreateUploadUrlRequest");

const UploadUrlResponseSchema = z
  .object({
    score_id: z.string().openapi({
      example: "score_20260520124530_a1b2c3d4e5f6",
    }),
    upload_url: z.string().url().openapi({
      example: "https://example-bucket.s3.ap-northeast-1.amazonaws.com/...",
    }),
    object_key: z.string().openapi({
      example: "scores/score_20260520124530_a1b2c3d4e5f6/original.pdf",
    }),
  })
  .openapi("CreateUploadUrlResponse");

const CreateScoreJobRequestSchema = z
  .object({
    score_id: z.string().min(1).openapi({
      example: "score_20260520124530_a1b2c3d4e5f6",
    }),
    original_key: z.string().min(1).openapi({
      example: "scores/score_20260520124530_a1b2c3d4e5f6/original.pdf",
    }),
  })
  .openapi("CreateScoreJobRequest");

const CreateScoreJobResponseSchema = z
  .object({
    score_id: z.string().openapi({
      example: "score_20260520124530_a1b2c3d4e5f6",
    }),
    status: z.literal("queued").openapi({
      example: "queued",
    }),
  })
  .openapi("CreateScoreJobResponse");

const ScoreParamsSchema = z.object({
  score_id: z
    .string()
    .min(1)
    .openapi({
      param: {
        name: "score_id",
        in: "path",
      },
      example: "score_20260520124530_a1b2c3d4e5f6",
    }),
});

const ScoreJobSchema = z
  .object({
    pk: z.string().openapi({
      example: "SCORE#score_20260520124530_a1b2c3d4e5f6",
    }),
    sk: z.literal("META").openapi({
      example: "META",
    }),
    score_id: z.string().openapi({
      example: "score_20260520124530_a1b2c3d4e5f6",
    }),
    status: z.enum(["created", "queued", "processing_omr", "needs_review", "failed"]).openapi({
      example: "needs_review",
    }),
    original_key: z.string().openapi({
      example: "scores/score_20260520124530_a1b2c3d4e5f6/original.pdf",
    }),
    musicxml_key: z.string().optional().openapi({
      example: "scores/score_20260520124530_a1b2c3d4e5f6/result.musicxml",
    }),
    error_message: z.string().nullable().optional().openapi({
      example: null,
    }),
    created_at: z.string().openapi({
      example: "2026-05-20T12:45:30.000Z",
    }),
    updated_at: z.string().openapi({
      example: "2026-05-20T12:46:10.000Z",
    }),
  })
  .openapi("ScoreJob");

const healthRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
      description: "Service health response.",
    },
  },
});

const createUploadUrlRoute = createRoute({
  method: "post",
  path: "/scores/upload-url",
  request: {
    body: {
      content: {
        "application/json": {
          schema: UploadUrlRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: UploadUrlResponseSchema,
        },
      },
      description: "Created S3 upload URL.",
    },
    400: errorResponse("Invalid upload URL request."),
    500: errorResponse("Unexpected server error."),
  },
});

const createScoreJobRoute = createRoute({
  method: "post",
  path: "/scores",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateScoreJobRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: CreateScoreJobResponseSchema,
        },
      },
      description: "Queued OMR job.",
    },
    400: errorResponse("Invalid score job request."),
    500: errorResponse("Unexpected server error."),
  },
});

const getScoreJobRoute = createRoute({
  method: "get",
  path: "/scores/{score_id}",
  request: {
    params: ScoreParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ScoreJobSchema,
        },
      },
      description: "Score job status.",
    },
    404: errorResponse("Score not found."),
    500: errorResponse("Unexpected server error."),
  },
});

export function createApp({ scoreService }: AppDependencies) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: "Invalid request." }, 400);
      }
    },
  });

  app.openapi(healthRoute, (c) => c.json({ ok: true, service: "tone-mark-api" }));

  app.openapi(createUploadUrlRoute, async (c) => {
    const result = await scoreService.createUploadUrl(c.req.valid("json"));
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }

    return c.json(result.value, 200);
  });

  app.openapi(createScoreJobRoute, async (c) => {
    const result = await scoreService.createScoreJob(c.req.valid("json"));
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }

    return c.json(result.value, 200);
  });

  app.openapi(getScoreJobRoute, async (c) => {
    const { score_id: scoreId } = c.req.valid("param");
    const score = await scoreService.getScoreJob(scoreId);

    if (!score) {
      return c.json({ error: "Score not found." }, 404);
    }

    return c.json(score, 200);
  });

  app.doc("/doc", {
    openapi: "3.0.0",
    info: {
      version: "0.1.0",
      title: "Tone Mark API",
      description: "API for score upload, OMR job creation, and status polling.",
    },
  });

  app.get("/ui", swaggerUI({ url: "/doc" }));

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "Internal server error." }, 500);
  });

  return {
    app,
    handler: handle(app),
  };
}

function errorResponse(description: string) {
  return {
    content: {
      "application/json": {
        schema: ErrorSchema,
      },
    },
    description,
  };
}
