import { fromUnknownError, success } from "@/lib/api/response";
import { readJson, requireString } from "@/lib/api/validation";
import {
  createEntitlementCatalog,
  type EntitlementScope,
  type EntitlementType,
  listEntitlementsCatalog,
} from "@/lib/services/entitlements-admin";
import { AppError } from "@/lib/api/types";

function parseEntitlementType(value: unknown): EntitlementType {
  const raw = requireString(value, "tipo").toUpperCase();
  if (raw === "BOOLEANO" || raw === "LIMITE" || raw === "CONTADOR") return raw;
  throw new AppError(400, "VALIDATION_ERROR", "tipo debe ser BOOLEANO, LIMITE o CONTADOR");
}

function parseEntitlementScope(value: unknown): EntitlementScope {
  const raw = requireString(value, "alcance").toUpperCase();
  if (raw === "EMPRESA" || raw === "USUARIO") return raw;
  throw new AppError(400, "VALIDATION_ERROR", "alcance debe ser EMPRESA o USUARIO");
}

function parseNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return String(value);
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function GET() {
  try {
    const data = await listEntitlementsCatalog();
    return success(data, { count: data.length });
  } catch (error) {
    return fromUnknownError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readJson<Record<string, unknown>>(request);
    const created = await createEntitlementCatalog({
      codigo: requireString(payload.codigo, "codigo"),
      nombre: requireString(payload.nombre, "nombre"),
      tipo: parseEntitlementType(payload.tipo),
      alcance: parseEntitlementScope(payload.alcance),
      descripcion: parseNullableText(payload.descripcion),
    });
    return success(created);
  } catch (error) {
    return fromUnknownError(error);
  }
}

