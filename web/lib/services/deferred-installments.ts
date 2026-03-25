import { PoolClient, QueryResultRow } from "pg";
import { AppError } from "@/lib/api/types";
import { query } from "@/lib/db";
import { requireDate, requireNumberLike, requireString, requireUuid } from "@/lib/api/validation";

const PERIOD_MONTHS: Record<string, number> = { MENSUAL: 1, TRIMESTRAL: 3, ANUAL: 12 };

export type DeferredAgreementHistoryRow = {
  agreement_id: string;
  suscripcion_id: string;
  contrato_id: string | null;
  estado: string;
  monto_total: string;
  cantidad_cuotas: number;
  frecuencia: string;
  fecha_primera_cuota: string;
  grace_days_snapshot: number;
  cuotas_pagadas: number;
  cuotas_vencidas: number;
  cuotas_pendientes: number;
  saldo_pendiente: string;
  created_at: string;
};

export type DeferredInstallmentHistoryRow = {
  cuota_id: string;
  acuerdo_id: string;
  numero_cuota: number;
  fecha_vencimiento: string;
  monto: string;
  estado: string;
  fecha_pago: string | null;
  factura_id: string | null;
  metodo_pago: string | null;
  referencia_pago: string | null;
};

export type DeferredCustomerSnapshot = {
  agreement_status: string | null;
  next_installment_due: string | null;
  overdue_installments: number;
  overdue_installment_amount: number;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

async function one<T extends QueryResultRow>(client: PoolClient, sql: string, values: unknown[] = []): Promise<T | null> {
  const res = await client.query<T>(sql, values);
  return res.rows[0] ?? null;
}

async function ensureCollectionPolicySchema(runner: { (sql: string, values?: unknown[]): Promise<unknown> }) {
  await runner(`
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
}

export async function ensureDeferredInstallmentSchema(client?: PoolClient) {
  const runner = client?.query.bind(client) ?? query;

  await ensureCollectionPolicySchema(runner);

  await runner(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'estado_acuerdo_pago_diferido'
          AND n.nspname = 'billing'
      ) THEN
        CREATE TYPE billing.estado_acuerdo_pago_diferido AS ENUM ('PENDIENTE_PRIMER_PAGO', 'ACTIVO', 'COMPLETADO', 'CANCELADO', 'INCUMPLIDO');
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'estado_cuota_pago_diferido'
          AND n.nspname = 'billing'
      ) THEN
        CREATE TYPE billing.estado_cuota_pago_diferido AS ENUM ('PROGRAMADA', 'VENCIDA', 'PAGADA', 'ANULADA');
      END IF;
    END $$;
  `);

  await runner(`
    CREATE TABLE IF NOT EXISTS billing.acuerdos_pago_diferido (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      empresa_id UUID NOT NULL REFERENCES core.empresas(id) ON DELETE CASCADE,
      suscripcion_id UUID NOT NULL REFERENCES billing.suscripciones(id) ON DELETE CASCADE,
      contrato_id UUID REFERENCES billing.contratos(id) ON DELETE SET NULL,
      estado billing.estado_acuerdo_pago_diferido NOT NULL DEFAULT 'PENDIENTE_PRIMER_PAGO',
      monto_total NUMERIC(18,2) NOT NULL CHECK (monto_total > 0),
      cantidad_cuotas INT NOT NULL CHECK (cantidad_cuotas > 0),
      frecuencia billing.periodo_precio NOT NULL,
      fecha_primera_cuota DATE NOT NULL,
      grace_days_snapshot INT NOT NULL DEFAULT 0 CHECK (grace_days_snapshot >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await runner("CREATE INDEX IF NOT EXISTS idx_acuerdos_pago_diferido_suscripcion ON billing.acuerdos_pago_diferido (suscripcion_id, created_at DESC)");
  await runner(
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_acuerdos_pago_diferido_open ON billing.acuerdos_pago_diferido (suscripcion_id) WHERE estado IN ('PENDIENTE_PRIMER_PAGO'::billing.estado_acuerdo_pago_diferido, 'ACTIVO'::billing.estado_acuerdo_pago_diferido, 'INCUMPLIDO'::billing.estado_acuerdo_pago_diferido)",
  );

  await runner(`
    CREATE TABLE IF NOT EXISTS billing.cuotas_pago_diferido (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      acuerdo_id UUID NOT NULL REFERENCES billing.acuerdos_pago_diferido(id) ON DELETE CASCADE,
      numero_cuota INT NOT NULL CHECK (numero_cuota > 0),
      fecha_vencimiento DATE NOT NULL,
      monto NUMERIC(18,2) NOT NULL CHECK (monto > 0),
      estado billing.estado_cuota_pago_diferido NOT NULL DEFAULT 'PROGRAMADA',
      fecha_pago DATE,
      factura_id UUID REFERENCES billing.facturas(id) ON DELETE SET NULL,
      metodo_pago TEXT,
      referencia_pago TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (acuerdo_id, numero_cuota)
    )
  `);
  await runner("CREATE INDEX IF NOT EXISTS idx_cuotas_pago_diferido_estado_vencimiento ON billing.cuotas_pago_diferido (estado, fecha_vencimiento)");
  await runner("CREATE INDEX IF NOT EXISTS idx_cuotas_pago_diferido_acuerdo ON billing.cuotas_pago_diferido (acuerdo_id, numero_cuota)");

  await runner("ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS cuota_diferida_id UUID");
  await runner(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'facturas_cuota_diferida_fk'
      ) THEN
        ALTER TABLE billing.facturas
        ADD CONSTRAINT facturas_cuota_diferida_fk
        FOREIGN KEY (cuota_diferida_id)
        REFERENCES billing.cuotas_pago_diferido(id)
        ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  await runner("CREATE UNIQUE INDEX IF NOT EXISTS uq_facturas_cuota_diferida ON billing.facturas (cuota_diferida_id) WHERE cuota_diferida_id IS NOT NULL");
}

function validatePaymentMethod(raw: unknown): "MANUAL" | "PASARELA" {
  const value = requireString(raw ?? "MANUAL", "metodo_pago");
  if (value !== "MANUAL" && value !== "PASARELA") {
    throw new AppError(400, "VALIDATION_ERROR", "metodo_pago must be MANUAL or PASARELA");
  }
  return value;
}

function buildSchedule(totalInput: unknown, countInput: unknown, firstDateInput: unknown, frequencyInput: unknown) {
  const total = Number(requireNumberLike(totalInput, "monto_total"));
  const count = Math.trunc(Number(requireNumberLike(countInput, "cantidad_cuotas")));
  const firstDate = requireDate(firstDateInput, "fecha_primera_cuota");
  const frequency = requireString(frequencyInput, "frecuencia");

  if (!Number.isFinite(total) || total <= 0) {
    throw new AppError(400, "VALIDATION_ERROR", "monto_total must be greater than 0");
  }
  if (!Number.isFinite(count) || count <= 0) {
    throw new AppError(400, "VALIDATION_ERROR", "cantidad_cuotas must be greater than 0");
  }
  if (!(frequency in PERIOD_MONTHS)) {
    throw new AppError(400, "VALIDATION_ERROR", "frecuencia must be MENSUAL, TRIMESTRAL or ANUAL");
  }

  const totalCents = Math.round(total * 100);
  const baseCents = Math.floor(totalCents / count);
  const lastCents = totalCents - baseCents * (count - 1);
  const rows = Array.from({ length: count }, (_, index) => ({
    numero_cuota: index + 1,
    fecha_vencimiento: addMonths(firstDate, (PERIOD_MONTHS[frequency] ?? 1) * index),
    monto: round2((index === count - 1 ? lastCents : baseCents) / 100),
  }));

  return {
    total: round2(total),
    count,
    firstDate,
    frequency,
    rows,
  };
}

async function resolveCollectionPolicy(client: PoolClient, empresaId: string, planId: string) {
  await ensureCollectionPolicySchema(client.query.bind(client));
  const res = await client.query<{ grace_days: number; auto_block: boolean }>(
    `SELECT grace_days, auto_block
       FROM billing.politicas_cobro
      WHERE activo = true
        AND (
          (scope = 'EMPRESA' AND empresa_id = $1)
          OR (scope = 'PLAN' AND plan_id = $2)
          OR (scope = 'GLOBAL')
        )
      ORDER BY CASE scope WHEN 'EMPRESA' THEN 0 WHEN 'PLAN' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 1`,
    [empresaId, planId],
  );
  return res.rows[0] ?? { grace_days: 0, auto_block: true };
}

async function resolveDeferredAlert(client: PoolClient, empresaId: string, suscripcionId: string) {
  const stillOverdue = await one<{ yes: number }>(
    client,
    `SELECT 1 AS yes
       FROM billing.cuotas_pago_diferido q
       JOIN billing.acuerdos_pago_diferido a ON a.id = q.acuerdo_id
      WHERE a.empresa_id = $1
        AND a.suscripcion_id = $2
        AND q.estado = 'VENCIDA'::billing.estado_cuota_pago_diferido
      LIMIT 1`,
    [empresaId, suscripcionId],
  );
  if (stillOverdue) return;

  await client.query(
    `UPDATE billing.alerts
        SET status = 'resolved',
            resolved_at = now()
      WHERE alert_type = 'deferred_installment_overdue'
        AND empresa_id = $1
        AND suscripcion_id = $2
        AND status <> 'resolved'`,
    [empresaId, suscripcionId],
  );
}

async function upsertDeferredAlert(client: PoolClient, params: {
  empresaId: string;
  suscripcionId: string;
  dueAt: string;
  payload: Record<string, unknown>;
}) {
  await client.query(
    `UPDATE billing.alerts
        SET due_at = $3::date,
            snapshot_json = $4::jsonb,
            assigned_to = NULL
      WHERE alert_type = 'deferred_installment_overdue'
        AND empresa_id = $1
        AND suscripcion_id = $2
        AND status IN ('open', 'in_progress')`,
    [params.empresaId, params.suscripcionId, params.dueAt, JSON.stringify(params.payload)],
  );

  await client.query(
    `INSERT INTO billing.alerts (alert_type, severity, empresa_id, suscripcion_id, status, due_at, snapshot_json)
     SELECT 'deferred_installment_overdue', 'high', $1, $2, 'open', $3::date, $4::jsonb
      WHERE NOT EXISTS (
        SELECT 1
          FROM billing.alerts
         WHERE alert_type = 'deferred_installment_overdue'
           AND empresa_id = $1
           AND suscripcion_id = $2
           AND status IN ('open', 'in_progress')
      )`,
    [params.empresaId, params.suscripcionId, params.dueAt, JSON.stringify(params.payload)],
  );
}

async function refreshAgreementState(client: PoolClient, agreementId: string) {
  const stats = await one<{
    total_rows: string;
    paid_rows: string;
    overdue_rows: string;
  }>(
    client,
    `SELECT
        count(*)::text AS total_rows,
        count(*) FILTER (WHERE estado = 'PAGADA'::billing.estado_cuota_pago_diferido)::text AS paid_rows,
        count(*) FILTER (WHERE estado = 'VENCIDA'::billing.estado_cuota_pago_diferido)::text AS overdue_rows
       FROM billing.cuotas_pago_diferido
      WHERE acuerdo_id = $1`,
    [agreementId],
  );

  if (!stats) return;

  const totalRows = Number(stats.total_rows ?? "0");
  const paidRows = Number(stats.paid_rows ?? "0");
  const overdueRows = Number(stats.overdue_rows ?? "0");

  let state = "PENDIENTE_PRIMER_PAGO";
  if (paidRows === totalRows && totalRows > 0) {
    state = "COMPLETADO";
  } else if (paidRows > 0 && overdueRows === 0) {
    state = "ACTIVO";
  } else if (paidRows > 0 && overdueRows > 0) {
    state = "INCUMPLIDO";
  }

  await client.query(
    `UPDATE billing.acuerdos_pago_diferido
        SET estado = $2::billing.estado_acuerdo_pago_diferido,
            updated_at = now()
      WHERE id = $1`,
    [agreementId, state],
  );
}

async function logDeferredEvent(client: PoolClient, params: {
  empresaId: string;
  suscripcionId: string;
  eventType: string;
  payload: Record<string, unknown>;
  facturaId?: string | null;
}) {
  await client.query(
    `INSERT INTO billing.event_log
      (empresa_id, suscripcion_id, event_type, payload_json, related_invoice_id, related_workflow, source_channel)
     VALUES ($1, $2, $3, $4::jsonb, $5, 'deferred_installments', 'billing-ui')`,
    [params.empresaId, params.suscripcionId, params.eventType, JSON.stringify(params.payload), params.facturaId ?? null],
  );
}

async function logCollectionEvent(client: PoolClient, params: {
  suscripcionId: string;
  facturaId?: string | null;
  eventType: "GRACE_GRANTED" | "GRACE_EXTENDED" | "GRACE_EXPIRED" | "BLOCKED" | "UNBLOCKED";
  payload: Record<string, unknown>;
}) {
  await client.query(
    `INSERT INTO billing.cobro_eventos (suscripcion_id, factura_id, event_type, actor, payload_json)
     VALUES ($1, $2, $3, 'deferred_installments', $4::jsonb)`,
    [params.suscripcionId, params.facturaId ?? null, params.eventType, JSON.stringify(params.payload)],
  );
}

export async function syncDeferredInstallmentState(client: PoolClient) {
  await ensureDeferredInstallmentSchema(client);

  const overdue = await client.query<{
    cuota_id: string;
    acuerdo_id: string;
    numero_cuota: number;
    fecha_vencimiento: string;
    empresa_id: string;
    suscripcion_id: string;
    plan_id: string;
    acuerdo_estado: string;
  }>(
    `SELECT
        q.id::text AS cuota_id,
        q.acuerdo_id::text AS acuerdo_id,
        q.numero_cuota,
        q.fecha_vencimiento::text,
        a.empresa_id::text AS empresa_id,
        a.suscripcion_id::text AS suscripcion_id,
        s.plan_id::text AS plan_id,
        a.estado::text AS acuerdo_estado
       FROM billing.cuotas_pago_diferido q
       JOIN billing.acuerdos_pago_diferido a ON a.id = q.acuerdo_id
       JOIN billing.suscripciones s ON s.id = a.suscripcion_id
      WHERE q.estado = 'PROGRAMADA'::billing.estado_cuota_pago_diferido
        AND q.fecha_vencimiento < CURRENT_DATE`,
  );

  for (const row of overdue.rows) {
    const policy = await resolveCollectionPolicy(client, row.empresa_id, row.plan_id);
    const graceUntil = addDays(row.fecha_vencimiento, policy.grace_days);

    await client.query(
      `UPDATE billing.cuotas_pago_diferido
          SET estado = 'VENCIDA'::billing.estado_cuota_pago_diferido,
              updated_at = now()
        WHERE id = $1`,
      [row.cuota_id],
    );

    await refreshAgreementState(client, row.acuerdo_id);

    if (row.acuerdo_estado === "ACTIVO") {
      await client.query(
        `UPDATE billing.suscripciones
            SET operational_status = 'EN_PRORROGA'::billing.estado_operativo_suscripcion,
                grace_days_granted = $2,
                grace_until = $3::date,
                updated_at = now()
          WHERE id = $1
            AND operational_status <> 'BLOQUEADA'::billing.estado_operativo_suscripcion`,
        [row.suscripcion_id, policy.grace_days, graceUntil],
      );
      await logCollectionEvent(client, {
        suscripcionId: row.suscripcion_id,
        eventType: "GRACE_GRANTED",
        payload: { cuota_id: row.cuota_id, numero_cuota: row.numero_cuota, grace_until: graceUntil, grace_days: policy.grace_days },
      });
    }

    await upsertDeferredAlert(client, {
      empresaId: row.empresa_id,
      suscripcionId: row.suscripcion_id,
      dueAt: row.fecha_vencimiento,
      payload: {
        cuota_id: row.cuota_id,
        acuerdo_id: row.acuerdo_id,
        numero_cuota: row.numero_cuota,
        fecha_vencimiento: row.fecha_vencimiento,
        grace_until: graceUntil,
        auto_block: policy.auto_block,
      },
    });
    await logDeferredEvent(client, {
      empresaId: row.empresa_id,
      suscripcionId: row.suscripcion_id,
      eventType: "deferred_installment_overdue",
      payload: { cuota_id: row.cuota_id, acuerdo_id: row.acuerdo_id, numero_cuota: row.numero_cuota, fecha_vencimiento: row.fecha_vencimiento, grace_until: graceUntil },
    });
  }

  const blockable = await client.query<{
    acuerdo_id: string;
    empresa_id: string;
    suscripcion_id: string;
    plan_id: string;
    cuota_id: string;
    numero_cuota: number;
    grace_until: string | null;
  }>(
    `SELECT DISTINCT ON (a.id)
        a.id::text AS acuerdo_id,
        a.empresa_id::text AS empresa_id,
        a.suscripcion_id::text AS suscripcion_id,
        s.plan_id::text AS plan_id,
        q.id::text AS cuota_id,
        q.numero_cuota,
        s.grace_until::text AS grace_until
       FROM billing.acuerdos_pago_diferido a
       JOIN billing.cuotas_pago_diferido q ON q.acuerdo_id = a.id
       JOIN billing.suscripciones s ON s.id = a.suscripcion_id
      WHERE q.estado = 'VENCIDA'::billing.estado_cuota_pago_diferido
        AND a.estado IN ('ACTIVO'::billing.estado_acuerdo_pago_diferido, 'INCUMPLIDO'::billing.estado_acuerdo_pago_diferido)
      ORDER BY a.id, q.fecha_vencimiento ASC`,
  );

  for (const row of blockable.rows) {
    const policy = await resolveCollectionPolicy(client, row.empresa_id, row.plan_id);
    if (!policy.auto_block) continue;
    if (!row.grace_until || row.grace_until >= todayIso()) continue;

    const changed = await client.query(
      `UPDATE billing.suscripciones
          SET operational_status = 'BLOQUEADA'::billing.estado_operativo_suscripcion,
              updated_at = now()
        WHERE id = $1
          AND operational_status <> 'BLOQUEADA'::billing.estado_operativo_suscripcion`,
      [row.suscripcion_id],
    );
    if ((changed.rowCount ?? 0) === 0) continue;

    await client.query(
      `UPDATE billing.acuerdos_pago_diferido
          SET estado = 'INCUMPLIDO'::billing.estado_acuerdo_pago_diferido,
              updated_at = now()
        WHERE id = $1`,
      [row.acuerdo_id],
    );
    await logCollectionEvent(client, {
      suscripcionId: row.suscripcion_id,
      eventType: "BLOCKED",
      payload: { cuota_id: row.cuota_id, numero_cuota: row.numero_cuota, grace_until: row.grace_until },
    });
    await logDeferredEvent(client, {
      empresaId: row.empresa_id,
      suscripcionId: row.suscripcion_id,
      eventType: "deferred_installment_subscription_blocked",
      payload: { acuerdo_id: row.acuerdo_id, cuota_id: row.cuota_id, numero_cuota: row.numero_cuota, grace_until: row.grace_until },
    });
  }
}

export async function createDeferredInstallmentPlan(client: PoolClient, payload: Record<string, unknown>) {
  await ensureDeferredInstallmentSchema(client);

  const subscriptionId = requireUuid(payload.suscripcion_id ?? payload.subscription_id, "suscripcion_id");
  const contractId = payload.contrato_id ? requireUuid(payload.contrato_id, "contrato_id") : null;
  const schedule = buildSchedule(payload.monto_total, payload.cantidad_cuotas, payload.fecha_primera_cuota, payload.frecuencia);

  const subscription = await one<{ empresa_id: string; plan_id: string }>(
    client,
    "SELECT empresa_id::text, plan_id::text FROM billing.suscripciones WHERE id = $1 LIMIT 1",
    [subscriptionId],
  );
  if (!subscription) throw new AppError(404, "NOT_FOUND", "Subscription not found");

  const openAgreement = await one<{ id: string }>(
    client,
    `SELECT id::text
       FROM billing.acuerdos_pago_diferido
      WHERE suscripcion_id = $1
        AND estado IN ('PENDIENTE_PRIMER_PAGO'::billing.estado_acuerdo_pago_diferido, 'ACTIVO'::billing.estado_acuerdo_pago_diferido, 'INCUMPLIDO'::billing.estado_acuerdo_pago_diferido)
      LIMIT 1`,
    [subscriptionId],
  );
  if (openAgreement) {
    throw new AppError(409, "CONFLICT", "Subscription already has an open deferred installment agreement");
  }

  const policy = await resolveCollectionPolicy(client, subscription.empresa_id, subscription.plan_id);
  const agreement = await one<{ id: string }>(
    client,
    `INSERT INTO billing.acuerdos_pago_diferido
      (empresa_id, suscripcion_id, contrato_id, estado, monto_total, cantidad_cuotas, frecuencia, fecha_primera_cuota, grace_days_snapshot)
     VALUES ($1, $2, $3, 'PENDIENTE_PRIMER_PAGO', $4::numeric, $5, $6::billing.periodo_precio, $7::date, $8)
     RETURNING id`,
    [subscription.empresa_id, subscriptionId, contractId, schedule.total, schedule.count, schedule.frequency, schedule.firstDate, policy.grace_days],
  );
  if (!agreement) throw new AppError(500, "INTERNAL_ERROR", "Failed to create deferred agreement");

  for (const row of schedule.rows) {
    await client.query(
      `INSERT INTO billing.cuotas_pago_diferido
        (acuerdo_id, numero_cuota, fecha_vencimiento, monto, estado)
       VALUES ($1, $2, $3::date, $4::numeric, 'PROGRAMADA')`,
      [agreement.id, row.numero_cuota, row.fecha_vencimiento, row.monto],
    );
  }

  await client.query(
    `UPDATE billing.suscripciones
        SET estado = 'PAUSADA'::billing.estado_suscripcion,
            operational_status = 'BLOQUEADA'::billing.estado_operativo_suscripcion,
            grace_days_granted = $2,
            grace_until = NULL,
            updated_at = now()
      WHERE id = $1`,
    [subscriptionId, policy.grace_days],
  );

  await logDeferredEvent(client, {
    empresaId: subscription.empresa_id,
    suscripcionId: subscriptionId,
    eventType: "deferred_agreement_created",
    payload: {
      acuerdo_id: agreement.id,
      monto_total: schedule.total,
      cantidad_cuotas: schedule.count,
      frecuencia: schedule.frequency,
      fecha_primera_cuota: schedule.firstDate,
      cuotas: schedule.rows,
    },
  });

  return {
    agreement_id: agreement.id,
    subscription_id: subscriptionId,
    empresa_id: subscription.empresa_id,
    monto_total: schedule.total,
    cantidad_cuotas: schedule.count,
    frecuencia: schedule.frequency,
    fecha_primera_cuota: schedule.firstDate,
    cuotas: schedule.rows,
  };
}

export async function payDeferredInstallment(client: PoolClient, payload: Record<string, unknown>) {
  await ensureDeferredInstallmentSchema(client);
  await syncDeferredInstallmentState(client);

  const installmentId = requireUuid(payload.cuota_id ?? payload.installment_id, "cuota_id");
  const paymentDate = requireDate(payload.fecha_pago ?? payload.payment_date ?? todayIso(), "fecha_pago");
  const paymentMethod = validatePaymentMethod(payload.metodo_pago);
  const reference = payload.referencia_pago ? requireString(payload.referencia_pago, "referencia_pago") : null;

  const row = await one<{
    cuota_id: string;
    acuerdo_id: string;
    numero_cuota: number;
    fecha_vencimiento: string;
    monto: string;
    estado: string;
    factura_id: string | null;
    cantidad_cuotas: number;
    acuerdo_estado: string;
    empresa_id: string;
    suscripcion_id: string;
  }>(
    client,
    `SELECT
        q.id::text AS cuota_id,
        q.acuerdo_id::text AS acuerdo_id,
        q.numero_cuota,
        q.fecha_vencimiento::text AS fecha_vencimiento,
        q.monto::text AS monto,
        q.estado::text AS estado,
        q.factura_id::text AS factura_id,
        a.cantidad_cuotas,
        a.estado::text AS acuerdo_estado,
        a.empresa_id::text AS empresa_id,
        a.suscripcion_id::text AS suscripcion_id
       FROM billing.cuotas_pago_diferido q
       JOIN billing.acuerdos_pago_diferido a ON a.id = q.acuerdo_id
      WHERE q.id = $1
      LIMIT 1`,
    [installmentId],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "Deferred installment not found");
  if (row.estado === "PAGADA") throw new AppError(409, "CONFLICT", "Deferred installment already paid");
  if (row.estado === "ANULADA") throw new AppError(400, "BUSINESS_RULE_VIOLATION", "Deferred installment is cancelled");
  if (row.factura_id) throw new AppError(409, "CONFLICT", "Deferred installment already has an invoice");
  if (row.estado !== "PROGRAMADA" && row.estado !== "VENCIDA") {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "Deferred installment cannot be paid from its current state");
  }

  const amount = Number(row.monto);
  const invoice = await one<{ id: string }>(
    client,
    `INSERT INTO billing.facturas
      (empresa_id, suscripcion_id, cuota_diferida_id, fecha_emision, fecha_vencimiento, subtotal, descuento_monto, total, estado, metodo_pago, referencia_externa, notas)
     VALUES ($1, $2, $3, $4::date, $5::date, $6::numeric, 0, $6::numeric, 'PAGADA', '${paymentMethod}', $7, $8)
     RETURNING id`,
    [
      row.empresa_id,
      row.suscripcion_id,
      row.cuota_id,
      paymentDate,
      row.fecha_vencimiento,
      amount,
      reference,
      `Pago cuota diferida ${row.numero_cuota}/${row.cantidad_cuotas}`,
    ],
  );
  if (!invoice) throw new AppError(500, "INTERNAL_ERROR", "Failed to create invoice for deferred installment");

  await client.query(
    `INSERT INTO billing.items_factura
      (factura_id, descripcion, cantidad, precio_unitario, total, periodo_desde, periodo_hasta)
     VALUES ($1, $2, 1, $3::numeric, $3::numeric, $4::date, $4::date)`,
    [invoice.id, `Cuota diferida ${row.numero_cuota}/${row.cantidad_cuotas}`, amount, row.fecha_vencimiento],
  );

  await client.query(
    `UPDATE billing.cuotas_pago_diferido
        SET estado = 'PAGADA'::billing.estado_cuota_pago_diferido,
            fecha_pago = $2::date,
            factura_id = $3,
            metodo_pago = $4,
            referencia_pago = $5,
            updated_at = now()
      WHERE id = $1`,
    [row.cuota_id, paymentDate, invoice.id, paymentMethod, reference],
  );

  await refreshAgreementState(client, row.acuerdo_id);

  const remainingOverdue = await one<{ yes: number }>(
    client,
    `SELECT 1 AS yes
       FROM billing.cuotas_pago_diferido q
       JOIN billing.acuerdos_pago_diferido a ON a.id = q.acuerdo_id
      WHERE a.suscripcion_id = $1
        AND q.estado = 'VENCIDA'::billing.estado_cuota_pago_diferido
      LIMIT 1`,
    [row.suscripcion_id],
  );

  const agreementState = await one<{ estado: string }>(
    client,
    "SELECT estado::text AS estado FROM billing.acuerdos_pago_diferido WHERE id = $1",
    [row.acuerdo_id],
  );
  const allPaid = agreementState?.estado === "COMPLETADO";

  if (row.numero_cuota === 1 && row.acuerdo_estado === "PENDIENTE_PRIMER_PAGO") {
    await client.query(
      `UPDATE billing.suscripciones
          SET estado = 'ACTIVA'::billing.estado_suscripcion,
              operational_status = CASE
                WHEN $2::boolean THEN operational_status
                ELSE 'EN_SERVICIO'::billing.estado_operativo_suscripcion
              END,
              grace_until = CASE WHEN $2::boolean THEN grace_until ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [row.suscripcion_id, Boolean(remainingOverdue)],
    );
  } else if (!remainingOverdue) {
    await client.query(
      `UPDATE billing.suscripciones
          SET operational_status = 'EN_SERVICIO'::billing.estado_operativo_suscripcion,
              grace_until = NULL,
              updated_at = now()
        WHERE id = $1
          AND estado = 'ACTIVA'::billing.estado_suscripcion`,
      [row.suscripcion_id],
    );
    await logCollectionEvent(client, {
      suscripcionId: row.suscripcion_id,
      facturaId: invoice.id,
      eventType: "UNBLOCKED",
      payload: { cuota_id: row.cuota_id, numero_cuota: row.numero_cuota },
    });
  }

  await resolveDeferredAlert(client, row.empresa_id, row.suscripcion_id);
  await logDeferredEvent(client, {
    empresaId: row.empresa_id,
    suscripcionId: row.suscripcion_id,
    facturaId: invoice.id,
    eventType: "deferred_installment_paid",
    payload: {
      acuerdo_id: row.acuerdo_id,
      cuota_id: row.cuota_id,
      numero_cuota: row.numero_cuota,
      fecha_pago: paymentDate,
      metodo_pago: paymentMethod,
      referencia_pago: reference,
      factura_id: invoice.id,
      agreement_completed: allPaid,
    },
  });

  return {
    agreement_id: row.acuerdo_id,
    cuota_id: row.cuota_id,
    factura_id: invoice.id,
    suscripcion_id: row.suscripcion_id,
    empresa_id: row.empresa_id,
    monto: amount,
    fecha_pago: paymentDate,
    metodo_pago: paymentMethod,
    referencia_pago: reference,
    agreement_completed: allPaid,
  };
}

