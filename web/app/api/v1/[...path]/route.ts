import { AppError } from "@/lib/api/types";
import { fromUnknownError, success } from "@/lib/api/response";
import { readJson } from "@/lib/api/validation";
import { RESOURCE_MAP } from "@/lib/repositories/resource-map";
import { createRow, deleteRow, getRowById, listRows, updateRow } from "@/lib/repositories/crud";
import { query } from "@/lib/db";
import { CRUD_RESOURCES } from "@/lib/crud-catalog";

type RouteContext = {
  params: Promise<{ path: string[] }> | { path: string[] };
};

async function ensureProductoSchema() {
  await query("ALTER TABLE billing.productos ADD COLUMN IF NOT EXISTS unidad_consumo TEXT");
  await query("ALTER TABLE billing.productos ADD COLUMN IF NOT EXISTS descripcion_operativa TEXT");
}

async function ensureBillingGraceSchema() {
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'estado_operativo_suscripcion'
          AND n.nspname = 'billing'
      ) THEN
        CREATE TYPE billing.estado_operativo_suscripcion AS ENUM ('EN_SERVICIO', 'EN_PRORROGA', 'BLOQUEADA');
      END IF;
    END $$;
  `);
  await query("ALTER TABLE billing.suscripciones ADD COLUMN IF NOT EXISTS grace_until DATE");
  await query("ALTER TABLE billing.suscripciones ADD COLUMN IF NOT EXISTS grace_days_granted INT NOT NULL DEFAULT 0");
  await query("ALTER TABLE billing.suscripciones DROP COLUMN IF EXISTS grace_reason");
  await query("ALTER TABLE billing.suscripciones DROP COLUMN IF EXISTS blocked_at");
  await query("ALTER TABLE billing.suscripciones DROP COLUMN IF EXISTS block_reason");
  await query(
    "ALTER TABLE billing.suscripciones ADD COLUMN IF NOT EXISTS operational_status billing.estado_operativo_suscripcion NOT NULL DEFAULT 'EN_SERVICIO'",
  );
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'modo_precio_plan'
          AND n.nspname = 'billing'
      ) THEN
        CREATE TYPE billing.modo_precio_plan AS ENUM ('BUNDLE', 'SUM_COMPONENTS');
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'tipo_descuento'
          AND n.nspname = 'billing'
      ) THEN
        CREATE TYPE billing.tipo_descuento AS ENUM ('PERCENT', 'FIXED');
      END IF;
    END $$;
  `);
  await query("ALTER TABLE billing.planes ADD COLUMN IF NOT EXISTS pricing_mode billing.modo_precio_plan NOT NULL DEFAULT 'BUNDLE'");
  await query("ALTER TABLE billing.suscripciones ADD COLUMN IF NOT EXISTS billing_cycle billing.periodo_precio");
  await query("UPDATE billing.suscripciones SET billing_cycle = periodo WHERE billing_cycle IS NULL");
  await query("ALTER TABLE billing.suscripciones ALTER COLUMN billing_cycle SET NOT NULL");
  await query("ALTER TABLE billing.suscripciones ALTER COLUMN precio_plan_id DROP NOT NULL");
  await query(`
    CREATE TABLE IF NOT EXISTS billing.suscripciones_plan_historial (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      suscripcion_id UUID NOT NULL REFERENCES billing.suscripciones(id) ON DELETE CASCADE,
      plan_id UUID NOT NULL REFERENCES billing.planes(id) ON DELETE RESTRICT,
      precio_plan_id UUID REFERENCES billing.precios_planes(id) ON DELETE RESTRICT,
      billing_cycle billing.periodo_precio NOT NULL,
      vigente_desde DATE NOT NULL,
      vigente_hasta DATE,
      motivo TEXT,
      changed_by UUID REFERENCES core.usuarios(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
    )
  `);
  await query(
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_suscripciones_plan_historial_open ON billing.suscripciones_plan_historial (suscripcion_id) WHERE vigente_hasta IS NULL",
  );
  await query(
    "CREATE INDEX IF NOT EXISTS idx_suscripciones_plan_historial_lookup ON billing.suscripciones_plan_historial (suscripcion_id, vigente_desde DESC)",
  );
  await query(`
    CREATE OR REPLACE FUNCTION billing.sync_suscripcion_plan_historial()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_change_date DATE;
      v_reason TEXT;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO billing.suscripciones_plan_historial
          (suscripcion_id, plan_id, precio_plan_id, billing_cycle, vigente_desde, vigente_hasta, motivo)
        VALUES
          (NEW.id, NEW.plan_id, NEW.precio_plan_id, NEW.billing_cycle, COALESCE(NEW.periodo_actual_inicio, NEW.fecha_inicio, CURRENT_DATE), NULL, 'ALTA_SUSCRIPCION');
        RETURN NEW;
      END IF;

      IF NEW.plan_id IS DISTINCT FROM OLD.plan_id
        OR NEW.precio_plan_id IS DISTINCT FROM OLD.precio_plan_id
        OR NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle THEN
        v_reason := 'CAMBIO_PLAN';
      ELSIF NEW.periodo_actual_inicio IS DISTINCT FROM OLD.periodo_actual_inicio THEN
        v_reason := 'RENOVACION';
      ELSE
        RETURN NEW;
      END IF;

      v_change_date := COALESCE(NEW.periodo_actual_inicio, CURRENT_DATE);

      UPDATE billing.suscripciones_plan_historial
         SET vigente_hasta = CASE
               WHEN vigente_desde < v_change_date THEN (v_change_date - INTERVAL '1 day')::date
               ELSE v_change_date
             END,
             updated_at = now()
       WHERE suscripcion_id = NEW.id
         AND vigente_hasta IS NULL;

      INSERT INTO billing.suscripciones_plan_historial
        (suscripcion_id, plan_id, precio_plan_id, billing_cycle, vigente_desde, vigente_hasta, motivo)
      VALUES
        (NEW.id, NEW.plan_id, NEW.precio_plan_id, NEW.billing_cycle, v_change_date, NULL, v_reason);

      RETURN NEW;
    END;
    $$;
  `);
  await query("DROP TRIGGER IF EXISTS trg_sync_suscripcion_plan_historial ON billing.suscripciones");
  await query(`
    CREATE TRIGGER trg_sync_suscripcion_plan_historial
    AFTER INSERT OR UPDATE OF plan_id, precio_plan_id, billing_cycle, periodo_actual_inicio
    ON billing.suscripciones
    FOR EACH ROW
    EXECUTE FUNCTION billing.sync_suscripcion_plan_historial()
  `);
  await query(`
    INSERT INTO billing.suscripciones_plan_historial
      (suscripcion_id, plan_id, precio_plan_id, billing_cycle, vigente_desde, vigente_hasta, motivo)
    SELECT
      s.id,
      s.plan_id,
      s.precio_plan_id,
      s.billing_cycle,
      COALESCE(s.periodo_actual_inicio, s.fecha_inicio, CURRENT_DATE),
      NULL,
      'MIGRACION_INICIAL'
    FROM billing.suscripciones s
    WHERE NOT EXISTS (
      SELECT 1
      FROM billing.suscripciones_plan_historial h
      WHERE h.suscripcion_id = s.id
    )
  `);
  await query(`
    CREATE OR REPLACE VIEW billing.v_suscripcion_adicionales_por_plan AS
    SELECT
      h.id::text AS historial_id,
      h.suscripcion_id::text AS suscripcion_id,
      h.plan_id::text AS plan_id,
      p.nombre AS plan_nombre,
      h.billing_cycle::text AS billing_cycle,
      h.vigente_desde::text AS plan_vigente_desde,
      h.vigente_hasta::text AS plan_vigente_hasta,
      i.id::text AS item_suscripcion_id,
      i.producto_id::text AS producto_id,
      pr.codigo AS producto_codigo,
      pr.nombre AS producto_nombre,
      i.origen::text AS item_origen,
      i.estado::text AS item_estado,
      i.cantidad,
      i.fecha_inicio::text AS item_fecha_inicio,
      i.fecha_fin::text AS item_fecha_fin,
      i.fecha_efectiva_inicio::text AS item_efectiva_inicio,
      i.fecha_efectiva_fin::text AS item_efectiva_fin,
      GREATEST(h.vigente_desde, COALESCE(i.fecha_efectiva_inicio, i.fecha_inicio))::text AS solape_desde,
      LEAST(COALESCE(h.vigente_hasta, '9999-12-31'::date), COALESCE(i.fecha_efectiva_fin, i.fecha_fin, '9999-12-31'::date))::text AS solape_hasta
    FROM billing.suscripciones_plan_historial h
    JOIN billing.planes p ON p.id = h.plan_id
    JOIN billing.items_suscripcion i ON i.suscripcion_id = h.suscripcion_id
    JOIN billing.productos pr ON pr.id = i.producto_id
    WHERE i.origen IN ('ADDON'::billing.origen_item_suscripcion, 'LEGACY'::billing.origen_item_suscripcion, 'MANUAL'::billing.origen_item_suscripcion)
      AND GREATEST(h.vigente_desde, COALESCE(i.fecha_efectiva_inicio, i.fecha_inicio))
          <= LEAST(COALESCE(h.vigente_hasta, '9999-12-31'::date), COALESCE(i.fecha_efectiva_fin, i.fecha_fin, '9999-12-31'::date))
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS billing.politicas_cobro (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      scope TEXT NOT NULL CHECK (scope IN ('GLOBAL', 'PLAN', 'EMPRESA')),
      plan_id UUID REFERENCES billing.planes(id) ON DELETE CASCADE,
      empresa_id UUID REFERENCES core.empresas(id) ON DELETE CASCADE,
      grace_days INT NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
      auto_block BOOLEAN NOT NULL DEFAULT TRUE,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (
        (scope = 'GLOBAL' AND plan_id IS NULL AND empresa_id IS NULL) OR
        (scope = 'PLAN' AND plan_id IS NOT NULL) OR
        (scope = 'EMPRESA' AND empresa_id IS NOT NULL)
      )
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS billing.cobro_eventos (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      suscripcion_id UUID NOT NULL REFERENCES billing.suscripciones(id) ON DELETE CASCADE,
      factura_id UUID REFERENCES billing.facturas(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('GRACE_GRANTED','GRACE_EXTENDED','GRACE_EXPIRED','BLOCKED','UNBLOCKED')),
      event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor TEXT,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await query("ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS subtotal NUMERIC(18,2) NOT NULL DEFAULT 0");
  await query("ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS descuento_tipo billing.tipo_descuento");
  await query("ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS descuento_valor NUMERIC(18,4)");
  await query("ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS descuento_monto NUMERIC(18,2) NOT NULL DEFAULT 0");
  await query("ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS descuento_motivo TEXT");
  await query("UPDATE billing.facturas SET subtotal = total WHERE subtotal = 0 AND total > 0");
  await query("UPDATE billing.facturas SET descuento_monto = 0 WHERE descuento_monto IS NULL");
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'facturas_descuento_monto_le_subtotal_chk'
      ) THEN
        ALTER TABLE billing.facturas
        ADD CONSTRAINT facturas_descuento_monto_le_subtotal_chk CHECK (descuento_monto <= subtotal);
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'facturas_descuento_tipo_valor_pair_chk'
      ) THEN
        ALTER TABLE billing.facturas
        ADD CONSTRAINT facturas_descuento_tipo_valor_pair_chk CHECK (
          (descuento_tipo IS NULL AND descuento_valor IS NULL)
          OR (descuento_tipo IS NOT NULL AND descuento_valor IS NOT NULL)
        );
      END IF;
    END $$;
  `);
}

