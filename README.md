# Axxess Hackathon 2026: Predictive Care System

Full-stack mock implementation of a role-based healthcare monitoring platform with:

- Real-time wearable streaming over WebSocket
- Predictive risk scoring and 7-day forecasting
- Patient and caregiver dashboards with strict role filtering
- HIPAA-minded handling patterns (query guardrails, masked insurance IDs, audit logging)
- Alerting pipeline for patient, caregiver, and beneficiary channels

## Stack

- Frontend: Next.js (App Router) + Recharts
- Backend: Node.js + Express + `ws`
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

## Demo Credentials

- Patient: `patient1@demo.com` / `Password123!`
- Patient: `patient2@demo.com` / `Password123!`
- Caregiver: `caregiver@demo.com` / `Password123!`

## Notes

- Data is in-memory and resets on backend restart.
- Prediction engine is heuristic and non-diagnostic by design.
- Notification channels are mocked (email/SMS entries are logged internally).
