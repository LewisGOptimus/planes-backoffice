import { AppError } from "@/lib/api/types";
import { query } from "@/lib/db";
import { runInTransaction } from "@/lib/sql/transactions";

export type EntitlementType = "BOOLEANO" | "LIMITE" | "CONTADOR";
export type EntitlementScope = "EMPRESA" | "USUARIO";
export type EntitlementOrigin = "PLAN" | "ADDON" | "MANUAL" | "LEGACY";

export type EntitlementCatalogRow = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: EntitlementType;
  alcance: EntitlementScope;
  descripcion: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanEntitlementRow = {
  plan_id: string;
  entitlement_id: string;
  codigo: string;
  nombre: string;
  tipo: EntitlementType;
  alcance: EntitlementScope;
  valor_entero: number | null;
  valor_booleano: boolean | null;
};

export type SubscriptionEntitlementRow = {
  suscripcion_id: string;
  entitlement_id: string;
  codigo: string;
  nombre: string;
  tipo: EntitlementType;
  valor_entero: number | null;
  valor_booleano: boolean | null;
  origen: EntitlementOrigin;
  efectivo_desde: string;
  efectivo_hasta: string | null;
};

type ValueInput = {
  valorEntero: number | null;
  valorBooleano: boolean | null;
};

type EntitlementMeta = {
  id: string;
  tipo: EntitlementType;
};

const SUBSCRIPTION_OVERRIDE_ORIGINS: EntitlementOrigin[] = ["ADDON", "MANUAL", "LEGACY"];

async function entitlementMetaOrThrow(entitlementId: string): Promise<EntitlementMeta> {
  const row = await query<{ id: string; tipo: EntitlementType }>(
    "SELECT id::text, tipo::text AS tipo FROM billing.entitlements WHERE id = $1 LIMIT 1",
    [entitlementId],
  );
  const meta = row.rows[0];
  if (!meta) throw new AppError(404, "NOT_FOUND", "Entitlement no existe");
  return meta;
}

async function ensurePlanExists(planId: string) {
  const row = await query<{ id: string }>("SELECT id::text FROM billing.planes WHERE id = $1 LIMIT 1", [planId]);
  if (!row.rows[0]) throw new AppError(404, "NOT_FOUND", "Plan no existe");
}

async function ensureSubscriptionExists(subscriptionId: string) {
  const row = await query<{ id: string }>("SELECT id::text FROM billing.suscripciones WHERE id = $1 LIMIT 1", [subscriptionId]);
  if (!row.rows[0]) throw new AppError(404, "NOT_FOUND", "Suscripcion no existe");
}

function normalizeByType(type: EntitlementType, value: ValueInput): ValueInput {
  if (type === "BOOLEANO") {
    if (value.valorBooleano === null) {
      throw new AppError(400, "VALIDATION_ERROR", "Entitlement BOOLEANO requiere valor_booleano");
    }
    return { valorEntero: null, valorBooleano: value.valorBooleano };
  }

  if (value.valorEntero === null) {
    throw new AppError(400, "VALIDATION_ERROR", "Entitlement LIMITE/CONTADOR requiere valor_entero");
  }
  if (!Number.isInteger(value.valorEntero) || value.valorEntero < 0) {
    throw new AppError(400, "VALIDATION_ERROR", "valor_entero debe ser un entero mayor o igual a 0");
  }
  return { valorEntero: value.valorEntero, valorBooleano: null };
}

export async function listEntitlementsCatalog(): Promise<EntitlementCatalogRow[]> {
  const rows = await query<EntitlementCatalogRow>(
    `SELECT
      id::text,
      codigo,
      nombre,
      tipo::text AS tipo,
      alcance::text AS alcance,
      descripcion,
      created_at::text,
      updated_at::text
     FROM billing.entitlements
     ORDER BY nombre, codigo`,
  );
  return rows.rows;
}

