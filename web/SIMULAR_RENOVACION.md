# Simular Renovacion de Suscripcion (Paso a Paso)

Este documento describe un flujo completo para simular una renovacion en el proyecto, desde la creacion de datos base hasta la renovacion de una suscripcion existente.

## 1. Levantar entorno

1. Inicia la base de datos (desde la raiz del repo):
```bash
docker compose up -d
```
2. Inicia la app web:
```bash
cd web
npm install
npm run dev
```
3. Abre `http://localhost:3000`.

## 2. Cargar datos base

Necesitas productos, planes, precios y moneda para que la renovacion funcione.

1. Ve a `Backoffice` (`/backoffice`), o llama:
   - `POST /api/backoffice/bootstrap`
2. Verifica que existan:
   - Al menos un plan activo
   - Al menos un precio vigente para ese plan en el periodo que usaras (MENSUAL/TRIMESTRAL/ANUAL)

## 3. Crear usuario (owner)

1. Ve a `Usuarios` (`/usuarios`).
2. Crea un usuario con:
   - `email`
   - `nombre`
3. Guarda el registro.

## 4. Crear empresa

1. Ve a `Empresas` (`/empresas`).
2. Crea una empresa con:
   - `nombre`
   - (Opcional) `nit`
3. Guarda el registro.

## 5. Crear suscripcion inicial

1. Ve a `Suscripciones` (`/suscripciones`).
2. Clic en `Nueva suscripcion`.
3. Completa:
   - `Empresa`
   - `Plan`
   - `Ciclo de cobro` (ej. `ANUAL`)
   - `Modo renovacion` (ej. `MANUAL`)
   - `Fecha inicio`
4. Opcional:
   - `Generar factura = Si`
   - Aplica descuento si quieres probar facturacion inicial:
     - `Tipo descuento`: `PERCENT` o `FIXED`
     - `Valor descuento`
     - `Motivo`
5. Clic en `Guardar`.
6. Confirma que la suscripcion quede en estado `ACTIVA`.

## 6. Preparar escenario de renovacion

Para ver efecto real de renovacion con precio nuevo:

1. Ve a `Precios` (`/precios`) o usa accion de actualizacion de precios.
2. Crea/activa un precio del plan con fecha de vigencia posterior (o distinta) para que en renovacion se seleccione ese precio vigente.

## 7. Simular renovacion (UI operativa)

1. Ve a `Operaciones` (`/operaciones`).
2. En `Accion`, selecciona `Renovar suscripcion`.
3. Completa:
   - `Suscripcion`
   - `Fecha de renovacion`
   - `Generar factura`:
     - `Si` (default): permite descuento y crea factura
     - `No`: no crea factura y no permite descuento
4. Si `Generar factura = Si`, opcionalmente define:
   - `Tipo descuento` (`PERCENT`/`FIXED`)
   - `Valor descuento`
   - `Motivo descuento`
5. Clic en `1) Preview`.
   - Verifica `Subtotal`, `Descuento` y `Total`.
6. Clic en `2) Confirmar`.

## 8. Verificar resultados

### Suscripcion

1. Ve a `Suscripciones` (`/suscripciones`).
2. Confirma que:
   - `periodo_actual_inicio` cambie a la fecha de renovacion
   - `periodo_actual_fin` avance segun el ciclo
   - `precio_plan_id` se actualice al precio vigente

### Factura (si `Generar factura = Si`)

1. Ve a `Facturas` (`/facturas`).
2. Revisa la nueva factura de la suscripcion renovada:
   - `subtotal`
   - `descuento_tipo`
   - `descuento_valor`
   - `descuento_monto`
   - `descuento_motivo`
   - `total` (neto)

## 9. Casos recomendados para probar

1. Renovar con factura y descuento porcentual (`PERCENT`, ejemplo `10`).
2. Renovar con factura y descuento fijo (`FIXED`, ejemplo `50000`).
3. Renovar con descuento mayor al subtotal (debe topearse y quedar `total = 0`).
4. Renovar sin factura (`Generar factura = No`) y sin descuento.
5. Intentar renovar sin factura pero con descuento (debe fallar validacion).

## 10. Troubleshooting rapido

1. Error `No active plan price found` o similar:
   - Falta precio vigente para el plan/periodo en la fecha de renovacion.
2. No aparece la suscripcion en selector:
   - Revisa que exista en `Suscripciones` y que lookups esten cargados.
3. Error de descuento:
   - Verifica que `Tipo` y `Valor` vayan juntos.
   - `%` debe estar entre `0` y `100`.
   - Monto fijo debe ser `>= 0`.