export async function listSubscriptionDeferredInstallments(subscriptionId: string) {
  await ensureDeferredInstallmentSchema();
  const [agreementsRes, installmentsRes] = await Promise.all([
    query<DeferredAgreementHistoryRow>(
      `SELECT
          a.id::text AS agreement_id,
          a.suscripcion_id::text AS suscripcion_id,
          a.contrato_id::text AS contrato_id,
          a.estado::text AS estado,
          a.monto_total::text AS monto_total,
          a.cantidad_cuotas,
          a.frecuencia::text AS frecuencia,
          a.fecha_primera_cuota::text AS fecha_primera_cuota,
          a.grace_days_snapshot,
          count(*) FILTER (WHERE q.estado = 'PAGADA'::billing.estado_cuota_pago_diferido)::int AS cuotas_pagadas,
          count(*) FILTER (WHERE q.estado = 'VENCIDA'::billing.estado_cuota_pago_diferido)::int AS cuotas_vencidas,
          count(*) FILTER (WHERE q.estado IN ('PROGRAMADA'::billing.estado_cuota_pago_diferido, 'VENCIDA'::billing.estado_cuota_pago_diferido))::int AS cuotas_pendientes,
          COALESCE(sum(q.monto) FILTER (WHERE q.estado IN ('PROGRAMADA'::billing.estado_cuota_pago_diferido, 'VENCIDA'::billing.estado_cuota_pago_diferido)), 0)::text AS saldo_pendiente,
          a.created_at::text AS created_at
       FROM billing.acuerdos_pago_diferido a
       LEFT JOIN billing.cuotas_pago_diferido q ON q.acuerdo_id = a.id
      WHERE a.suscripcion_id = $1
      GROUP BY a.id
      ORDER BY a.created_at DESC`,
      [subscriptionId],
    ),
    query<DeferredInstallmentHistoryRow>(
      `SELECT
          q.id::text AS cuota_id,
          q.acuerdo_id::text AS acuerdo_id,
          q.numero_cuota,
          q.fecha_vencimiento::text AS fecha_vencimiento,
          q.monto::text AS monto,
          q.estado::text AS estado,
          q.fecha_pago::text AS fecha_pago,
          q.factura_id::text AS factura_id,
          q.metodo_pago,
          q.referencia_pago
       FROM billing.cuotas_pago_diferido q
       JOIN billing.acuerdos_pago_diferido a ON a.id = q.acuerdo_id
      WHERE a.suscripcion_id = $1
      ORDER BY q.fecha_vencimiento ASC, q.numero_cuota ASC`,
      [subscriptionId],
    ),
  ]);

  return {
    agreements: agreementsRes.rows,
    installments: installmentsRes.rows,
  };
}

