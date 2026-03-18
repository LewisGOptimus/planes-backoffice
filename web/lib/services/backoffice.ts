import { PoolClient, QueryResultRow } from "pg";
import { AppError } from "@/lib/api/types";
import { query } from "@/lib/db";
import { requireDate, requireNumberLike, requireString, requireUuid } from "@/lib/api/validation";
import { runInTransaction } from "@/lib/sql/transactions";
import { syncPlanEntitlementsToSubscription } from "@/lib/services/entitlements";
import { computeInvoiceDiscountTotals, parseBooleanLike, parseDiscountInput } from "@/lib/services/invoice-discounts";

const PERIOD_MONTHS: Record<string, number> = { MENSUAL: 1, TRIMESTRAL: 3, ANUAL: 12 };

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function one<T extends QueryResultRow>(client: PoolClient, sql: string, values: unknown[] = []): Promise<T | null> {
  const r = await client.query<T>(sql, values);
  return r.rows[0] ?? null;
}

async function ensureEmpresaSchema(client?: PoolClient) {
  const runner = client?.query.bind(client) ?? query;
  await runner("ALTER TABLE core.empresas ADD COLUMN IF NOT EXISTS telefono TEXT");
  await runner("ALTER TABLE core.empresas ADD COLUMN IF NOT EXISTS departamento TEXT");
  await runner("ALTER TABLE core.empresas ADD COLUMN IF NOT EXISTS ciudad TEXT");
  await runner("ALTER TABLE core.empresas ADD COLUMN IF NOT EXISTS direccion TEXT");
}

