/* ============================================================
   PLANES POC - MODELO SIMPLE DESDE CERO
   Esquemas: common, core, billing
   ============================================================ */

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
SET TIME ZONE 'UTC';

CREATE SCHEMA IF NOT EXISTS common;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS billing;

/* =========================
   COMMON
   ========================= */

CREATE TABLE IF NOT EXISTS common.monedas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo VARCHAR(10) NOT NULL UNIQUE,
  nombre VARCHAR(255) NOT NULL,
  simbolo VARCHAR(10),
  decimales INT NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* =========================
   CORE
   ========================= */

CREATE TABLE IF NOT EXISTS core.usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.empresas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT NOT NULL,
  nit VARCHAR(30),
  timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.usuarios_empresas (
  usuario_id UUID NOT NULL REFERENCES core.usuarios(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES core.empresas(id) ON DELETE CASCADE,
  rol TEXT NOT NULL DEFAULT 'OWNER',
  es_principal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, empresa_id),
  CONSTRAINT usuarios_empresas_rol_chk CHECK (rol IN ('OWNER', 'ADMIN', 'MEMBER'))
);

CREATE INDEX IF NOT EXISTS idx_usuarios_empresas_empresa_id
  ON core.usuarios_empresas (empresa_id);

CREATE INDEX IF NOT EXISTS idx_usuarios_empresas_usuario_id
  ON core.usuarios_empresas (usuario_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_empresas_principal_por_usuario
  ON core.usuarios_empresas (usuario_id)
  WHERE es_principal = TRUE;

/* =========================
   BILLING ENUMS
   ========================= */

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'tipo_producto' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.tipo_producto AS ENUM ('SOFTWARE', 'MODULO', 'ADDON', 'CONSUMIBLE', 'SERVICIO');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'alcance_producto' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.alcance_producto AS ENUM ('EMPRESA', 'USUARIO', 'GLOBAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'periodo_precio' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.periodo_precio AS ENUM ('MENSUAL', 'TRIMESTRAL', 'ANUAL', 'VITALICIO', 'UNICO');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'estado_suscripcion' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.estado_suscripcion AS ENUM ('ACTIVA', 'PAUSADA', 'CANCELADA', 'EXPIRADA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'estado_operativo_suscripcion' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.estado_operativo_suscripcion AS ENUM ('EN_SERVICIO', 'EN_PRORROGA', 'BLOQUEADA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'modo_renovacion' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.modo_renovacion AS ENUM ('AUTOMATICA', 'MANUAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'origen_item_suscripcion' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.origen_item_suscripcion AS ENUM ('PLAN', 'ADDON', 'LEGACY', 'MANUAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'estado_item_suscripcion' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.estado_item_suscripcion AS ENUM ('ACTIVO', 'EXPIRADO');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'tipo_entitlement' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.tipo_entitlement AS ENUM ('BOOLEANO', 'LIMITE', 'CONTADOR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'alcance_entitlement' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.alcance_entitlement AS ENUM ('EMPRESA', 'USUARIO');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'estado_factura' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.estado_factura AS ENUM ('BORRADOR', 'EMITIDA', 'PAGADA', 'ANULADA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'tipo_descuento' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.tipo_descuento AS ENUM ('PERCENT', 'FIXED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'metodo_pago' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.metodo_pago AS ENUM ('MANUAL', 'PASARELA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'modo_precio_plan' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.modo_precio_plan AS ENUM ('BUNDLE', 'SUM_COMPONENTS');
  END IF;
END $$;

/* =========================
   CATALOGO
   ========================= */

CREATE TABLE IF NOT EXISTS billing.productos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  unidad_consumo TEXT,
  descripcion_operativa TEXT,
  tipo billing.tipo_producto NOT NULL,
  alcance billing.alcance_producto NOT NULL,
  es_consumible BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing.precios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  producto_id UUID NOT NULL REFERENCES billing.productos(id) ON DELETE RESTRICT,
  periodo billing.periodo_precio NOT NULL,
  moneda_id UUID NOT NULL REFERENCES common.monedas(id) ON DELETE RESTRICT,
  valor NUMERIC(18,2) NOT NULL CHECK (valor >= 0),
  permite_prorrateo BOOLEAN NOT NULL DEFAULT TRUE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  valido_desde DATE,
  valido_hasta DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valido_hasta IS NULL OR valido_desde IS NULL OR valido_hasta >= valido_desde)
);

CREATE TABLE IF NOT EXISTS billing.planes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  pricing_mode billing.modo_precio_plan NOT NULL DEFAULT 'BUNDLE',
  periodo billing.periodo_precio NOT NULL DEFAULT 'MENSUAL',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (periodo IN ('MENSUAL','TRIMESTRAL','ANUAL'))
);

CREATE TABLE IF NOT EXISTS billing.items_plan (
  plan_id UUID NOT NULL REFERENCES billing.planes(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES billing.productos(id) ON DELETE RESTRICT,
  incluido BOOLEAN NOT NULL DEFAULT TRUE,
  cantidad INTEGER,
  PRIMARY KEY (plan_id, producto_id),
  CHECK (cantidad IS NULL OR cantidad >= 0)
);

CREATE TABLE IF NOT EXISTS billing.precios_planes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES billing.planes(id) ON DELETE CASCADE,
  moneda_id UUID NOT NULL REFERENCES common.monedas(id) ON DELETE RESTRICT,
  periodo billing.periodo_precio NOT NULL,
  valor NUMERIC(18,2) NOT NULL CHECK (valor >= 0),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  valido_desde DATE,
  valido_hasta DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valido_hasta IS NULL OR valido_desde IS NULL OR valido_hasta >= valido_desde)
);

/* =========================
   SUSCRIPCIONES
   ========================= */

CREATE TABLE IF NOT EXISTS billing.suscripciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id UUID NOT NULL REFERENCES core.empresas(id) ON DELETE RESTRICT,
  plan_id UUID NOT NULL REFERENCES billing.planes(id) ON DELETE RESTRICT,
  precio_plan_id UUID REFERENCES billing.precios_planes(id) ON DELETE RESTRICT,
  estado billing.estado_suscripcion NOT NULL DEFAULT 'ACTIVA',
  billing_cycle billing.periodo_precio NOT NULL,
  periodo billing.periodo_precio NOT NULL,
  modo_renovacion billing.modo_renovacion NOT NULL DEFAULT 'MANUAL',
  fecha_inicio DATE NOT NULL,
  periodo_actual_inicio DATE NOT NULL,
  periodo_actual_fin DATE NOT NULL,
  grace_days_granted INT NOT NULL DEFAULT 0 CHECK (grace_days_granted >= 0),
  grace_until DATE,
  operational_status billing.estado_operativo_suscripcion NOT NULL DEFAULT 'EN_SERVICIO',
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (periodo_actual_fin > periodo_actual_inicio),
  CHECK (billing_cycle = periodo),
  CHECK (billing_cycle IN ('MENSUAL','TRIMESTRAL','ANUAL'))
);

ALTER TABLE billing.suscripciones
  ALTER COLUMN precio_plan_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suscripciones_grace_block
  ON billing.suscripciones (estado, operational_status, grace_until);

CREATE TABLE IF NOT EXISTS billing.items_suscripcion (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  suscripcion_id UUID NOT NULL REFERENCES billing.suscripciones(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES billing.productos(id) ON DELETE RESTRICT,
  precio_id UUID REFERENCES billing.precios(id) ON DELETE RESTRICT,
  cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad >= 0),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  fecha_efectiva_inicio DATE,
  fecha_efectiva_fin DATE,
  origen billing.origen_item_suscripcion NOT NULL DEFAULT 'PLAN',
  estado billing.estado_item_suscripcion NOT NULL DEFAULT 'ACTIVO',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
  CHECK (fecha_efectiva_fin IS NULL OR fecha_efectiva_inicio IS NULL OR fecha_efectiva_fin >= fecha_efectiva_inicio)
);

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
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_suscripciones_plan_historial_open
  ON billing.suscripciones_plan_historial (suscripcion_id)
  WHERE vigente_hasta IS NULL;

CREATE INDEX IF NOT EXISTS idx_suscripciones_plan_historial_lookup
  ON billing.suscripciones_plan_historial (suscripcion_id, vigente_desde DESC);

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

DROP TRIGGER IF EXISTS trg_sync_suscripcion_plan_historial ON billing.suscripciones;
CREATE TRIGGER trg_sync_suscripcion_plan_historial
AFTER INSERT OR UPDATE OF plan_id, precio_plan_id, billing_cycle, periodo_actual_inicio
ON billing.suscripciones
FOR EACH ROW
EXECUTE FUNCTION billing.sync_suscripcion_plan_historial();

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
);

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
      <= LEAST(COALESCE(h.vigente_hasta, '9999-12-31'::date), COALESCE(i.fecha_efectiva_fin, i.fecha_fin, '9999-12-31'::date));

