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

const MusicXmlUrlResponseSchema = z
  .object({
    score_id: z.string().openapi({
      example: "score_20260520124530_a1b2c3d4e5f6",
    }),
    musicxml_key: z.string().openapi({
      example: "scores/score_20260520124530_a1b2c3d4e5f6/result.musicxml",
    }),
    download_url: z.string().url().openapi({
      example: "https://example-bucket.s3.ap-northeast-1.amazonaws.com/...",
    }),
    expires_in: z.number().int().positive().openapi({
      example: 900,
    }),
  })
  .openapi("MusicXmlUrlResponse");

const PutMusicXmlResponseSchema = z
  .object({
    score_id: z.string().openapi({
      example: "score_20260520124530_a1b2c3d4e5f6",
    }),
    status: z.literal("needs_review").openapi({
      example: "needs_review",
    }),
    musicxml_key: z.string().openapi({
      example: "scores/score_20260520124530_a1b2c3d4e5f6/result.musicxml",
    }),
  })
  .openapi("PutMusicXmlResponse");

const AnalyzeScoreResponseSchema = z
  .object({
    score_id: z.string().openapi({
      example: "score_20260520124530_a1b2c3d4e5f6",
    }),
    status: z.literal("analyzed").openapi({
      example: "analyzed",
    }),
    notes_json_key: z.string().openapi({
      example: "scores/score_20260520124530_a1b2c3d4e5f6/notes.json",
    }),
    pitch_counts_key: z.string().openapi({
      example: "scores/score_20260520124530_a1b2c3d4e5f6/pitch_counts.json",
    }),
    pitch_counts: z.record(z.string(), z.number().int().nonnegative()).openapi({
      example: {
        C4: 3,
        C5: 1,
      },
    }),
  })
  .openapi("AnalyzeScoreResponse");

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
    status: z
      .enum(["created", "queued", "processing_omr", "needs_review", "analyzed", "failed"])
      .openapi({
        example: "needs_review",
      }),
    original_key: z.string().openapi({
      example: "scores/score_20260520124530_a1b2c3d4e5f6/original.pdf",
    }),
    musicxml_key: z.string().optional().openapi({
      example: "scores/score_20260520124530_a1b2c3d4e5f6/result.musicxml",
    }),
    notes_json_key: z.string().optional().openapi({
      example: "scores/score_20260520124530_a1b2c3d4e5f6/notes.json",
    }),
    pitch_counts_key: z.string().optional().openapi({
      example: "scores/score_20260520124530_a1b2c3d4e5f6/pitch_counts.json",
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

const createMusicXmlDownloadUrlRoute = createRoute({
  method: "get",
  path: "/scores/{score_id}/musicxml-url",
  request: {
    params: ScoreParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: MusicXmlUrlResponseSchema,
        },
      },
      description: "Created S3 MusicXML download URL.",
    },
    404: errorResponse("Score or MusicXML not found."),
    500: errorResponse("Unexpected server error."),
  },
});

const putMusicXmlRoute = createRoute({
  method: "put",
  path: "/scores/{score_id}/musicxml",
  request: {
    params: ScoreParamsSchema,
    body: {
      content: {
        "application/vnd.recordare.musicxml+xml": {
          schema: z.string().openapi({
            example:
              '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"></score-partwise>',
          }),
        },
        "application/xml": {
          schema: z.string().openapi({
            example:
              '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"></score-partwise>',
          }),
        },
        "text/xml": {
          schema: z.string().openapi({
            example:
              '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"></score-partwise>',
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: PutMusicXmlResponseSchema,
        },
      },
      description: "Saved MusicXML.",
    },
    400: errorResponse("Invalid MusicXML."),
    404: errorResponse("Score not found."),
    500: errorResponse("Unexpected server error."),
  },
});

const analyzeScoreRoute = createRoute({
  method: "post",
  path: "/scores/{score_id}/analyze",
  request: {
    params: ScoreParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: AnalyzeScoreResponseSchema,
        },
      },
      description: "Analyzed MusicXML pitch counts.",
    },
    400: errorResponse("Invalid MusicXML."),
    404: errorResponse("Score or MusicXML not found."),
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

  app.openapi(createMusicXmlDownloadUrlRoute, async (c) => {
    const { score_id: scoreId } = c.req.valid("param");
    const result = await scoreService.createMusicXmlDownloadUrl(scoreId);
    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }

    return c.json(result.value, 200);
  });

  app.openapi(putMusicXmlRoute, async (c) => {
    const { score_id: scoreId } = c.req.valid("param");
    const result = await scoreService.putMusicXml(scoreId, await c.req.text());
    if (!result.ok) {
      const status = result.error === "Score not found." ? 404 : 400;
      return c.json({ error: result.error }, status);
    }

    return c.json(result.value, 200);
  });

  app.openapi(analyzeScoreRoute, async (c) => {
    const { score_id: scoreId } = c.req.valid("param");
    // NOTE: This MVP endpoint uses a lightweight MusicXML parser. For robust
    // score semantics, move analysis into the worker with Python music21.
    const result = await scoreService.analyzeScore(scoreId);
    if (!result.ok) {
      const status = result.error === "Invalid MusicXML." ? 400 : 404;
      return c.json({ error: result.error }, status);
    }

    return c.json(result.value, 200);
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
