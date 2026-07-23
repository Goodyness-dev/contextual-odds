import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config';
import { requestId } from './middleware/requestID';
import { errorMiddleware } from './middleware/errors';
import { logger } from './lib/logger';
import { healthRouter } from './routes/health';
import signalRouter from './routes/signal';

const app = express();

// ─── Middleware Chain ─────────────────────────────────────────────────────────
app.use(helmet());

app.use(
  cors({
    origin:
      config.NODE_ENV === 'production'
        ? [config.FRONTEND_URL]
        : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://10.200.101.241:3000', '*'],
    credentials: true,
  }),
);

app.use(requestId);
app.use(express.json({ limit: '1mb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/health', healthRouter);

// Elastico Signal Agent (Hackathon)
app.use('/api/signal', signalRouter);

// ─── Error Middleware ─────────────────────────────────────────────────────────
app.use(errorMiddleware);

// ─── Server Boot ──────────────────────────────────────────────────────────────
const PORT = config.PORT;

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    logger.info({ port: PORT, env: config.NODE_ENV }, 'Elastico Signal API running');
  }).on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error({ port: PORT }, `Port ${PORT} is already in use`);
    } else {
      logger.error({ err }, 'Server failed to start');
    }
    process.exit(1);
  });
}

export default app;