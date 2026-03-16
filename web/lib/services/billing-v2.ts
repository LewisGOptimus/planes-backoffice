
import { PoolClient, QueryResultRow } from "pg";
import { query } from "@/lib/db";
import { AppError } from "@/lib/api/types";
import { runInTransaction, lockIdempotencyKey } from "@/lib/sql/transactions";
import { assert, requireDate, requireNumberLike, requireString, requireUuid } from "@/lib/api/validation";
import { runWorkflow, WorkflowName } from "@/lib/services/workflows";
import { syncPlanEntitlementsToSubscription } from "@/lib/services/entitlements";
import { computeInvoiceDiscountTotals, parseBooleanLike, parseDiscountInput } from "@/lib/services/invoice-discounts";
import {
  BillingAction,
  BillingAlert,
  BillingTimelineEvent,
  Customer360Response,
  CustomerSearchItem,
  ImpactPreviewResponse,
  OperationsDashboardResponse,
  PriceBookVersion,
} from "@/lib/types/billing-v2";

const PERIOD_MONTHS: Record<string, number> = { MENSUAL: 1, TRIMESTRAL: 3, ANUAL: 12 };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function diffDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00.000Z`).getTime();
  const b = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.max(1, Math.floor((b - a) / 86400000));
}

function asNum(v: string | number): number {
  return Number(v);
}

async function one<T extends QueryResultRow>(client: PoolClient, sql: string, values: unknown[] = []): Promise<T | null> {
  const res = await client.query<T>(sql, values);
  return res.rows[0] ?? null;
}

async function ensureBillingModelSchema() {
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
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'suscripciones_billing_cycle_periodo_chk'
      ) THEN
        ALTER TABLE billing.suscripciones
        ADD CONSTRAINT suscripciones_billing_cycle_periodo_chk CHECK (billing_cycle = periodo);
      END IF;
    END $$;
  `);
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

export async function ensureBillingOpsTables() {
  await ensureBillingModelSchema();
  await query(`
    CREATE TABLE IF NOT EXISTS billing.event_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      empresa_id UUID REFERENCES core.empresas(id) ON DELETE SET NULL,
      suscripcion_id UUID REFERENCES billing.suscripciones(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor_user_id UUID REFERENCES core.usuarios(id) ON DELETE SET NULL,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      related_invoice_id UUID REFERENCES billing.facturas(id) ON DELETE SET NULL,
      related_workflow TEXT,
      operation_id TEXT,
      source_channel TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS billing.alerts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      empresa_id UUID NOT NULL REFERENCES core.empresas(id) ON DELETE CASCADE,
      suscripcion_id UUID REFERENCES billing.suscripciones(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      due_at TIMESTAMPTZ,
      snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      assigned_to UUID REFERENCES core.usuarios(id) ON DELETE SET NULL,
      resolved_at TIMESTAMPTZ,
      UNIQUE (alert_type, empresa_id, suscripcion_id, status)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_billing_alerts_status_due
      ON billing.alerts (status, due_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_billing_event_log_empresa_time
      ON billing.event_log (empresa_id, event_time DESC)
  `);
}

