import { AppError } from "@/lib/api/types";

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid JSON body");
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError(400, "VALIDATION_ERROR", `${field} must be a non-empty string`);
  }
  return value;
}

export function requireUuid(value: unknown, field: string): string {
  const text = requireString(value, field);
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!re.test(text)) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} must be a valid UUID`);
  }
  return text;
}

export function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} must be YYYY-MM-DD`);
  }
  return value;
}

export function requireDate(value: unknown, field: string): string {
  const parsed = optionalDate(value, field);
  if (!parsed) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} is required`);
  }
  return parsed;
}

export function requireNumberLike(value: unknown, field: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return value;
  }
  throw new AppError(400, "VALIDATION_ERROR", `${field} must be numeric`);
}

export function assert(condition: unknown, message: string, code: "VALIDATION_ERROR" | "BUSINESS_RULE_VIOLATION" = "VALIDATION_ERROR") {
  if (!condition) {
    throw new AppError(400, code, message);
  }
}
