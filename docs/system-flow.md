# End-to-End System Flow

1. Patient authenticates and completes onboarding inference questionnaire.
2. Baseline disease/risk estimate is stored in `PatientProfile`.
3. WebSocket engine emits wearable vitals every 3-5 seconds.
4. Frontend dashboards update live with observed vitals.
5. Backend aggregates recent vitals and computes predictions every 15 seconds.
6. Predicted risk trend and explainability are delivered through WebSocket/API.
7. Alert conditions trigger notifications for patient, caregiver, and beneficiaries.
8. Caregiver dashboard ranks assigned patients by priority score.
9. Insurance compatibility endpoint maps disease signal to ICD category.
10. Caregiver actions are audit logged for compliance traceability.
