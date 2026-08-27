#!/usr/bin/env node
/**
 * Standalone worker process. Optional: the API already runs an in-process
 * worker (WORKER_ENABLED=true). Use this when you want a dedicated Render
 * Background Worker so indexing never competes with request handling — then set
 * WORKER_ENABLED=false on the web service.
 */
import { config, validateConfig } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../config/db.js';
import { ensureCollection } from '../config/qdrant.js';
import { logger } from '../utils/logger.js';
import { warmEmbeddings } from '../services/embeddings/index.js';
import { recoverStuckJobs, runWorkerOnce, stopWorker } from './worker.js';

const missing = validateConfig();
if (missing.length) {
  logger.error({ missing }, 'Refusing to start worker with missing configuration');
  process.exit(1);
}

await connectMongo();
await ensureCollection();
await recoverStuckJobs();
await warmEmbeddings();

logger.info({ pollMs: config.worker.pollMs }, 'Standalone CodeWeave worker running');

let shuttingDown = false;

const loop = async () => {
  while (!shuttingDown) {
    try {
      const didWork = await runWorkerOnce({ force: true });
      if (!didWork) await new Promise((resolve) => setTimeout(resolve, config.worker.pollMs));
    } catch (err) {
      logger.error({ err: err.message }, 'Worker loop error');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

const shutdown = async (signal) => {
  logger.info({ signal }, 'Worker shutting down');
  shuttingDown = true;
  stopWorker();
  await disconnectMongo();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await loop();
