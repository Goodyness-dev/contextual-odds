import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';
// ─── Error Codes ─────────────────────────────────────────────────────────────
// Machine-readable codes the frontend can switch on.
export const ErrorCode = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_TOKEN: 'INVALID_TOKEN',

  // Resources
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // Payments
  PAYMENT_INIT_FAILED: 'PAYMENT_INIT_FAILED',
  PAYMENT_VERIFICATION_FAILED: 'PAYMENT_VERIFICATION_FAILED',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  INVALID_WEBHOOK_SIGNATURE: 'INVALID_WEBHOOK_SIGNATURE',
  DUPLICATE_WEBHOOK: 'DUPLICATE_WEBHOOK',

  // Email
  EMAIL_SEND_FAILED: 'EMAIL_SEND_FAILED',

  // Generation
  GENERATION_FAILED: 'GENERATION_FAILED',
  GENERATION_MALFORMED: 'GENERATION_MALFORMED',

  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ─── AppError Class ──────────────────────────────────────────────────────────
// Services and controllers throw this. The error middleware below is
// the ONLY place it becomes an HTTP response. Never call res.status()
// for error cases — always throw AppError.
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: ErrorCode) {
    super(message);

    this.statusCode = statusCode;
    this.code = code;
    // Operational errors are expected (bad input, not found, etc.).
    // Non-operational means something crashed unexpectedly.
    this.isOperational = true;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── Error Response Shape ────────────────────────────────────────────────────
// Every error from this API looks the same. The frontend can always rely
// on this shape.
type ErrorResponse = {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
};

// ─── Error Middleware ────────────────────────────────────────────────────────
// MUST be mounted last in index.ts, after all routes.
// Four arguments is what makes Express treat this as an error handler —
// do not remove `_next` even though it's unused.
export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = req.id;

  if (err instanceof AppError) {
    // Expected operational error — use the error's own status and code
    const body: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        requestId,
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // Unexpected error — log the full stack, return a generic 500.
  // We intentionally don't expose internal details to the client.
  logger.error({
  requestId,
  error: err.message,
  stack: err.stack,
}, 'unhandled error');

  const body: ErrorResponse = {
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred. Please try again.',
      requestId,
    },
  };

  res.status(500).json(body);
}