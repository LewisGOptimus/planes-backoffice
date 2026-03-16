import { PoolClient } from "pg";

type SyncParams = {
  suscripcionId: string;
  planId: string;
  effectiveFrom: string;
};

type EntitlementPlanRow = {
  entitlement_id: string;
  valor_entero: number | null;
  valor_booleano: boolean | null;
};

type ActiveEntitlementRow = {
  entitlement_id: string;
  origen: string;
};

export async function syncPlanEntitlementsToSubscription(client: PoolClient, params: SyncParams) {
  const { suscripcionId, planId, effectiveFrom } = params;

  const [planEntitlements, activeRows] = await Promise.all([
    client.query<EntitlementPlanRow>(
      `SELECT entitlement_id::text, valor_entero, valor_booleano
       FROM billing.entitlements_plan
       WHERE plan_id = $1`,
      [planId],
    ),
    client.query<ActiveEntitlementRow>(
      `SELECT entitlement_id::text, origen::text
       FROM billing.entitlements_suscripcion
       WHERE suscripcion_id = $1
         AND efectivo_desde <= $2::date
         AND (efectivo_hasta IS NULL OR efectivo_hasta >= $2::date)`,
      [suscripcionId, effectiveFrom],
    ),
  ]);

  const planByEntitlement = new Map<string, EntitlementPlanRow>();
  for (const row of planEntitlements.rows) {
    planByEntitlement.set(row.entitlement_id, row);
  }

  const hasAddonOverride = new Set<string>();
  for (const row of activeRows.rows) {
    if (row.origen === "ADDON") {
      hasAddonOverride.add(row.entitlement_id);
    }
  }

  await client.query(
    `UPDATE billing.entitlements_suscripcion
        SET efectivo_hasta = ($2::date - INTERVAL '1 day')::date
      WHERE suscripcion_id = $1
        AND origen = 'PLAN'::billing.origen_item_suscripcion
        AND efectivo_hasta IS NULL
        AND efectivo_desde < $2::date
        AND (
          entitlement_id NOT IN (
            SELECT ep.entitlement_id
            FROM billing.entitlements_plan ep
            WHERE ep.plan_id = $3
          )
          OR entitlement_id IN (
            SELECT es.entitlement_id
            FROM billing.entitlements_suscripcion es
            WHERE es.suscripcion_id = $1
              AND es.origen = 'ADDON'::billing.origen_item_suscripcion
              AND es.efectivo_desde <= $2::date
              AND (es.efectivo_hasta IS NULL OR es.efectivo_hasta >= $2::date)
          )
        )`,
    [suscripcionId, effectiveFrom, planId],
  );

  for (const row of planEntitlements.rows) {
    if (hasAddonOverride.has(row.entitlement_id)) continue;

    await client.query(
      `UPDATE billing.entitlements_suscripcion
          SET efectivo_hasta = ($3::date - INTERVAL '1 day')::date
        WHERE suscripcion_id = $1
          AND entitlement_id = $2
          AND origen = 'PLAN'::billing.origen_item_suscripcion
          AND efectivo_hasta IS NULL
          AND efectivo_desde < $3::date`,
      [suscripcionId, row.entitlement_id, effectiveFrom],
    );

    await client.query(
      `INSERT INTO billing.entitlements_suscripcion
        (suscripcion_id, entitlement_id, valor_entero, valor_booleano, origen, efectivo_desde, efectivo_hasta)
       VALUES ($1, $2, $3, $4, 'PLAN'::billing.origen_item_suscripcion, $5::date, NULL)
       ON CONFLICT (suscripcion_id, entitlement_id, efectivo_desde)
       DO UPDATE SET
         valor_entero = EXCLUDED.valor_entero,
         valor_booleano = EXCLUDED.valor_booleano,
         origen = EXCLUDED.origen,
         efectivo_hasta = NULL`,
      [suscripcionId, row.entitlement_id, row.valor_entero, row.valor_booleano, effectiveFrom],
    );
  }
}