export async function createEntitlementCatalog(input: {
  codigo: string;
  nombre: string;
  tipo: EntitlementType;
  alcance: EntitlementScope;
  descripcion: string | null;
}): Promise<EntitlementCatalogRow> {
  try {
    const created = await query<EntitlementCatalogRow>(
      `INSERT INTO billing.entitlements (codigo, nombre, tipo, alcance, descripcion)
       VALUES ($1, $2, $3::billing.tipo_entitlement, $4::billing.alcance_entitlement, $5)
       RETURNING
         id::text,
         codigo,
         nombre,
         tipo::text AS tipo,
         alcance::text AS alcance,
         descripcion,
         created_at::text,
         updated_at::text`,
      [input.codigo, input.nombre, input.tipo, input.alcance, input.descripcion],
    );
    return created.rows[0]!;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && String((error as { code: string }).code) === "23505") {
      throw new AppError(409, "CONFLICT", "Ya existe un entitlement con ese codigo");
    }
    throw error;
  }
}

export async function listPlanEntitlements(planId: string): Promise<PlanEntitlementRow[]> {
  await ensurePlanExists(planId);
  const rows = await query<PlanEntitlementRow>(
    `SELECT
      ep.plan_id::text AS plan_id,
      ep.entitlement_id::text AS entitlement_id,
      e.codigo,
      e.nombre,
      e.tipo::text AS tipo,
      e.alcance::text AS alcance,
      ep.valor_entero,
      ep.valor_booleano
     FROM billing.entitlements_plan ep
     JOIN billing.entitlements e ON e.id = ep.entitlement_id
     WHERE ep.plan_id = $1
     ORDER BY e.nombre, e.codigo`,
    [planId],
  );
  return rows.rows;
}

export async function upsertPlanEntitlement(input: {
  planId: string;
  entitlementId: string;
  valorEntero: number | null;
  valorBooleano: boolean | null;
}): Promise<PlanEntitlementRow> {
  await ensurePlanExists(input.planId);
  const meta = await entitlementMetaOrThrow(input.entitlementId);
  const normalized = normalizeByType(meta.tipo, {
    valorEntero: input.valorEntero,
    valorBooleano: input.valorBooleano,
  });

  await query(
    `INSERT INTO billing.entitlements_plan (plan_id, entitlement_id, valor_entero, valor_booleano)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (plan_id, entitlement_id)
     DO UPDATE SET
       valor_entero = EXCLUDED.valor_entero,
       valor_booleano = EXCLUDED.valor_booleano`,
    [input.planId, input.entitlementId, normalized.valorEntero, normalized.valorBooleano],
  );

  const rows = await query<PlanEntitlementRow>(
    `SELECT
      ep.plan_id::text AS plan_id,
      ep.entitlement_id::text AS entitlement_id,
      e.codigo,
      e.nombre,
      e.tipo::text AS tipo,
      e.alcance::text AS alcance,
      ep.valor_entero,
      ep.valor_booleano
     FROM billing.entitlements_plan ep
     JOIN billing.entitlements e ON e.id = ep.entitlement_id
     WHERE ep.plan_id = $1
       AND ep.entitlement_id = $2
     LIMIT 1`,
    [input.planId, input.entitlementId],
  );
  const out = rows.rows[0];
  if (!out) throw new AppError(500, "INTERNAL_ERROR", "No fue posible guardar el entitlement del plan");
  return out;
}

export async function removePlanEntitlement(planId: string, entitlementId: string): Promise<PlanEntitlementRow> {
  await ensurePlanExists(planId);
  const deleted = await query<PlanEntitlementRow>(
    `DELETE FROM billing.entitlements_plan ep
     WHERE ep.plan_id = $1
       AND ep.entitlement_id = $2
     RETURNING
       ep.plan_id::text AS plan_id,
       ep.entitlement_id::text AS entitlement_id,
       ''::text AS codigo,
       ''::text AS nombre,
       'LIMITE'::text AS tipo,
       'EMPRESA'::text AS alcance,
       ep.valor_entero,
       ep.valor_booleano`,
    [planId, entitlementId],
  );
  const row = deleted.rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "El entitlement no esta asignado al plan");
  return row;
}

