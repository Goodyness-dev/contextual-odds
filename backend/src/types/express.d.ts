// Augments Express's Request type globally so every controller and middleware
// gets full TypeScript coverage on req.id.
// No imports needed here — declaration merging happens automatically.

declare global {
  namespace Express {
    interface Request {
      // Set by requestId middleware — a UUID tied to this request lifecycle
      id: string;
    }
  }
}

export {};