import { AuthGate } from "@/components/AuthGate";
import { PatientDashboard } from "@/components/PatientDashboard";

export default function PatientPage() {
  return (
    <AuthGate allowedRole="Patient">
      <PatientDashboard />
    </AuthGate>
  );
}
