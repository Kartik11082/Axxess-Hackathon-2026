import { NextFunction, Request, Response } from "express";
import { store } from "../data/store";

export function requireOnboardingComplete(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  const status = store.getOnboardingStatus(req.auth.userId);
  if (!status) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  if (!status.onboardingCompleted) {
    res.status(403).json({
      error: "Onboarding must be completed before accessing this resource.",
      nextPath: status.nextPath
    });
    return;
  }

  next();
}
