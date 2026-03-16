export function formatMoney(
  value: unknown,
  currency = "COP",
  locale = "es-CO",
  fallback = "-",
): string {
  if (value === null || value === undefined) return fallback;

  let numeric: number | null = null;

  if (typeof value === "number") {
    numeric = Number.isFinite(value) ? value : null;
  } else if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return fallback;
    const normalized = raw.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
    const parsed = Number(normalized);
    numeric = Number.isFinite(parsed) ? parsed : null;
  }

  if (numeric === null) return String(value);

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function looksLikeMoneyField(key: string): boolean {
  if (/_id$/i.test(key)) return false;
  return /^(valor|total|monto|subtotal|descuento)(_|$)|(_valor|_total|_monto|_subtotal|_descuento)$|precio_unitario|item_factura_total|incremento_mensual|incremento_anual/i.test(key);
}