async function getPathParts(ctx: RouteContext): Promise<string[]> {
  const params = await ctx.params;
  return params.path ?? [];
}

function asCleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDateString(value: unknown): string | null {
  const v = asCleanString(value);
  return v || null;
}

function addMonthsIso(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function ensureProductCreateRules(payload: Record<string, unknown>) {
  const tipo = asCleanString(payload.tipo);
  if (tipo !== "CONSUMIBLE") return;

  const unidad = asCleanString(payload.unidad_consumo);
  if (!unidad) {
    throw new AppError(400, "VALIDATION_ERROR", "unidad_consumo is required for CONSUMIBLE products");
  }
}

async function ensureProductPatchRules(id: string, payload: Record<string, unknown>) {
  const current = await query<{ tipo: string; unidad_consumo: string | null }>(
    "SELECT tipo::text AS tipo, unidad_consumo FROM billing.productos WHERE id = $1 LIMIT 1",
    [id],
  );
  const row = current.rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "productos not found");

  const tipo = asCleanString(payload.tipo) || row.tipo;
  if (tipo !== "CONSUMIBLE") return;
  const unidad = asCleanString(payload.unidad_consumo) || asCleanString(row.unidad_consumo);
  if (!unidad) {
    throw new AppError(400, "VALIDATION_ERROR", "unidad_consumo is required for CONSUMIBLE products");
  }
}

