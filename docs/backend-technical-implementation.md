# Backend Technical Implementation

## 1) Overview

The backend is a TypeScript Node.js service using Express for REST APIs and `ws` for real-time streaming.  
It implements:

- JWT-based authentication and role authorization (`Patient`, `Caregiver`)
- Caregiver-to-patient access filtering
- Mock wearable data streaming every 3-5 seconds
- Scheduled and on-demand risk prediction
- Notification fan-out (patient, caregiver, beneficiary mock channels)
- Audit logging for caregiver activity
- Basic HIPAA-oriented guardrails (query restrictions, masked identifiers)

Primary entrypoint: `backend/src/server.ts`.

## 2) Runtime and Boot Sequence

1. Load environment values from `.env` in `backend/src/config.ts`.
2. Create Express app + HTTP server in `backend/src/server.ts`.
3. Register middleware:
   - CORS
   - JSON parser (`1mb`)
   - PHI-like query key blocker (`insuranceId`, `ssn`, `dob`)
4. Mount API router at `/api`.
5. Start `StreamingEngine` on the same HTTP server (`/ws`).
6. Start listening on `PORT` (default `4000`).

## 3) Project Structure

- `backend/src/api`: REST route modules
- `backend/src/auth`: JWT token generation and verification
- `backend/src/config.ts`: env configuration and thresholds
- `backend/src/data/store.ts`: in-memory datastore and seeded demo entities
- `backend/src/engine/streamingEngine.ts`: websocket auth, subscriptions, stream emission, scheduled predictions
- `backend/src/middleware`: auth, role checks, patient access checks
- `backend/src/services`: risk model, prediction persistence, notifications, audit
- `backend/src/utils`: masking and time helpers
- `backend/src/models`: type definitions and Express request augmentation

## 4) Data Layer and Models

Storage is in-memory (no database), implemented in `backend/src/data/store.ts`.  
Main entity sets:

- `users` (seeded patient/caregiver accounts)
- `patientProfiles` (`Map<patientId, PatientProfile>`)
- `caregiverPatientMappings`
- `beneficiaries`
- `vitalsByPatient`
- `predictionLogsByPatient`
- `notifications`
- `outboundNotifications` (mock email/SMS records)
- `auditLogs`

Retention policies:

- Vitals history per patient: last `1200` records
- Profile wearable snapshot: last `250`
- Prediction logs per patient: last `300`
- Notifications list calls: latest `100`
- Audit list calls: latest `200`

## 5) Authentication and Authorization

### JWT

- Token generation: `backend/src/auth/jwt.ts`
- Validation middleware: `backend/src/middleware/auth.ts`
- Payload fields:
  - `userId`
  - `role`
  - `email`

### Role checks

- `requireRole("Patient" | "Caregiver")` in `backend/src/middleware/role.ts`

### Patient access filtering

- `canAccessPatient()` in `backend/src/middleware/access.ts`
- Rules:
  - Patient can access only own records
  - Caregiver can access only mapped patients

## 6) API Surface

Router root: `backend/src/api/index.ts` mounted at `/api`.

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

### Onboarding

- `POST /api/onboarding/assess`
- Input: 0-4 scores for behavioral symptoms
- Output: `baselineRiskScore`, `inferredDiseaseRisk`

### Patient

- `GET /api/patients/me`
- `POST /api/patients/me/beneficiaries`
- `GET /api/patients/:patientId/vitals`
- `GET /api/patients/:patientId/predictions`

### Caregiver

- `GET /api/caregiver/patients`
- `GET /api/caregiver/patients/:patientId`
- `POST /api/caregiver/mappings`
- `GET /api/caregiver/alerts/prioritized`
- `GET /api/caregiver/audit`

### Prediction

- `POST /api/predict-risk`
- Validates sample schema with `zod`
- Enforces single patient target consistency
- Persists prediction and updates risk state

### Notifications

- `GET /api/notifications`
- `POST /api/notifications/:notificationId/ack`

### Insurance

- `GET /api/insurance/check/:patientId`
- Returns ICD code + compatibility message

## 7) Streaming Engine

File: `backend/src/engine/streamingEngine.ts`.

Protocol:

