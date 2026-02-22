import { store } from "../data/store";

export function logCaregiverAction(params: {
  caregiverId: string;
  action: string;
  patientId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): void {
  store.addAuditLog({
    actorUserId: params.caregiverId,
    action: params.action,
    patientId: params.patientId,
    metadata: params.metadata
  });
}
