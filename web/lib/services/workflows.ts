import { PoolClient, QueryResultRow } from "pg";
import { AppError } from "@/lib/api/types";
import { assert, requireDate, requireNumberLike, requireString, requireUuid } from "@/lib/api/validation";
import { runInTransaction, lockIdempotencyKey } from "@/lib/sql/transactions";
import { syncPlanEntitlementsToSubscription } from "@/lib/services/entitlements";
import { computeInvoiceDiscountTotals, parseBooleanLike, parseDiscountInput } from "@/lib/services/invoice-discounts";

type Dict = Record<string, unknown>;
type WorkflowContext = { body: Dict; headers: Headers };
type WorkflowHandler = (ctx: WorkflowContext) => Promise<unknown>;

const PERIOD_MONTHS: Record<string, number> = { MENSUAL: 1, TRIMESTRAL: 3, ANUAL: 12 };
const todayIso = () => new Date().toISOString().slice(0, 10);
const addMonths = (iso: string, m: number) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 10);
};
const diffDays = (a: string, b: string) => {
  const x = new Date(`${a}T00:00:00.000Z`).getTime();
  const y = new Date(`${b}T00:00:00.000Z`).getTime();
  return Math.max(1, Math.floor((y - x) / 86400000));
};

async function one<T extends QueryResultRow>(client: PoolClient, sql: string, values: unknown[] = []): Promise<T | null> {
  const r = await client.query<T>(sql, values);
  return r.rows[0] ?? null;
}

async function withIdempotency(client: PoolClient, headers: Headers) {
  const key = headers.get("idempotency_key") ?? headers.get("idempotency-key");
  if (key) await lockIdempotencyKey(client, key);
}

async function ensureMoneda(client: PoolClient, codigo: string) {
  const e = await one<{ id: string }>(client, "SELECT id FROM common.monedas WHERE codigo = $1", [codigo]);
  if (e) return e.id;
  const c = await one<{ id: string }>(
    client,
    "INSERT INTO common.monedas (codigo, nombre, simbolo, decimales) VALUES ($1,$2,$3,2) RETURNING id",
    [codigo, codigo === "COP" ? "Peso Colombiano" : codigo, codigo === "COP" ? "$" : codigo],
  );
  return c!.id;
}

async function ensureProducto(client: PoolClient, data: { codigo: string; nombre: string; tipo: string; alcance: string; es_consumible?: boolean }) {
  const e = await one<{ id: string }>(client, "SELECT id FROM billing.productos WHERE codigo = $1", [data.codigo]);
  if (e) return e.id;
  const c = await one<{ id: string }>(
    client,
    "INSERT INTO billing.productos (codigo,nombre,tipo,alcance,es_consumible) VALUES ($1,$2,$3::billing.tipo_producto,$4::billing.alcance_producto,$5) RETURNING id",
    [data.codigo, data.nombre, data.tipo, data.alcance, data.es_consumible ?? false],
  );
  return c!.id;
}

async function ensurePlan(client: PoolClient, codigo: string, nombre: string, periodo: "MENSUAL" | "TRIMESTRAL" | "ANUAL") {
  const e = await one<{ id: string; periodo: "MENSUAL" | "TRIMESTRAL" | "ANUAL" }>(
    client,
    "SELECT id, periodo FROM billing.planes WHERE codigo = $1",
    [codigo],
  );
  if (e) return e;
  const c = await one<{ id: string; periodo: "MENSUAL" | "TRIMESTRAL" | "ANUAL" }>(
    client,
    "INSERT INTO billing.planes (codigo,nombre,periodo) VALUES ($1,$2,$3::billing.periodo_precio) RETURNING id,periodo",
    [codigo, nombre, periodo],
  );
  return c!;
}

async function ensurePlanPrice(client: PoolClient, planId: string, monedaId: string, periodo: string, valor: string, desde: string) {
  const e = await one<{ id: string }>(
    client,
    "SELECT id FROM billing.precios_planes WHERE plan_id=$1 AND moneda_id=$2 AND periodo=$3::billing.periodo_precio AND valor=$4::numeric AND activo=true ORDER BY created_at DESC LIMIT 1",
    [planId, monedaId, periodo, valor],
  );
  if (e) return e.id;
  const c = await one<{ id: string }>(
    client,
    "INSERT INTO billing.precios_planes (plan_id,moneda_id,periodo,valor,activo,valido_desde) VALUES ($1,$2,$3::billing.periodo_precio,$4::numeric,true,$5) RETURNING id",
    [planId, monedaId, periodo, valor, desde],
  );
  return c!.id;
}