export async function getDeferredCustomerSnapshot(client: PoolClient, customerId: string): Promise<DeferredCustomerSnapshot | null> {
  await ensureDeferredInstallmentSchema(client);
  const row = await one<{
    agreement_status: string | null;
    next_installment_due: string | null;
    overdue_installments: string;
    overdue_installment_amount: string;
  }>(
    client,
    `SELECT
        max(a.estado::text) AS agreement_status,
        min(q.fecha_vencimiento)::text FILTER (WHERE q.estado IN ('PROGRAMADA'::billing.estado_cuota_pago_diferido, 'VENCIDA'::billing.estado_cuota_pago_diferido)) AS next_installment_due,
        count(*) FILTER (WHERE q.estado = 'VENCIDA'::billing.estado_cuota_pago_diferido)::text AS overdue_installments,
        COALESCE(sum(q.monto) FILTER (WHERE q.estado = 'VENCIDA'::billing.estado_cuota_pago_diferido), 0)::text AS overdue_installment_amount
       FROM billing.acuerdos_pago_diferido a
       JOIN billing.cuotas_pago_diferido q ON q.acuerdo_id = a.id
      WHERE a.empresa_id = $1
        AND a.estado <> 'CANCELADO'::billing.estado_acuerdo_pago_diferido`,
    [customerId],
  );

  if (!row || row.agreement_status === null) return null;
  return {
    agreement_status: row.agreement_status,
    next_installment_due: row.next_installment_due,
    overdue_installments: Number(row.overdue_installments ?? "0"),
    overdue_installment_amount: Number(row.overdue_installment_amount ?? "0"),
  };
}

