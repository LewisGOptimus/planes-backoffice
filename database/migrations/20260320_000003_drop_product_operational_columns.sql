ALTER TABLE billing.productos
  DROP COLUMN IF EXISTS unidad_consumo,
  DROP COLUMN IF EXISTS descripcion_operativa;
