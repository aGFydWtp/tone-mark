import { Hono } from "hono";
import { handle } from "hono/aws-lambda";

const app = new Hono();

app.get("/", (c) => c.json({ ok: true, service: "tone-mark-api" }));

export const handler = handle(app);