export function previewDeferredInstallmentPlan(payload: Record<string, unknown>) {
  const schedule = buildSchedule(payload.monto_total, payload.cantidad_cuotas, payload.fecha_primera_cuota, payload.frecuencia);
  return {
    currency: "COP",
    summary: "Creacion de acuerdo de pagos diferidos",
    lines: schedule.rows.map((row) => ({
      label: `Cuota ${row.numero_cuota}/${schedule.count}`,
      amount: row.monto,
      billing_date: row.fecha_vencimiento,
      effective_start: null,
      effective_end: null,
      notes: row.numero_cuota === 1 ? "La suscripcion se activara al registrar el pago de esta cuota." : undefined,
    })),
    totals: {
      subtotal: schedule.total,
      discount: 0,
      total: schedule.total,
    },
    warnings: ["La suscripcion quedara pausada y bloqueada hasta el pago de la primera cuota."],
  };
}

export async function previewDeferredInstallmentPayment(client: PoolClient, payload: Record<string, unknown>) {
  await ensureDeferredInstallmentSchema(client);
  const installmentId = requireUuid(payload.cuota_id ?? payload.installment_id, "cuota_id");
  const row = await one<{
    numero_cuota: number;
    monto: string;
    fecha_vencimiento: string;
    cantidad_cuotas: number;
    estado: string;
  }>(
    client,
    `SELECT
        q.numero_cuota,
        q.monto::text AS monto,
        q.fecha_vencimiento::text AS fecha_vencimiento,
        a.cantidad_cuotas,
        q.estado::text AS estado
       FROM billing.cuotas_pago_diferido q
       JOIN billing.acuerdos_pago_diferido a ON a.id = q.acuerdo_id
      WHERE q.id = $1`,
    [installmentId],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "Deferred installment not found");
  if (row.estado === "PAGADA") throw new AppError(409, "CONFLICT", "Deferred installment already paid");

  return {
    currency: "COP",
    summary: "Pago de cuota diferida",
    lines: [
      {
        label: `Cuota ${row.numero_cuota}/${row.cantidad_cuotas}`,
        amount: Number(row.monto),
        billing_date: row.fecha_vencimiento,
        effective_start: null,
        effective_end: null,
      },
    ],
    totals: {
      subtotal: Number(row.monto),
      discount: 0,
      total: Number(row.monto),
    },
    warnings: ["La factura se emitira en estado PAGADA en el momento del registro del pago."],
  };
}