async function ensureSubscriptionCreateRules(payload: Record<string, unknown>) {
  if (!payload.empresa_id || payload.estado !== "ACTIVA") return;
  const result = await query<{ id: string }>(
    "SELECT id FROM billing.suscripciones WHERE empresa_id = $1 AND estado = 'ACTIVA'::billing.estado_suscripcion LIMIT 1",
    [payload.empresa_id],
  );
  if (result.rowCount && result.rowCount > 0) {
    throw new AppError(409, "CONFLICT", "Company already has an active subscription");
  }

  const planId = payload.plan_id as string | undefined;
  const precioPlanId = payload.precio_plan_id as string | undefined;
  if (!planId || !precioPlanId) return;

  const opDate = String((payload.fecha_inicio as string | undefined) ?? (payload.periodo_actual_inicio as string | undefined) ?? new Date().toISOString().slice(0, 10));
  const precio = await query<{ plan_id: string; periodo: string; activo: boolean; valido_desde: string | null; valido_hasta: string | null }>(
    "SELECT plan_id, periodo::text, activo, valido_desde::text, valido_hasta::text FROM billing.precios_planes WHERE id = $1 LIMIT 1",
    [precioPlanId],
  );
  const row = precio.rows[0];
  if (!row) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id not found");
  }
  if (row.plan_id !== planId) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id does not belong to plan_id");
  }
  if (!row.activo) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id is inactive");
  }
  if ((row.valido_desde && row.valido_desde > opDate) || (row.valido_hasta && row.valido_hasta < opDate)) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id is not valid for operation date");
  }

  const billingCycle = String((payload.billing_cycle as string | undefined) ?? (payload.periodo as string | undefined) ?? row.periodo);
  if (billingCycle !== row.periodo) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "billing_cycle does not match precio_plan period");
  }
}