async function getPlanPriceVigente(client: PoolClient, planId: string, periodo: string, fecha: string) {
  const p = await one<{ id: string; valor: string; moneda_id: string }>(
    client,
    "SELECT id, valor::text, moneda_id FROM billing.precios_planes WHERE plan_id=$1 AND periodo=$2::billing.periodo_precio AND activo=true AND (valido_desde IS NULL OR valido_desde <= $3::date) AND (valido_hasta IS NULL OR valido_hasta >= $3::date) ORDER BY valido_desde DESC NULLS LAST, created_at DESC LIMIT 1",
    [planId, periodo, fecha],
  );
  if (!p) throw new AppError(400, "BUSINESS_RULE_VIOLATION", "No active plan price found");
  return p;
}

async function getProductPriceVigente(client: PoolClient, productId: string, periodo: string, fecha: string) {
  const p = await one<{ id: string; valor: string; moneda_id: string; permite_prorrateo: boolean }>(
    client,
    "SELECT id, valor::text, moneda_id, permite_prorrateo FROM billing.precios WHERE producto_id=$1 AND periodo=$2::billing.periodo_precio AND activo=true AND (valido_desde IS NULL OR valido_desde <= $3::date) AND (valido_hasta IS NULL OR valido_hasta >= $3::date) ORDER BY valido_desde DESC NULLS LAST, created_at DESC LIMIT 1",
    [productId, periodo, fecha],
  );
  if (!p) throw new AppError(400, "BUSINESS_RULE_VIOLATION", "No active product price found");
  return p;
}

async function createSubscription(
  client: PoolClient,
  data: { empresaId: string; planId: string; precioPlanId: string; periodo: "MENSUAL" | "TRIMESTRAL" | "ANUAL"; fechaInicio: string; modo?: "AUTOMATICA" | "MANUAL" },
) {
  const exists = await one<{ id: string }>(client, "SELECT id FROM billing.suscripciones WHERE empresa_id=$1 AND estado='ACTIVA'::billing.estado_suscripcion LIMIT 1", [data.empresaId]);
  if (exists) throw new AppError(409, "CONFLICT", "Company already has an active subscription");
  const fin = addMonths(data.fechaInicio, PERIOD_MONTHS[data.periodo] ?? 12);
  const s = await one<{ id: string; periodo_actual_inicio: string; periodo_actual_fin: string }>(
    client,
    "INSERT INTO billing.suscripciones (empresa_id,plan_id,precio_plan_id,estado,billing_cycle,periodo,modo_renovacion,fecha_inicio,periodo_actual_inicio,periodo_actual_fin) VALUES ($1,$2,$3,'ACTIVA',$4::billing.periodo_precio,$4::billing.periodo_precio,$5::billing.modo_renovacion,$6,$6,$7) RETURNING id, periodo_actual_inicio::text, periodo_actual_fin::text",
    [data.empresaId, data.planId, data.precioPlanId, data.periodo, data.modo ?? "MANUAL", data.fechaInicio, fin],
  );
  await client.query(
    `INSERT INTO billing.items_suscripcion
      (suscripcion_id, producto_id, cantidad, fecha_inicio, fecha_fin, origen, estado)
     SELECT
      $1,
      ip.producto_id,
      COALESCE(ip.cantidad, 1),
      $2::date,
      $3::date,
      'PLAN'::billing.origen_item_suscripcion,
      'ACTIVO'::billing.estado_item_suscripcion
     FROM billing.items_plan ip
     WHERE ip.plan_id = $4
       AND ip.incluido = TRUE
       AND NOT EXISTS (
         SELECT 1
         FROM billing.items_suscripcion is2
         WHERE is2.suscripcion_id = $1
           AND is2.producto_id = ip.producto_id
           AND is2.origen = 'PLAN'::billing.origen_item_suscripcion
       )`,
    [s!.id, s!.periodo_actual_inicio, s!.periodo_actual_fin, data.planId],
  );
  await syncPlanEntitlementsToSubscription(client, {
    suscripcionId: s!.id,
    planId: data.planId,
    effectiveFrom: data.fechaInicio,
  });
  return s!;
}

