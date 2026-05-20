import { createApp } from "./app.js";
import { createAwsScoreService } from "./score-service.js";

const app = createApp({
  scoreService: createAwsScoreService(),
});

export const handler = app.handler;