async function ensureSubscriptionPatchRules(id: string, payload: Record<string, unknown>) {
  if (payload.estado !== "ACTIVA" && !payload.empresa_id) return;
  const currentCompany = await query<{ id: string; empresa_id: string }>(
    "SELECT id, empresa_id FROM billing.suscripciones WHERE id = $1",
    [id],
  );
  const row = currentCompany.rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "suscripciones not found");
  const empresaId = (payload.empresa_id as string | undefined) ?? row.empresa_id;
  const status = (payload.estado as string | undefined) ?? "ACTIVA";
  if (status !== "ACTIVA") return;

  const result = await query<{ id: string }>(
    "SELECT id FROM billing.suscripciones WHERE empresa_id = $1 AND estado = 'ACTIVA'::billing.estado_suscripcion AND id <> $2 LIMIT 1",
    [empresaId, id],
  );
  if (result.rowCount && result.rowCount > 0) {
    throw new AppError(409, "CONFLICT", "Company already has an active subscription");
  }

  const currentSub = await query<{ id: string; plan_id: string; precio_plan_id: string; periodo: string; billing_cycle: string; fecha_inicio: string }>(
    "SELECT id, plan_id, precio_plan_id, periodo::text, billing_cycle::text, fecha_inicio::text FROM billing.suscripciones WHERE id = $1 LIMIT 1",
    [id],
  );
  const currentSubscription = currentSub.rows[0];
  if (!currentSubscription) {
    throw new AppError(404, "NOT_FOUND", "suscripciones not found");
  }

  const nextPlanId = String((payload.plan_id as string | undefined) ?? currentSubscription.plan_id);
  const nextBillingCycle = String(
    (payload.billing_cycle as string | undefined) ?? (payload.periodo as string | undefined) ?? currentSubscription.billing_cycle ?? currentSubscription.periodo,
  );
  const planChanged = nextPlanId !== currentSubscription.plan_id;
  const cycleChanged = nextBillingCycle !== currentSubscription.billing_cycle;
  const requiresPlanWindowUpdate = planChanged || cycleChanged;

  if (requiresPlanWindowUpdate) {
    const startDate = asCleanString(payload.periodo_actual_inicio) || asCleanString(payload.fecha_inicio);
    if (!startDate) {
      throw new AppError(400, "VALIDATION_ERROR", "periodo_actual_inicio is required when changing plan or billing_cycle");
    }
    payload.periodo_actual_inicio = startDate;
    if (!asCleanString(payload.periodo_actual_fin)) {
      const months = nextBillingCycle === "ANUAL" ? 12 : nextBillingCycle === "TRIMESTRAL" ? 3 : 1;
      payload.periodo_actual_fin = addMonthsIso(startDate, months);
    }
  }

  const opDate = String(
    (payload.periodo_actual_inicio as string | undefined) ??
      (payload.fecha_inicio as string | undefined) ??
      currentSubscription.fecha_inicio ??
      new Date().toISOString().slice(0, 10),
  );

  if (!payload.precio_plan_id && requiresPlanWindowUpdate) {
    const price = await query<{ id: string }>(
      `SELECT id::text
       FROM billing.precios_planes
       WHERE plan_id = $1
         AND periodo = $2::billing.periodo_precio
         AND activo = true
         AND (valido_desde IS NULL OR valido_desde <= $3::date)
         AND (valido_hasta IS NULL OR valido_hasta >= $3::date)
       ORDER BY valido_desde DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [nextPlanId, nextBillingCycle, opDate],
    );
    if (!price.rows[0]) {
      throw new AppError(400, "BUSINESS_RULE_VIOLATION", "No active precio_plan_id found for selected plan/cycle/date");
    }
    payload.precio_plan_id = price.rows[0].id;
  }

  const nextPrecioPlanId = String((payload.precio_plan_id as string | undefined) ?? currentSubscription.precio_plan_id);

  const precio = await query<{ plan_id: string; periodo: string; activo: boolean; valido_desde: string | null; valido_hasta: string | null }>(
    "SELECT plan_id, periodo::text, activo, valido_desde::text, valido_hasta::text FROM billing.precios_planes WHERE id = $1 LIMIT 1",
    [nextPrecioPlanId],
  );
  const priceRow = precio.rows[0];
  if (!priceRow) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id not found");
  }
  if (priceRow.plan_id !== nextPlanId) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id does not belong to plan");
  }
  if (!priceRow.activo) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id is inactive");
  }
  if ((priceRow.valido_desde && priceRow.valido_desde > opDate) || (priceRow.valido_hasta && priceRow.valido_hasta < opDate)) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id is not valid for operation date");
  }
  if (nextBillingCycle !== priceRow.periodo) {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "billing_cycle does not match precio_plan period");
  }
}

async function ensureSubscriptionGraceRules(payload: Record<string, unknown>, id?: string) {
  const statusRaw = asCleanString(payload.operational_status);
  if (statusRaw && !["EN_SERVICIO", "EN_PRORROGA", "BLOQUEADA"].includes(statusRaw)) {
    throw new AppError(400, "VALIDATION_ERROR", "operational_status must be EN_SERVICIO, EN_PRORROGA or BLOQUEADA");
  }

  const graceUntil = normalizeDateString(payload.grace_until);
  const daysRaw = payload.grace_days_granted;
  const hasDays = daysRaw !== undefined && daysRaw !== null && String(daysRaw).trim() !== "";
  const graceDays = hasDays ? Number(daysRaw) : null;
  if (graceDays !== null && (!Number.isFinite(graceDays) || graceDays < 0)) {
    throw new AppError(400, "VALIDATION_ERROR", "grace_days_granted must be >= 0");
  }

  const status = id
    ? (
        await query<{ estado: string }>("SELECT estado::text AS estado FROM billing.suscripciones WHERE id = $1 LIMIT 1", [id])
      ).rows[0]?.estado
    : asCleanString(payload.estado);
  if (!status) return;

  if ((graceUntil || statusRaw === "EN_PRORROGA" || (graceDays ?? 0) > 0) && status !== "ACTIVA" && status !== "PAUSADA") {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "Grace period is only allowed for ACTIVA or PAUSADA subscriptions");
  }

  if (graceDays !== null) {
    payload.grace_days_granted = graceDays;
    if (graceDays === 0) {
      payload.grace_until = null;
      if (!statusRaw) payload.operational_status = "EN_SERVICIO";
      return;
    }
    const ref = id
      ? (
          await query<{ periodo_actual_fin: string }>(
            "SELECT periodo_actual_fin::text FROM billing.suscripciones WHERE id = $1 LIMIT 1",
            [id],
          )
        ).rows[0]?.periodo_actual_fin
      : asCleanString(payload.periodo_actual_fin);
    if (!ref) {
      throw new AppError(400, "BUSINESS_RULE_VIOLATION", "periodo_actual_fin is required to calculate grace_until");
    }
    const d = new Date(`${ref}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + graceDays);
    payload.grace_until = d.toISOString().slice(0, 10);
    payload.operational_status = "EN_PRORROGA";
  }
}