async function createFactura(
  client: PoolClient,
  empresaId: string,
  suscripcionId: string | null,
  usuarioId: string | null,
  fecha: string,
  subtotal: string,
  notas: string,
  discountRaw?: { type?: unknown; value?: unknown; reason?: unknown },
) {
  const discount = parseDiscountInput({
    typeRaw: discountRaw?.type,
    valueRaw: discountRaw?.value,
    reasonRaw: discountRaw?.reason,
    typeField: "discount_type",
    valueField: "discount_value",
    reasonField: "discount_reason",
  });
  const totals = computeInvoiceDiscountTotals(Number(subtotal), discount);
  const f = await one<{ id: string }>(
    client,
    `INSERT INTO billing.facturas
      (empresa_id,suscripcion_id,usuario_id,fecha_emision,subtotal,descuento_tipo,descuento_valor,descuento_monto,descuento_motivo,total,estado,metodo_pago,notas)
     VALUES ($1,$2,$3,$4,$5::numeric,$6::billing.tipo_descuento,$7::numeric,$8::numeric,$9,$10::numeric,'EMITIDA','MANUAL',$11)
     RETURNING id`,
    [
      empresaId,
      suscripcionId,
      usuarioId,
      fecha,
      totals.subtotal,
      totals.discount_type,
      totals.discount_value,
      totals.discount_amount,
      totals.discount_reason,
      totals.total,
      notas,
    ],
  );
  return { id: f!.id, totals };
}

async function createItemFactura(client: PoolClient, data: { facturaId: string; productoId?: string | null; precioId?: string | null; descripcion: string; cantidad: number; unit: string; total: string; desde?: string | null; hasta?: string | null }) {
  const i = await one<{ id: string }>(
    client,
    "INSERT INTO billing.items_factura (factura_id,producto_id,precio_id,descripcion,cantidad,precio_unitario,total,periodo_desde,periodo_hasta) VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$9) RETURNING id",
    [data.facturaId, data.productoId ?? null, data.precioId ?? null, data.descripcion, data.cantidad, data.unit, data.total, data.desde ?? null, data.hasta ?? null],
  );
  return i!.id;
}

const onboardLegacySupport: WorkflowHandler = async ({ body, headers }) =>
  runInTransaction(async (client) => {
    await withIdempotency(client, headers);
    const email = requireString(body.email, "email");
    const nombre = requireString(body.nombre, "nombre");
    const empresaNombre = requireString(body.empresaNombre, "empresaNombre");
    const fecha = requireDate(body.fecha ?? todayIso(), "fecha");
    const precioSoporte = requireNumberLike(body.precioSoporte ?? "1200000", "precioSoporte");

    const user = await one<{ id: string }>(client, "INSERT INTO core.usuarios (email,nombre) VALUES ($1,$2) RETURNING id", [email, nombre]);
    const empresa = await one<{ id: string }>(client, "INSERT INTO core.empresas (nombre,nit,timezone) VALUES ($1,$2,'UTC') RETURNING id", [empresaNombre, body.nit ?? null]);
    await client.query("INSERT INTO core.usuarios_empresas (usuario_id,empresa_id,rol,es_principal) VALUES ($1,$2,'OWNER',true)", [user!.id, empresa!.id]);

    const monedaId = await ensureMoneda(client, "COP");
    const plan = await ensurePlan(client, "LEGACY-BASE-ANUAL", "Legacy Base Anual", "ANUAL");
    const planPriceId = await ensurePlanPrice(client, plan.id, monedaId, "ANUAL", "0", fecha);
    const soporteId = await ensureProducto(client, { codigo: "SOPORTE-ANUAL", nombre: "Soporte Anual", tipo: "SERVICIO", alcance: "EMPRESA" });
    const soportePrice = await one<{ id: string }>(
      client,
      "INSERT INTO billing.precios (producto_id,periodo,moneda_id,valor,permite_prorrateo,activo,valido_desde) VALUES ($1,'ANUAL',$2,$3::numeric,false,true,$4) ON CONFLICT DO NOTHING RETURNING id",
      [soporteId, monedaId, precioSoporte, fecha],
    );
    const soportePriceId = soportePrice?.id ?? (await getProductPriceVigente(client, soporteId, "ANUAL", fecha)).id;

    const sub = await createSubscription(client, { empresaId: empresa!.id, planId: plan.id, precioPlanId: planPriceId, periodo: "ANUAL", fechaInicio: fecha });
    const item = await one<{ id: string }>(
      client,
      "INSERT INTO billing.items_suscripcion (suscripcion_id,producto_id,precio_id,cantidad,fecha_inicio,fecha_fin,fecha_efectiva_inicio,fecha_efectiva_fin,origen,estado) VALUES ($1,$2,$3,1,$4,$5,$4,$5,'LEGACY','ACTIVO') RETURNING id",
      [sub.id, soporteId, soportePriceId, fecha, addMonths(fecha, 12)],
    );
    const factura = await createFactura(client, empresa!.id, sub.id, user!.id, fecha, precioSoporte, "Onboarding legacy + soporte");
    const facturaId = factura.id;
    await createItemFactura(client, { facturaId, productoId: soporteId, precioId: soportePriceId, descripcion: "Soporte anual", cantidad: 1, unit: precioSoporte, total: precioSoporte, desde: fecha, hasta: addMonths(fecha, 12) });
    return { caso: 1, usuarioId: user!.id, empresaId: empresa!.id, suscripcionId: sub.id, itemSuscripcionId: item!.id, facturaId };
  });

