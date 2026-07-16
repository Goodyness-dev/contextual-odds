

import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = uuidv4();

  req.id = id;
  res.setHeader('X-Request-Id', id);

  logger.info({
    requestId: id,
    method: req.method,
    path: req.path,
  }, 'incoming request');

  next();
}