export async function listSubscriptionEntitlementHistory(subscriptionId: string): Promise<SubscriptionEntitlementRow[]> {
  await ensureSubscriptionExists(subscriptionId);
  const rows = await query<SubscriptionEntitlementRow>(
    `SELECT
      es.suscripcion_id::text AS suscripcion_id,
      es.entitlement_id::text AS entitlement_id,
      e.codigo,
      e.nombre,
      e.tipo::text AS tipo,
      es.valor_entero,
      es.valor_booleano,
      es.origen::text AS origen,
      es.efectivo_desde::text AS efectivo_desde,
      es.efectivo_hasta::text AS efectivo_hasta
     FROM billing.entitlements_suscripcion es
     JOIN billing.entitlements e ON e.id = es.entitlement_id
     WHERE es.suscripcion_id = $1
     ORDER BY e.nombre, es.efectivo_desde DESC, es.origen`,
    [subscriptionId],
  );
  return rows.rows;
}

export async function createSubscriptionEntitlementOverride(input: {
  subscriptionId: string;
  entitlementId: string;
  origen: EntitlementOrigin;
  valorEntero: number | null;
  valorBooleano: boolean | null;
  efectivoDesde: string;
  efectivoHasta: string | null;
}): Promise<SubscriptionEntitlementRow> {
  if (!SUBSCRIPTION_OVERRIDE_ORIGINS.includes(input.origen)) {
    throw new AppError(400, "VALIDATION_ERROR", "origen debe ser ADDON, MANUAL o LEGACY");
  }
  if (input.efectivoHasta && input.efectivoHasta < input.efectivoDesde) {
    throw new AppError(400, "VALIDATION_ERROR", "efectivo_hasta no puede ser menor que efectivo_desde");
  }

  await ensureSubscriptionExists(input.subscriptionId);
  const meta = await entitlementMetaOrThrow(input.entitlementId);
  const normalized = normalizeByType(meta.tipo, {
    valorEntero: input.valorEntero,
    valorBooleano: input.valorBooleano,
  });

  return runInTransaction(async (client) => {
    await client.query(
      `UPDATE billing.entitlements_suscripcion
          SET efectivo_hasta = ($4::date - INTERVAL '1 day')::date
        WHERE suscripcion_id = $1
          AND entitlement_id = $2
          AND origen = $3::billing.origen_item_suscripcion
          AND efectivo_hasta IS NULL
          AND efectivo_desde < $4::date`,
      [input.subscriptionId, input.entitlementId, input.origen, input.efectivoDesde],
    );

    let valorEnteroToPersist = normalized.valorEntero;
    if (meta.tipo !== "BOOLEANO" && normalized.valorEntero !== null) {
      const current = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(COALESCE(valor_entero, 0)), 0)::text AS total
         FROM billing.entitlements_suscripcion
         WHERE suscripcion_id = $1
           AND entitlement_id = $2
           AND efectivo_desde <= $3::date
           AND (efectivo_hasta IS NULL OR efectivo_hasta >= $3::date)`,
        [input.subscriptionId, input.entitlementId, input.efectivoDesde],
      );
      const base = Number(current.rows[0]?.total ?? "0");
      valorEnteroToPersist = base + normalized.valorEntero;
    }

    await client.query(
      `INSERT INTO billing.entitlements_suscripcion
        (suscripcion_id, entitlement_id, valor_entero, valor_booleano, origen, efectivo_desde, efectivo_hasta)
       VALUES ($1, $2, $3, $4, $5::billing.origen_item_suscripcion, $6::date, $7::date)
       ON CONFLICT (suscripcion_id, entitlement_id, efectivo_desde)
       DO UPDATE SET
         valor_entero = EXCLUDED.valor_entero,
         valor_booleano = EXCLUDED.valor_booleano,
         origen = EXCLUDED.origen,
         efectivo_hasta = EXCLUDED.efectivo_hasta`,
      [
        input.subscriptionId,
        input.entitlementId,
        valorEnteroToPersist,
        normalized.valorBooleano,
        input.origen,
        input.efectivoDesde,
        input.efectivoHasta,
      ],
    );

    const row = await client.query<SubscriptionEntitlementRow>(
      `SELECT
        es.suscripcion_id::text AS suscripcion_id,
        es.entitlement_id::text AS entitlement_id,
        e.codigo,
        e.nombre,
        e.tipo::text AS tipo,
        es.valor_entero,
        es.valor_booleano,
        es.origen::text AS origen,
        es.efectivo_desde::text AS efectivo_desde,
        es.efectivo_hasta::text AS efectivo_hasta
       FROM billing.entitlements_suscripcion es
       JOIN billing.entitlements e ON e.id = es.entitlement_id
       WHERE es.suscripcion_id = $1
         AND es.entitlement_id = $2
         AND es.efectivo_desde = $3::date
       LIMIT 1`,
      [input.subscriptionId, input.entitlementId, input.efectivoDesde],
    );

    const out = row.rows[0];
    if (!out) throw new AppError(500, "INTERNAL_ERROR", "No fue posible guardar el override");
    return out;
  });
}

export async function updateSubscriptionEntitlementWindow(input: {
  subscriptionId: string;
  entitlementId: string;
  efectivoDesde: string;
  efectivoHasta: string | null;
}): Promise<SubscriptionEntitlementRow> {
  if (input.efectivoHasta && input.efectivoHasta < input.efectivoDesde) {
    throw new AppError(400, "VALIDATION_ERROR", "efectivo_hasta no puede ser menor que efectivo_desde");
  }

  await ensureSubscriptionExists(input.subscriptionId);
  const current = await query<{ origen: EntitlementOrigin }>(
    `SELECT origen::text AS origen
     FROM billing.entitlements_suscripcion
     WHERE suscripcion_id = $1
       AND entitlement_id = $2
       AND efectivo_desde = $3::date
     LIMIT 1`,
    [input.subscriptionId, input.entitlementId, input.efectivoDesde],
  );
  const currentRow = current.rows[0];
  if (!currentRow) throw new AppError(404, "NOT_FOUND", "No existe el registro de entitlement para la suscripcion");
  if (currentRow.origen === "PLAN") {
    throw new AppError(400, "BUSINESS_RULE_VIOLATION", "Los entitlements de origen PLAN se gestionan desde el plan");
  }

  const updated = await query<SubscriptionEntitlementRow>(
    `UPDATE billing.entitlements_suscripcion es
        SET efectivo_hasta = $4::date
      WHERE es.suscripcion_id = $1
        AND es.entitlement_id = $2
        AND es.efectivo_desde = $3::date
      RETURNING
        es.suscripcion_id::text AS suscripcion_id,
        es.entitlement_id::text AS entitlement_id,
        ''::text AS codigo,
        ''::text AS nombre,
        'LIMITE'::text AS tipo,
        es.valor_entero,
        es.valor_booleano,
        es.origen::text AS origen,
        es.efectivo_desde::text AS efectivo_desde,
        es.efectivo_hasta::text AS efectivo_hasta`,
    [input.subscriptionId, input.entitlementId, input.efectivoDesde, input.efectivoHasta],
  );
  const row = updated.rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "No existe el registro de entitlement para la suscripcion");

  const joined = await query<SubscriptionEntitlementRow>(
    `SELECT
      es.suscripcion_id::text AS suscripcion_id,
      es.entitlement_id::text AS entitlement_id,
      e.codigo,
      e.nombre,
      e.tipo::text AS tipo,
      es.valor_entero,
      es.valor_booleano,
      es.origen::text AS origen,
      es.efectivo_desde::text AS efectivo_desde,
      es.efectivo_hasta::text AS efectivo_hasta
     FROM billing.entitlements_suscripcion es
     JOIN billing.entitlements e ON e.id = es.entitlement_id
     WHERE es.suscripcion_id = $1
       AND es.entitlement_id = $2
       AND es.efectivo_desde = $3::date
     LIMIT 1`,
    [input.subscriptionId, input.entitlementId, input.efectivoDesde],
  );
  return joined.rows[0]!;
}
