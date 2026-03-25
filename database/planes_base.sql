/* ============================================================
   BILLING BASE - MODELO SIMPLE
   Depende de schemas common y core
   ============================================================ */

SET TIME ZONE 'UTC';
CREATE SCHEMA IF NOT EXISTS billing;

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
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'metodo_pago' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.metodo_pago AS ENUM ('MANUAL', 'PASARELA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'modo_precio_plan' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.modo_precio_plan AS ENUM ('BUNDLE', 'SUM_COMPONENTS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'product_visibility' AND n.nspname = 'billing') THEN
    CREATE TYPE billing.product_visibility AS ENUM ('PUBLIC', 'PRIVATE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS billing.productos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  tipo billing.tipo_producto NOT NULL,
  alcance billing.alcance_producto NOT NULL,
  es_consumible BOOLEAN NOT NULL DEFAULT FALSE,
  visibility billing.product_visibility NOT NULL DEFAULT 'PRIVATE',
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing.items_plan (
  plan_id UUID NOT NULL REFERENCES billing.planes(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES billing.productos(id) ON DELETE RESTRICT,
  incluido BOOLEAN NOT NULL DEFAULT TRUE,
  cantidad INTEGER,
  PRIMARY KEY (plan_id, producto_id)
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
  grace_until DATE,
  grace_reason TEXT,
  blocked_at TIMESTAMPTZ,
  block_reason TEXT,
  operational_status billing.estado_operativo_suscripcion NOT NULL DEFAULT 'EN_SERVICIO',
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE billing.suscripciones
  ALTER COLUMN precio_plan_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS billing.items_suscripcion (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  suscripcion_id UUID NOT NULL REFERENCES billing.suscripciones(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES billing.productos(id) ON DELETE RESTRICT,
  precio_id UUID REFERENCES billing.precios(id) ON DELETE RESTRICT,
  cantidad INTEGER NOT NULL DEFAULT 1,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  fecha_efectiva_inicio DATE,
  fecha_efectiva_fin DATE,
  origen billing.origen_item_suscripcion NOT NULL DEFAULT 'PLAN',
  estado billing.estado_item_suscripcion NOT NULL DEFAULT 'ACTIVO',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

