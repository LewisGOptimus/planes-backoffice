import { AppError } from "@/lib/api/types";
import { fromUnknownError, success } from "@/lib/api/response";
import { readJson } from "@/lib/api/validation";
import { RESOURCE_MAP } from "@/lib/repositories/resource-map";
import { createRow, deleteRow, getRowById, listRows, updateRow } from "@/lib/repositories/crud";
import { query } from "@/lib/db";
import { CRUD_RESOURCES } from "@/lib/crud-catalog";
import {
  assertValidProductShape,
  ensureProductCatalogSchema,
} from "@/lib/services/product-catalog";
import {
  runAfterSubscriptionCreate,
  runAfterSubscriptionPatch,
  runBeforeSubscriptionCreate,
  runBeforeSubscriptionDelete,
  runBeforeSubscriptionPatch,
} from "@/src/modules/suscripciones/adapters/inbound/v1-subscriptions-adapter";

type RouteContext = {
  params: Promise<{ path: string[] }> | { path: string[] };
};

async function ensureProductoSchema() {
  await ensureProductCatalogSchema();
}

async function ensureEmpresaSchema() {
  return;
}

async function ensureBillingGraceSchema() {
  return;
}

async function ensureContractsSchema() {
  return;
}

async function getPathParts(ctx: RouteContext): Promise<string[]> {
  const params = await ctx.params;
  return params.path ?? [];
}

function asCleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolLike(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  const raw = asCleanString(value).toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new AppError(400, "VALIDATION_ERROR", `${field} must be true or false`);
}

function normalizeContractCycle(value: unknown): "MENSUAL" | "ANUAL" {
  const cycle = asCleanString(value).toUpperCase();
  if (cycle === "MENSUAL" || cycle === "ANUAL") return cycle;
  throw new AppError(400, "VALIDATION_ERROR", "billing_cycle must be MENSUAL or ANUAL");
}

function normalizeContractPrice(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new AppError(400, "VALIDATION_ERROR", "precio must be a non-negative number");
  }
  return num.toFixed(2);
}

function normalizeContractType(value: unknown): "mensual" | "anual" {
  const raw = asCleanString(value).toLowerCase();
  if (raw === "mensual" || raw === "anual") return raw;
  throw new AppError(400, "VALIDATION_ERROR", "tipo_contrato must be mensual or anual");
}

async function resolvePlanSnapshot(planId: string): Promise<{ planNombre: string }> {
  const plan = await query<{ nombre: string }>("SELECT nombre FROM billing.planes WHERE id = $1 LIMIT 1", [planId]);
  if (!plan.rows[0]) {
    throw new AppError(404, "NOT_FOUND", "plan_id not found");
  }
  return { planNombre: asCleanString(plan.rows[0].nombre) || "Plan sin definir" };
}