const onboardNewAnnual: WorkflowHandler = async ({ body, headers }) =>
  runInTransaction(async (client) => {
    await withIdempotency(client, headers);
    const email = requireString(body.email, "email");
    const nombre = requireString(body.nombre, "nombre");
    const empresaNombre = requireString(body.empresaNombre, "empresaNombre");
    const fecha = requireDate(body.fecha ?? todayIso(), "fecha");
    const valorPlan = requireNumberLike(body.valorPlan ?? "1800000", "valorPlan");
    const user = await one<{ id: string }>(client, "INSERT INTO core.usuarios (email,nombre) VALUES ($1,$2) RETURNING id", [email, nombre]);
    const empresa = await one<{ id: string }>(client, "INSERT INTO core.empresas (nombre,nit,timezone) VALUES ($1,$2,'UTC') RETURNING id", [empresaNombre, body.nit ?? null]);
    await client.query("INSERT INTO core.usuarios_empresas (usuario_id,empresa_id,rol,es_principal) VALUES ($1,$2,'OWNER',true)", [user!.id, empresa!.id]);

    const monedaId = await ensureMoneda(client, "COP");
    const plan = await ensurePlan(client, requireString(body.planCodigo ?? "PLAN-ANUAL-BASE", "planCodigo"), requireString(body.planNombre ?? "Plan anual base", "planNombre"), "ANUAL");
    const priceId = await ensurePlanPrice(client, plan.id, monedaId, "ANUAL", valorPlan, fecha);
    const contabId = await ensureProducto(client, { codigo: "CONTABILIDAD", nombre: "Contabilidad", tipo: "MODULO", alcance: "EMPRESA" });
    const nominaId = await ensureProducto(client, { codigo: "NOMINA", nombre: "Nomina", tipo: "MODULO", alcance: "EMPRESA" });
    await client.query("INSERT INTO billing.items_plan (plan_id,producto_id,incluido,cantidad) VALUES ($1,$2,true,null) ON CONFLICT (plan_id,producto_id) DO NOTHING", [plan.id, contabId]);
    await client.query("INSERT INTO billing.items_plan (plan_id,producto_id,incluido,cantidad) VALUES ($1,$2,true,null) ON CONFLICT (plan_id,producto_id) DO NOTHING", [plan.id, nominaId]);
    const sub = await createSubscription(client, { empresaId: empresa!.id, planId: plan.id, precioPlanId: priceId, periodo: "ANUAL", fechaInicio: fecha });
    const factura = await createFactura(client, empresa!.id, sub.id, user!.id, fecha, valorPlan, "Onboarding anual");
    const facturaId = factura.id;
    await createItemFactura(client, { facturaId, descripcion: "Plan anual base", cantidad: 1, unit: valorPlan, total: valorPlan, desde: fecha, hasta: addMonths(fecha, 12) });
    return { caso: 2, usuarioId: user!.id, empresaId: empresa!.id, suscripcionId: sub.id, facturaId };
  });

