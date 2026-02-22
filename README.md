# Axxess Hackathon 2026: Predictive Care System

Full-stack mock implementation of a role-based healthcare monitoring platform with:

- Real-time wearable streaming over WebSocket
- Predictive risk scoring and 7-day forecasting
- Patient and caregiver dashboards with strict role filtering
- HIPAA-minded handling patterns (query guardrails, masked insurance IDs, audit logging)
- Alerting pipeline for patient, caregiver, and beneficiary channels

## Stack

- Frontend: Next.js (App Router) + Recharts
- Backend: Node.js + Express + `ws` + Prisma
- Database: SQLite (schema now includes all in-memory entities)
- Data: In-memory models (mock-ready structure)
- Auth: JWT with role-based route enforcement

## Repository Layout

- `backend`: Express REST API + WebSocket server + mock predictive engine
- `frontend`: Next.js app with patient and caregiver dashboards
- `shared`: Cross-service model contracts (available for extension)

## Technical Implementation Docs

- Backend: `docs/backend-technical-implementation.md`
- Frontend: `docs/frontend-technical-implementation.md`

## Implemented Capabilities

### 1. Role-Based Auth + Access Control

- Roles: `Patient`, `Caregiver`
- JWT login/register + protected endpoints
- Caregiver access restricted to assigned patients via `CaregiverPatientMapping`
- Frontend route guards on `/patient` and `/caregiver`

### 2. HIPAA Guardrails (Mock)

- Sensitive query parameters are blocked server-side
- Insurance IDs masked in API responses
- Inactivity auto-logout in frontend session hook
- Caregiver actions audit logged (`caregiver_view_*`, mapping updates, prioritization views)

### 3. Streaming and Predictive Engine

- WebSocket endpoint: `ws://localhost:4000/ws`
- Vitals emitted every 3-5 seconds per patient
- Periodic aggregation and model scoring every 15 seconds
- `/api/predict-risk` endpoint for direct prediction requests
- Prediction payload includes:
  - `predictedRiskScore`
  - `predictedDisease`
  - `confidence`
  - `predictedTrend` (7 day)
  - `riskMomentum`
  - `explainability`
  - `icdCode`

### 4. Dashboard Differentiation: Observed vs Predicted

- Observed panel:
  - solid live chart lines
  - pulsing `LIVE DATA` badge
  - latest timestamp
- Predicted panel:
  - dashed projected risk line
  - gradient forecast fill
  - `PREDICTED TREND` + confidence badge
  - disclaimer tooltip copy

### 5. Advanced Features

- Risk momentum indicator (`Increasing`, `Improving`, `Stable`)
- Explainable AI panel (top feature contributors)
- Caregiver alert prioritization: `riskScore * confidence * (1 + max(rateOfChange, 0))`
- Trend heatmap (`Stable`, `Watch`, `High risk`)
- Insurance ICD mapping:
  - Diabetes -> `E11.9`
  - Cardiac -> `I25.x`

## API Overview

Base URL: `http://localhost:4000/api`

- Auth
  - `POST /auth/register`
  - `POST /auth/login`
  - `GET /auth/me`
- Onboarding
  - `POST /onboarding/assess`
- Patients
  - `GET /patients/me`
  - `POST /patients/me/beneficiaries`
  - `GET /patients/:patientId/vitals`
  - `GET /patients/:patientId/predictions`
- Caregiver
  - `GET /caregiver/patients`
  - `GET /caregiver/patients/:patientId`
  - `POST /caregiver/mappings`
  - `GET /caregiver/alerts/prioritized`
  - `GET /caregiver/audit`
- Prediction
  - `POST /predict-risk`
- Assistant (Featherless-backed)
  - `POST /assistant/coach-plan`
  - `POST /assistant/chat`
- Notifications
  - `GET /notifications`
  - `POST /notifications/:notificationId/ack`
- Insurance
  - `GET /insurance/check/:patientId`

## Local Run

1. Copy env templates:
   - `backend/.env.example` -> `backend/.env`
   - `frontend/.env.example` -> `frontend/.env.local`
2. Install dependencies from repo root:
   - `npm install`
3. Start both apps:
   - `npm run dev`
4. Open:
   - Frontend: `http://localhost:3000`
   - Backend health: `http://localhost:4000/api/health`

## Featherless AI Setup

Set these in `backend/.env`:

- `FEATHERLESS_API_URL=https://api.featherless.ai/v1/chat/completions`
- `FEATHERLESS_API_KEY=<your-key>`
- `FEATHERLESS_MODEL=deepseek-ai/DeepSeek-V3-0324`
- `FEATHERLESS_TIMEOUT_MS=25000`

If key/model are missing or unavailable, assistant endpoints fall back to deterministic local guidance.

Patient wellness pages:

- `/patient/coaching` for Diet & Lifestyle Coaching
- `/patient/assistant` for Virtual Assistant workflows

## Login Troubleshooting (`Failed to fetch`)

If login shows `Failed to fetch`, backend is usually not running or Prisma is not initialized.

Run in order:

1. `npm run db:generate --workspace backend`
2. `npm run db:push --workspace backend`
3. `npm run db:seed --workspace backend`
4. `npm run dev:backend`
5. Verify health in browser: `http://localhost:4000/api/health`
6. Then run frontend: `npm run dev:frontend`

## Database Setup (Persistent Mapping)

From repo root:

1. Ensure `DATABASE_URL` in `backend/.env` is:
   - `DATABASE_URL=file:./dev.db`
2. Install deps:
   - `npm install`
3. Generate Prisma client:
   - `npm run db:generate --workspace backend`
4. Create/apply schema:
   - `npm run db:push --workspace backend`
5. Seed demo users/data:
   - `npm run db:seed --workspace backend`

## Demo Credentials

- Patient: `patient1@demo.com` / `Password123!`
- Patient: `patient2@demo.com` / `Password123!`
- Caregiver: `caregiver@demo.com` / `Password123!`

## Notes

- Runtime still uses in-memory service objects for most operations.
- SQLite now holds the SQL model for all core entities and is seeded with demo records.
- Prediction engine is heuristic and non-diagnostic by design.
- Notification channels are mocked (email/SMS entries are logged internally).
