import { NextFunction, Request, Response } from "express";
import { Role } from "../models/types";

export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    if (req.auth.role !== role) {
      res.status(403).json({ error: "Forbidden for this role." });
      return;
    }
    next();
  };
}