const migrateFromExcel: WorkflowHandler = async ({ body, headers }) =>
  runInTransaction(async (client) => {
    await withIdempotency(client, headers);
    const usuarioId = requireUuid(body.usuarioId, "usuarioId");
    const empresaId = requireUuid(body.empresaId, "empresaId");
    const planId = requireUuid(body.planId, "planId");
    const fecha = requireDate(body.fecha ?? todayIso(), "fecha");
    const plan = await one<{ id: string; periodo: "MENSUAL" | "TRIMESTRAL" | "ANUAL" }>(client, "SELECT id,periodo FROM billing.planes WHERE id=$1", [planId]);
    if (!plan) throw new AppError(404, "NOT_FOUND", "Plan not found");
    const price = await getPlanPriceVigente(client, planId, plan.periodo, fecha);
    const sub = await createSubscription(client, { empresaId, planId, precioPlanId: price.id, periodo: plan.periodo, fechaInicio: fecha });
    const items = Array.isArray(body.items) ? body.items : [];
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Dict;
      await client.query(
        "INSERT INTO billing.items_suscripcion (suscripcion_id,producto_id,cantidad,fecha_inicio,fecha_fin,fecha_efectiva_inicio,fecha_efectiva_fin,origen,estado) VALUES ($1,$2,$3,$4,$5,$6,$7,'LEGACY','ACTIVO')",
        [sub.id, requireUuid(r.productoId, "items[].productoId"), Number(r.cantidad ?? 1), requireDate(r.fechaInicio ?? fecha, "items[].fechaInicio"), r.fechaFin ? requireDate(r.fechaFin, "items[].fechaFin") : null, r.fechaEfectivaInicio ? requireDate(r.fechaEfectivaInicio, "items[].fechaEfectivaInicio") : null, r.fechaEfectivaFin ? requireDate(r.fechaEfectivaFin, "items[].fechaEfectivaFin") : null],
      );
    }
    return { caso: 3, usuarioId, empresaId, suscripcionId: sub.id, migratedItems: items.length };
  });

const accountantMultiCompanySubscriptions: WorkflowHandler = async ({ body, headers }) =>
  runInTransaction(async (client) => {
    await withIdempotency(client, headers);
    const email = requireString(body.email, "email");
    const nombre = requireString(body.nombre, "nombre");
    const fecha = requireDate(body.fecha ?? todayIso(), "fecha");
    const valorPlan = requireNumberLike(body.valorPlan ?? "120000", "valorPlan");
    const user = await one<{ id: string }>(client, "INSERT INTO core.usuarios (email,nombre) VALUES ($1,$2) RETURNING id", [email, nombre]);
    const monedaId = await ensureMoneda(client, "COP");
    const plan = await ensurePlan(client, requireString(body.planCodigo ?? "PLAN-CONTABILIDAD-MENSUAL", "planCodigo"), "Plan Contabilidad Mensual", "MENSUAL");
    const priceId = await ensurePlanPrice(client, plan.id, monedaId, "MENSUAL", valorPlan, fecha);
    const empresas = Array.isArray(body.empresas) && body.empresas.length > 0 ? body.empresas : [{ nombre: "Empresa 1" }, { nombre: "Empresa 2" }, { nombre: "Empresa 3" }];
    const out: Array<{ empresaId: string; suscripcionId: string }> = [];
    for (const raw of empresas.slice(0, 3)) {
      const e = raw as Dict;
      const empresa = await one<{ id: string }>(client, "INSERT INTO core.empresas (nombre,timezone) VALUES ($1,'UTC') RETURNING id", [requireString(e.nombre, "empresas[].nombre")]);
      await client.query("INSERT INTO core.usuarios_empresas (usuario_id,empresa_id,rol,es_principal) VALUES ($1,$2,'OWNER',$3)", [user!.id, empresa!.id, out.length === 0]);
      const sub = await createSubscription(client, { empresaId: empresa!.id, planId: plan.id, precioPlanId: priceId, periodo: "MENSUAL", fechaInicio: fecha });
      out.push({ empresaId: empresa!.id, suscripcionId: sub.id });
    }
    return { caso: 4, usuarioId: user!.id, asignaciones: out };
  });

