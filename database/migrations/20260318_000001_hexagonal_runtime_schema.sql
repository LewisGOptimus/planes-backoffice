-- 2026-03-18 Hexagonal baseline migrations
-- This migration replaces runtime DDL from API routes.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE core.empresas ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE core.empresas ADD COLUMN IF NOT EXISTS departamento TEXT;
ALTER TABLE core.empresas ADD COLUMN IF NOT EXISTS ciudad TEXT;
ALTER TABLE core.empresas ADD COLUMN IF NOT EXISTS direccion TEXT;

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

ALTER TABLE billing.suscripciones ADD COLUMN IF NOT EXISTS grace_until DATE;
ALTER TABLE billing.suscripciones ADD COLUMN IF NOT EXISTS grace_days_granted INT NOT NULL DEFAULT 0;
ALTER TABLE billing.suscripciones DROP COLUMN IF EXISTS grace_reason;
ALTER TABLE billing.suscripciones DROP COLUMN IF EXISTS blocked_at;
ALTER TABLE billing.suscripciones DROP COLUMN IF EXISTS block_reason;
ALTER TABLE billing.suscripciones ADD COLUMN IF NOT EXISTS operational_status billing.estado_operativo_suscripcion NOT NULL DEFAULT 'EN_SERVICIO';
ALTER TABLE billing.suscripciones ADD COLUMN IF NOT EXISTS billing_cycle billing.periodo_precio;
UPDATE billing.suscripciones SET billing_cycle = periodo WHERE billing_cycle IS NULL;
ALTER TABLE billing.suscripciones ALTER COLUMN billing_cycle SET NOT NULL;
ALTER TABLE billing.suscripciones ALTER COLUMN precio_plan_id DROP NOT NULL;

ALTER TABLE billing.planes ADD COLUMN IF NOT EXISTS pricing_mode billing.modo_precio_plan NOT NULL DEFAULT 'BUNDLE';

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

ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS subtotal NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS descuento_tipo billing.tipo_descuento;
ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS descuento_valor NUMERIC(18,4);
ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS descuento_monto NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE billing.facturas ADD COLUMN IF NOT EXISTS descuento_motivo TEXT;
UPDATE billing.facturas SET subtotal = total WHERE subtotal = 0 AND total > 0;
UPDATE billing.facturas SET descuento_monto = 0 WHERE descuento_monto IS NULL;

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

CREATE TABLE IF NOT EXISTS billing.contratos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id UUID REFERENCES core.empresas(id) ON DELETE SET NULL,
  plan_id UUID REFERENCES billing.planes(id) ON DELETE SET NULL,
  billing_cycle billing.periodo_precio,
  tipo_contrato TEXT CHECK (tipo_contrato IN ('mensual', 'anual')),
  nombre_cliente_empresa TEXT NOT NULL,
  nit VARCHAR(30) NOT NULL,
  nit_indicativo VARCHAR(10),
  plan_nombre TEXT NOT NULL,
  precio NUMERIC(18,2) NOT NULL CHECK (precio >= 0),
  fecha_contrato DATE NOT NULL,
  fecha_primer_pago DATE NOT NULL,
  adicionales TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  representante_nombre TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    billing_cycle IS NULL
    OR billing_cycle IN ('MENSUAL'::billing.periodo_precio, 'ANUAL'::billing.periodo_precio)
  )
);

CREATE INDEX IF NOT EXISTS idx_contratos_empresa ON billing.contratos (empresa_id);
CREATE INDEX IF NOT EXISTS idx_contratos_plan ON billing.contratos (plan_id);
CREATE INDEX IF NOT EXISTS idx_contratos_activo ON billing.contratos (activo);
CREATE INDEX IF NOT EXISTS idx_contratos_created_at ON billing.contratos (created_at DESC);