async function ensureContractCreateRules(payload: Record<string, unknown>) {
  const contractType = normalizeContractType(payload.tipo_contrato);
  const cycle = payload.billing_cycle
    ? normalizeContractCycle(payload.billing_cycle)
    : contractType === "anual"
      ? "ANUAL"
      : "MENSUAL";
  const customerName = asCleanString(payload.nombre_cliente_empresa);
  if (!customerName) {
    throw new AppError(400, "VALIDATION_ERROR", "nombre_cliente_empresa is required");
  }
  const nit = asCleanString(payload.nit);
  if (!nit) {
    throw new AppError(400, "VALIDATION_ERROR", "nit is required");
  }
  if (!/^\d+$/.test(nit)) {
    throw new AppError(400, "VALIDATION_ERROR", "nit must contain only digits");
  }
  const nitIndicativo = asCleanString(payload.nit_indicativo);
  if (nitIndicativo && !/^\d+$/.test(nitIndicativo)) {
    throw new AppError(400, "VALIDATION_ERROR", "nit_indicativo must contain only digits");
  }
  const planNameRaw = asCleanString(payload.plan_nombre);
  if (!planNameRaw) {
    throw new AppError(400, "VALIDATION_ERROR", "plan_nombre is required");
  }
  const price = normalizeContractPrice(payload.precio);
  const contractDate = asCleanString(payload.fecha_contrato);
  const firstPaymentDate = asCleanString(payload.fecha_primer_pago);
  if (!contractDate) {
    throw new AppError(400, "VALIDATION_ERROR", "fecha_contrato is required");
  }
  if (!firstPaymentDate) {
    throw new AppError(400, "VALIDATION_ERROR", "fecha_primer_pago is required");
  }
  const active = payload.activo === undefined ? true : normalizeBoolLike(payload.activo, "activo");
  const extra = asCleanString(payload.adicionales);
  const planId = asCleanString(payload.plan_id);
  let resolvedPlanName = planNameRaw;
  if (planId) {
    const snapshot = await resolvePlanSnapshot(planId);
    resolvedPlanName = snapshot.planNombre || planNameRaw;
  }

  delete payload.periodo;
  delete payload.representante_nombre;
  delete payload.plan;
  payload.billing_cycle = cycle;
  payload.tipo_contrato = contractType;
  payload.nombre_cliente_empresa = customerName;
  payload.nit = nit;
  payload.nit_indicativo = nitIndicativo || null;
  payload.plan_nombre = resolvedPlanName;
  payload.precio = price;
  payload.fecha_contrato = contractDate;
  payload.fecha_primer_pago = firstPaymentDate;
  payload.adicionales = extra || null;
  payload.activo = active;
  payload.representante_nombre = customerName;
  payload.empresa_id = payload.empresa_id ? asCleanString(payload.empresa_id) || null : null;
  payload.plan_id = planId || null;
}

async function ensureContractPatchRules(contractId: string, payload: Record<string, unknown>) {
  const current = await query<{ id: string; plan_nombre: string; nombre_cliente_empresa: string }>(
    "SELECT id::text, plan_nombre, nombre_cliente_empresa FROM billing.contratos WHERE id = $1 LIMIT 1",
    [contractId],
  );
  if (!current.rows[0]) {
    throw new AppError(404, "NOT_FOUND", "contratos not found");
  }

  if (payload.tipo_contrato !== undefined) {
    payload.tipo_contrato = normalizeContractType(payload.tipo_contrato);
  }
  if (payload.billing_cycle !== undefined || payload.periodo !== undefined) {
    payload.billing_cycle = normalizeContractCycle(payload.billing_cycle ?? payload.periodo);
  }
  if (payload.precio !== undefined) {
    payload.precio = normalizeContractPrice(payload.precio);
  }
  if (payload.activo !== undefined) {
    payload.activo = normalizeBoolLike(payload.activo, "activo");
  }
  if (payload.nombre_cliente_empresa !== undefined) {
    const customerName = asCleanString(payload.nombre_cliente_empresa);
    if (!customerName) {
      throw new AppError(400, "VALIDATION_ERROR", "nombre_cliente_empresa cannot be empty");
    }
    payload.nombre_cliente_empresa = customerName;
    payload.representante_nombre = customerName;
  }
  if (payload.nit !== undefined) {
    const nit = asCleanString(payload.nit);
    if (!nit) {
      throw new AppError(400, "VALIDATION_ERROR", "nit cannot be empty");
    }
    if (!/^\d+$/.test(nit)) {
      throw new AppError(400, "VALIDATION_ERROR", "nit must contain only digits");
    }
    payload.nit = nit;
  }
  if (payload.nit_indicativo !== undefined) {
    const nitIndicativo = asCleanString(payload.nit_indicativo);
    if (nitIndicativo && !/^\d+$/.test(nitIndicativo)) {
      throw new AppError(400, "VALIDATION_ERROR", "nit_indicativo must contain only digits");
    }
    payload.nit_indicativo = nitIndicativo || null;
  }
  if (payload.plan_nombre !== undefined) {
    const planName = asCleanString(payload.plan_nombre);
    if (!planName) {
      throw new AppError(400, "VALIDATION_ERROR", "plan_nombre cannot be empty");
    }
    payload.plan_nombre = planName;
  }
  if (payload.fecha_contrato !== undefined && !asCleanString(payload.fecha_contrato)) {
    throw new AppError(400, "VALIDATION_ERROR", "fecha_contrato cannot be empty");
  }
  if (payload.fecha_primer_pago !== undefined && !asCleanString(payload.fecha_primer_pago)) {
    throw new AppError(400, "VALIDATION_ERROR", "fecha_primer_pago cannot be empty");
  }
  if (payload.plan_id !== undefined) {
    const planId = asCleanString(payload.plan_id);
    if (!planId) {
      payload.plan_id = null;
    } else {
      const snapshot = await resolvePlanSnapshot(planId);
      payload.plan_id = planId;
      payload.plan_nombre = snapshot.planNombre;
    }
  }

  delete payload.periodo;
  delete payload.plan;
  if (payload.adicionales !== undefined) {
    const extra = asCleanString(payload.adicionales);
    payload.adicionales = extra || null;
  }
  if (payload.empresa_id !== undefined) {
    const empresaId = asCleanString(payload.empresa_id);
    payload.empresa_id = empresaId || null;
  }
  if (!payload.nombre_cliente_empresa && payload.representante_nombre !== undefined) {
    delete payload.representante_nombre;
  }
}

