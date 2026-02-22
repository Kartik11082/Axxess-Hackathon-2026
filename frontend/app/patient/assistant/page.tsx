import { AuthGate } from "@/components/AuthGate";
import { PatientWellnessPage } from "@/components/PatientWellnessPage";

export default function PatientAssistantPage() {
  return (
    <AuthGate allowedRole="Patient">
      <PatientWellnessPage mode="assistant" />
    </AuthGate>
  );
}