async function maybeLogSubscriptionGraceEvents(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before || !after) return;
  const subscriptionId = String(after.id ?? "");
  if (!subscriptionId) return;

  const beforeGrace = normalizeDateString(before.grace_until);
  const afterGrace = normalizeDateString(after.grace_until);

  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  if (!beforeGrace && afterGrace) {
    events.push({ type: "GRACE_GRANTED", payload: { grace_until: afterGrace } });
  } else if (beforeGrace && afterGrace && beforeGrace !== afterGrace) {
    events.push({ type: "GRACE_EXTENDED", payload: { from: beforeGrace, to: afterGrace } });
  } else if (beforeGrace && !afterGrace) {
    events.push({ type: "GRACE_EXPIRED", payload: { previous_grace_until: beforeGrace } });
  }

  for (const ev of events) {
    await query(
      `INSERT INTO billing.cobro_eventos (suscripcion_id, event_type, actor, payload_json)
       VALUES ($1, $2, 'api_v1_patch', $3::jsonb)`,
      [subscriptionId, ev.type, JSON.stringify(ev.payload)],
    );
  }
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
  const suscripcionId = row.id as string | undefined;
  const planId = row.plan_id as string | undefined;
  const periodoInicio = row.periodo_actual_inicio as string | undefined;
  const periodoFin = row.periodo_actual_fin as string | undefined;
  if (!suscripcionId || !planId || !periodoInicio || !periodoFin) return;

  await query(
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
    [suscripcionId, periodoInicio, periodoFin, planId],
  );
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
    if (resource === "suscripciones" || resource === "politicas-cobro" || resource === "cobro-eventos") {
      await ensureBillingGraceSchema();
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
    if (resource === "suscripciones" || resource === "politicas-cobro" || resource === "cobro-eventos") {
      await ensureBillingGraceSchema();
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
      await ensureSubscriptionGraceRules(payload);
    }
    if (resource === "items-suscripcion") {
      await ensureSubscriptionItemCreateRules(payload);
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
    if (resource === "suscripciones" || resource === "politicas-cobro" || resource === "cobro-eventos") {
      await ensureBillingGraceSchema();
    }

    const payload = await readJson<Record<string, unknown>>(request);
    let cancellationReasonForHistory: string | null = null;
    let planChangeReasonForHistory: string | null = null;
    let previousPlanEndForHistory: string | null = null;
    const before =
      resource === "suscripciones" && idParts.length === 1
        ? (
            await query<Record<string, unknown>>(
              "SELECT id::text, estado::text, plan_id::text, billing_cycle::text, grace_until::text, operational_status::text, canceled_at::text FROM billing.suscripciones WHERE id = $1 LIMIT 1",
              [idParts[0]],
            )
          ).rows[0] ?? null
        : null;
    if (resource === "productos" && idParts.length === 1) {
      await ensureProductPatchRules(idParts[0]!, payload);
    }
    if (resource === "suscripciones" && idParts.length === 1) {
      if (!payload.billing_cycle && payload.periodo) payload.billing_cycle = payload.periodo;
      if (!payload.periodo && payload.billing_cycle) payload.periodo = payload.billing_cycle;
      await ensureSubscriptionPatchRules(idParts[0]!, payload);
      await ensureSubscriptionGraceRules(payload, idParts[0]!);

      const previousStatus = asCleanString(before?.estado);
      const nextStatus = asCleanString(payload.estado) || previousStatus;
      const previousPlanId = asCleanString(before?.plan_id);
      const previousBillingCycle = asCleanString(before?.billing_cycle);
      const nextPlanId = asCleanString(payload.plan_id) || previousPlanId;
      const nextBillingCycle = asCleanString(payload.billing_cycle) || previousBillingCycle;
      const planOrCycleChanged = previousPlanId !== nextPlanId || previousBillingCycle !== nextBillingCycle;

      const planChangeReason = asCleanString(payload.motivo_cambio_plan);
      const previousPlanEnd = normalizeDateString(payload.fecha_fin_plan_anterior);
      delete payload.motivo_cambio_plan;
      delete payload.fecha_fin_plan_anterior;
      if (planOrCycleChanged) {
        if (!planChangeReason) {
          throw new AppError(400, "VALIDATION_ERROR", "motivo_cambio_plan is required when changing plan or billing_cycle");
        }
        if (!["NUEVO_PLAN", "RENOVACION", "CAMBIO_PLAN"].includes(planChangeReason)) {
          throw new AppError(400, "VALIDATION_ERROR", "motivo_cambio_plan must be NUEVO_PLAN, RENOVACION or CAMBIO_PLAN");
        }
        if (!previousPlanEnd) {
          throw new AppError(400, "VALIDATION_ERROR", "fecha_fin_plan_anterior is required when changing plan or billing_cycle");
        }
        const newPlanStart = normalizeDateString(payload.periodo_actual_inicio) || normalizeDateString(payload.fecha_inicio);
        if (newPlanStart && previousPlanEnd > newPlanStart) {
          throw new AppError(400, "VALIDATION_ERROR", "fecha_fin_plan_anterior cannot be greater than periodo_actual_inicio");
        }
        planChangeReasonForHistory = planChangeReason;
        previousPlanEndForHistory = previousPlanEnd;
      }

      const cancellationReason = asCleanString(payload.motivo_cancelacion);
      delete payload.motivo_cancelacion;
      if (previousStatus !== "CANCELADA" && nextStatus === "CANCELADA") {
        if (!cancellationReason) {
          throw new AppError(400, "VALIDATION_ERROR", "motivo_cancelacion is required when setting estado to CANCELADA");
        }
        cancellationReasonForHistory = cancellationReason;
        if (!payload.canceled_at) {
          payload.canceled_at = new Date().toISOString();
        }
      }
    }
    if (resource === "items-suscripcion" && idParts.length === 1) {
      await ensureSubscriptionItemPatchRules(idParts[0]!, payload);
    }
    const row = await updateRow(config, idParts, payload);
    if (resource === "suscripciones") {
      const previousStatus = asCleanString(before?.estado);
      const nextStatus = asCleanString((row as Record<string, unknown>)?.estado ?? payload.estado);
      if (idParts.length === 1 && planChangeReasonForHistory && previousPlanEndForHistory) {
        await query(
          `WITH closed_row AS (
             SELECT id
             FROM billing.suscripciones_plan_historial
             WHERE suscripcion_id = $1
               AND vigente_hasta IS NOT NULL
             ORDER BY updated_at DESC, created_at DESC
             LIMIT 1
           )
           UPDATE billing.suscripciones_plan_historial h
              SET vigente_hasta = $2::date,
                  updated_at = now()
            WHERE h.id IN (SELECT id FROM closed_row)`,
          [idParts[0], previousPlanEndForHistory],
        );
        await query(
          `UPDATE billing.suscripciones_plan_historial
              SET motivo = $2,
                  updated_at = now()
            WHERE suscripcion_id = $1
              AND vigente_hasta IS NULL`,
          [idParts[0], planChangeReasonForHistory],
        );
      }
      if (idParts.length === 1 && previousStatus !== "CANCELADA" && nextStatus === "CANCELADA") {
        if (cancellationReasonForHistory) {
          const rawCanceledAt = asCleanString((row as Record<string, unknown>)?.canceled_at ?? payload.canceled_at);
          const cancellationDate = (rawCanceledAt ? rawCanceledAt.slice(0, 10) : "") || new Date().toISOString().slice(0, 10);
          const closeOpenHistory = await query(
            `UPDATE billing.suscripciones_plan_historial
                SET vigente_hasta = COALESCE(vigente_hasta, $3::date),
                    motivo = $1,
                    updated_at = now()
              WHERE suscripcion_id = $2
                AND vigente_hasta IS NULL`,
            [`CANCELADA: ${cancellationReasonForHistory}`, idParts[0], cancellationDate],
          );
          if (!closeOpenHistory.rowCount) {
            await query(
              `INSERT INTO billing.suscripciones_plan_historial
                 (suscripcion_id, plan_id, billing_cycle, vigente_desde, vigente_hasta, motivo)
               SELECT
                 s.id,
                 s.plan_id,
                 s.billing_cycle,
                 COALESCE(s.periodo_actual_inicio, s.fecha_inicio, $3::date),
                 $3::date,
                 $1
               FROM billing.suscripciones s
               WHERE s.id = $2`,
              [`CANCELADA: ${cancellationReasonForHistory}`, idParts[0], cancellationDate],
            );
          }
        }
      }
      await maybeLogSubscriptionGraceEvents(before, row as Record<string, unknown>);
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
      const motivo = asCleanString(payload.motivo);
      if (!motivo) {
        throw new AppError(400, "VALIDATION_ERROR", "motivo is required to delete a suscripcion");
      }
      await query(
        `UPDATE billing.suscripciones_plan_historial
            SET vigente_hasta = COALESCE(vigente_hasta, CURRENT_DATE),
                motivo = $1,
                updated_at = now()
          WHERE suscripcion_id = $2
            AND vigente_hasta IS NULL`,
        [`ELIMINADA: ${motivo}`, idParts[0]],
      );
    }

    const row = await deleteRow(config, idParts);
    return success(row);
  } catch (error) {
    return fromUnknownError(error);
  }
}
