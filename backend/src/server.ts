import cors from "cors";
import express from "express";
import http from "http";
import { apiRouter } from "./api";
import { config } from "./config";
import { StreamingEngine } from "./engine/streamingEngine";

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
streamingEngine.start();

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`WebSocket endpoint ws://localhost:${config.port}/ws`);
});

process.on("SIGINT", () => {
  streamingEngine.stop();
  server.close(() => process.exit(0));
});
