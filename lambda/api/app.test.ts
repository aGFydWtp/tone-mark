import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";
import type { ScoreJob, ScoreService } from "./score-service.js";

test("GET /doc returns OpenAPI document", async () => {
  const { app } = createApp({ scoreService: createMockScoreService() });

  const response = await app.request("/doc");
  const body = (await response.json()) as {
    openapi: string;
    paths: Record<string, unknown>;
  };

  assert.equal(response.status, 200);
  assert.equal(body.openapi, "3.0.0");
  assert.ok(body.paths["/scores/upload-url"]);
  assert.ok(body.paths["/scores"]);
  assert.ok(body.paths["/scores/{score_id}"]);
  assert.ok(body.paths["/scores/{score_id}/musicxml-url"]);
  assert.ok(body.paths["/scores/{score_id}/musicxml"]);
  assert.ok(body.paths["/scores/{score_id}/analyze"]);
});

test("GET /ui returns Swagger UI HTML", async () => {
  const { app } = createApp({ scoreService: createMockScoreService() });

  const response = await app.request("/ui");
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(body, /SwaggerUIBundle/);
  assert.match(body, /\/doc/);
});

test("POST /scores/upload-url rejects unsupported content type", async () => {
  const { app } = createApp({ scoreService: createMockScoreService() });

  const response = await app.request("/scores/upload-url", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      filename: "score.gif",
      content_type: "image/gif",
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "content_type must be application/pdf, image/png, or image/jpeg.",
  });
});

test("POST /scores/upload-url returns upload URL payload", async () => {
  const { app } = createApp({ scoreService: createMockScoreService() });

  const response = await app.request("/scores/upload-url", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      filename: "score.pdf",
      content_type: "application/pdf",
    }),
  });

  const body = (await response.json()) as {
    score_id: string;
    object_key: string;
    upload_url: string;
  };

  assert.equal(response.status, 200);
  assert.match(body.score_id, /^score_/);
  assert.match(body.object_key, /^scores\/score_.+\/original\.pdf$/);
  assert.equal(body.upload_url, "https://example.com/upload");
});

test("POST /scores rejects mismatched score_id and original_key", async () => {
  const { app } = createApp({ scoreService: createMockScoreService() });

  const response = await app.request("/scores", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      score_id: "score_20260520124530_a1b2c3d4e5f6",
      original_key: "scores/other/original.pdf",
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "original_key must belong to score_id.",
  });
});

test("GET /scores/:score_id returns 404 when score is missing", async () => {
  const { app } = createApp({
    scoreService: createMockScoreService({
      getScoreJob: async () => null,
    }),
  });

  const response = await app.request("/scores/score_missing");

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Score not found.",
  });
});

test("GET /scores/:score_id/musicxml-url returns 404 when score is missing", async () => {
  const { app } = createApp({
    scoreService: createMockScoreService({
      async createMusicXmlDownloadUrl() {
        return {
          ok: false,
          error: "Score not found.",
        };
      },
    }),
  });

  const response = await app.request("/scores/score_missing/musicxml-url");

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Score not found.",
  });
});

test("GET /scores/:score_id/musicxml-url returns 404 when MusicXML is missing", async () => {
  const { app } = createApp({
    scoreService: createMockScoreService({
      async createMusicXmlDownloadUrl() {
        return {
          ok: false,
          error: "MusicXML not found.",
        };
      },
    }),
  });

  const response = await app.request("/scores/score_20260520124530_a1b2c3d4e5f6/musicxml-url");

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "MusicXML not found.",
  });
});

test("GET /scores/:score_id/musicxml-url returns download URL payload", async () => {
  const { app } = createApp({ scoreService: createMockScoreService() });

  const response = await app.request("/scores/score_20260520124530_a1b2c3d4e5f6/musicxml-url");
  const body = (await response.json()) as {
    score_id: string;
    musicxml_key: string;
    download_url: string;
    expires_in: number;
  };

  assert.equal(response.status, 200);
  assert.equal(body.score_id, "score_20260520124530_a1b2c3d4e5f6");
  assert.equal(body.musicxml_key, "scores/score_20260520124530_a1b2c3d4e5f6/result.musicxml");
  assert.equal(body.download_url, "https://example.com/musicxml");
  assert.equal(body.expires_in, 900);
});

test("PUT /scores/:score_id/musicxml rejects empty body", async () => {
  const { app } = createApp({ scoreService: createMockScoreService() });

  const response = await app.request("/scores/score_20260520124530_a1b2c3d4e5f6/musicxml", {
    method: "PUT",
    headers: {
      "content-type": "application/vnd.recordare.musicxml+xml",
    },
    body: "",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Invalid MusicXML.",
  });
});

