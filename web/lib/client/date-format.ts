export function formatDateOnly(value: unknown, fallback = "-"): string {
  if (value === null || value === undefined) return fallback;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return fallback;
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
  }

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return fallback;
    const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (direct) return direct[1];
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return raw;
  }

  return String(value);
}

export function looksLikeDateField(key: string): boolean {
  return /fecha|date|periodo_|valido_|efectivo_|_at$|grace_until|blocked_at|event_time|desde|hasta/i.test(key);
}
