import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireOnboardingComplete } from "../middleware/onboarding";
import { store } from "../data/store";

export const notificationRoutes = Router();

notificationRoutes.use(requireAuth, requireOnboardingComplete);

notificationRoutes.get("/", (req, res) => {
  const userId = req.auth!.userId;
  res.json({
    notifications: store.listNotifications(userId)
  });
});

notificationRoutes.post("/:notificationId/ack", (req, res) => {
  const userId = req.auth!.userId;
  const record = store.acknowledgeNotification(userId, req.params.notificationId);
  if (!record) {
    res.status(404).json({ error: "Notification not found." });
    return;
  }
  res.json({
    notification: record
  });
});