1. Client connects to `ws://host:port/ws`.
2. Client sends `{ "type": "auth", "token": "<jwt>" }`.
3. Server replies `auth_ok` and initializes role-based subscriptions:
   - patient: own patient ID
   - caregiver: all mapped patient IDs
4. Optional client subscribe message:
   - `{ "type": "subscribe", "patientId": "..." }`
   - server validates with `canSubscribe`
5. Server emits:
   - `{ "type": "vitals", "payload": StreamingVitals }`
   - `{ "type": "prediction", "payload": PredictionResponse }`

Generation:

- Per patient timer emits synthetic vitals every random interval between `STREAM_MIN_INTERVAL_MS` and `STREAM_MAX_INTERVAL_MS`.

Scheduled predictions:

- Every `PREDICTION_RUN_INTERVAL_MS`, aggregate vitals from last `PREDICTION_WINDOW_MINUTES`, run prediction, persist, notify, and broadcast.

## 8) Prediction and Risk Logic

Files:

- `backend/src/services/riskModel.ts`
- `backend/src/services/predictionService.ts`

### Onboarding baseline

- Computes separate weighted scores for diabetes and cardiac risk from behavioral symptoms.
- `riskScore = max(diabetesScore, cardiacScore)`.
- Disease class selected if score exceeds threshold.

### Streaming prediction

- Extract features from recent vitals:
  - average HR, steps, blood oxygen, sleep
  - HR trend
- Compute normalized feature signals:
  - elevated HR, low activity, poor sleep, low oxygen, rising trend
- Compute disease-specific scores:
  - cardiac weighted sum
  - diabetes weighted sum
- `predictedRiskScore = max(cardiacScore, diabetesScore)`
- `predictedDisease` selected from higher score
- Confidence from sample volume + disease signal gap
- Risk momentum from current-vs-previous delta
- 7-day forecast generated from momentum slope
- Explainability list from dominant feature signals
- ICD mapping:
  - Diabetes -> `E11.9`
  - Cardiac -> `I25.x`
  - Stable -> `Z03.89`

### Persistence and prioritization

- Prediction logs store model output with version tag `mock-risk-model-v1.0.0`.
- Patient profile risk and class are updated on each run.
- Caregiver prioritization formula:
  - `priorityScore = riskScore * confidence * (1 + max(rateOfChange, 0))`

## 9) Notification and Audit Pipeline

Files:

- `backend/src/services/notificationService.ts`
- `backend/src/services/auditService.ts`

Triggers:

- `predictedRiskScore > PREDICTION_RISK_THRESHOLD`
- `confidence > PREDICTION_CONFIDENCE_THRESHOLD`
- sustained HR spike across configured sample count

Actions:

- Create in-app notifications for patient
- Create in-app notifications for mapped caregivers
- Create outbound mock notifications for beneficiaries (email + SMS)
- Preserve minimal PHI in notification message content

Caregiver audit:

- Key caregiver actions are logged with timestamp and action type.

## 10) HIPAA-Oriented Guardrails Implemented

- Query-level PHI-like key blocking (`insuranceId`, `ssn`, `dob`)
- Mask insurance IDs in API responses (`****-****-1234`)
- Role-based least-privilege access for patient data
- Audit trail for caregiver activity
- Notification payloads avoid clinical detail/PHI expansion

## 11) Configuration

Source: `backend/src/config.ts` and `backend/.env.example`.

Core variables:

- `PORT`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `PREDICTION_RISK_THRESHOLD`
- `PREDICTION_CONFIDENCE_THRESHOLD`
- `SUSTAINED_HR_THRESHOLD`
- `SUSTAINED_HR_SAMPLES`
- `STREAM_MIN_INTERVAL_MS`
- `STREAM_MAX_INTERVAL_MS`
- `PREDICTION_WINDOW_MINUTES`
- `PREDICTION_RUN_INTERVAL_MS`

## 12) Current Limits and Production Gaps

- In-memory storage only (data resets on restart)
- No refresh token rotation/session revocation store
- No external message bus/email/SMS provider integration
- No formal rate limiting, tracing, or persistence-level encryption
- Prediction model is heuristic/mock, not diagnostic or clinically validated
