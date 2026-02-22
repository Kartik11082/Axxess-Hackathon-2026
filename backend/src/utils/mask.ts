export function maskInsuranceId(rawInsuranceId: string): string {
  if (!rawInsuranceId) {
    return "";
  }

  const visibleDigits = rawInsuranceId.slice(-4);
  return `****-****-${visibleDigits}`;
}

export function maskGenericId(rawValue: string): string {
  if (!rawValue) {
    return "";
  }
  if (rawValue.length <= 4) {
    return `***${rawValue}`;
  }
  return `${"*".repeat(Math.max(4, rawValue.length - 4))}${rawValue.slice(-4)}`;
}