const renewSubscription: WorkflowHandler = async ({ body, headers }) =>
  runInTransaction(async (client) => {
    await withIdempotency(client, headers);
    const suscripcionId = requireUuid(body.suscripcionId, "suscripcionId");
    const fecha = requireDate(body.fechaRenovacion ?? todayIso(), "fechaRenovacion");
    const generarFactura = parseBooleanLike(body.generarFactura, true);
    const discount = parseDiscountInput({
      typeRaw: body.descuentoTipo ?? body.discountType,
      valueRaw: body.descuentoValor ?? body.discountValue,
      reasonRaw: body.descuentoMotivo ?? body.discountReason,
      typeField: "descuentoTipo",
      valueField: "descuentoValor",
      reasonField: "descuentoMotivo",
    });
    if (!generarFactura && discount) {
      throw new AppError(400, "VALIDATION_ERROR", "Discount is only allowed when generarFactura is true");
    }
    const sub = await one<{ id: string; plan_id: string; periodo: "MENSUAL" | "TRIMESTRAL" | "ANUAL" }>(client, "SELECT id, plan_id, periodo FROM billing.suscripciones WHERE id=$1", [suscripcionId]);
    if (!sub) throw new AppError(404, "NOT_FOUND", "Subscription not found");
    const company = await one<{ empresa_id: string }>(client, "SELECT empresa_id::text FROM billing.suscripciones WHERE id=$1", [suscripcionId]);
    if (!company) throw new AppError(404, "NOT_FOUND", "Subscription not found");
    const price = await getPlanPriceVigente(client, sub.plan_id, sub.periodo, fecha);
    const fin = addMonths(fecha, PERIOD_MONTHS[sub.periodo] ?? 12);
    await client.query("UPDATE billing.suscripciones SET precio_plan_id=$1, periodo_actual_inicio=$2, periodo_actual_fin=$3, estado='ACTIVA', updated_at=now() WHERE id=$4", [price.id, fecha, fin, suscripcionId]);
    await syncPlanEntitlementsToSubscription(client, {
      suscripcionId,
      planId: sub.plan_id,
      effectiveFrom: fecha,
    });
    let facturaId: string | null = null;
    if (generarFactura) {
      const factura = await createFactura(client, company.empresa_id, suscripcionId, null, fecha, price.valor, "Renovacion de suscripcion", {
        type: discount?.type,
        value: discount?.value,
        reason: discount?.reason,
      });
      facturaId = factura.id;
      await createItemFactura(client, {
        facturaId,
        descripcion: "Renovacion de suscripcion",
        cantidad: 1,
        unit: price.valor,
        total: price.valor,
        desde: fecha,
        hasta: fin,
      });
    }
    return { caso: 5, suscripcionId, precioPlanId: price.id, periodoActualInicio: fecha, periodoActualFin: fin, facturaId };
  });

const updatePlanPrices: WorkflowHandler = async ({ body, headers }) =>
  runInTransaction(async (client) => {
    await withIdempotency(client, headers);
    const planId = requireUuid(body.planId, "planId");
    const vigenteDesde = requireDate(body.vigenteDesde ?? todayIso(), "vigenteDesde");
    const incMensual = Number(requireNumberLike(body.incrementoMensual, "incrementoMensual"));
    const incAnual = Number(requireNumberLike(body.incrementoAnual, "incrementoAnual"));
    const prices = await client.query<{ periodo: string; valor: string; moneda_id: string }>("SELECT periodo::text, valor::text, moneda_id FROM billing.precios_planes WHERE plan_id=$1 AND activo=true AND periodo IN ('MENSUAL','ANUAL')", [planId]);
    const created: string[] = [];
    for (const p of prices.rows) {
      const plus = p.periodo === "MENSUAL" ? incMensual : incAnual;
      const v = (Number(p.valor) + plus).toFixed(2);
      const n = await one<{ id: string }>(client, "INSERT INTO billing.precios_planes (plan_id,moneda_id,periodo,valor,activo,valido_desde) VALUES ($1,$2,$3::billing.periodo_precio,$4::numeric,true,$5) RETURNING id", [planId, p.moneda_id, p.periodo, v, vigenteDesde]);
      created.push(n!.id);
    }
    return { caso: 6, planId, nuevosPrecios: created };
  });

const purchaseConsumable: WorkflowHandler = async ({ body, headers }) =>
  runInTransaction(async (client) => {
    await withIdempotency(client, headers);
    const suscripcionId = requireUuid(body.suscripcionId, "suscripcionId");
    const cantidad = Number(requireNumberLike(body.cantidad ?? "1", "cantidad"));
    assert(cantidad > 0, "cantidad must be > 0");
    const fecha = requireDate(body.fecha ?? todayIso(), "fecha");
    const sub = await one<{ id: string; periodo: string }>(client, "SELECT id, periodo::text FROM billing.suscripciones WHERE id=$1", [suscripcionId]);
    if (!sub) throw new AppError(404, "NOT_FOUND", "Subscription not found");
    const productoId = body.productoId ? requireUuid(body.productoId, "productoId") : (await one<{ id: string }>(client, "SELECT id FROM billing.productos WHERE codigo=$1", [requireString(body.productoCodigo, "productoCodigo")]))?.id;
    if (!productoId) throw new AppError(404, "NOT_FOUND", "Product not found");
    const prod = await one<{ es_consumible: boolean }>(client, "SELECT es_consumible FROM billing.productos WHERE id=$1", [productoId]);
    if (!prod) throw new AppError(404, "NOT_FOUND", "Product not found");
    assert(prod.es_consumible, "Product is not consumable", "BUSINESS_RULE_VIOLATION");
    const price = await getProductPriceVigente(client, productoId, sub.periodo, fecha);
    const item = await one<{ id: string }>(client, "INSERT INTO billing.items_suscripcion (suscripcion_id,producto_id,precio_id,cantidad,fecha_inicio,origen,estado) VALUES ($1,$2,$3,$4,$5,'ADDON','ACTIVO') RETURNING id", [suscripcionId, productoId, price.id, cantidad, fecha]);
    return { caso: 7, suscripcionId, itemSuscripcionId: item!.id, cantidad };
  });