async function ensureProductCreateRules(payload: Record<string, unknown>) {
  assertValidProductShape(payload);
  const tipo = asCleanString(payload.tipo);
  if (tipo !== "CONSUMIBLE") return;

  const unidad = asCleanString(payload.unidad_consumo);
  if (!unidad) {
    throw new AppError(400, "VALIDATION_ERROR", "unidad_consumo is required for CONSUMIBLE products");
  }
}

async function ensureProductPatchRules(id: string, payload: Record<string, unknown>) {
  const current = await query<{
    tipo: string;
    unidad_consumo: string | null;
    visibility: string;
  }>(
    "SELECT tipo::text AS tipo, unidad_consumo, visibility::text AS visibility FROM billing.productos WHERE id = $1 LIMIT 1",
    [id],
  );
  const row = current.rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "productos not found");

  assertValidProductShape({
    visibility: payload.visibility ?? row.visibility,
  });

  const tipo = asCleanString(payload.tipo) || row.tipo;
  if (tipo !== "CONSUMIBLE") return;
  const unidad = asCleanString(payload.unidad_consumo) || asCleanString(row.unidad_consumo);
  if (!unidad) {
    throw new AppError(400, "VALIDATION_ERROR", "unidad_consumo is required for CONSUMIBLE products");
  }
}

async function ensureSubscriptionCreateRules(payload: Record<string, unknown>) {
  await runBeforeSubscriptionCreate(payload);
}

async function ensureSubscriptionPatchRules(id: string, payload: Record<string, unknown>) {
  return runBeforeSubscriptionPatch(id, payload);
}

async function ensureSubscriptionItemCreateRules(payload: Record<string, unknown>) {
  const productId = asCleanString(payload.producto_id);
  if (!productId) return;

  const productRes = await query<{ id: string; es_consumible: boolean }>(
    "SELECT id::text AS id, es_consumible FROM billing.productos WHERE id = $1 LIMIT 1",
    [productId],
  );
  const product = productRes.rows[0];
  if (!product) {
    throw new AppError(404, "NOT_FOUND", "producto_id not found");
  }

  const precioId = asCleanString(payload.precio_id);
  const operationDate = asCleanString(payload.fecha_inicio) || new Date().toISOString().slice(0, 10);
  if (product.es_consumible && !precioId) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_id is required for consumable subscription items");
  }
  if (!precioId) return;

  const priceRes = await query<{ producto_id: string; activo: boolean; valido_desde: string | null; valido_hasta: string | null }>(
    "SELECT producto_id::text, activo, valido_desde::text, valido_hasta::text FROM billing.precios WHERE id = $1 LIMIT 1",
    [precioId],
  );
  const price = priceRes.rows[0];
  if (!price) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_id not found");
  }
  if (price.producto_id !== productId) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_id does not belong to producto_id");
  }
  if (!price.activo) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_id is inactive");
  }
  if ((price.valido_desde && price.valido_desde > operationDate) || (price.valido_hasta && price.valido_hasta < operationDate)) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_id is not valid for fecha_inicio");
  }
}

