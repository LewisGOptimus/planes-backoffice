# Reglas Actuales de Renovacion

Este documento resume las reglas que hoy aplica el sistema cuando se ejecuta una renovacion desde `Operaciones` (`renew_subscription`).

## 1) Entrada requerida

Campos minimos:

- `suscripcion_id` (UUID)
- `billing_date` (fecha de renovacion, formato `YYYY-MM-DD`)

Campos opcionales:

- `generate_invoice` (default: `true`)
- `discount_type` (`PERCENT` o `FIXED`)
- `discount_value` (numerico)
- `discount_reason` (texto libre)

## 2) Reglas de negocio de renovacion

1. La suscripcion debe existir.
2. Se toma el precio vigente del plan para la fecha de renovacion.
3. Se actualiza la suscripcion:
   - `precio_plan_id` con el precio vigente
   - `periodo_actual_inicio = billing_date`
   - `periodo_actual_fin = billing_date + meses del periodo`
   - `estado = ACTIVA`
4. Se resincronizan entitlements de plan para la nueva vigencia.

## 3) Factura en renovacion

### Si `generate_invoice = true` (por defecto)

1. Se genera factura `EMITIDA`.
2. Se persisten campos de descuento a nivel factura:
   - `subtotal`
   - `descuento_tipo`
   - `descuento_valor`
   - `descuento_monto`
   - `descuento_motivo`
   - `total` (neto)
3. Se crea `item_factura` con la linea de renovacion.

### Si `generate_invoice = false`

1. No se crea factura.
2. Si llega descuento, se rechaza con error de validacion.

## 4) Reglas de descuento

1. `discount_type` y `discount_value` deben venir juntos.
2. `discount_type` permitido: `PERCENT` o `FIXED`.
3. `PERCENT` debe estar entre `0` y `100`.
4. `FIXED` debe ser `>= 0`.
5. El descuento aplicado se limita al subtotal (cap).
6. `total = subtotal - descuento_monto`.
7. Se redondea a 2 decimales (monto aplicado y total neto).

## 5) Reglas de persistencia en `billing.facturas`

Checks vigentes:

1. `subtotal >= 0`
2. `descuento_monto >= 0`
3. `total >= 0`
4. `descuento_monto <= subtotal`
5. `descuento_tipo` y `descuento_valor` deben ir ambos nulos o ambos informados

## 6) Nota tecnica relevante

En renovacion, el `item_factura` **no** debe guardar `precio_id` de `precios_planes`, porque `items_factura.precio_id` referencia `billing.precios` (precios de producto), no `billing.precios_planes`.