const addCompanyWithSubscription: WorkflowHandler = async ({ body, headers }) =>
  runInTransaction(async (client) => {
    await withIdempotency(client, headers);
    const usuarioId = requireUuid(body.usuarioId, "usuarioId");
    const planId = requireUuid(body.planId, "planId");
    const fecha = requireDate(body.fecha ?? todayIso(), "fecha");
    const plan = await one<{ id: string; periodo: "MENSUAL" | "TRIMESTRAL" | "ANUAL" }>(client, "SELECT id,periodo FROM billing.planes WHERE id=$1", [planId]);
    if (!plan) throw new AppError(404, "NOT_FOUND", "Plan not found");
    const price = await getPlanPriceVigente(client, plan.id, plan.periodo, fecha);
    const empresa = await one<{ id: string }>(client, "INSERT INTO core.empresas (nombre,nit,timezone) VALUES ($1,$2,'UTC') RETURNING id", [requireString(body.nombre, "nombre"), body.nit ?? null]);
    await client.query("INSERT INTO core.usuarios_empresas (usuario_id,empresa_id,rol,es_principal) VALUES ($1,$2,'OWNER',false)", [usuarioId, empresa!.id]);
    const sub = await createSubscription(client, { empresaId: empresa!.id, planId: plan.id, precioPlanId: price.id, periodo: plan.periodo, fechaInicio: fecha });
    return { caso: 8, usuarioId, empresaId: empresa!.id, suscripcionId: sub.id };
  });

const upgradeMidcycleLimit: WorkflowHandler = async ({ body, headers }) =>
  runInTransaction(async (client) => {
    await withIdempotency(client, headers);
    const suscripcionId = requireUuid(body.suscripcionId, "suscripcionId");
    const fecha = requireDate(body.fecha ?? todayIso(), "fecha");
    const nuevoLimite = Number(requireNumberLike(body.nuevoLimite, "nuevoLimite"));
    const sub = await one<{ id: string; empresa_id: string; periodo: string; periodo_actual_inicio: string; periodo_actual_fin: string }>(client, "SELECT id, empresa_id, periodo::text, periodo_actual_inicio::text, periodo_actual_fin::text FROM billing.suscripciones WHERE id=$1", [suscripcionId]);
    if (!sub) throw new AppError(404, "NOT_FOUND", "Subscription not found");
    const ent = body.entitlementId ? await one<{ id: string }>(client, "SELECT id FROM billing.entitlements WHERE id=$1", [requireUuid(body.entitlementId, "entitlementId")]) : await one<{ id: string }>(client, "SELECT id FROM billing.entitlements WHERE codigo=$1", [requireString(body.entitlementCodigo, "entitlementCodigo")]);
    if (!ent) throw new AppError(404, "NOT_FOUND", "Entitlement not found");
    await client.query("UPDATE billing.entitlements_suscripcion SET efectivo_hasta=$2::date - INTERVAL '1 day' WHERE suscripcion_id=$1 AND entitlement_id=$3 AND efectivo_hasta IS NULL", [suscripcionId, fecha, ent.id]);
    await client.query("INSERT INTO billing.entitlements_suscripcion (suscripcion_id,entitlement_id,valor_entero,origen,efectivo_desde) VALUES ($1,$2,$3,'ADDON',$4)", [suscripcionId, ent.id, nuevoLimite, fecha]);

    let facturaId: string | null = null;
    if (body.productoId) {
      const productoId = requireUuid(body.productoId, "productoId");
      const price = await getProductPriceVigente(client, productoId, sub.periodo, fecha);
      assert(price.permite_prorrateo, "Product price does not allow proration", "BUSINESS_RULE_VIOLATION");
      const totalDays = diffDays(sub.periodo_actual_inicio, sub.periodo_actual_fin);
      const remainDays = diffDays(fecha, sub.periodo_actual_fin);
      const prorr = ((Number(price.valor) * remainDays) / totalDays).toFixed(2);
      const factura = await createFactura(client, sub.empresa_id, suscripcionId, null, fecha, prorr, "Upgrade mid-cycle");
      facturaId = factura.id;
      const itemId = await createItemFactura(client, { facturaId, productoId, precioId: price.id, descripcion: "Upgrade de limite", cantidad: 1, unit: prorr, total: prorr, desde: fecha, hasta: sub.periodo_actual_fin });
      await client.query("INSERT INTO billing.prorrateos (suscripcion_id,producto_id,desde,hasta,valor_original,valor_prorrateado,factura_id,item_factura_id) VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric,$7,$8)", [suscripcionId, productoId, fecha, sub.periodo_actual_fin, price.valor, prorr, facturaId, itemId]);
    }
    return { caso: 9, suscripcionId, entitlementId: ent.id, facturaId };
  });