async function ensureSubscriptionItemPatchRules(itemId: string, payload: Record<string, unknown>) {
  const currentRes = await query<{ id: string; producto_id: string; precio_id: string | null; fecha_inicio: string }>(
    "SELECT id::text, producto_id::text, precio_id::text, fecha_inicio::text FROM billing.items_suscripcion WHERE id = $1 LIMIT 1",
    [itemId],
  );
  const current = currentRes.rows[0];
  if (!current) {
    throw new AppError(404, "NOT_FOUND", "items-suscripcion not found");
  }

  const productId = asCleanString(payload.producto_id) || current.producto_id;
  const precioId = asCleanString(payload.precio_id) || asCleanString(current.precio_id);
  const operationDate = asCleanString(payload.fecha_inicio) || current.fecha_inicio || new Date().toISOString().slice(0, 10);

  const productRes = await query<{ es_consumible: boolean }>(
    "SELECT es_consumible FROM billing.productos WHERE id = $1 LIMIT 1",
    [productId],
  );
  const product = productRes.rows[0];
  if (!product) {
    throw new AppError(404, "NOT_FOUND", "producto_id not found");
  }
  if (product.es_consumible && !precioId) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_id is required for consumable subscription items");
  }
  if (!precioId) return;

  const priceRes = await query<{ producto_id: string; activo: boolean; valido_desde: string | null; valido_hasta: string | null }>(
    "SELECT producto_id::text, activo, valido_desde::text, valido_hasta::text FROM billing.precios WHERE id = $1 LIMIT 1",
    [precioId],
  );
  const price = priceRes.rows[0];
  if (!price) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_id not found");
  }
  if (price.producto_id !== productId) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_id does not belong to producto_id");
  }
  if (!price.activo) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_id is inactive");
  }
  if ((price.valido_desde && price.valido_desde > operationDate) || (price.valido_hasta && price.valido_hasta < operationDate)) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_id is not valid for fecha_inicio");
  }
}

