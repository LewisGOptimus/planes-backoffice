import { fromUnknownError, success } from "@/lib/api/response";
import { readJson, requireDate, requireNumberLike, requireUuid } from "@/lib/api/validation";
import { AppError } from "@/lib/api/types";
import { getSuscripcionEntitlements } from "@/lib/services/backoffice";
import {
  createSubscriptionEntitlementOverride,
  listSubscriptionEntitlementHistory,
  type EntitlementOrigin,
} from "@/lib/services/entitlements-admin";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

function parseNullableInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(requireNumberLike(value, field));
  if (!Number.isInteger(num)) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} debe ser entero`);
  }
  return num;
}

function parseNullableBoolean(value: unknown, field: string): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (raw === "true") return true;
    if (raw === "false") return false;
  }
  throw new AppError(400, "VALIDATION_ERROR", `${field} debe ser true o false`);
}

function parseOverrideOrigin(value: unknown): EntitlementOrigin {
  if (value === null || value === undefined || value === "") return "ADDON";
  const raw = String(value).trim().toUpperCase();
  if (raw === "ADDON" || raw === "MANUAL" || raw === "LEGACY") return raw;
  throw new AppError(400, "VALIDATION_ERROR", "origen debe ser ADDON, MANUAL o LEGACY");
}

function parseNullableDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requireDate(value, field);
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const withHistory = url.searchParams.get("historial");
    const data =
      withHistory === "true"
        ? await listSubscriptionEntitlementHistory(id)
        : await getSuscripcionEntitlements(id);
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const payload = await readJson<Record<string, unknown>>(request);
    const data = await createSubscriptionEntitlementOverride({
      subscriptionId: id,
      entitlementId: requireUuid(payload.entitlement_id, "entitlement_id"),
      origen: parseOverrideOrigin(payload.origen),
      valorEntero: parseNullableInteger(payload.valor_entero, "valor_entero"),
      valorBooleano: parseNullableBoolean(payload.valor_booleano, "valor_booleano"),
      efectivoDesde: requireDate(payload.efectivo_desde, "efectivo_desde"),
      efectivoHasta: parseNullableDate(payload.efectivo_hasta, "efectivo_hasta"),
    });
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}