/* =========================
   ENTITLEMENTS
   ========================= */

CREATE TABLE IF NOT EXISTS billing.entitlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo billing.tipo_entitlement NOT NULL,
  alcance billing.alcance_entitlement NOT NULL,
  descripcion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing.entitlements_plan (
  plan_id UUID NOT NULL REFERENCES billing.planes(id) ON DELETE CASCADE,
  entitlement_id UUID NOT NULL REFERENCES billing.entitlements(id) ON DELETE CASCADE,
  valor_entero INTEGER,
  valor_booleano BOOLEAN,
  PRIMARY KEY (plan_id, entitlement_id)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_plan_plan_id
  ON billing.entitlements_plan (plan_id);

CREATE TABLE IF NOT EXISTS billing.entitlements_suscripcion (
  suscripcion_id UUID NOT NULL REFERENCES billing.suscripciones(id) ON DELETE CASCADE,
  entitlement_id UUID NOT NULL REFERENCES billing.entitlements(id) ON DELETE CASCADE,
  valor_entero INTEGER,
  valor_booleano BOOLEAN,
  origen billing.origen_item_suscripcion NOT NULL,
  efectivo_desde DATE NOT NULL,
  efectivo_hasta DATE,
  PRIMARY KEY (suscripcion_id, entitlement_id, efectivo_desde),
  CHECK (efectivo_hasta IS NULL OR efectivo_hasta >= efectivo_desde)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_suscripcion_sync
  ON billing.entitlements_suscripcion (suscripcion_id, entitlement_id, efectivo_hasta, origen);

CREATE TABLE IF NOT EXISTS billing.entitlements_usuario (
  usuario_id UUID NOT NULL REFERENCES core.usuarios(id) ON DELETE CASCADE,
  entitlement_id UUID NOT NULL REFERENCES billing.entitlements(id) ON DELETE CASCADE,
  valor_entero INTEGER,
  valor_booleano BOOLEAN,
  efectivo_desde DATE NOT NULL,
  efectivo_hasta DATE,
  origen billing.origen_item_suscripcion NOT NULL,
  PRIMARY KEY (usuario_id, entitlement_id, efectivo_desde),
  CHECK (efectivo_hasta IS NULL OR efectivo_hasta >= efectivo_desde)
);

/* =========================
   FACTURACION
   ========================= */

CREATE TABLE IF NOT EXISTS billing.facturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id UUID NOT NULL REFERENCES core.empresas(id) ON DELETE RESTRICT,
  suscripcion_id UUID REFERENCES billing.suscripciones(id) ON DELETE SET NULL,
  usuario_id UUID REFERENCES core.usuarios(id) ON DELETE SET NULL,
  fecha_emision DATE NOT NULL,
  fecha_vencimiento DATE,
  subtotal NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  descuento_tipo billing.tipo_descuento,
  descuento_valor NUMERIC(18,4),
  descuento_monto NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (descuento_monto >= 0),
  descuento_motivo TEXT,
  total NUMERIC(18,2) NOT NULL CHECK (total >= 0),
  estado billing.estado_factura NOT NULL,
  metodo_pago billing.metodo_pago NOT NULL DEFAULT 'MANUAL',
  referencia_externa TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fecha_vencimiento IS NULL OR fecha_vencimiento >= fecha_emision),
  CHECK (descuento_monto <= subtotal),
  CHECK (
    (descuento_tipo IS NULL AND descuento_valor IS NULL)
    OR (descuento_tipo IS NOT NULL AND descuento_valor IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS billing.items_factura (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factura_id UUID NOT NULL REFERENCES billing.facturas(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES billing.productos(id) ON DELETE RESTRICT,
  precio_id UUID REFERENCES billing.precios(id) ON DELETE RESTRICT,
  descripcion TEXT,
  cantidad INTEGER NOT NULL CHECK (cantidad >= 0),
  precio_unitario NUMERIC(18,2) NOT NULL CHECK (precio_unitario >= 0),
  total NUMERIC(18,2) NOT NULL CHECK (total >= 0),
  periodo_desde DATE,
  periodo_hasta DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (periodo_hasta IS NULL OR periodo_desde IS NULL OR periodo_hasta >= periodo_desde)
);

CREATE TABLE IF NOT EXISTS billing.prorrateos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  suscripcion_id UUID NOT NULL REFERENCES billing.suscripciones(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES billing.productos(id) ON DELETE RESTRICT,
  desde DATE NOT NULL,
  hasta DATE NOT NULL,
  valor_original NUMERIC(18,2) NOT NULL CHECK (valor_original >= 0),
  valor_prorrateado NUMERIC(18,2) NOT NULL CHECK (valor_prorrateado >= 0),
  factura_id UUID REFERENCES billing.facturas(id) ON DELETE SET NULL,
  item_factura_id UUID REFERENCES billing.items_factura(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (hasta > desde)
);

/* =========================
   OPERACION Y AUDITORIA
   ========================= */

CREATE TABLE IF NOT EXISTS billing.politicas_cobro (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL', 'PLAN', 'EMPRESA')),
  plan_id UUID REFERENCES billing.planes(id) ON DELETE CASCADE,
  empresa_id UUID REFERENCES core.empresas(id) ON DELETE CASCADE,
  grace_days INT NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
  auto_block BOOLEAN NOT NULL DEFAULT TRUE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing.cobro_eventos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  suscripcion_id UUID NOT NULL REFERENCES billing.suscripciones(id) ON DELETE CASCADE,
  factura_id UUID REFERENCES billing.facturas(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('GRACE_GRANTED','GRACE_EXTENDED','GRACE_EXPIRED','BLOCKED','UNBLOCKED')),
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cobro_eventos_suscripcion_time
  ON billing.cobro_eventos (suscripcion_id, event_time DESC);

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
);

CREATE INDEX IF NOT EXISTS idx_billing_event_log_empresa_time
  ON billing.event_log (empresa_id, event_time DESC);

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
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_alerts_open
  ON billing.alerts (alert_type, empresa_id, COALESCE(suscripcion_id, '00000000-0000-0000-0000-000000000000'::uuid), status);

CREATE INDEX IF NOT EXISTS idx_billing_alerts_status_due
  ON billing.alerts (status, due_at DESC);