export async function searchCustomers(params: URLSearchParams): Promise<CustomerSearchItem[]> {
  await ensureBillingOpsTables();
  const q = (params.get("query") ?? "").trim();
  const status = params.get("status");
  const renewalWindow = Number(params.get("renewal_window_days") ?? "0") || null;

  const values: unknown[] = [];
  const where: string[] = [];

  if (q) {
    values.push(`%${q.toLowerCase()}%`);
    const i = values.length;
    where.push(`(
      lower(e.nombre) LIKE $${i}
      OR lower(COALESCE(e.nit,'')) LIKE $${i}
      OR EXISTS (
        SELECT 1
        FROM core.usuarios_empresas ue
        JOIN core.usuarios u ON u.id = ue.usuario_id
        WHERE ue.empresa_id = e.id
          AND lower(COALESCE(u.email,'')) LIKE $${i}
      )
    )`);
  }

  if (status) {
    values.push(status);
    where.push(`s.estado::text = $${values.length}`);
  }

  if (renewalWindow && renewalWindow > 0) {
    values.push(renewalWindow);
    where.push(`s.periodo_actual_fin <= (CURRENT_DATE + make_interval(days => $${values.length}))::date`);
  }

  const sql = `
    SELECT
      e.id AS customer_id,
      e.nombre,
      e.nit,
      (
        SELECT u.email
        FROM core.usuarios_empresas ue
        JOIN core.usuarios u ON u.id = ue.usuario_id
        WHERE ue.empresa_id = e.id
        ORDER BY ue.es_principal DESC, u.created_at ASC
        LIMIT 1
      ) AS primary_contact,
      s.id AS active_subscription_id,
      s.estado::text AS subscription_status,
      s.periodo_actual_fin::text AS renewal_date
    FROM core.empresas e
    LEFT JOIN LATERAL (
      SELECT s1.*
      FROM billing.suscripciones s1
      WHERE s1.empresa_id = e.id
      ORDER BY (s1.estado = 'ACTIVA'::billing.estado_suscripcion) DESC, s1.updated_at DESC
      LIMIT 1
    ) s ON true
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY
      CASE WHEN s.estado = 'ACTIVA'::billing.estado_suscripcion THEN 0 ELSE 1 END,
      e.updated_at DESC
    LIMIT 50
  `;

  const res = await query<CustomerSearchItem>(sql, values);
  return res.rows;
}
export async function getCustomerOverview(customerId: string): Promise<Customer360Response> {
  await ensureBillingOpsTables();
  const customer = await query<{ id: string; nombre: string; nit: string | null; timezone: string }>(
    "SELECT id, nombre, nit, timezone FROM core.empresas WHERE id = $1",
    [customerId],
  );
  if ((customer.rowCount ?? 0) === 0) throw new AppError(404, "NOT_FOUND", "Customer not found");

  const subRes = await query<{
    id: string;
    plan_id: string;
    plan_name: string;
    status: string;
    period: string;
    period_start: string;
    period_end: string;
  }>(
    `SELECT s.id, s.plan_id, p.nombre AS plan_name, s.estado::text AS status, s.billing_cycle::text AS period,
            s.periodo_actual_inicio::text AS period_start, s.periodo_actual_fin::text AS period_end
       FROM billing.suscripciones s
       JOIN billing.planes p ON p.id = s.plan_id
      WHERE s.empresa_id = $1
      ORDER BY (s.estado = 'ACTIVA'::billing.estado_suscripcion) DESC, s.updated_at DESC
      LIMIT 1`,
    [customerId],
  );

  const invRes = await query<{
    id: string;
    issue_date: string;
    due_date: string | null;
    total: string;
    status: string;
    payment_method: string;
  }>(
    `SELECT id, fecha_emision::text AS issue_date, fecha_vencimiento::text AS due_date, total::text,
            estado::text AS status, metodo_pago::text AS payment_method
       FROM billing.facturas
      WHERE empresa_id = $1
      ORDER BY fecha_emision DESC
      LIMIT 12`,
    [customerId],
  );

  const alertsRes = await query<{
    id: string;
    alert_type: string;
    severity: string;
    status: string;
    due_at: string | null;
  }>(
    `SELECT id, alert_type, severity, status, due_at::text
       FROM billing.alerts
      WHERE empresa_id = $1 AND status <> 'resolved'
      ORDER BY created_at DESC
      LIMIT 10`,
    [customerId],
  );

  const openInv = invRes.rows.filter((x) => x.status !== "PAGADA" && x.status !== "ANULADA");
  const activeSub = subRes.rows[0] ?? null;

  return {
    customer: customer.rows[0],
    active_subscription: activeSub,
    invoices: invRes.rows.map((x) => ({ ...x, total: Number(x.total) })),
    consumption: [],
    alerts: alertsRes.rows,
    kpis: {
      open_invoices: openInv.length,
      open_invoice_amount: openInv.reduce((acc, x) => acc + Number(x.total), 0),
      next_renewal_date: activeSub?.period_end ?? null,
    },
  };
}

