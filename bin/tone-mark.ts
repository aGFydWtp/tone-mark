#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ToneMarkStack } from "../lib/tone-mark-stack.js";

const app = new cdk.App();

new ToneMarkStack(app, "ToneMarkStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
