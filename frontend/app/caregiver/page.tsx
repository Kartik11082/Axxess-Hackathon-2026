import { AuthGate } from "@/components/AuthGate";
import { CaregiverDashboard } from "@/components/CaregiverDashboard";

export default function CaregiverPage() {
  return (
    <AuthGate allowedRole="Caregiver">
      <CaregiverDashboard />
    </AuthGate>
  );
}