export async function getCustomerTimeline(customerId: string, params: URLSearchParams): Promise<BillingTimelineEvent[]> {
  await ensureBillingOpsTables();
  const from = params.get("from");
  const to = params.get("to");
  const entity = params.get("entity");
  const values: unknown[] = [customerId];
  const where: string[] = ["empresa_id = $1"];

  if (from) {
    values.push(from);
    where.push(`event_time::date >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    where.push(`event_time::date <= $${values.length}::date`);
  }
  if (entity) {
    values.push(entity);
    where.push(`event_type = $${values.length}`);
  }

  const res = await query<BillingTimelineEvent>(
    `SELECT id, event_type, event_time::text, actor_user_id::text, related_invoice_id::text, related_workflow,
            payload_json::jsonb AS payload_json
       FROM billing.event_log
      WHERE ${where.join(" AND ")}
      ORDER BY event_time DESC
      LIMIT 120`,
    values,
  );
  return res.rows;
}

export async function getPriceBook(params: URLSearchParams): Promise<{ versions: PriceBookVersion[]; simulation: Record<string, unknown> | null }> {
  await ensureBillingOpsTables();
  const planId = params.get("plan_id");
  const periodo = params.get("periodo");
  const from = params.get("from");
  const to = params.get("to");
  const activeOnly = params.get("active_only") === "true";
  const simulateDate = params.get("simulate_date");
  const simulateSubscriptionId = params.get("suscripcion_id");

  const values: unknown[] = [];
  const where: string[] = [];

  if (planId) {
    values.push(planId);
    where.push(`pp.plan_id = $${values.length}`);
  }
  if (periodo) {
    values.push(periodo);
    where.push(`pp.periodo::text = $${values.length}`);
  }
  if (from) {
    values.push(from);
    where.push(`(pp.valido_hasta IS NULL OR pp.valido_hasta >= $${values.length}::date)`);
  }
  if (to) {
    values.push(to);
    where.push(`(pp.valido_desde IS NULL OR pp.valido_desde <= $${values.length}::date)`);
  }
  if (activeOnly) {
    where.push("pp.activo = true");
  }

  const res = await query<{
    id: string;
    plan_id: string;
    plan_name: string;
    period: string;
    value: string;
    currency_code: string;
    active: boolean;
    valid_from: string | null;
    valid_to: string | null;
  }>(
    `SELECT pp.id, pp.plan_id, p.nombre AS plan_name, pp.periodo::text AS period, pp.valor::text AS value,
            m.codigo AS currency_code, pp.activo AS active, pp.valido_desde::text AS valid_from, pp.valido_hasta::text AS valid_to
       FROM billing.precios_planes pp
       JOIN billing.planes p ON p.id = pp.plan_id
       JOIN common.monedas m ON m.id = pp.moneda_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY p.nombre, pp.periodo, pp.valido_desde DESC NULLS LAST, pp.created_at DESC`,
    values,
  );

  let simulation: Record<string, unknown> | null = null;
  if (simulateDate && simulateSubscriptionId) {
    const sub = await query<{ plan_id: string; billing_cycle: string }>(
      "SELECT plan_id, billing_cycle::text FROM billing.suscripciones WHERE id = $1",
      [simulateSubscriptionId],
    );
    if ((sub.rowCount ?? 0) > 0) {
      const s = sub.rows[0];
      const p = await query<{ id: string; value: string }>(
        `SELECT id, valor::text AS value
           FROM billing.precios_planes
          WHERE plan_id = $1
            AND periodo = $2::billing.periodo_precio
            AND activo = true
            AND (valido_desde IS NULL OR valido_desde <= $3::date)
            AND (valido_hasta IS NULL OR valido_hasta >= $3::date)
          ORDER BY valido_desde DESC NULLS LAST, created_at DESC
          LIMIT 1`,
        [s.plan_id, s.billing_cycle, simulateDate],
      );
      if ((p.rowCount ?? 0) > 0) {
        simulation = {
          subscription_id: simulateSubscriptionId,
          billing_date: simulateDate,
          selected_price_id: p.rows[0].id,
          projected_total: Number(p.rows[0].value),
          effective_start: simulateDate,
          effective_end: addMonths(simulateDate, PERIOD_MONTHS[s.billing_cycle] ?? 1),
        };
      }
    }
  }

  return {
    versions: res.rows.map((x) => ({ ...x, value: Number(x.value) })),
    simulation,
  };
}
async function getPlanPrice(client: PoolClient, planId: string, periodo: string, date: string) {
  const row = await one<{ id: string; value: string }>(
    client,
    `SELECT id, valor::text AS value
       FROM billing.precios_planes
      WHERE plan_id = $1
        AND periodo = $2::billing.periodo_precio
        AND activo = true
        AND (valido_desde IS NULL OR valido_desde <= $3::date)
        AND (valido_hasta IS NULL OR valido_hasta >= $3::date)
      ORDER BY valido_desde DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [planId, periodo, date],
  );
  if (!row) throw new AppError(400, "BUSINESS_RULE_VIOLATION", "No active plan price for date");
  return row;
}

async function getProductPrice(client: PoolClient, productId: string, periodo: string, date: string) {
  const row = await one<{ id: string; value: string; permite_prorrateo: boolean }>(
    client,
    `SELECT id, valor::text AS value, permite_prorrateo
       FROM billing.precios
      WHERE producto_id = $1
        AND periodo = $2::billing.periodo_precio
        AND activo = true
        AND (valido_desde IS NULL OR valido_desde <= $3::date)
        AND (valido_hasta IS NULL OR valido_hasta >= $3::date)
      ORDER BY valido_desde DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [productId, periodo, date],
  );
  if (!row) throw new AppError(400, "BUSINESS_RULE_VIOLATION", "No active product price for date");
  return row;
}

async function resolvePlanCharge(client: PoolClient, planId: string, billingCycle: string, date: string) {
  const plan = await one<{ pricing_mode: string }>(client, "SELECT pricing_mode::text FROM billing.planes WHERE id = $1", [planId]);
  if (!plan) throw new AppError(404, "NOT_FOUND", "Plan not found");

  const fallbackPlanPrice = await getPlanPrice(client, planId, billingCycle, date);
  if (plan.pricing_mode !== "SUM_COMPONENTS") {
    return {
      pricing_mode: plan.pricing_mode,
      plan_price_id: fallbackPlanPrice.id,
      amount: Number(fallbackPlanPrice.value),
      details: [] as Array<{ producto_id: string; amount: number }>,
    };
  }

  const items = await client.query<{ producto_id: string; cantidad: number | null }>(
    `SELECT producto_id::text, cantidad
       FROM billing.items_plan
      WHERE plan_id = $1 AND incluido = true`,
    [planId],
  );

  let amount = 0;
  const details: Array<{ producto_id: string; amount: number }> = [];
  for (const item of items.rows) {
    const price = await getProductPrice(client, item.producto_id, billingCycle, date);
    const qty = Math.max(1, Number(item.cantidad ?? 1));
    const line = Number((Number(price.value) * qty).toFixed(2));
    amount += line;
    details.push({ producto_id: item.producto_id, amount: line });
  }

  return {
    pricing_mode: plan.pricing_mode,
    plan_price_id: fallbackPlanPrice.id,
    amount: Number(amount.toFixed(2)),
    details,
  };
}

function toSubtotal(lines: Array<{ amount: number }>) {
  return Number(lines.reduce((acc, l) => acc + l.amount, 0).toFixed(2));
}

async function resolveProductId(client: PoolClient, codeInput: unknown): Promise<string> {
  const code = requireString(codeInput, "producto_codigo");
  const product = await one<{ id: string }>(client, "SELECT id FROM billing.productos WHERE codigo = $1", [code]);
  if (!product) throw new AppError(404, "NOT_FOUND", "Product not found");
  return product.id;
}

export async function previewAction(action: BillingAction, payload: Record<string, unknown>): Promise<ImpactPreviewResponse> {
  await ensureBillingOpsTables();
  return runInTransaction(async (client) => {
    const warnings: string[] = [];

    if (action === "renew_subscription") {
      const subscriptionId = requireUuid(payload.suscripcion_id ?? payload.subscription_id, "suscripcion_id");
      const billingDate = requireDate(payload.billing_date ?? todayIso(), "billing_date");
      const generateInvoice = parseBooleanLike(payload.generate_invoice, true);
      const discount = parseDiscountInput({
        typeRaw: payload.discount_type,
        valueRaw: payload.discount_value,
        reasonRaw: payload.discount_reason,
        typeField: "discount_type",
        valueField: "discount_value",
        reasonField: "discount_reason",
      });
      if (!generateInvoice && discount) {
        throw new AppError(400, "VALIDATION_ERROR", "Discount is only allowed when generate_invoice is true");
      }
      const sub = await one<{ plan_id: string; billing_cycle: string }>(client, "SELECT plan_id, billing_cycle::text FROM billing.suscripciones WHERE id = $1", [subscriptionId]);
      if (!sub) throw new AppError(404, "NOT_FOUND", "Subscription not found");
      const price = await getPlanPrice(client, sub.plan_id, sub.billing_cycle, billingDate);
      if (!generateInvoice) {
        warnings.push("Renovacion configurada sin factura.");
      }
      const line = {
        label: "Renovacion de suscripcion",
        amount: generateInvoice ? asNum(price.value) : 0,
        billing_date: billingDate,
        effective_start: billingDate,
        effective_end: addMonths(billingDate, PERIOD_MONTHS[sub.billing_cycle] ?? 1),
      };
      const totals = generateInvoice ? computeInvoiceDiscountTotals(line.amount, discount) : computeInvoiceDiscountTotals(0, null);
      return {
        action,
        currency: "COP",
        summary: "Renovacion usando precio vigente del plan",
        lines: [line],
        totals: { subtotal: totals.subtotal, discount: totals.discount_amount, total: totals.total },
        warnings,
      };
    }

    if (action === "purchase_consumable") {
      const subscriptionId = requireUuid(payload.suscripcion_id, "suscripcion_id");
      const qty = Number(requireNumberLike(payload.cantidad, "cantidad"));
      const billingDate = requireDate(payload.billing_date ?? todayIso(), "billing_date");
      const sub = await one<{ billing_cycle: string }>(client, "SELECT billing_cycle::text FROM billing.suscripciones WHERE id = $1", [subscriptionId]);
      if (!sub) throw new AppError(404, "NOT_FOUND", "Subscription not found");
      const productId = payload.producto_id ? requireUuid(payload.producto_id, "producto_id") : await resolveProductId(client, payload.producto_codigo);
      const price = await getProductPrice(client, productId, sub.billing_cycle, billingDate);
      const amount = Number((Number(price.value) * qty).toFixed(2));
      return {
        action,
        currency: "COP",
        summary: "Compra de consumible adicional",
        lines: [{ label: `Consumible x${qty}`, amount, billing_date: billingDate, effective_start: billingDate, effective_end: null }],
        totals: { subtotal: amount, discount: 0, total: amount },
        warnings,
      };
    }

    if (action === "purchase_fixed_term_service") {
      const subscriptionId = requireUuid(payload.suscripcion_id, "suscripcion_id");
      const billingDate = requireDate(payload.billing_date ?? payload.fecha_pago ?? todayIso(), "billing_date");
      const effectiveStart = requireDate(payload.effective_start ?? payload.fecha_efectiva_inicio, "effective_start");
      const effectiveEnd = requireDate(payload.effective_end ?? payload.fecha_efectiva_fin, "effective_end");
      assert(effectiveEnd > effectiveStart, "effective_end must be greater than effective_start");
      const sub = await one<{ id: string }>(client, "SELECT id FROM billing.suscripciones WHERE id = $1", [subscriptionId]);
      if (!sub) throw new AppError(404, "NOT_FOUND", "Subscription not found");
      const productId = payload.producto_id ? requireUuid(payload.producto_id, "producto_id") : await resolveProductId(client, payload.producto_codigo);
      const price = await getProductPrice(client, productId, "ANUAL", billingDate);
      if (price.permite_prorrateo) warnings.push("El precio del producto permite prorrateo, pero este flujo exige precio fijo.");
      const amount = Number(price.value);
      return {
        action,
        currency: "COP",
        summary: "Servicio de vigencia fija",
        lines: [{ label: "Servicio fijo", amount, billing_date: billingDate, effective_start: effectiveStart, effective_end: effectiveEnd }],
        totals: { subtotal: amount, discount: 0, total: amount },
        warnings,
      };
    }

    if (action === "upgrade_midcycle_limit") {
      const subscriptionId = requireUuid(payload.suscripcion_id, "suscripcion_id");
      const billingDate = requireDate(payload.billing_date ?? todayIso(), "billing_date");
      const productId = requireUuid(payload.producto_id, "producto_id");
      if (!payload.entitlement_id && !payload.entitlement_codigo) {
        throw new AppError(400, "VALIDATION_ERROR", "entitlement_id is required");
      }
      const sub = await one<{ billing_cycle: string; periodo_actual_inicio: string; periodo_actual_fin: string }>(
        client,
        "SELECT billing_cycle::text, periodo_actual_inicio::text, periodo_actual_fin::text FROM billing.suscripciones WHERE id = $1",
        [subscriptionId],
      );
      if (!sub) throw new AppError(404, "NOT_FOUND", "Subscription not found");
      const price = await getProductPrice(client, productId, sub.billing_cycle, billingDate);
      assert(price.permite_prorrateo, "Product does not allow proration", "BUSINESS_RULE_VIOLATION");
      const totalDays = diffDays(sub.periodo_actual_inicio, sub.periodo_actual_fin);
      const remaining = diffDays(billingDate, sub.periodo_actual_fin);
      const amount = Number(((Number(price.value) * remaining) / totalDays).toFixed(2));
      return {
        action,
        currency: "COP",
        summary: "Upgrade con prorrateo de ciclo",
        lines: [{ label: "Prorrateo upgrade", amount, billing_date: billingDate, effective_start: billingDate, effective_end: sub.periodo_actual_fin }],
        totals: { subtotal: amount, discount: 0, total: amount },
        warnings,
      };
    }
    if (action === "create_subscription") {
      const planId = requireUuid(payload.plan_id, "plan_id");
      const period = requireString(payload.billing_cycle ?? payload.periodo, "billing_cycle");
      const billingDate = requireDate(payload.billing_date ?? todayIso(), "billing_date");
      const charge = await resolvePlanCharge(client, planId, period, billingDate);
      const included = await client.query<{ qty: string }>(
        "SELECT count(*)::text AS qty FROM billing.items_plan WHERE plan_id = $1 AND incluido = true",
        [planId],
      );
      const amount = charge.amount;
      return {
        action,
        currency: "COP",
        summary: charge.pricing_mode === "SUM_COMPONENTS" ? "Alta de nueva suscripcion (suma de componentes)" : "Alta de nueva suscripcion (bundle)",
        lines: [{ label: `Plan base (+${included.rows[0]?.qty ?? "0"} items incluidos)`, amount, billing_date: billingDate, effective_start: billingDate, effective_end: addMonths(billingDate, PERIOD_MONTHS[period] ?? 1) }],
        totals: { subtotal: amount, discount: 0, total: amount },
        warnings,
      };
    }

    if (action === "add_company_with_subscription") {
      const planId = requireUuid(payload.plan_id, "plan_id");
      const billingDate = requireDate(payload.billing_date ?? todayIso(), "billing_date");
      const plan = await one<{ periodo: string }>(client, "SELECT periodo::text FROM billing.planes WHERE id = $1", [planId]);
      if (!plan) throw new AppError(404, "NOT_FOUND", "Plan not found");
      const price = await getPlanPrice(client, planId, plan.periodo, billingDate);
      const amount = Number(price.value);
      return {
        action,
        currency: "COP",
        summary: "Nueva empresa con suscripcion",
        lines: [{ label: "Alta de empresa + plan", amount, billing_date: billingDate, effective_start: billingDate, effective_end: addMonths(billingDate, PERIOD_MONTHS[plan.periodo] ?? 1) }],
        totals: { subtotal: amount, discount: 0, total: amount },
        warnings,
      };
    }

    const planId = requireUuid(payload.plan_id, "plan_id");
    const vigenteDesde = requireDate(payload.billing_date ?? payload.vigente_desde ?? todayIso(), "billing_date");
    const incMensual = Number(requireNumberLike(payload.incremento_mensual, "incremento_mensual"));
    const incAnual = Number(requireNumberLike(payload.incremento_anual, "incremento_anual"));
    const prices = await client.query<{ periodo: string; valor: string }>(
      "SELECT periodo::text, valor::text FROM billing.precios_planes WHERE plan_id = $1 AND activo = true AND periodo IN ('MENSUAL','ANUAL')",
      [planId],
    );
    const lines = prices.rows.map((p) => {
      const next = Number((Number(p.valor) + (p.periodo === "MENSUAL" ? incMensual : incAnual)).toFixed(2));
      return {
        label: `Actualizacion ${p.periodo}`,
        amount: next,
        billing_date: vigenteDesde,
        effective_start: vigenteDesde,
        effective_end: null,
      };
    });
    const subtotal = toSubtotal(lines);
    return {
      action,
      currency: "COP",
      summary: "Actualizacion de precios de plan",
      lines,
      totals: { subtotal, discount: 0, total: subtotal },
      warnings,
    };
  });
}

async function createSubscription(client: PoolClient, payload: Record<string, unknown>) {
  const empresaId = requireUuid(payload.empresa_id, "empresa_id");
  const planId = requireUuid(payload.plan_id, "plan_id");
  const billingDate = requireDate(payload.billing_date ?? todayIso(), "billing_date");
  const billingCycle = requireString(payload.billing_cycle ?? payload.periodo ?? "", "billing_cycle");
  const mode = (payload.modo_renovacion ?? "MANUAL") as "MANUAL" | "AUTOMATICA";

  const existing = await one<{ id: string }>(client, "SELECT id FROM billing.suscripciones WHERE empresa_id = $1 AND estado = 'ACTIVA'::billing.estado_suscripcion", [empresaId]);
  if (existing) throw new AppError(409, "CONFLICT", "Company already has an active subscription");

  const plan = await one<{ pricing_mode: string; periodo: string }>(client, "SELECT pricing_mode::text, periodo::text FROM billing.planes WHERE id = $1", [planId]);
  if (!plan) throw new AppError(404, "NOT_FOUND", "Plan not found");
  const selectedCycle = billingCycle || plan.periodo;
  const charge = await resolvePlanCharge(client, planId, selectedCycle, billingDate);
  const end = addMonths(billingDate, PERIOD_MONTHS[selectedCycle] ?? 1);

  const sub = await one<{ id: string }>(
    client,
    `INSERT INTO billing.suscripciones
      (empresa_id, plan_id, precio_plan_id, estado, billing_cycle, periodo, modo_renovacion, fecha_inicio, periodo_actual_inicio, periodo_actual_fin)
     VALUES
      ($1, $2, $3, 'ACTIVA', $4::billing.periodo_precio, $4::billing.periodo_precio, $5::billing.modo_renovacion, $6, $6, $7)
     RETURNING id`,
    [empresaId, planId, charge.plan_price_id, selectedCycle, mode, billingDate, end],
  );

  await client.query(
    `INSERT INTO billing.items_suscripcion (suscripcion_id, producto_id, cantidad, fecha_inicio, fecha_fin, origen, estado)
     SELECT $1, ip.producto_id, COALESCE(ip.cantidad,1), $2::date, $3::date,
            'PLAN'::billing.origen_item_suscripcion, 'ACTIVO'::billing.estado_item_suscripcion
       FROM billing.items_plan ip
      WHERE ip.plan_id = $4 AND ip.incluido = true`,
    [sub!.id, billingDate, end, planId],
  );
  await syncPlanEntitlementsToSubscription(client, {
    suscripcionId: sub!.id,
    planId,
    effectiveFrom: billingDate,
  });

  return { subscription_id: sub!.id, billing_date: billingDate, period_end: end, total: charge.amount, pricing_mode: charge.pricing_mode };
}

async function executeUpdatePlanPrices(client: PoolClient, payload: Record<string, unknown>) {
  const planId = requireUuid(payload.plan_id, "plan_id");
  const vigenteDesde = requireDate(payload.billing_date ?? payload.vigente_desde ?? todayIso(), "billing_date");
  const incMensual = Number(requireNumberLike(payload.incremento_mensual, "incremento_mensual"));
  const incAnual = Number(requireNumberLike(payload.incremento_anual, "incremento_anual"));

  const rows = await client.query<{ id: string; periodo: string; valor: string; moneda_id: string }>(
    `SELECT id, periodo::text, valor::text, moneda_id
       FROM billing.precios_planes
      WHERE plan_id = $1
        AND activo = true
        AND periodo IN ('MENSUAL','ANUAL')`,
    [planId],
  );

  const created: string[] = [];
  for (const row of rows.rows) {
    const plus = row.periodo === "MENSUAL" ? incMensual : incAnual;
    const next = Number((Number(row.valor) + plus).toFixed(2));

    await client.query(
      `UPDATE billing.precios_planes
          SET valido_hasta = ($2::date - INTERVAL '1 day')::date
        WHERE plan_id = $1
          AND periodo = $3::billing.periodo_precio
          AND activo = true
          AND (valido_hasta IS NULL OR valido_hasta >= $2::date)
          AND id <> $4`,
      [planId, vigenteDesde, row.periodo, row.id],
    );

    const inserted = await one<{ id: string }>(
      client,
      `INSERT INTO billing.precios_planes (plan_id, moneda_id, periodo, valor, activo, valido_desde)
       VALUES ($1, $2, $3::billing.periodo_precio, $4::numeric, true, $5)
       RETURNING id`,
      [planId, row.moneda_id, row.periodo, next.toFixed(2), vigenteDesde],
    );
    created.push(inserted!.id);
  }

  return { plan_id: planId, nuevos_precios: created, billing_date: vigenteDesde };
}

function toWorkflowAction(action: BillingAction): WorkflowName | null {
  const map: Record<BillingAction, WorkflowName | null> = {
    create_subscription: null,
    renew_subscription: "renew-subscription",
    upgrade_midcycle_limit: "upgrade-midcycle-limit",
    purchase_consumable: "purchase-consumable",
    purchase_fixed_term_service: "purchase-fixed-term-service",
    add_company_with_subscription: "add-company-with-subscription",
    update_plan_prices: null,
  };
  return map[action];
}
function toWorkflowPayload(action: BillingAction, payload: Record<string, unknown>): Record<string, unknown> {
  if (action === "renew_subscription") {
    return {
      suscripcionId: payload.suscripcion_id,
      fechaRenovacion: payload.billing_date,
      generarFactura: payload.generate_invoice,
      descuentoTipo: payload.discount_type,
      descuentoValor: payload.discount_value,
      descuentoMotivo: payload.discount_reason,
    };
  }
  if (action === "upgrade_midcycle_limit") {
    return {
      suscripcionId: payload.suscripcion_id,
      entitlementId: payload.entitlement_id,
      entitlementCodigo: payload.entitlement_codigo,
      nuevoLimite: payload.nuevo_limite,
      productoId: payload.producto_id,
      fecha: payload.billing_date,
    };
  }
  if (action === "purchase_consumable") {
    return {
      suscripcionId: payload.suscripcion_id,
      productoId: payload.producto_id,
      productoCodigo: payload.producto_codigo,
      cantidad: payload.cantidad,
      fecha: payload.billing_date,
    };
  }
  if (action === "purchase_fixed_term_service") {
    return {
      suscripcionId: payload.suscripcion_id,
      productoId: payload.producto_id,
      productoCodigo: payload.producto_codigo,
      fechaPago: payload.billing_date,
      fechaEfectivaInicio: payload.effective_start,
      fechaEfectivaFin: payload.effective_end,
    };
  }
  if (action === "add_company_with_subscription") {
    return {
      usuarioId: payload.usuario_id,
      nombre: payload.nombre,
      planId: payload.plan_id,
      fecha: payload.billing_date,
      nit: payload.nit,
    };
  }
  return payload;
}

export async function executeAction(action: BillingAction, payload: Record<string, unknown>, headers: Headers) {
  await ensureBillingOpsTables();
  return runInTransaction(async (client) => {
    const operationId = crypto.randomUUID();
    const idempotencyKey = headers.get("idempotency-key") ?? headers.get("idempotency_key") ?? operationId;
    await lockIdempotencyKey(client, idempotencyKey);

    const actorUserId = headers.get("x-actor-user-id");
    const sourceChannel = headers.get("x-source-channel") ?? "billing-ui";
    let result: Record<string, unknown>;
    let relatedWorkflow: string | null = null;

    if (action === "create_subscription") {
      result = await createSubscription(client, payload);
    } else if (action === "update_plan_prices") {
      result = await executeUpdatePlanPrices(client, payload);
    } else {
      const wf = toWorkflowAction(action);
      if (!wf) throw new AppError(400, "VALIDATION_ERROR", "Unsupported action mapping");
      relatedWorkflow = wf;
      result = (await runWorkflow(wf, toWorkflowPayload(action, payload), headers)) as Record<string, unknown>;
    }

    const empresaId = (result.empresaId ?? payload.empresa_id ?? payload.customer_id ?? null) as string | null;
    const suscripcionId = (result.suscripcionId ?? result.subscription_id ?? payload.suscripcion_id ?? null) as string | null;
    const facturaId = (result.facturaId ?? result.factura_id ?? null) as string | null;

    await client.query(
      `INSERT INTO billing.event_log
        (empresa_id, suscripcion_id, event_type, actor_user_id, payload_json, related_invoice_id, related_workflow, operation_id, source_channel)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
      [empresaId, suscripcionId, `execute:${action}`, actorUserId, JSON.stringify(result), facturaId, relatedWorkflow, operationId, sourceChannel],
    );

    return {
      action,
      operation_id: operationId,
      idempotency_key: idempotencyKey,
      actor_user_id: actorUserId,
      source_channel: sourceChannel,
      result,
    };
  });
}

