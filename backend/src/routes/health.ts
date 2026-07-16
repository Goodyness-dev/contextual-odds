import { Router } from 'express';
import type { Request, Response } from 'express';

export const healthRouter = Router();

// GET /health
// Railway uses this to verify the server is alive.
// No auth — must be publicly reachable.
healthRouter.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});