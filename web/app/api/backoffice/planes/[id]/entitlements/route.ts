import { fromUnknownError, success } from "@/lib/api/response";
import { readJson, requireNumberLike, requireUuid } from "@/lib/api/validation";
import { AppError } from "@/lib/api/types";
import { listPlanEntitlements, upsertPlanEntitlement } from "@/lib/services/entitlements-admin";

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

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const data = await listPlanEntitlements(id);
    return success(data, { count: data.length });
  } catch (error) {
    return fromUnknownError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const payload = await readJson<Record<string, unknown>>(request);
    const data = await upsertPlanEntitlement({
      planId: id,
      entitlementId: requireUuid(payload.entitlement_id, "entitlement_id"),
      valorEntero: parseNullableInteger(payload.valor_entero, "valor_entero"),
      valorBooleano: parseNullableBoolean(payload.valor_booleano, "valor_booleano"),
    });
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}

