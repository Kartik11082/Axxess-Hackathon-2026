import { Request } from "express";
import { store } from "../data/store";

export function canAccessPatient(req: Request, patientId: string): boolean {
  if (!req.auth) {
    return false;
  }

  if (req.auth.role === "Patient") {
    return req.auth.userId === patientId;
  }

  const mappedPatients = store.getCaregiverPatientIds(req.auth.userId);
  return mappedPatients.includes(patientId);
}
