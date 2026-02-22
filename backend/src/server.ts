import cors from "cors";
import express from "express";
import http from "http";
import { apiRouter } from "./api";
import { config } from "./config";
import { initializePersistentDomainData } from "./db/persistentDomain";
import { prisma } from "./db/prisma";
import { initializePersistentMappings } from "./db/persistentMappings";
import { initializePersistentUsers } from "./db/persistentUsers";
import { StreamingEngine } from "./engine/streamingEngine";
import { liveAlertService } from "./services/liveAlertService";

const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));

// Guardrail: reject known PHI-like query keys.
app.use((req, res, next) => {
  const blockedKeys = ["insuranceId", "ssn", "dob"];
  const hasBlockedQueryKey = Object.keys(req.query).some((key) => blockedKeys.includes(key));
  if (hasBlockedQueryKey) {
    res.status(400).json({ error: "Sensitive identifiers are not allowed in query parameters." });
    return;
  }
  next();
});

app.use("/api", apiRouter);

const streamingEngine = new StreamingEngine(server);

async function startServer(): Promise<void> {
  await initializePersistentUsers();
  await initializePersistentMappings();
  await initializePersistentDomainData();
  liveAlertService.start();
  streamingEngine.start();

  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://localhost:${config.port}`);
    // eslint-disable-next-line no-console
    console.log(`WebSocket endpoint ws://localhost:${config.port}/ws`);
  });
}

startServer().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start backend:", error);
  process.exit(1);
});

process.on("SIGINT", async () => {
  streamingEngine.stop();
  liveAlertService.stop();
  await prisma?.$disconnect().catch(() => undefined);
  server.close(() => process.exit(0));
});
