# Frontend Technical Implementation

## 1) Overview

The frontend is a Next.js App Router application written in TypeScript.  
It provides:

- role-gated login and dashboard routing
- patient dashboard with live vitals + predicted trends
- caregiver dashboard with prioritized patient triage
- real-time websocket updates and periodic prediction requests
- inactivity-based auto logout
- visual separation between observed and forecasted data

Primary app root: `frontend/app`.

## 2) Runtime and Routing

Routes:

- `/` -> login experience
- `/patient` -> patient dashboard (protected)
- `/caregiver` -> caregiver dashboard (protected)

Route protection is implemented by `AuthGate`:

- checks local session token/user from `localStorage`
- verifies role locally first
- confirms token validity with `GET /api/auth/me`
- redirects to correct route on mismatch/expired session

## 3) Project Structure

- `frontend/app`: route entrypoints and global layout/styles
- `frontend/components`: UI and dashboard composition
- `frontend/lib/api.ts`: typed fetch wrapper with bearer auth
- `frontend/lib/auth.ts`: local session storage helpers
- `frontend/lib/hooks.ts`: websocket + inactivity session hooks
- `frontend/lib/types.ts`: shared client-side interfaces
- `frontend/app/globals.css`: design tokens, layout, responsive behavior

## 4) Session and Security Behavior

### Local session persistence

Stored keys in browser local storage:

- `axxess_token`
- `axxess_user`

Managed through:

- `saveSession`
- `getToken`
- `getUser`
- `clearSession`

### Inactivity auto logout

`useInactivityLogout` attaches listeners for:

- mousemove
- keydown
- click
- touchstart
- scroll

Any activity resets the timeout; expiry triggers forced logout redirect.

## 5) API Integration Layer

File: `frontend/lib/api.ts`.

`apiRequest<T>()` behavior:

- prefixes requests with `NEXT_PUBLIC_API_BASE_URL`
- sets `Content-Type: application/json`
- injects `Authorization: Bearer <token>` by default
- supports unauthenticated calls via `authenticated: false`
- normalizes backend error payloads to thrown JS errors

## 6) Real-Time Streaming Client

File: `frontend/lib/hooks.ts`, hook `useVitalsSocket`.

Flow:

1. Open websocket to `NEXT_PUBLIC_WS_URL`.
2. Send auth message with JWT token on open.
3. After `auth_ok`, optionally subscribe to `patientId`.
4. Handle incoming events:
   - `vitals` -> update observed telemetry
   - `prediction` -> update forecast/risk panels
5. Track connection state (`connected`, `statusText`) for UI use.

The hook uses refs for callbacks to avoid stale closure issues on rapid updates.

## 7) UI Architecture

### Shared composition components

- `AppHeader`: title, role subtitle, status chip, logout action
- `NotificationPanel`: notification list and acknowledgement action
- `LiveVitalsChart`: observed telemetry chart (solid style)
- `RiskForecastChart`: observed + projected risk chart (solid + dashed/gradient)
- `PredictionInsights`: explainability, risk momentum, disease class, ICD panel
- `TrendHeatmap`: day-wise risk state coloring
- `CaregiverPriorityTable`: ranked patient triage list

### Dashboard containers

#### Patient dashboard (`PatientDashboard`)

- loads own profile/prediction/notifications on mount
- subscribes to own websocket stream
- refreshes insurance compatibility panel
- periodically submits recent samples to `/api/predict-risk` (20s)
- renders:
  - live vitals (left)
  - notifications (left)
  - forecast chart (right)
  - explainability panel (right)
  - trend heatmap (right)

#### Caregiver dashboard (`CaregiverDashboard`)

- loads assigned patients + prioritized alerts on mount
- loads selected patient detail
- subscribes to selected patient stream
- refreshes insurance compatibility for selected patient
- supports patient switching from prioritization table
- renders:
  - prioritization table (top)
  - live/prediction panels for selected patient
  - notification feed

## 8) Visual Differentiation: Observed vs Predicted

Implemented in chart components + CSS:

- Observed data:
  - solid lines
  - blue/teal/yellow telemetry palette
  - pulsing `LIVE DATA` badge
  - latest timestamp label
- Predicted data:
  - dashed magenta line (`strokeDasharray`)
  - gradient area fill for projection
  - `PREDICTED TREND` badge
  - confidence badge
  - explicit non-diagnostic disclaimer text

## 9) Styling System

File: `frontend/app/globals.css`.

Highlights:

- CSS variables for theme tokens and semantics
- custom font pairing via `next/font`:
  - headings: `Space Grotesk`
  - body: `IBM Plex Sans`
- layered radial/linear gradient background
- subtle entry animation and pulse animation for live badge
- responsive breakpoints:
  - <= 960px collapses to single-column dashboard
  - <= 680px optimizes header/table/heatmap for small screens

## 10) Environment Configuration

Source: `frontend/.env.example`.

- `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:4000`)
- `NEXT_PUBLIC_WS_URL` (default `ws://localhost:4000/ws`)

## 11) User Flows

### Login flow

1. User submits email/password on `/`.
2. Frontend calls `POST /api/auth/login`.
3. Token/user saved locally.
4. User redirected by role to `/patient` or `/caregiver`.

### Patient monitoring flow

1. Patient dashboard loads existing baseline and latest prediction.
2. Websocket pushes live vitals and prediction updates.
3. Dashboard sends rolling sample windows for fresh predictions.
4. Notifications and risk panels update in near real-time.

### Caregiver triage flow

1. Caregiver opens assigned patient list and priority ranking.
2. Selects patient from triage table.
3. Watches live vitals + predicted trend for that patient.
4. Acknowledges alerts as needed.

## 12) Current Limits and Production Gaps

- Session is local-storage based (no refresh-token flow)
- No SSR auth gating; guard is client-side
- No global state manager (React local state only)
- No end-to-end UI test suite included yet
- Some UX states can be further improved for slow/offline network handling