export async function ensureBillingGraceSchema() {
  await runInTransaction(async (client) => {
    await client.query(`
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

    await client.query("ALTER TABLE billing.suscripciones ADD COLUMN IF NOT EXISTS grace_until DATE");
    await client.query("ALTER TABLE billing.suscripciones ADD COLUMN IF NOT EXISTS grace_days_granted INT NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE billing.suscripciones DROP COLUMN IF EXISTS grace_reason");
    await client.query("ALTER TABLE billing.suscripciones DROP COLUMN IF EXISTS blocked_at");
    await client.query("ALTER TABLE billing.suscripciones DROP COLUMN IF EXISTS block_reason");
    await client.query(
      "ALTER TABLE billing.suscripciones ADD COLUMN IF NOT EXISTS operational_status billing.estado_operativo_suscripcion NOT NULL DEFAULT 'EN_SERVICIO'",
    );

    await client.query(`
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

    await client.query(`
      ALTER TABLE billing.planes
      ADD COLUMN IF NOT EXISTS pricing_mode billing.modo_precio_plan NOT NULL DEFAULT 'BUNDLE'
    `);

    await client.query(`
      ALTER TABLE billing.suscripciones
      ADD COLUMN IF NOT EXISTS billing_cycle billing.periodo_precio
    `);
    await client.query("UPDATE billing.suscripciones SET billing_cycle = periodo WHERE billing_cycle IS NULL");
    await client.query("ALTER TABLE billing.suscripciones ALTER COLUMN billing_cycle SET NOT NULL");
    await client.query("ALTER TABLE billing.suscripciones ALTER COLUMN precio_plan_id DROP NOT NULL");

    await client.query(`
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

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'suscripciones_billing_cycle_values_chk'
        ) THEN
          ALTER TABLE billing.suscripciones
          ADD CONSTRAINT suscripciones_billing_cycle_values_chk CHECK (billing_cycle IN ('MENSUAL','TRIMESTRAL','ANUAL'));
        END IF;
      END $$;
    `);

    await client.query(`
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
    await client.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_suscripciones_plan_historial_open ON billing.suscripciones_plan_historial (suscripcion_id) WHERE vigente_hasta IS NULL",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_suscripciones_plan_historial_lookup ON billing.suscripciones_plan_historial (suscripcion_id, vigente_desde DESC)",
    );
    await client.query(`
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
    await client.query("DROP TRIGGER IF EXISTS trg_sync_suscripcion_plan_historial ON billing.suscripciones");
    await client.query(`
      CREATE TRIGGER trg_sync_suscripcion_plan_historial
      AFTER INSERT OR UPDATE OF plan_id, precio_plan_id, billing_cycle, periodo_actual_inicio
      ON billing.suscripciones
      FOR EACH ROW
      EXECUTE FUNCTION billing.sync_suscripcion_plan_historial()
    `);
    await client.query(`
      INSERT INTO billing.suscripciones_plan_historial
        (suscripcion_id, plan_id, precio_plan_id, billing_cycle, vigente_desde, vigente_hasta, motivo)
      SELECT
        s.id,
        s.plan_id,
        s.precio_plan_id,
        s.billing_cycle,
        COALESCE(s.periodo_actual_inicio, s.fecha_inicio, CURRENT_DATE) AS vigente_desde,
        NULL,
        'MIGRACION_INICIAL'
      FROM billing.suscripciones s
      WHERE NOT EXISTS (
        SELECT 1
        FROM billing.suscripciones_plan_historial h
        WHERE h.suscripcion_id = s.id
      )
    `);
    await client.query(`
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

    await client.query(`
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

    await client.query(`
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

    await client.query("CREATE INDEX IF NOT EXISTS idx_suscripciones_grace_block ON billing.suscripciones (estado, operational_status, grace_until)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_cobro_eventos_suscripcion_time ON billing.cobro_eventos (suscripcion_id, event_time DESC)");
    await client.query("ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS subtotal NUMERIC(18,2) NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS descuento_tipo billing.tipo_descuento");
    await client.query("ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS descuento_valor NUMERIC(18,4)");
    await client.query("ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS descuento_monto NUMERIC(18,2) NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS descuento_motivo TEXT");
    await client.query("UPDATE billing.facturas SET subtotal = total WHERE subtotal = 0 AND total > 0");
    await client.query("UPDATE billing.facturas SET descuento_monto = 0 WHERE descuento_monto IS NULL");
    await client.query(`
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
  });
}

export async function ensureConsumableProductProfileSchema() {
  await runInTransaction(async (client) => {
    await client.query("ALTER TABLE billing.productos ADD COLUMN IF NOT EXISTS unidad_consumo TEXT");
    await client.query("ALTER TABLE billing.productos ADD COLUMN IF NOT EXISTS descripcion_operativa TEXT");
    await client.query(
      `UPDATE billing.productos
          SET unidad_consumo = 'DOCUMENTO'
        WHERE codigo = 'DOCS-ELECTRONICOS'
          AND (unidad_consumo IS NULL OR btrim(unidad_consumo) = '')`,
    );
  });
}

export async function backofficeSeed() {
  const key = process.env.BACKOFFICE_ADMIN_KEY;
  if (process.env.NODE_ENV === "production") {
    throw new AppError(403, "UNAUTHORIZED", "BackOffice seed disabled in production");
  }
  if (!key) {
    throw new AppError(500, "INTERNAL_ERROR", "BACKOFFICE_ADMIN_KEY is not configured");
  }

  await ensureBillingGraceSchema();

  return runInTransaction(async (client) => {
    await client.query("ALTER TABLE billing.productos ADD COLUMN IF NOT EXISTS unidad_consumo TEXT");
    await client.query("ALTER TABLE billing.productos ADD COLUMN IF NOT EXISTS descripcion_operativa TEXT");

    await client.query(
      `INSERT INTO common.monedas (codigo, nombre, simbolo, decimales)
       VALUES ('COP', 'Peso Colombiano', '$', 2)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre`,
    );

    const cop = await one<{ id: string }>(client, "SELECT id FROM common.monedas WHERE codigo = 'COP'");
    if (!cop) throw new AppError(500, "INTERNAL_ERROR", "COP currency not available");

    const productos = [
      ["CONTABILIDAD", "Contabilidad", "MODULO", "EMPRESA", false, null, null],
      ["NOMINA", "Nomina", "MODULO", "EMPRESA", false, null, null],
      [
        "DOCS-ELECTRONICOS",
        "Documentos Electronicos",
        "CONSUMIBLE",
        "EMPRESA",
        true,
        "DOCUMENTO",
        "Pool de creditos consumibles para emision de documentos electronicos",
      ],
      ["SOPORTE-ANUAL", "Soporte Anual", "SERVICIO", "EMPRESA", false, null, null],
      ["CERTIFICADO-DIGITAL", "Certificado Digital", "SERVICIO", "EMPRESA", false, null, null],
    ] as const;

    for (const p of productos) {
      await client.query(
        `INSERT INTO billing.productos (codigo, nombre, tipo, alcance, es_consumible, unidad_consumo, descripcion_operativa, activo)
         VALUES ($1, $2, $3::billing.tipo_producto, $4::billing.alcance_producto, $5, $6, $7, true)
         ON CONFLICT (codigo) DO UPDATE
         SET nombre = EXCLUDED.nombre,
             tipo = EXCLUDED.tipo,
             alcance = EXCLUDED.alcance,
             es_consumible = EXCLUDED.es_consumible,
             unidad_consumo = EXCLUDED.unidad_consumo,
             descripcion_operativa = EXCLUDED.descripcion_operativa`,
        [...p],
      );
    }

    const planes = [
      ["PLAN-MENSUAL-BASE", "Plan Mensual Base", "MENSUAL", "180000"],
      ["PLAN-ANUAL-BASE", "Plan Anual Base", "ANUAL", "1800000"],
    ] as const;

    for (const p of planes) {
      await client.query(
        `INSERT INTO billing.planes (codigo, nombre, periodo, activo)
         VALUES ($1, $2, $3::billing.periodo_precio, true)
         ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, periodo = EXCLUDED.periodo`,
        [p[0], p[1], p[2]],
      );
    }

    const planRows = await client.query<{ id: string; codigo: string; periodo: string }>("SELECT id, codigo, periodo::text FROM billing.planes");
    for (const p of planRows.rows) {
      const valor = p.codigo === "PLAN-MENSUAL-BASE" ? "180000" : "1800000";
      await client.query(
        `INSERT INTO billing.precios_planes (plan_id, moneda_id, periodo, valor, activo, valido_desde)
         SELECT $1, $2, $3::billing.periodo_precio, $4::numeric, true, CURRENT_DATE
         WHERE NOT EXISTS (
            SELECT 1 FROM billing.precios_planes
            WHERE plan_id = $1 AND periodo = $3::billing.periodo_precio AND activo = true
         )`,
        [p.id, cop.id, p.periodo, valor],
      );
    }

    return { seeded: true, productos: productos.length, planes: planes.length };
  });
}

export async function ensureCopCurrency() {
  await ensureBillingGraceSchema();
  await runInTransaction(async (client) => {
    await client.query("ALTER TABLE billing.productos ADD COLUMN IF NOT EXISTS unidad_consumo TEXT");
    await client.query("ALTER TABLE billing.productos ADD COLUMN IF NOT EXISTS descripcion_operativa TEXT");

    const exists = await one<{ id: string }>(client, "SELECT id FROM common.monedas WHERE codigo = 'COP' LIMIT 1");
    if (!exists) {
      await client.query(
        `INSERT INTO common.monedas (codigo, nombre, simbolo, decimales)
         VALUES ('COP', 'Peso Colombiano', '$', 2)
         ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre`,
      );
    }

    await client.query(
      `UPDATE billing.productos
          SET unidad_consumo = 'DOCUMENTO'
        WHERE codigo = 'DOCS-ELECTRONICOS'
          AND (unidad_consumo IS NULL OR btrim(unidad_consumo) = '')`,
    );
  });
  return { ok: true };
}

export async function backofficeClean() {
  if (process.env.NODE_ENV === "production") {
    throw new AppError(403, "UNAUTHORIZED", "BackOffice clean disabled in production");
  }
  if (!process.env.BACKOFFICE_ADMIN_KEY) {
    throw new AppError(500, "INTERNAL_ERROR", "BACKOFFICE_ADMIN_KEY is not configured");
  }

  await runInTransaction(async (client) => {
    await client.query(`
      DO $$
      DECLARE
          t RECORD;
      BEGIN
          FOR t IN
            SELECT schemaname, tablename
            FROM pg_tables
            WHERE schemaname IN ('billing', 'core', 'common')
          LOOP
            EXECUTE format('TRUNCATE TABLE %I.%I RESTART IDENTITY CASCADE', t.schemaname, t.tablename);
          END LOOP;
      END $$;
    `);
  });

  return { cleaned: true };
}

export async function getEmpresaCards() {
  await ensureEmpresaSchema();
  const r = await query<{
    empresa_id: string;
    empresa_nombre: string;
    telefono: string | null;
    departamento: string | null;
    ciudad: string | null;
    direccion: string | null;
    owner_user_id: string | null;
    owner_nombre: string | null;
    owner_email: string | null;
    suscripcion_id: string | null;
    estado_suscripcion: string | null;
    plan_nombre: string | null;
    periodo_fin: string | null;
    ultima_factura_fecha: string | null;
    ultima_factura_total: string | null;
    total_abierto: string | null;
  }>(`
    SELECT
      e.id::text AS empresa_id,
      e.nombre AS empresa_nombre,
      e.telefono,
      e.departamento,
      e.ciudad,
      e.direccion,
      owner.usuario_id::text AS owner_user_id,
      u.nombre AS owner_nombre,
      u.email AS owner_email,
      s.id::text AS suscripcion_id,
      s.estado::text AS estado_suscripcion,
      p.nombre AS plan_nombre,
      s.periodo_actual_fin::text AS periodo_fin,
      lf.fecha_emision::text AS ultima_factura_fecha,
      lf.total::text AS ultima_factura_total,
      open_inv.total_abierto::text AS total_abierto
    FROM core.empresas e
    LEFT JOIN LATERAL (
      SELECT ue.usuario_id
      FROM core.usuarios_empresas ue
      WHERE ue.empresa_id = e.id
        AND ue.rol = 'OWNER'
      ORDER BY ue.es_principal DESC, ue.updated_at DESC, ue.created_at DESC
      LIMIT 1
    ) owner ON true
    LEFT JOIN core.usuarios u ON u.id = owner.usuario_id
    LEFT JOIN LATERAL (
      SELECT *
      FROM billing.suscripciones s
      WHERE s.empresa_id = e.id
      ORDER BY
        (s.estado = 'ACTIVA'::billing.estado_suscripcion) DESC,
        COALESCE(s.periodo_actual_fin, s.periodo_actual_inicio, s.fecha_inicio) DESC,
        COALESCE(s.periodo_actual_inicio, s.fecha_inicio) DESC,
        s.updated_at DESC,
        s.created_at DESC
      LIMIT 1
    ) s ON true
    LEFT JOIN billing.planes p ON p.id = s.plan_id
    LEFT JOIN LATERAL (
      SELECT f.fecha_emision, f.total
      FROM billing.facturas f
      WHERE f.empresa_id = e.id
      ORDER BY f.fecha_emision DESC
      LIMIT 1
    ) lf ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(f.total),0) AS total_abierto
      FROM billing.facturas f
      WHERE f.empresa_id = e.id
        AND f.estado IN ('BORRADOR'::billing.estado_factura, 'EMITIDA'::billing.estado_factura)
    ) open_inv ON true
    ORDER BY e.created_at DESC
  `);
  return r.rows;
}

export async function getBackofficeLookups() {
  await ensureBillingGraceSchema();
  const [empresas, planes, productos, suscripciones, usuarios, monedas, preciosPlanes, entitlements] = await Promise.all([
    query<{ id: string; nombre: string }>("SELECT id::text, nombre FROM core.empresas ORDER BY nombre"),
    query<{ id: string; nombre: string; periodo: string; pricing_mode: string }>(
      "SELECT id::text, nombre, periodo::text, pricing_mode::text FROM billing.planes ORDER BY nombre",
    ),
    query<{ id: string; nombre: string; codigo: string }>("SELECT id::text, nombre, codigo FROM billing.productos ORDER BY nombre"),
    query<{ id: string; empresa: string; plan: string }>(`
      SELECT s.id::text, e.nombre AS empresa, p.nombre AS plan
      FROM billing.suscripciones s
      JOIN core.empresas e ON e.id = s.empresa_id
      JOIN billing.planes p ON p.id = s.plan_id
      ORDER BY s.created_at DESC`),
    query<{ id: string; nombre: string; email: string }>("SELECT id::text, nombre, email FROM core.usuarios ORDER BY nombre"),
    query<{ id: string; codigo: string }>("SELECT id::text, codigo FROM common.monedas ORDER BY codigo"),
    query<{ id: string; plan_id: string; periodo: string; valor: string }>("SELECT id::text, plan_id::text, periodo::text, valor::text FROM billing.precios_planes ORDER BY created_at DESC"),
    query<{ id: string; codigo: string; nombre: string; tipo: string }>("SELECT id::text, codigo, nombre, tipo::text FROM billing.entitlements ORDER BY nombre"),
  ]);

  return {
    empresas: empresas.rows.map((x) => ({ value: x.id, label: x.nombre })),
    planes: planes.rows.map((x) => ({ value: x.id, label: `${x.nombre} (${x.pricing_mode} | default ${x.periodo})` })),
    productos: productos.rows.map((x) => ({ value: x.id, label: `${x.nombre} (${x.codigo})` })),
    suscripciones: suscripciones.rows.map((x) => ({ value: x.id, label: `${x.empresa} | ${x.plan}` })),
    usuarios: usuarios.rows.map((x) => ({ value: x.id, label: `${x.nombre} (${x.email})` })),
    monedas: monedas.rows.map((x) => ({ value: x.id, label: x.codigo })),
    precios_planes: preciosPlanes.rows,
    entitlements: entitlements.rows.map((x) => ({ value: x.id, label: `${x.nombre} (${x.codigo} | ${x.tipo})` })),
  };
}

export async function saveEmpresaWithOwner(payload: Record<string, unknown>) {
  return runInTransaction(async (client) => {
    await ensureEmpresaSchema(client);
    const ownerUserId = requireUuid(payload.owner_user_id, "owner_user_id");
    const nombre = requireString(payload.nombre, "nombre");
    const nit = payload.nit ? requireString(payload.nit, "nit") : null;
    const telefono = payload.telefono ? requireString(payload.telefono, "telefono") : null;
    const departamento = payload.departamento ? requireString(payload.departamento, "departamento") : null;
    const ciudad = payload.ciudad ? requireString(payload.ciudad, "ciudad") : null;
    const direccion = payload.direccion ? requireString(payload.direccion, "direccion") : null;
    const timezone = requireString(payload.timezone ?? "UTC", "timezone");
    const activa = payload.activa === undefined ? true : Boolean(payload.activa);

    const ownerExists = await one<{ id: string }>(client, "SELECT id FROM core.usuarios WHERE id = $1", [ownerUserId]);
    if (!ownerExists) throw new AppError(404, "NOT_FOUND", "Owner user not found");

    let empresaId: string;
    if (payload.id) {
      empresaId = requireUuid(payload.id, "id");
      await client.query(
        `UPDATE core.empresas
            SET nombre = $1, nit = $2, telefono = $3, departamento = $4, ciudad = $5, direccion = $6, timezone = $7, activa = $8, updated_at = now()
          WHERE id = $9`,
        [nombre, nit, telefono, departamento, ciudad, direccion, timezone, activa, empresaId],
      );
    } else {
      const created = await one<{ id: string }>(
        client,
        `INSERT INTO core.empresas (nombre, nit, telefono, departamento, ciudad, direccion, timezone, activa)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [nombre, nit, telefono, departamento, ciudad, direccion, timezone, activa],
      );
      if (!created) throw new AppError(500, "INTERNAL_ERROR", "Failed to create company");
      empresaId = created.id;
    }

    await client.query(
      `UPDATE core.usuarios_empresas
          SET rol = 'ADMIN', updated_at = now()
        WHERE empresa_id = $1
          AND rol = 'OWNER'
          AND usuario_id <> $2`,
      [empresaId, ownerUserId],
    );

    const hasPrincipal = await one<{ yes: number }>(
      client,
      "SELECT 1 AS yes FROM core.usuarios_empresas WHERE usuario_id = $1 AND es_principal = true LIMIT 1",
      [ownerUserId],
    );

    await client.query(
      `INSERT INTO core.usuarios_empresas (usuario_id, empresa_id, rol, es_principal)
       VALUES ($1, $2, 'OWNER', $3)
       ON CONFLICT (usuario_id, empresa_id)
       DO UPDATE SET rol = 'OWNER', updated_at = now()`,
      [ownerUserId, empresaId, hasPrincipal ? false : true],
    );

    return { empresa_id: empresaId, owner_user_id: ownerUserId };
  });
}

export async function createPlanWithSetup(payload: Record<string, unknown>) {
  await ensureBillingGraceSchema();
  return runInTransaction(async (client) => {
    const codigo = requireString(payload.codigo, "codigo");
    const nombre = requireString(payload.nombre, "nombre");
    const descripcion = payload.descripcion ? requireString(payload.descripcion, "descripcion") : null;
    const periodo = requireString(payload.periodo ?? "MENSUAL", "periodo");
    const pricingMode = requireString(payload.pricing_mode ?? "BUNDLE", "pricing_mode");
    const activo = payload.activo === undefined ? true : Boolean(payload.activo);
    const graceDays = payload.grace_days === undefined || payload.grace_days === null || String(payload.grace_days).trim() === ""
      ? 0
      : Number(requireNumberLike(payload.grace_days, "grace_days"));

    const productosRaw = Array.isArray(payload.productos) ? payload.productos : [];
    if (productosRaw.length === 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Debe asignar minimo un producto al plan");
    }

    const preciosRaw = Array.isArray(payload.precios) ? payload.precios : [];
    if (preciosRaw.length === 0 && pricingMode !== "SUM_COMPONENTS") {
      throw new AppError(400, "VALIDATION_ERROR", "Debe registrar al menos un precio inicial");
    }

    const plan = await one<{ id: string }>(
      client,
      `INSERT INTO billing.planes (codigo, nombre, descripcion, pricing_mode, periodo, activo)
       VALUES ($1, $2, $3, $4::billing.modo_precio_plan, $5::billing.periodo_precio, $6)
       RETURNING id`,
      [codigo, nombre, descripcion, pricingMode, periodo, activo],
    );
    if (!plan) throw new AppError(500, "INTERNAL_ERROR", "No se pudo crear el plan");

    const productSet = new Set<string>();
    for (const raw of productosRaw) {
      const productoId = requireUuid(raw, "productos[]");
      if (productSet.has(productoId)) continue;
      productSet.add(productoId);
      await client.query(
        `INSERT INTO billing.items_plan (plan_id, producto_id, incluido, cantidad)
         VALUES ($1, $2, true, NULL)`,
        [plan.id, productoId],
      );
    }

    const createdPriceIds: string[] = [];
    for (const raw of preciosRaw) {
      if (!raw || typeof raw !== "object") continue;
      const p = raw as Record<string, unknown>;
      const monedaId = requireUuid(p.moneda_id, "precios[].moneda_id");
      const precioPeriodo = requireString(p.periodo ?? periodo, "precios[].periodo");
      const valor = requireNumberLike(p.valor, "precios[].valor");
      const validoDesde = p.valido_desde ? requireDate(p.valido_desde, "precios[].valido_desde") : null;
      const validoHasta = p.valido_hasta ? requireDate(p.valido_hasta, "precios[].valido_hasta") : null;

      const inserted = await one<{ id: string }>(
        client,
        `INSERT INTO billing.precios_planes
          (plan_id, moneda_id, periodo, valor, activo, valido_desde, valido_hasta)
         VALUES ($1, $2, $3::billing.periodo_precio, $4::numeric, true, $5, $6)
         RETURNING id`,
        [plan.id, monedaId, precioPeriodo, valor, validoDesde, validoHasta],
      );
      if (inserted) createdPriceIds.push(inserted.id);
    }
    if (pricingMode === "SUM_COMPONENTS" && createdPriceIds.length === 0) {
      const cop = await one<{ id: string }>(client, "SELECT id FROM common.monedas WHERE codigo = 'COP' LIMIT 1");
      if (!cop) {
        throw new AppError(400, "BUSINESS_RULE_VIOLATION", "Para planes SUM_COMPONENTS se requiere moneda COP configurada");
      }
      const autoPrice = await one<{ id: string }>(
        client,
        `INSERT INTO billing.precios_planes
          (plan_id, moneda_id, periodo, valor, activo, valido_desde)
         VALUES ($1, $2, $3::billing.periodo_precio, 0, true, CURRENT_DATE)
         RETURNING id`,
        [plan.id, cop.id, periodo],
      );
      if (autoPrice) createdPriceIds.push(autoPrice.id);
    }

    const entitlementsRaw = Array.isArray(payload.entitlements) ? payload.entitlements : [];
    let entitlementsAsignados = 0;
    for (const raw of entitlementsRaw) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const entitlementId = requireUuid(row.entitlement_id, "entitlements[].entitlement_id");
      const entitlementMeta = await one<{ tipo: string }>(
        client,
        "SELECT tipo::text AS tipo FROM billing.entitlements WHERE id = $1",
        [entitlementId],
      );
      if (!entitlementMeta) throw new AppError(404, "NOT_FOUND", "Entitlement no existe");
      const hasEntero = row.valor_entero !== undefined && row.valor_entero !== null && String(row.valor_entero).trim() !== "";
      const hasBooleano = row.valor_booleano !== undefined && row.valor_booleano !== null && String(row.valor_booleano).trim() !== "";
      const valorEntero = hasEntero ? Number(requireNumberLike(row.valor_entero, "entitlements[].valor_entero")) : null;
      const valorBooleano =
        hasBooleano
          ? (typeof row.valor_booleano === "boolean"
            ? row.valor_booleano
            : String(row.valor_booleano).toLowerCase() === "true")
          : null;
      if (entitlementMeta.tipo === "BOOLEANO" && !hasBooleano) {
        throw new AppError(400, "VALIDATION_ERROR", "Entitlement BOOLEANO requiere valor_booleano");
      }
      if (entitlementMeta.tipo !== "BOOLEANO" && !hasEntero) {
        throw new AppError(400, "VALIDATION_ERROR", "Entitlement LIMITE/CONTADOR requiere valor_entero");
      }

      await client.query(
        `INSERT INTO billing.entitlements_plan (plan_id, entitlement_id, valor_entero, valor_booleano)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (plan_id, entitlement_id)
         DO UPDATE SET valor_entero = EXCLUDED.valor_entero, valor_booleano = EXCLUDED.valor_booleano`,
        [plan.id, entitlementId, valorEntero, valorBooleano],
      );
      entitlementsAsignados += 1;
    }

    await client.query(
      `INSERT INTO billing.politicas_cobro (scope, plan_id, grace_days, auto_block, activo)
       VALUES ('PLAN', $1, $2, true, true)
       ON CONFLICT DO NOTHING`,
      [plan.id, Math.max(0, graceDays)],
    );

    return { plan_id: plan.id, precios_ids: createdPriceIds, productos_asignados: productSet.size, entitlements_asignados: entitlementsAsignados };
  });
}

export async function getEmpresaEntitlements(empresaId: string) {
  const data = await query<{
    fuente: string;
    codigo: string;
    nombre: string;
    tipo: string;
    valor_entero: number | null;
    valor_booleano: boolean | null;
  }>(
    `SELECT 'SUSCRIPCION'::text AS fuente,
            e.codigo,
            e.nombre,
            e.tipo::text,
            es.valor_entero,
            es.valor_booleano
     FROM billing.suscripciones s
     JOIN billing.entitlements_suscripcion es ON es.suscripcion_id = s.id
     JOIN billing.entitlements e ON e.id = es.entitlement_id
     WHERE s.empresa_id = $1
       AND es.efectivo_desde <= CURRENT_DATE
       AND (es.efectivo_hasta IS NULL OR es.efectivo_hasta >= CURRENT_DATE)

     UNION ALL

     SELECT 'USUARIO'::text AS fuente,
            e.codigo,
            e.nombre,
            e.tipo::text,
            eu.valor_entero,
            eu.valor_booleano
     FROM core.usuarios_empresas ue
     JOIN billing.entitlements_usuario eu ON eu.usuario_id = ue.usuario_id
     JOIN billing.entitlements e ON e.id = eu.entitlement_id
     WHERE ue.empresa_id = $1
       AND eu.efectivo_desde <= CURRENT_DATE
       AND (eu.efectivo_hasta IS NULL OR eu.efectivo_hasta >= CURRENT_DATE)
     ORDER BY codigo, fuente`,
    [empresaId],
  );

  return data.rows;
}

export async function getSuscripcionEntitlements(suscripcionId: string) {
  const data = await query<{
    entitlement_id: string;
    codigo: string;
    nombre: string;
    tipo: string;
    valor_entero: number | null;
    valor_booleano: boolean | null;
    origen: string;
    efectivo_desde: string;
    efectivo_hasta: string | null;
  }>(
    `SELECT
      e.id::text AS entitlement_id,
      e.codigo,
      e.nombre,
      e.tipo::text,
      es.valor_entero,
      es.valor_booleano,
      es.origen::text,
      es.efectivo_desde::text,
      es.efectivo_hasta::text
     FROM billing.entitlements_suscripcion es
     JOIN billing.entitlements e ON e.id = es.entitlement_id
     WHERE es.suscripcion_id = $1
       AND es.efectivo_desde <= CURRENT_DATE
       AND (es.efectivo_hasta IS NULL OR es.efectivo_hasta >= CURRENT_DATE)
     ORDER BY e.codigo, es.origen`,
    [suscripcionId],
  );
  return data.rows;
}

export async function getEmpresaConsumablesPool(empresaId: string) {
  const rows = await query<{
    suscripcion_id: string;
    producto_id: string;
    producto_codigo: string;
    producto_nombre: string;
    unidad_consumo: string | null;
    comprado: number;
    consumido: number;
    restante: number;
    vigencia_pago_inicio: string | null;
    vigencia_pago_fin: string | null;
    vigencia_efectiva_inicio: string | null;
    vigencia_efectiva_fin: string | null;
    estado_item: string;
  }>(
    `SELECT
      s.id::text AS suscripcion_id,
      isub.producto_id::text AS producto_id,
      p.codigo AS producto_codigo,
      p.nombre AS producto_nombre,
      p.unidad_consumo,
      COALESCE(sum(isub.cantidad), 0)::int AS comprado,
      0::int AS consumido,
      COALESCE(sum(isub.cantidad), 0)::int AS restante,
      min(isub.fecha_inicio)::text AS vigencia_pago_inicio,
      max(isub.fecha_fin)::text AS vigencia_pago_fin,
      min(isub.fecha_efectiva_inicio)::text AS vigencia_efectiva_inicio,
      max(isub.fecha_efectiva_fin)::text AS vigencia_efectiva_fin,
      max(isub.estado)::text AS estado_item
     FROM billing.suscripciones s
     JOIN billing.items_suscripcion isub ON isub.suscripcion_id = s.id
     JOIN billing.productos p ON p.id = isub.producto_id
     WHERE s.empresa_id = $1
       AND p.es_consumible = true
     GROUP BY s.id, isub.producto_id, p.codigo, p.nombre, p.unidad_consumo
     ORDER BY p.nombre, s.id`,
    [empresaId],
  );
  return rows.rows;
}

export async function getSubscriptionConsumableInvoiceLinks(subscriptionId: string) {
  const rows = await query<{
    item_suscripcion_id: string;
    producto_id: string;
    producto_codigo: string;
    producto_nombre: string;
    factura_id: string | null;
    factura_fecha: string | null;
    factura_estado: string | null;
    item_factura_id: string | null;
    item_factura_descripcion: string | null;
    item_factura_total: string | null;
    link_type: string;
  }>(
    `SELECT
      isub.id::text AS item_suscripcion_id,
      p.id::text AS producto_id,
      p.codigo AS producto_codigo,
      p.nombre AS producto_nombre,
      f.id::text AS factura_id,
      f.fecha_emision::text AS factura_fecha,
      f.estado::text AS factura_estado,
      ifa.id::text AS item_factura_id,
      ifa.descripcion AS item_factura_descripcion,
      ifa.total::text AS item_factura_total,
      CASE
        WHEN ifa.id IS NULL THEN 'SIN_FACTURA_RELACIONADA'
        WHEN ifa.precio_id IS NOT NULL AND ifa.precio_id = isub.precio_id THEN 'PRECIO_COINCIDENTE'
        ELSE 'PRODUCTO_COINCIDENTE'
      END AS link_type
     FROM billing.items_suscripcion isub
     JOIN billing.productos p ON p.id = isub.producto_id
     LEFT JOIN billing.facturas f ON f.suscripcion_id = isub.suscripcion_id
     LEFT JOIN billing.items_factura ifa
       ON ifa.factura_id = f.id
      AND ifa.producto_id = isub.producto_id
      AND (
        ifa.periodo_desde IS NULL
        OR isub.fecha_inicio IS NULL
        OR ifa.periodo_desde <= COALESCE(isub.fecha_fin, isub.fecha_inicio)
      )
      AND (
        ifa.periodo_hasta IS NULL
        OR isub.fecha_inicio IS NULL
        OR ifa.periodo_hasta >= isub.fecha_inicio
      )
     WHERE isub.suscripcion_id = $1
       AND p.es_consumible = true
     ORDER BY p.nombre, f.fecha_emision DESC NULLS LAST, ifa.created_at DESC NULLS LAST`,
    [subscriptionId],
  );
  return rows.rows;
}

export async function getSubscriptionPlanHistoryWithBilling(subscriptionId: string) {
  const [historyRes, invoicesRes] = await Promise.all([
    query<{
      historial_id: string;
      suscripcion_id: string;
      plan_id: string;
      plan_nombre: string;
      billing_cycle: string;
      vigente_desde: string;
      vigente_hasta: string | null;
      motivo: string | null;
      precio_plan_id: string | null;
      created_at: string;
    }>(
      `SELECT
        h.id::text AS historial_id,
        h.suscripcion_id::text AS suscripcion_id,
        h.plan_id::text AS plan_id,
        p.nombre AS plan_nombre,
        h.billing_cycle::text AS billing_cycle,
        h.vigente_desde::text AS vigente_desde,
        h.vigente_hasta::text AS vigente_hasta,
        h.motivo,
        h.precio_plan_id::text AS precio_plan_id,
        h.created_at::text AS created_at
       FROM billing.suscripciones_plan_historial h
       JOIN billing.planes p ON p.id = h.plan_id
       WHERE h.suscripcion_id = $1
       ORDER BY h.vigente_desde DESC, h.created_at DESC`,
      [subscriptionId],
    ),
    query<{
      factura_id: string;
      fecha_emision: string;
      fecha_vencimiento: string | null;
      estado: string;
      subtotal: string | null;
      descuento_monto: string | null;
      total: string;
      metodo_pago: string;
      notas: string | null;
    }>(
      `SELECT
        f.id::text AS factura_id,
        f.fecha_emision::text AS fecha_emision,
        f.fecha_vencimiento::text AS fecha_vencimiento,
        f.estado::text AS estado,
        f.subtotal::text AS subtotal,
        f.descuento_monto::text AS descuento_monto,
        f.total::text AS total,
        f.metodo_pago::text AS metodo_pago,
        f.notas
       FROM billing.facturas f
       WHERE f.suscripcion_id = $1
       ORDER BY f.fecha_emision DESC, f.created_at DESC`,
      [subscriptionId],
    ),
  ]);

  return {
    history: historyRes.rows,
    invoices: invoicesRes.rows,
  };
}

export async function renewExpiredSubscription(input: {
  subscriptionId: string;
  fechaInicio: string;
  precioPlanId: string;
  billingCycle: string;
}) {
  await ensureBillingGraceSchema();
  return runInTransaction(async (client) => {
    const sub = await one<{
      id: string;
      plan_id: string;
      precio_plan_id: string;
      billing_cycle: string;
      periodo_actual_fin: string;
    }>(
      client,
      `SELECT
        id::text,
        plan_id::text,
        precio_plan_id::text,
        billing_cycle::text,
        periodo_actual_fin::text
       FROM billing.suscripciones
       WHERE id = $1
       LIMIT 1`,
      [input.subscriptionId],
    );
    if (!sub) throw new AppError(404, "NOT_FOUND", "Suscripcion no existe");
    if (sub.periodo_actual_fin >= new Date().toISOString().slice(0, 10)) {
      throw new AppError(400, "BUSINESS_RULE_VIOLATION", "La suscripcion aun no esta vencida para renovar");
    }

    const selectedPrice = await one<{
      id: string;
      plan_id: string;
      periodo: string;
      activo: boolean;
      valido_desde: string | null;
      valido_hasta: string | null;
    }>(
      client,
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
      [input.precioPlanId],
    );
    if (!selectedPrice) throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id no existe");
    if (selectedPrice.plan_id !== sub.plan_id) {
      throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id no pertenece al plan actual");
    }
    if (selectedPrice.periodo !== input.billingCycle) {
      throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id no coincide con billing_cycle");
    }
    if (!selectedPrice.activo) {
      throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id inactivo");
    }
    if (
      (selectedPrice.valido_desde && selectedPrice.valido_desde > input.fechaInicio) ||
      (selectedPrice.valido_hasta && selectedPrice.valido_hasta < input.fechaInicio)
    ) {
      throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_plan_id no vigente para fecha_inicio");
    }

    const months = input.billingCycle === "ANUAL" ? 12 : input.billingCycle === "TRIMESTRAL" ? 3 : 1;
    const periodoActualFin = addMonths(input.fechaInicio, months);

    await client.query(
      `UPDATE billing.suscripciones
          SET precio_plan_id = $1,
              billing_cycle = $2::billing.periodo_precio,
              periodo = $2::billing.periodo_precio,
              periodo_actual_inicio = $3::date,
              periodo_actual_fin = $4::date,
              estado = 'ACTIVA'::billing.estado_suscripcion,
              updated_at = now()
        WHERE id = $5`,
      [input.precioPlanId, input.billingCycle, input.fechaInicio, periodoActualFin, input.subscriptionId],
    );

    await client.query(
      `UPDATE billing.items_suscripcion
          SET fecha_inicio = $2::date,
              fecha_fin = $3::date,
              estado = 'ACTIVO'::billing.estado_item_suscripcion,
              updated_at = now()
        WHERE suscripcion_id = $1
          AND origen = 'PLAN'::billing.origen_item_suscripcion`,
      [input.subscriptionId, input.fechaInicio, periodoActualFin],
    );

    await syncPlanEntitlementsToSubscription(client, {
      suscripcionId: input.subscriptionId,
      planId: sub.plan_id,
      effectiveFrom: input.fechaInicio,
    });

    return {
      suscripcion_id: input.subscriptionId,
      plan_id: sub.plan_id,
      precio_plan_id: input.precioPlanId,
      billing_cycle: input.billingCycle,
      periodo_actual_inicio: input.fechaInicio,
      periodo_actual_fin: periodoActualFin,
    };
  });
}

async function getVigentePrecioPlan(client: PoolClient, planId: string, periodo: string, fecha: string) {
  const row = await one<{ id: string; valor: string }>(
    client,
    `SELECT id, valor::text
     FROM billing.precios_planes
     WHERE plan_id = $1
       AND periodo = $2::billing.periodo_precio
       AND activo = true
       AND (valido_desde IS NULL OR valido_desde <= $3::date)
       AND (valido_hasta IS NULL OR valido_hasta >= $3::date)
     ORDER BY valido_desde DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [planId, periodo, fecha],
  );
  if (!row) throw new AppError(400, "BUSINESS_RULE_VIOLATION", "No existe precio vigente para el plan");
  return row;
}

async function getVigentePrecioProducto(client: PoolClient, productoId: string, periodo: string, fecha: string) {
  const row = await one<{ id: string; valor: string }>(
    client,
    `SELECT id, valor::text
     FROM billing.precios
     WHERE producto_id = $1
       AND periodo = $2::billing.periodo_precio
       AND activo = true
       AND (valido_desde IS NULL OR valido_desde <= $3::date)
       AND (valido_hasta IS NULL OR valido_hasta >= $3::date)
     ORDER BY valido_desde DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [productoId, periodo, fecha],
  );
  if (!row) throw new AppError(400, "BUSINESS_RULE_VIOLATION", "No existe precio vigente para producto incluido del plan");
  return row;
}

async function resolveSubscriptionCharge(client: PoolClient, planId: string, billingCycle: string, fecha: string) {
  const plan = await one<{ pricing_mode: string }>(client, "SELECT pricing_mode::text FROM billing.planes WHERE id = $1", [planId]);
  if (!plan) throw new AppError(404, "NOT_FOUND", "Plan no existe");

  if (plan.pricing_mode !== "SUM_COMPONENTS") {
    const planPrice = await getVigentePrecioPlan(client, planId, billingCycle, fecha);
    return { priceId: planPrice.id, amount: Number(planPrice.valor) };
  }

  const items = await client.query<{ producto_id: string; cantidad: number | null }>(
    "SELECT producto_id::text, cantidad FROM billing.items_plan WHERE plan_id = $1 AND incluido = true",
    [planId],
  );

  let amount = 0;
  for (const item of items.rows) {
    const pr = await getVigentePrecioProducto(client, item.producto_id, billingCycle, fecha);
    amount += Number(pr.valor) * Math.max(1, Number(item.cantidad ?? 1));
  }

  return { priceId: null, amount: Number(amount.toFixed(2)) };
}

export async function createSubscriptionWithOptions(payload: Record<string, unknown>) {
  await ensureBillingGraceSchema();
  return runInTransaction(async (client) => {
    const empresaId = requireUuid(payload.empresa_id, "empresa_id");
    const planId = requireUuid(payload.plan_id, "plan_id");
    const billingCycle = requireString(payload.billing_cycle ?? payload.periodo, "billing_cycle");
    const fechaInicio = requireDate(payload.fecha_inicio, "fecha_inicio");
    const modoRenovacion = requireString(payload.modo_renovacion ?? "MANUAL", "modo_renovacion");
    const generarFactura = parseBooleanLike(payload.generar_factura, false);
    const discount = parseDiscountInput({
      typeRaw: payload.descuento_tipo,
      valueRaw: payload.descuento_valor,
      reasonRaw: payload.descuento_motivo,
      typeField: "descuento_tipo",
      valueField: "descuento_valor",
      reasonField: "descuento_motivo",
    });
    if (!generarFactura && discount) {
      throw new AppError(400, "VALIDATION_ERROR", "descuento_* solo se permite cuando generar_factura = true");
    }

    const exists = await one<{ id: string }>(
      client,
      "SELECT id FROM billing.suscripciones WHERE empresa_id = $1 AND estado = 'ACTIVA'::billing.estado_suscripcion LIMIT 1",
      [empresaId],
    );
    if (exists) throw new AppError(409, "CONFLICT", "La empresa ya tiene una suscripcion activa");

    const charge = await resolveSubscriptionCharge(client, planId, billingCycle, fechaInicio);
    const fin = addMonths(fechaInicio, PERIOD_MONTHS[billingCycle] ?? 1);

    const suscripcion = await one<{ id: string }>(
      client,
      `INSERT INTO billing.suscripciones
        (empresa_id, plan_id, precio_plan_id, estado, billing_cycle, periodo, modo_renovacion, fecha_inicio, periodo_actual_inicio, periodo_actual_fin)
       VALUES ($1, $2, $3, 'ACTIVA', $4::billing.periodo_precio, $4::billing.periodo_precio, $5::billing.modo_renovacion, $6, $6, $7)
       RETURNING id`,
      [empresaId, planId, charge.priceId, billingCycle, modoRenovacion, fechaInicio, fin],
    );

    await client.query(
      `INSERT INTO billing.items_suscripcion
        (suscripcion_id, producto_id, cantidad, fecha_inicio, fecha_fin, origen, estado)
       SELECT $1, ip.producto_id, COALESCE(ip.cantidad,1), $2::date, $3::date,
              'PLAN'::billing.origen_item_suscripcion, 'ACTIVO'::billing.estado_item_suscripcion
       FROM billing.items_plan ip
       WHERE ip.plan_id = $4 AND ip.incluido = true`,
      [suscripcion!.id, fechaInicio, fin, planId],
    );
    await syncPlanEntitlementsToSubscription(client, {
      suscripcionId: suscripcion!.id,
      planId,
      effectiveFrom: fechaInicio,
    });

    const items = Array.isArray(payload.items_suscripcion) ? payload.items_suscripcion : [];
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const productoId = requireUuid(item.producto_id, "items_suscripcion[].producto_id");
      const precioId = item.precio_id ? requireUuid(item.precio_id, "items_suscripcion[].precio_id") : null;
      const fechaInicioItem = requireDate(item.fecha_inicio ?? fechaInicio, "items_suscripcion[].fecha_inicio");

      const product = await one<{ es_consumible: boolean }>(
        client,
        "SELECT es_consumible FROM billing.productos WHERE id = $1",
        [productoId],
      );
      if (!product) throw new AppError(404, "NOT_FOUND", "Producto del item no existe");
      if (product.es_consumible && !precioId) {
        throw new AppError(400, "BUSINESS_RULE_VIOLATION", "items_suscripcion[].precio_id es obligatorio para consumibles");
      }
      if (precioId) {
        const price = await one<{ producto_id: string; activo: boolean; valido_desde: string | null; valido_hasta: string | null }>(
          client,
          "SELECT producto_id::text, activo, valido_desde::text, valido_hasta::text FROM billing.precios WHERE id = $1",
          [precioId],
        );
        if (!price) throw new AppError(400, "BUSINESS_RULE_VIOLATION", "Precio de item no existe");
        if (price.producto_id !== productoId) {
          throw new AppError(400, "BUSINESS_RULE_VIOLATION", "El precio no pertenece al producto del item");
        }
        if (!price.activo) {
          throw new AppError(400, "BUSINESS_RULE_VIOLATION", "El precio del item esta inactivo");
        }
        if ((price.valido_desde && price.valido_desde > fechaInicioItem) || (price.valido_hasta && price.valido_hasta < fechaInicioItem)) {
          throw new AppError(400, "BUSINESS_RULE_VIOLATION", "El precio no esta vigente para la fecha de inicio del item");
        }
      }

      await client.query(
        `INSERT INTO billing.items_suscripcion
          (suscripcion_id, producto_id, precio_id, cantidad, fecha_inicio, fecha_fin, fecha_efectiva_inicio, fecha_efectiva_fin, origen, estado)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, 'ADDON'::billing.origen_item_suscripcion, 'ACTIVO'::billing.estado_item_suscripcion)`,
        [
          suscripcion!.id,
          productoId,
          precioId,
          Number(requireNumberLike(item.cantidad ?? 1, "items_suscripcion[].cantidad")),
          fechaInicioItem,
          item.fecha_fin ? requireDate(item.fecha_fin, "items_suscripcion[].fecha_fin") : null,
          item.fecha_efectiva_inicio ? requireDate(item.fecha_efectiva_inicio, "items_suscripcion[].fecha_efectiva_inicio") : null,
          item.fecha_efectiva_fin ? requireDate(item.fecha_efectiva_fin, "items_suscripcion[].fecha_efectiva_fin") : null,
        ],
      );
    }

    let facturaId: string | null = null;
    if (generarFactura) {
      const totals = computeInvoiceDiscountTotals(charge.amount, discount);
      const factura = await one<{ id: string }>(
        client,
        `INSERT INTO billing.facturas
          (empresa_id, suscripcion_id, fecha_emision, subtotal, descuento_tipo, descuento_valor, descuento_monto, descuento_motivo, total, estado, metodo_pago, notas)
         VALUES ($1, $2, $3, $4::numeric, $5::billing.tipo_descuento, $6::numeric, $7::numeric, $8, $9::numeric, 'EMITIDA', 'MANUAL', 'Generada desde alta de suscripcion')
         RETURNING id`,
        [
          empresaId,
          suscripcion!.id,
          fechaInicio,
          totals.subtotal,
          totals.discount_type,
          totals.discount_value,
          totals.discount_amount,
          totals.discount_reason,
          totals.total,
        ],
      );
      facturaId = factura!.id;

      await client.query(
        `INSERT INTO billing.items_factura
          (factura_id, descripcion, cantidad, precio_unitario, total, periodo_desde, periodo_hasta)
         VALUES ($1, $2, 1, $3::numeric, $3::numeric, $4, $5)`,
        [factura!.id, "Cargo plan suscripcion", charge.amount, fechaInicio, fin],
      );
    }

    return { suscripcion_id: suscripcion!.id, factura_id: facturaId };
  });
}

export async function addSubscriptionItemWithOptionalInvoice(payload: Record<string, unknown>) {
  await ensureBillingGraceSchema();
  return runInTransaction(async (client) => {
    const suscripcionId = requireUuid(payload.suscripcion_id, "suscripcion_id");
    const productoId = requireUuid(payload.producto_id, "producto_id");
    const cantidad = Number(requireNumberLike(payload.cantidad ?? 1, "cantidad"));
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new AppError(400, "VALIDATION_ERROR", "cantidad must be greater than 0");
    }

    const fechaInicio = requireDate(payload.fecha_inicio, "fecha_inicio");
    const fechaFin = payload.fecha_fin ? requireDate(payload.fecha_fin, "fecha_fin") : null;
    const fechaEfectivaInicio = payload.fecha_efectiva_inicio ? requireDate(payload.fecha_efectiva_inicio, "fecha_efectiva_inicio") : null;
    const fechaEfectivaFin = payload.fecha_efectiva_fin ? requireDate(payload.fecha_efectiva_fin, "fecha_efectiva_fin") : null;
    const precioId = payload.precio_id ? requireUuid(payload.precio_id, "precio_id") : null;
    const generarFactura = parseBooleanLike(payload.generar_factura, false);
    const discount = parseDiscountInput({
      typeRaw: payload.descuento_tipo,
      valueRaw: payload.descuento_valor,
      reasonRaw: payload.descuento_motivo,
      typeField: "descuento_tipo",
      valueField: "descuento_valor",
      reasonField: "descuento_motivo",
    });
    if (!generarFactura && discount) {
      throw new AppError(400, "VALIDATION_ERROR", "descuento_* solo se permite cuando generar_factura = true");
    }

    const subscription = await one<{ id: string; empresa_id: string }>(
      client,
      "SELECT id::text, empresa_id::text FROM billing.suscripciones WHERE id = $1 LIMIT 1",
      [suscripcionId],
    );
    if (!subscription) throw new AppError(404, "NOT_FOUND", "Suscripcion no existe");

    const product = await one<{ id: string; nombre: string; es_consumible: boolean }>(
      client,
      "SELECT id::text, nombre, es_consumible FROM billing.productos WHERE id = $1 LIMIT 1",
      [productoId],
    );
    if (!product) throw new AppError(404, "NOT_FOUND", "Producto no existe");

    if (product.es_consumible && !precioId) {
      throw new AppError(400, "BUSINESS_RULE_VIOLATION", "precio_id es obligatorio para productos consumibles");
    }

    let precioValor = 0;
    if (precioId) {
      const price = await one<{ producto_id: string; activo: boolean; valido_desde: string | null; valido_hasta: string | null; valor: string }>(
        client,
        "SELECT producto_id::text, activo, valido_desde::text, valido_hasta::text, valor::text FROM billing.precios WHERE id = $1 LIMIT 1",
        [precioId],
      );
      if (!price) throw new AppError(400, "BUSINESS_RULE_VIOLATION", "Precio no existe");
      if (price.producto_id !== productoId) {
        throw new AppError(400, "BUSINESS_RULE_VIOLATION", "El precio no pertenece al producto");
      }
      if (!price.activo) {
        throw new AppError(400, "BUSINESS_RULE_VIOLATION", "El precio esta inactivo");
      }
      if ((price.valido_desde && price.valido_desde > fechaInicio) || (price.valido_hasta && price.valido_hasta < fechaInicio)) {
        throw new AppError(400, "BUSINESS_RULE_VIOLATION", "El precio no esta vigente para la fecha seleccionada");
      }
      precioValor = Number(price.valor);
    }

    if (generarFactura && !precioId) {
      throw new AppError(400, "BUSINESS_RULE_VIOLATION", "Para facturar automaticamente debes seleccionar un precio");
    }

    const createdItem = await one<{ id: string }>(
      client,
      `INSERT INTO billing.items_suscripcion
        (suscripcion_id, producto_id, precio_id, cantidad, fecha_inicio, fecha_fin, fecha_efectiva_inicio, fecha_efectiva_fin, origen, estado)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, 'ADDON'::billing.origen_item_suscripcion, 'ACTIVO'::billing.estado_item_suscripcion)
       RETURNING id`,
      [
        suscripcionId,
        productoId,
        precioId,
        cantidad,
        fechaInicio,
        fechaFin,
        fechaEfectivaInicio,
        fechaEfectivaFin,
      ],
    );

    const totalCalculado = Number((precioValor * cantidad).toFixed(2));
    let facturaId: string | null = null;
    if (generarFactura) {
      const totals = computeInvoiceDiscountTotals(totalCalculado, discount);
      const factura = await one<{ id: string }>(
        client,
        `INSERT INTO billing.facturas
          (empresa_id, suscripcion_id, fecha_emision, subtotal, descuento_tipo, descuento_valor, descuento_monto, descuento_motivo, total, estado, metodo_pago, notas)
         VALUES ($1, $2, $3, $4::numeric, $5::billing.tipo_descuento, $6::numeric, $7::numeric, $8, $9::numeric, 'EMITIDA', 'MANUAL', 'Generada desde agregar item a suscripcion')
         RETURNING id`,
        [
          subscription.empresa_id,
          suscripcionId,
          fechaInicio,
          totals.subtotal,
          totals.discount_type,
          totals.discount_value,
          totals.discount_amount,
          totals.discount_reason,
          totals.total,
        ],
      );
      facturaId = factura!.id;

      await client.query(
        `INSERT INTO billing.items_factura
          (factura_id, producto_id, precio_id, descripcion, cantidad, precio_unitario, total, periodo_desde, periodo_hasta)
         VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8, $9)`,
        [
          facturaId,
          productoId,
          precioId,
          `Item manual: ${product.nombre}`,
          cantidad,
          precioValor,
          totalCalculado,
          fechaInicio,
          fechaFin,
        ],
      );
    }

    return {
      item_suscripcion_id: createdItem!.id,
      factura_id: facturaId,
      precio_unitario: precioValor,
      cantidad,
      total_calculado: totalCalculado,
    };
  });
}



