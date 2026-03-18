import { query } from '@/lib/db';
import {
  PlanPriceRecord,
  SubscriptionRecord,
  SubscriptionRepositoryPort,
} from '@/src/modules/suscripciones/domain/ports/subscription-repository-port';

function mapSubscriptionRecord(row: Record<string, unknown>): SubscriptionRecord {
  return {
    id: String(row.id),
    empresaId: String(row.empresa_id),
    planId: String(row.plan_id),
    precioPlanId: row.precio_plan_id ? String(row.precio_plan_id) : null,
    periodo: String(row.periodo ?? ''),
    billingCycle: String(row.billing_cycle ?? ''),
    fechaInicio: String(row.fecha_inicio ?? ''),
    periodoActualFin: row.periodo_actual_fin ? String(row.periodo_actual_fin) : null,
    estado: String(row.estado ?? ''),
    operationalStatus: row.operational_status ? String(row.operational_status) : null,
    graceUntil: row.grace_until ? String(row.grace_until) : null,
    canceledAt: row.canceled_at ? String(row.canceled_at) : null,
  };
}

export class PostgresSubscriptionRepository implements SubscriptionRepositoryPort {
  async findActiveSubscriptionByCompany(companyId: string, excludedSubscriptionId?: string): Promise<string | null> {
    const result = excludedSubscriptionId
      ? await query<{ id: string }>(
          "SELECT id::text FROM billing.suscripciones WHERE empresa_id = $1 AND estado = 'ACTIVA'::billing.estado_suscripcion AND id <> $2 LIMIT 1",
          [companyId, excludedSubscriptionId],
        )
      : await query<{ id: string }>(
          "SELECT id::text FROM billing.suscripciones WHERE empresa_id = $1 AND estado = 'ACTIVA'::billing.estado_suscripcion LIMIT 1",
          [companyId],
        );

    return result.rows[0]?.id ?? null;
  }

  async findSubscriptionById(subscriptionId: string): Promise<SubscriptionRecord | null> {
    const result = await query<Record<string, unknown>>(
      `SELECT
         id::text,
         empresa_id::text,
         plan_id::text,
         precio_plan_id::text,
         periodo::text,
         billing_cycle::text,
         fecha_inicio::text,
         periodo_actual_fin::text,
         estado::text,
         operational_status::text,
         grace_until::text,
         canceled_at::text
       FROM billing.suscripciones
       WHERE id = $1
       LIMIT 1`,
      [subscriptionId],
    );

    if (!result.rows[0]) {
      return null;
    }

    return mapSubscriptionRecord(result.rows[0]);
  }

  async findPlanPriceById(planPriceId: string): Promise<PlanPriceRecord | null> {
    const result = await query<{
      id: string;
      plan_id: string;
      periodo: string;
      activo: boolean;
      valido_desde: string | null;
      valido_hasta: string | null;
    }>(
      `SELECT
         id::text,
         plan_id::text,
         periodo::text,
         activo,
         valido_desde::text,
         valido_hasta::text
       FROM billing.precios_planes
       WHERE id = $1
       LIMIT 1`,
      [planPriceId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      planId: row.plan_id,
      periodo: row.periodo,
      activo: row.activo,
      validoDesde: row.valido_desde,
      validoHasta: row.valido_hasta,
    };
  }

  async findLatestValidPlanPrice(planId: string, billingCycle: string, operationDate: string): Promise<string | null> {
    const result = await query<{ id: string }>(
      `SELECT id::text
       FROM billing.precios_planes
       WHERE plan_id = $1
         AND periodo = $2::billing.periodo_precio
         AND activo = true
         AND (valido_desde IS NULL OR valido_desde <= $3::date)
         AND (valido_hasta IS NULL OR valido_hasta >= $3::date)
       ORDER BY valido_desde DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [planId, billingCycle, operationDate],
    );

    return result.rows[0]?.id ?? null;
  }

  async insertSubscriptionGraceEvent(subscriptionId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
    await query(
      `INSERT INTO billing.cobro_eventos (suscripcion_id, event_type, actor, payload_json)
       VALUES ($1, $2, 'api_v1_patch', $3::jsonb)`,
      [subscriptionId, eventType, JSON.stringify(payload)],
    );
  }

  async closeOpenHistoryWithReason(subscriptionId: string, reason: string, closeDate: string): Promise<number> {
    const result = await query(
      `UPDATE billing.suscripciones_plan_historial
          SET vigente_hasta = COALESCE(vigente_hasta, $3::date),
              motivo = $1,
              updated_at = now()
        WHERE suscripcion_id = $2
          AND vigente_hasta IS NULL`,
      [reason, subscriptionId, closeDate],
    );

    return result.rowCount ?? 0;
  }

  async upsertClosedHistoryFromSubscription(subscriptionId: string, reason: string, closeDate: string): Promise<void> {
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
      [reason, subscriptionId, closeDate],
    );
  }

  async updateLatestClosedHistoryEndDate(subscriptionId: string, endDate: string): Promise<void> {
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
      [subscriptionId, endDate],
    );
  }

  async updateOpenHistoryReason(subscriptionId: string, reason: string): Promise<void> {
    await query(
      `UPDATE billing.suscripciones_plan_historial
          SET motivo = $2,
              updated_at = now()
        WHERE suscripcion_id = $1
          AND vigente_hasta IS NULL`,
      [subscriptionId, reason],
    );
  }

  async syncPlanItems(subscriptionId: string, planId: string, periodStart: string, periodEnd: string): Promise<void> {
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
      [subscriptionId, periodStart, periodEnd, planId],
    );
  }
}