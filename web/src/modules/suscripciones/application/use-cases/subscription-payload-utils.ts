export function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function toNullableDateString(value: unknown): string | null {
  const trimmedValue = toTrimmedString(value);
  return trimmedValue === '' ? null : trimmedValue;
}

export function normalizeBillingCycle(payload: Record<string, unknown>): void {
  if (!payload.billing_cycle && payload.periodo) {
    payload.billing_cycle = payload.periodo;
  }

  if (!payload.periodo && payload.billing_cycle) {
    payload.periodo = payload.billing_cycle;
  }
}