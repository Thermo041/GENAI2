import { config, validateConfig } from './config/env.js';
import { logger } from './utils/logger.js';
import { connectMongo, disconnectMongo } from './config/db.js';
import { ensureCollection } from './config/qdrant.js';
import { createApp } from './app.js';
import { recoverStuckJobs, startWorker, stopWorker } from './jobs/worker.js';
import { warmEmbeddings } from './services/embeddings/index.js';

const missing = validateConfig();
if (missing.length) {
  logger.error(
    { missing },
    'Missing required configuration. Copy .env.example to .env and fill these in — CodeWeave will not start with fake defaults.',
  );
  process.exit(1);
}

await connectMongo();
await ensureCollection();
await recoverStuckJobs();

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, env: config.env, client: config.clientUrl, worker: config.worker.enabled },
    'CodeWeave API listening',
  );
});

server.headersTimeout = 120000;
server.requestTimeout = 0; // SSE streams stay open

startWorker();
warmEmbeddings();

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  stopWorker();
  server.close(async () => {
    await disconnectMongo();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ reason: String(reason) }, 'Unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  logger.error({ err: err.message, stack: err.stack }, 'Uncaught exception');
  shutdown('uncaughtException');
});