export async function listAlerts(params: URLSearchParams): Promise<BillingAlert[]> {
  await ensureBillingOpsTables();
  const type = params.get("type");
  const state = params.get("state");
  const assignee = params.get("assignee");
  const page = Math.max(1, Number(params.get("page") ?? "1"));
  const pageSize = 30;

  const values: unknown[] = [];
  const where: string[] = [];

  if (type) {
    values.push(type);
    where.push(`alert_type = $${values.length}`);
  }
  if (state) {
    values.push(state);
    where.push(`status = $${values.length}`);
  }
  if (assignee) {
    values.push(assignee);
    where.push(`assigned_to = $${values.length}`);
  }

  values.push(pageSize);
  values.push((page - 1) * pageSize);

  const res = await query<BillingAlert>(
    `SELECT id, alert_type, severity, status, empresa_id::text, suscripcion_id::text,
            created_at::text, due_at::text, assigned_to::text, snapshot_json::jsonb
       FROM billing.alerts
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return res.rows;
}

export async function patchAlert(alertId: string, payload: Record<string, unknown>) {
  await ensureBillingOpsTables();
  const status = payload.status ? requireString(payload.status, "status") : null;
  const assignedTo = payload.assigned_to ? requireUuid(payload.assigned_to, "assigned_to") : null;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (status) {
    values.push(status);
    updates.push(`status = $${values.length}`);
    if (status === "resolved") {
      updates.push("resolved_at = now()");
    }
  }

  if (assignedTo) {
    values.push(assignedTo);
    updates.push(`assigned_to = $${values.length}`);
  }

  if (updates.length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "No patch fields provided");
  }

  values.push(alertId);
  const res = await query(
    `UPDATE billing.alerts
        SET ${updates.join(", ")}
      WHERE id = $${values.length}
      RETURNING id, alert_type, severity, status, empresa_id::text, suscripcion_id::text, created_at::text, due_at::text, assigned_to::text, snapshot_json::jsonb`,
    values,
  );

  if ((res.rowCount ?? 0) === 0) throw new AppError(404, "NOT_FOUND", "Alert not found");
  return res.rows[0];
}
export async function runAlertsBatch(): Promise<{ generated: number; generated_at: string }> {
  await ensureBillingOpsTables();
  return runInTransaction(async (client) => {
    const now = new Date().toISOString();
    let generated = 0;

    const renewals = await client.query<{ empresa_id: string; suscripcion_id: string; periodo_actual_fin: string }>(
      `SELECT empresa_id::text, id::text AS suscripcion_id, periodo_actual_fin::text
         FROM billing.suscripciones
        WHERE estado = 'ACTIVA'::billing.estado_suscripcion
          AND periodo_actual_fin <= (CURRENT_DATE + INTERVAL '30 day')::date`,
    );

    for (const row of renewals.rows) {
      const inserted = await client.query(
        `INSERT INTO billing.alerts (alert_type, severity, empresa_id, suscripcion_id, status, due_at, snapshot_json)
         VALUES ('renewal_due', 'medium', $1, $2, 'open', $3::date, $4::jsonb)
         ON CONFLICT (alert_type, empresa_id, suscripcion_id, status)
         DO NOTHING`,
        [row.empresa_id, row.suscripcion_id, row.periodo_actual_fin, JSON.stringify(row)],
      );
      generated += inserted.rowCount ?? 0;
    }

    const expiredSubs = await client.query<{ empresa_id: string; suscripcion_id: string; periodo_actual_fin: string }>(
      `SELECT empresa_id::text, id::text AS suscripcion_id, periodo_actual_fin::text
         FROM billing.suscripciones
        WHERE estado = 'ACTIVA'::billing.estado_suscripcion
          AND periodo_actual_fin < CURRENT_DATE`,
    );

    for (const row of expiredSubs.rows) {
      const inserted = await client.query(
        `INSERT INTO billing.alerts (alert_type, severity, empresa_id, suscripcion_id, status, due_at, snapshot_json)
         VALUES ('subscription_overdue', 'high', $1, $2, 'open', now(), $3::jsonb)
         ON CONFLICT (alert_type, empresa_id, suscripcion_id, status)
         DO NOTHING`,
        [row.empresa_id, row.suscripcion_id, JSON.stringify(row)],
      );
      generated += inserted.rowCount ?? 0;
    }

    const unpaid = await client.query<{ empresa_id: string; factura_id: string; fecha_vencimiento: string | null; total: string }>(
      `SELECT empresa_id::text, id::text AS factura_id, fecha_vencimiento::text, total::text
         FROM billing.facturas
        WHERE estado = 'EMITIDA'::billing.estado_factura`,
    );

    for (const row of unpaid.rows) {
      const due = row.fecha_vencimiento ?? todayIso();
      const inserted = await client.query(
        `INSERT INTO billing.alerts (alert_type, severity, empresa_id, status, due_at, snapshot_json)
         VALUES ('invoice_unpaid', 'medium', $1, 'open', $2::date, $3::jsonb)
         ON CONFLICT (alert_type, empresa_id, suscripcion_id, status)
         DO NOTHING`,
        [row.empresa_id, due, JSON.stringify(row)],
      );
      generated += inserted.rowCount ?? 0;
    }

    await client.query(
      `INSERT INTO billing.event_log (empresa_id, event_type, payload_json, related_workflow, source_channel)
       VALUES (NULL, 'alerts_batch_run', $1::jsonb, 'billing_alerts_job', 'scheduler')`,
      [JSON.stringify({ generated, generated_at: now })],
    );

    return { generated, generated_at: now };
  });
}

export async function getOperationsDashboard(): Promise<OperationsDashboardResponse> {
  await ensureBillingOpsTables();
  const [kpiRenewals, kpiOverdue, kpiUnpaid, queue] = await Promise.all([
    query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM billing.suscripciones
        WHERE estado = 'ACTIVA'::billing.estado_suscripcion
          AND periodo_actual_fin <= (CURRENT_DATE + INTERVAL '30 day')::date`,
    ),
    query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM billing.suscripciones
        WHERE estado = 'ACTIVA'::billing.estado_suscripcion
          AND periodo_actual_fin < CURRENT_DATE`,
    ),
    query<{ n: string }>(
      `SELECT count(*)::text AS n FROM billing.facturas WHERE estado = 'EMITIDA'::billing.estado_factura`,
    ),
    query<BillingAlert>(
      `SELECT id, alert_type, severity, status, empresa_id::text, suscripcion_id::text, created_at::text, due_at::text,
              assigned_to::text, snapshot_json::jsonb
         FROM billing.alerts
        WHERE status IN ('open','in_progress')
        ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, due_at ASC NULLS LAST
        LIMIT 30`,
    ),
  ]);

  return {
    generated_at: new Date().toISOString(),
    kpis: {
      renewals_next_30_days: Number(kpiRenewals.rows[0]?.n ?? "0"),
      overdue_subscriptions: Number(kpiOverdue.rows[0]?.n ?? "0"),
      unpaid_invoices: Number(kpiUnpaid.rows[0]?.n ?? "0"),
    },
    queue: queue.rows,
  };
}
export async function getBillingLookups() {
  await ensureBillingOpsTables();
  const [companies, subscriptions, plans, users, products, entitlements] = await Promise.all([
    query<{ id: string; nombre: string }>("SELECT id::text, nombre FROM core.empresas ORDER BY updated_at DESC LIMIT 200"),
    query<{ id: string; empresa_nombre: string; plan_nombre: string }>(
      `SELECT s.id::text, e.nombre AS empresa_nombre, p.nombre AS plan_nombre
         FROM billing.suscripciones s
         JOIN core.empresas e ON e.id = s.empresa_id
         JOIN billing.planes p ON p.id = s.plan_id
        ORDER BY s.updated_at DESC
        LIMIT 200`,
    ),
    query<{ id: string; nombre: string; periodo: string; pricing_mode: string }>(
      "SELECT id::text, nombre, periodo::text, pricing_mode::text FROM billing.planes ORDER BY nombre",
    ),
    query<{ id: string; nombre: string; email: string }>("SELECT id::text, nombre, email FROM core.usuarios ORDER BY created_at DESC LIMIT 200"),
    query<{ id: string; codigo: string; nombre: string }>("SELECT id::text, codigo, nombre FROM billing.productos ORDER BY nombre"),
    query<{ id: string; codigo: string; nombre: string; tipo: string }>("SELECT id::text, codigo, nombre, tipo::text FROM billing.entitlements ORDER BY nombre"),
  ]);

  return {
    empresas: companies.rows.map((x) => ({ value: x.id, label: x.nombre })),
    suscripciones: subscriptions.rows.map((x) => ({ value: x.id, label: `${x.empresa_nombre} | ${x.plan_nombre}` })),
    planes: plans.rows.map((x) => ({ value: x.id, label: `${x.nombre} (${x.pricing_mode} | default ${x.periodo})` })),
    usuarios: users.rows.map((x) => ({ value: x.id, label: `${x.nombre} (${x.email})` })),
    productos: products.rows.map((x) => ({ value: x.id, label: `${x.nombre} (${x.codigo})` })),
    entitlements: entitlements.rows.map((x) => ({ value: x.id, label: `${x.nombre} (${x.codigo} | ${x.tipo})` })),
  };
}