const purchaseFixedTermService: WorkflowHandler = async ({ body, headers }) =>
  runInTransaction(async (client) => {
    await withIdempotency(client, headers);
    const suscripcionId = requireUuid(body.suscripcionId, "suscripcionId");
    const fechaPago = requireDate(body.fechaPago ?? todayIso(), "fechaPago");
    const eIni = requireDate(body.fechaEfectivaInicio, "fechaEfectivaInicio");
    const eFin = requireDate(body.fechaEfectivaFin, "fechaEfectivaFin");
    assert(eFin > eIni, "fechaEfectivaFin must be greater than fechaEfectivaInicio");
    const sub = await one<{ id: string; empresa_id: string }>(client, "SELECT id,empresa_id FROM billing.suscripciones WHERE id=$1", [suscripcionId]);
    if (!sub) throw new AppError(404, "NOT_FOUND", "Subscription not found");
    const productoId = body.productoId ? requireUuid(body.productoId, "productoId") : (await one<{ id: string }>(client, "SELECT id FROM billing.productos WHERE codigo=$1", [requireString(body.productoCodigo, "productoCodigo")]))?.id;
    if (!productoId) throw new AppError(404, "NOT_FOUND", "Product not found");
    const price = await getProductPriceVigente(client, productoId, "ANUAL", fechaPago);
    assert(!price.permite_prorrateo, "Product must be non-proratable", "BUSINESS_RULE_VIOLATION");
    const item = await one<{ id: string }>(client, "INSERT INTO billing.items_suscripcion (suscripcion_id,producto_id,precio_id,cantidad,fecha_inicio,fecha_fin,fecha_efectiva_inicio,fecha_efectiva_fin,origen,estado) VALUES ($1,$2,$3,1,$4,$5,$6,$7,'ADDON','ACTIVO') RETURNING id", [suscripcionId, productoId, price.id, fechaPago, addMonths(fechaPago, 12), eIni, eFin]);
    const factura = await createFactura(client, sub.empresa_id, suscripcionId, null, fechaPago, price.valor, "Compra servicio fijo");
    const facturaId = factura.id;
    await createItemFactura(client, { facturaId, productoId, precioId: price.id, descripcion: "Servicio fijo anual", cantidad: 1, unit: price.valor, total: price.valor, desde: eIni, hasta: eFin });
    return { caso: 10, suscripcionId, itemSuscripcionId: item!.id, facturaId };
  });

const names = [
  "onboard-legacy-support",
  "onboard-new-annual",
  "migrate-from-excel",
  "accountant-multi-company-subscriptions",
  "renew-subscription",
  "update-plan-prices",
  "purchase-consumable",
  "add-company-with-subscription",
  "upgrade-midcycle-limit",
  "purchase-fixed-term-service",
] as const;

export type WorkflowName = (typeof names)[number];

const map: Record<WorkflowName, WorkflowHandler> = {
  "onboard-legacy-support": onboardLegacySupport,
  "onboard-new-annual": onboardNewAnnual,
  "migrate-from-excel": migrateFromExcel,
  "accountant-multi-company-subscriptions": accountantMultiCompanySubscriptions,
  "renew-subscription": renewSubscription,
  "update-plan-prices": updatePlanPrices,
  "purchase-consumable": purchaseConsumable,
  "add-company-with-subscription": addCompanyWithSubscription,
  "upgrade-midcycle-limit": upgradeMidcycleLimit,
  "purchase-fixed-term-service": purchaseFixedTermService,
};

export function isWorkflow(name: string): name is WorkflowName {
  return names.includes(name as WorkflowName);
}

export async function runWorkflow(name: WorkflowName, body: Dict, headers: Headers) {
  return map[name]({ body, headers });
}

