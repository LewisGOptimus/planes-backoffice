import { AppError } from "@/lib/api/types";

export type DiscountType = "PERCENT" | "FIXED";

export type ParsedDiscountInput = {
  type: DiscountType;
  value: number;
  reason: string | null;
};

export type InvoiceDiscountTotals = {
  subtotal: number;
  discount_type: DiscountType | null;
  discount_value: number | null;
  discount_amount: number;
  discount_reason: string | null;
  total: number;
};

function round2(value: number) {
  return Number(value.toFixed(2));
}

function round4(value: number) {
  return Number(value.toFixed(4));
}

function toNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function parseBooleanLike(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (["true", "1", "yes", "si", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

export function parseDiscountInput(args: {
  typeRaw: unknown;
  valueRaw: unknown;
  reasonRaw?: unknown;
  typeField: string;
  valueField: string;
  reasonField?: string;
}): ParsedDiscountInput | null {
  const reason = toNullableText(args.reasonRaw);
  const typeText = toNullableText(args.typeRaw);
  const hasValue = !(args.valueRaw === undefined || args.valueRaw === null || `${args.valueRaw}`.trim() === "");

  if (!typeText && !hasValue) {
    return null;
  }
  if (!typeText || !hasValue) {
    throw new AppError(400, "VALIDATION_ERROR", `${args.typeField} and ${args.valueField} must be provided together`);
  }

  if (typeText !== "PERCENT" && typeText !== "FIXED") {
    throw new AppError(400, "VALIDATION_ERROR", `${args.typeField} must be PERCENT or FIXED`);
  }

  const valueNum = Number(args.valueRaw);
  if (!Number.isFinite(valueNum)) {
    throw new AppError(400, "VALIDATION_ERROR", `${args.valueField} must be numeric`);
  }
  if (valueNum < 0) {
    throw new AppError(400, "VALIDATION_ERROR", `${args.valueField} must be >= 0`);
  }
  if (typeText === "PERCENT" && valueNum > 100) {
    throw new AppError(400, "VALIDATION_ERROR", `${args.valueField} must be <= 100 for percentage discounts`);
  }

  return {
    type: typeText,
    value: typeText === "PERCENT" ? round4(valueNum) : round2(valueNum),
    reason,
  };
}

export function computeInvoiceDiscountTotals(subtotalInput: number, discount: ParsedDiscountInput | null): InvoiceDiscountTotals {
  const subtotal = round2(subtotalInput);
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    throw new AppError(400, "VALIDATION_ERROR", "subtotal must be >= 0");
  }

  if (!discount) {
    return {
      subtotal,
      discount_type: null,
      discount_value: null,
      discount_amount: 0,
      discount_reason: null,
      total: subtotal,
    };
  }

  const rawAmount = discount.type === "PERCENT" ? subtotal * (discount.value / 100) : discount.value;
  const discountAmount = round2(Math.min(subtotal, Math.max(0, rawAmount)));
  const total = round2(subtotal - discountAmount);

  return {
    subtotal,
    discount_type: discount.type,
    discount_value: discount.value,
    discount_amount: discountAmount,
    discount_reason: discount.reason,
    total,
  };
}
