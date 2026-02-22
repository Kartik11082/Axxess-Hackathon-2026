import { AuthGate } from "@/components/AuthGate";
import { PatientWellnessPage } from "@/components/PatientWellnessPage";

export default function PatientCoachingPage() {
  return (
    <AuthGate allowedRole="Patient">
      <PatientWellnessPage mode="plan" />
    </AuthGate>
  );
}