async function syncPlanItemsForSubscription(row: Record<string, unknown>) {
  await runAfterSubscriptionCreate(row);
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const parts = await getPathParts(context);
    if (parts.length === 0) throw new AppError(404, "NOT_FOUND", "Endpoint not found");

    const [resource, ...idParts] = parts;
    if (resource === "meta") {
      const [kind] = idParts;
      if (kind === "resources") {
        return success(CRUD_RESOURCES);
      }
      if (kind === "health") {
        const db = await query<{ ok: number }>("SELECT 1 AS ok");
        return success({
          api: true,
          db: db.rowCount === 1,
          seedEnabled: process.env.NODE_ENV !== "production" && Boolean(process.env.DEV_SEED_KEY),
          now: new Date().toISOString(),
        });
      }
      throw new AppError(404, "NOT_FOUND", "Meta endpoint not found");
    }

    if (resource === "workflows") throw new AppError(404, "NOT_FOUND", "Workflows disabled");
    if (resource === "productos") {
      await ensureProductoSchema();
    }
    if (resource === "empresas") {
      await ensureEmpresaSchema();
    }
    if (resource === "suscripciones" || resource === "politicas-cobro" || resource === "cobro-eventos") {
      await ensureBillingGraceSchema();
    }
    if (resource === "contratos") {
      await ensureContractsSchema();
    }

    const config = RESOURCE_MAP.get(resource);
    if (!config) throw new AppError(404, "NOT_FOUND", "Resource not found");
    if (idParts.length > 0) {
      const row = await getRowById(config, idParts);
      return success(row);
    }

    const rows = await listRows(config, new URL(request.url).searchParams);
    return success(rows, { count: rows.length });
  } catch (error) {
    return fromUnknownError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const parts = await getPathParts(context);
    if (parts.length === 0) throw new AppError(404, "NOT_FOUND", "Endpoint not found");
    const [resource] = parts;

    if (resource === "workflows") throw new AppError(404, "NOT_FOUND", "Workflows disabled");
    if (resource === "productos") {
      await ensureProductoSchema();
    }
    if (resource === "empresas") {
      await ensureEmpresaSchema();
    }
    if (resource === "suscripciones" || resource === "politicas-cobro" || resource === "cobro-eventos") {
      await ensureBillingGraceSchema();
    }
    if (resource === "contratos") {
      await ensureContractsSchema();
    }

    const config = RESOURCE_MAP.get(resource);
    if (!config) throw new AppError(404, "NOT_FOUND", "Resource not found");
    if (parts.length > 1) throw new AppError(405, "VALIDATION_ERROR", "POST does not accept id path");

    const payload = await readJson<Record<string, unknown>>(request);
    if (resource === "productos") {
      await ensureProductCreateRules(payload);
    }
    if (resource === "suscripciones") {
      if (!payload.billing_cycle && payload.periodo) payload.billing_cycle = payload.periodo;
      if (!payload.periodo && payload.billing_cycle) payload.periodo = payload.billing_cycle;
      await ensureSubscriptionCreateRules(payload);
    }
    if (resource === "items-suscripcion") {
      await ensureSubscriptionItemCreateRules(payload);
    }
    if (resource === "contratos") {
      await ensureContractCreateRules(payload);
    }
    const row = await createRow(config, payload);
    if (resource === "suscripciones") {
      await syncPlanItemsForSubscription(row as Record<string, unknown>);
    }
    return success(row);
  } catch (error) {
    return fromUnknownError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const parts = await getPathParts(context);
    if (parts.length < 2) throw new AppError(405, "VALIDATION_ERROR", "PATCH requires resource id");
    const [resource, ...idParts] = parts;
    const config = RESOURCE_MAP.get(resource);
    if (!config) throw new AppError(404, "NOT_FOUND", "Resource not found");
    if (resource === "productos") {
      await ensureProductoSchema();
    }
    if (resource === "empresas") {
      await ensureEmpresaSchema();
    }
    if (resource === "suscripciones" || resource === "politicas-cobro" || resource === "cobro-eventos") {
      await ensureBillingGraceSchema();
    }
    if (resource === "contratos") {
      await ensureContractsSchema();
    }

    const payload = await readJson<Record<string, unknown>>(request);
    let subscriptionPatchContext: Awaited<ReturnType<typeof ensureSubscriptionPatchRules>> | null = null;
    if (resource === "productos" && idParts.length === 1) {
      await ensureProductPatchRules(idParts[0]!, payload);
    }
    if (resource === "suscripciones" && idParts.length === 1) {
      if (!payload.billing_cycle && payload.periodo) payload.billing_cycle = payload.periodo;
      if (!payload.periodo && payload.billing_cycle) payload.periodo = payload.billing_cycle;
      subscriptionPatchContext = await ensureSubscriptionPatchRules(idParts[0]!, payload);
    }
    if (resource === "items-suscripcion" && idParts.length === 1) {
      await ensureSubscriptionItemPatchRules(idParts[0]!, payload);
    }
    if (resource === "contratos" && idParts.length === 1) {
      await ensureContractPatchRules(idParts[0]!, payload);
    }
    const row = await updateRow(config, idParts, payload);
    if (resource === "suscripciones" && idParts.length === 1 && subscriptionPatchContext) {
      await runAfterSubscriptionPatch(idParts[0], subscriptionPatchContext, row as Record<string, unknown>, payload);
    }
    return success(row);
  } catch (error) {
    return fromUnknownError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const parts = await getPathParts(context);
    if (parts.length < 2) throw new AppError(405, "VALIDATION_ERROR", "DELETE requires resource id");
    const [resource, ...idParts] = parts;
    const config = RESOURCE_MAP.get(resource);
    if (!config) throw new AppError(404, "NOT_FOUND", "Resource not found");

    if (resource === "suscripciones" && idParts.length === 1) {
      const raw = await request.text();
      let payload: Record<string, unknown> = {};
      if (raw.trim() !== "") {
        try {
          payload = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          throw new AppError(400, "VALIDATION_ERROR", "Invalid JSON body");
        }
      }
      await runBeforeSubscriptionDelete(idParts[0], asCleanString(payload.motivo));
    }

    const row = await deleteRow(config, idParts);
    return success(row);
  } catch (error) {
    return fromUnknownError(error);
  }
}