test("PUT /scores/:score_id/musicxml returns saved MusicXML payload", async () => {
  const { app } = createApp({ scoreService: createMockScoreService() });

  const response = await app.request("/scores/score_20260520124530_a1b2c3d4e5f6/musicxml", {
    method: "PUT",
    headers: {
      "content-type": "application/vnd.recordare.musicxml+xml",
    },
    body: '<?xml version="1.0"?><score-partwise version="4.0"></score-partwise>',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    score_id: "score_20260520124530_a1b2c3d4e5f6",
    status: "needs_review",
    musicxml_key: "scores/score_20260520124530_a1b2c3d4e5f6/result.musicxml",
  });
});

test("POST /scores/:score_id/analyze returns pitch counts", async () => {
  const { app } = createApp({ scoreService: createMockScoreService() });

  const response = await app.request("/scores/score_20260520124530_a1b2c3d4e5f6/analyze", {
    method: "POST",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    score_id: "score_20260520124530_a1b2c3d4e5f6",
    status: "analyzed",
    notes_json_key: "scores/score_20260520124530_a1b2c3d4e5f6/notes.json",
    pitch_counts_key: "scores/score_20260520124530_a1b2c3d4e5f6/pitch_counts.json",
    pitch_counts: {
      C4: 2,
      C5: 1,
    },
  });
});

test("POST /scores/:score_id/analyze returns 404 when MusicXML is missing", async () => {
  const { app } = createApp({
    scoreService: createMockScoreService({
      async analyzeScore() {
        return {
          ok: false,
          error: "MusicXML not found.",
        };
      },
    }),
  });

  const response = await app.request("/scores/score_20260520124530_a1b2c3d4e5f6/analyze", {
    method: "POST",
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "MusicXML not found.",
  });
});

test("POST /scores/:score_id/analyze returns 400 for invalid MusicXML", async () => {
  const { app } = createApp({
    scoreService: createMockScoreService({
      async analyzeScore() {
        return {
          ok: false,
          error: "Invalid MusicXML.",
        };
      },
    }),
  });

  const response = await app.request("/scores/score_20260520124530_a1b2c3d4e5f6/analyze", {
    method: "POST",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Invalid MusicXML.",
  });
});

test("CORS preflight allows here.now, its subdomains, and localhost", async () => {
  const { app } = createApp({ scoreService: createMockScoreService() });

  for (const origin of [
    "https://here.now",
    "https://app.here.now",
    "https://a.b.here.now",
    "https://app.tools.mockht.net",
    "http://localhost:5173",
  ]) {
    const response = await app.request("/scores", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
      },
    });

    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  }
});

test("CORS rejects disallowed origins", async () => {
  const { app } = createApp({ scoreService: createMockScoreService() });

  for (const origin of ["https://evil.example", "https://here.now.evil.com", "http://here.now"]) {
    const response = await app.request("/scores", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
      },
    });

    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});

function createMockScoreService(overrides: Partial<ScoreService> = {}): ScoreService {
  return {
    async createUploadUrl(input) {
      if (input.content_type !== "application/pdf") {
        return {
          ok: false,
          error: "content_type must be application/pdf, image/png, or image/jpeg.",
        };
      }

      const scoreId = "score_20260520124530_a1b2c3d4e5f6";

      return {
        ok: true,
        value: {
          score_id: scoreId,
          upload_url: "https://example.com/upload",
          object_key: `scores/${scoreId}/original.pdf`,
        },
      };
    },
    async createScoreJob(input) {
      const scoreId = String(input.score_id);
      const originalKey = String(input.original_key);
      if (!originalKey.startsWith(`scores/${scoreId}/`)) {
        return {
          ok: false,
          error: "original_key must belong to score_id.",
        };
      }

      return {
        ok: true,
        value: {
          score_id: scoreId,
          status: "queued",
        },
      };
    },
    async getScoreJob(scoreId) {
      return {
        pk: `SCORE#${scoreId}`,
        sk: "META",
        score_id: scoreId,
        status: "created",
        original_key: `scores/${scoreId}/original.pdf`,
        created_at: "2026-05-20T00:00:00.000Z",
        updated_at: "2026-05-20T00:00:00.000Z",
      } satisfies ScoreJob;
    },
    async createMusicXmlDownloadUrl(scoreId) {
      return {
        ok: true,
        value: {
          score_id: scoreId,
          musicxml_key: `scores/${scoreId}/result.musicxml`,
          download_url: "https://example.com/musicxml",
          expires_in: 900,
        },
      };
    },
    async putMusicXml(scoreId, musicXml) {
      if (!musicXml.trim()) {
        return {
          ok: false,
          error: "Invalid MusicXML.",
        };
      }

      return {
        ok: true,
        value: {
          score_id: scoreId,
          status: "needs_review",
          musicxml_key: `scores/${scoreId}/result.musicxml`,
        },
      };
    },
    async analyzeScore(scoreId) {
      return {
        ok: true,
        value: {
          score_id: scoreId,
          status: "analyzed",
          notes_json_key: `scores/${scoreId}/notes.json`,
          pitch_counts_key: `scores/${scoreId}/pitch_counts.json`,
          pitch_counts: {
            C4: 2,
            C5: 1,
          },
        },
      };
    },
    ...overrides,
  };
}
