// Vercel entry: one serverless function serves the whole app (API + /shared modules + SPA fallback).
// The database lives in memory (AWP_DB=:memory:): every cold start seeds the sample data again, so changes made
// in the deployed prototype are not kept.

import { createApp } from '../server/index.js';

const app = createApp({ dbFile: process.env.AWP_DB || ':memory:' });

export default function handler(req, res) {
  return app.handler(req, res);
}
