import { NextFunction, Request, Response } from "express";

interface Bucket {
  hits: number;
  resetAt: number;
}

export function createRateLimiter(windowMs: number, maxHits: number) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const bucket = buckets.get(ip);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(ip, {
        hits: 1,
        resetAt: now + windowMs
      });
      next();
      return;
    }

    if (bucket.hits >= maxHits) {
      const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfterSeconds.toString());
      res.status(429).json({
        error: "Too many requests. Please try again later."
      });
      return;
    }

    bucket.hits += 1;
    next();
  };
}
