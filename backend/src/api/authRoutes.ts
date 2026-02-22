import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { generateToken } from "../auth/jwt";
import { config } from "../config";
import { store } from "../data/store";
import {
  persistCaregiverOnboardingDraft,
  persistPatientOnboardingDraft,
  persistPatientProfile
} from "../db/persistentDomain";
import { findPersistentUserByEmail, findPersistentUserById, persistUser } from "../db/persistentUsers";
import { requireAuth } from "../middleware/auth";
import { createRateLimiter } from "../middleware/rateLimit";
import { User } from "../models/types";

const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  role: z.enum(["Patient", "Caregiver"]),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

function sanitizeUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    onboardingCompleted: user.onboardingCompleted,
    patientCode: user.patientCode
  };
}

export const authRoutes = Router();
const signupRateLimiter = createRateLimiter(config.signupRateLimitWindowMs, config.signupRateLimitMax);

function resolveNextPath(userId: string): string {
  return store.getOnboardingStatus(userId)?.nextPath ?? "/";
}

authRoutes.post("/register", signupRateLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid registration payload.", details: parsed.error.flatten() });
    return;
  }

  const { name, email, role, password } = parsed.data;

  const existing = store.getUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: "Email already exists." });
    return;
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const user = store.createUser({ name, email, role, passwordHash });
  await persistUser(user);
  if (role === "Patient") {
    await Promise.all([persistPatientProfile(user.id), persistPatientOnboardingDraft(user.id)]);
  } else {
    await persistCaregiverOnboardingDraft(user.id);
  }
  const token = generateToken({
    userId: user.id,
    role: user.role,
    email: user.email
  });

  res.status(201).json({
    token,
    user: sanitizeUser(user),
    nextPath: resolveNextPath(user.id)
  });
});

authRoutes.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid login payload.", details: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;
  const tryLogin = async () => {
    let user = store.getUserByEmail(email);
    if (!user) {
      user = (await findPersistentUserByEmail(email)) ?? undefined;
    }
    if (!user) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }

    const valid = bcrypt.compareSync(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }

    const token = generateToken({
      userId: user.id,
      role: user.role,
      email: user.email
    });

    res.json({
      token,
      user: sanitizeUser(user),
      nextPath: resolveNextPath(user.id)
    });
  };

  tryLogin().catch(() => {
    res.status(500).json({ error: "Login failed unexpectedly." });
  });
});

authRoutes.get("/me", requireAuth, (req, res) => {
  const resolveUser = async () => {
    let user = store.getUserById(req.auth!.userId);
    if (!user) {
      user = (await findPersistentUserById(req.auth!.userId)) ?? undefined;
    }
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    res.json({
      user: sanitizeUser(user),
      onboarding: store.getOnboardingStatus(user.id)
    });
  };

  resolveUser().catch(() => {
    res.status(500).json({ error: "Failed to resolve current user." });
  });
});
