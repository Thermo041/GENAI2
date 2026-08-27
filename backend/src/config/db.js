import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

let connecting = null;

mongoose.set('strictQuery', true);
// NOTE: sanitizeFilter is deliberately NOT enabled globally — it rewrites our own
// operator queries ($lt/$in) into $eq. All user input reaches queries only after
// zod validation plus explicit path/branch validators.

export async function connectMongo() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connecting) return connecting;

  connecting = mongoose
    .connect(config.mongo.uri, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 60000,
      maxPoolSize: 10,
      minPoolSize: 1,
      autoIndex: true,
    })
    .then((m) => {
      logger.info({ db: m.connection.name }, 'MongoDB connected');
      return m.connection;
    })
    .catch((err) => {
      connecting = null;
      logger.error({ err: err.message }, 'MongoDB connection failed');
      throw err;
    });

  return connecting;
}

mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

export async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  connecting = null;
}

export function mongoHealth() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return { state: states[mongoose.connection.readyState] ?? 'unknown', db: mongoose.connection.name || null };
}
