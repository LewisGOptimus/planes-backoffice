import { fromUnknownError, success } from "@/lib/api/response";
import { AppError } from "@/lib/api/types";
import { runInTransaction } from "@/lib/sql/transactions";

async function upsertMoneda() {
  return runInTransaction(async (client) => {
    await client.query(
      `INSERT INTO common.monedas (codigo, nombre, simbolo, decimales)
       VALUES ('COP', 'Peso Colombiano', '$', 2)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre
      `,
    );
    await client.query(
      `INSERT INTO common.monedas (codigo, nombre, simbolo, decimales)
       VALUES ('USD', 'US Dollar', '$', 2)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre
      `,
    );
    const moneda = await client.query<{ id: string; codigo: string }>("SELECT id, codigo FROM common.monedas");
    return moneda.rows;
  });
}

export async function POST(request: Request) {
  try {
    if (process.env.NODE_ENV === "production") {
      throw new AppError(403, "UNAUTHORIZED", "Seed endpoint disabled in production");
    }

    const required = process.env.DEV_SEED_KEY;
    const provided = request.headers.get("x-dev-seed-key");
    if (!required || provided !== required) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid or missing x-dev-seed-key");
    }

    const monedas = await upsertMoneda();
    const cop = monedas.find((m) => m.codigo === "COP");
    if (!cop) throw new AppError(500, "INTERNAL_ERROR", "COP currency not available");

    const seeded = await runInTransaction(async (client) => {
      await client.query("ALTER TABLE billing.productos ADD COLUMN IF NOT EXISTS unidad_consumo TEXT");
      await client.query("ALTER TABLE billing.productos ADD COLUMN IF NOT EXISTS descripcion_operativa TEXT");

      const productoRows = [
        { codigo: "CONTABILIDAD", nombre: "Contabilidad", tipo: "MODULO", alcance: "EMPRESA", es_consumible: false, unidad_consumo: null, descripcion_operativa: null },
        { codigo: "NOMINA", nombre: "Nomina", tipo: "MODULO", alcance: "EMPRESA", es_consumible: false, unidad_consumo: null, descripcion_operativa: null },
        {
          codigo: "DOCS-ELECTRONICOS",
          nombre: "Documentos Electronicos",
          tipo: "CONSUMIBLE",
          alcance: "EMPRESA",
          es_consumible: true,
          unidad_consumo: "DOCUMENTO",
          descripcion_operativa: "Pool de creditos consumibles para emision de documentos electronicos",
        },
        { codigo: "SOPORTE-ANUAL", nombre: "Soporte Anual", tipo: "SERVICIO", alcance: "EMPRESA", es_consumible: false, unidad_consumo: null, descripcion_operativa: null },
        { codigo: "CERTIFICADO-DIGITAL", nombre: "Certificado Digital", tipo: "SERVICIO", alcance: "EMPRESA", es_consumible: false, unidad_consumo: null, descripcion_operativa: null },
      ];

      for (const p of productoRows) {
        await client.query(
          `INSERT INTO billing.productos (codigo, nombre, tipo, alcance, es_consumible, unidad_consumo, descripcion_operativa, activo)
           VALUES ($1, $2, $3::billing.tipo_producto, $4::billing.alcance_producto, $5, $6, $7, true)
           ON CONFLICT (codigo) DO UPDATE SET
             nombre = EXCLUDED.nombre,
             tipo = EXCLUDED.tipo,
             alcance = EXCLUDED.alcance,
             es_consumible = EXCLUDED.es_consumible,
             unidad_consumo = EXCLUDED.unidad_consumo,
             descripcion_operativa = EXCLUDED.descripcion_operativa`,
          [p.codigo, p.nombre, p.tipo, p.alcance, p.es_consumible, p.unidad_consumo, p.descripcion_operativa],
        );
      }

      const plans = [
        { codigo: "PLAN-MENSUAL-BASE", nombre: "Plan Mensual Base", periodo: "MENSUAL", valor: "180000" },
        { codigo: "PLAN-ANUAL-BASE", nombre: "Plan Anual Base", periodo: "ANUAL", valor: "1800000" },
      ];

      for (const plan of plans) {
        await client.query(
          `INSERT INTO billing.planes (codigo, nombre, periodo, activo)
           VALUES ($1, $2, $3::billing.periodo_precio, true)
           ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, periodo = EXCLUDED.periodo`,
          [plan.codigo, plan.nombre, plan.periodo],
        );
      }

      const planData = await client.query<{ id: string; codigo: string; periodo: string }>("SELECT id, codigo, periodo::text FROM billing.planes");
      for (const plan of planData.rows) {
        const value = plan.codigo === "PLAN-MENSUAL-BASE" ? "180000" : "1800000";
        await client.query(
          `INSERT INTO billing.precios_planes (plan_id, moneda_id, periodo, valor, activo, valido_desde)
           SELECT $1, $2, $3::billing.periodo_precio, $4::numeric, true, CURRENT_DATE
           WHERE NOT EXISTS (
             SELECT 1 FROM billing.precios_planes pp
             WHERE pp.plan_id = $1 AND pp.moneda_id = $2 AND pp.periodo = $3::billing.periodo_precio
               AND pp.valor = $4::numeric AND pp.activo = true
           )`,
          [plan.id, cop.id, plan.periodo, value],
        );
      }

      const products = await client.query<{ id: string; codigo: string }>("SELECT id, codigo FROM billing.productos");
      const anual = planData.rows.find((p) => p.codigo === "PLAN-ANUAL-BASE");
      const mensual = planData.rows.find((p) => p.codigo === "PLAN-MENSUAL-BASE");
      const contab = products.rows.find((p) => p.codigo === "CONTABILIDAD");
      const nomina = products.rows.find((p) => p.codigo === "NOMINA");

      if (anual && mensual && contab && nomina) {
        for (const planId of [anual.id, mensual.id]) {
          for (const productId of [contab.id, nomina.id]) {
            await client.query(
              `INSERT INTO billing.items_plan (plan_id, producto_id, incluido, cantidad)
               VALUES ($1, $2, true, null)
               ON CONFLICT (plan_id, producto_id) DO NOTHING`,
              [planId, productId],
            );
          }
        }
      }

      await client.query(
        `INSERT INTO billing.entitlements (codigo, nombre, tipo, alcance, descripcion)
         VALUES
          ('LIMITE-EMPLEADOS', 'Limite de Empleados', 'LIMITE', 'EMPRESA', 'Cantidad de empleados permitidos'),
          ('LIMITE-EMPRESAS', 'Limite de Empresas', 'LIMITE', 'USUARIO', 'Cantidad de empresas permitidas')
         ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre`,
      );

      const ent = await client.query<{ id: string; codigo: string }>("SELECT id, codigo FROM billing.entitlements");
      const emp = ent.rows.find((x) => x.codigo === "LIMITE-EMPLEADOS");
      const empresas = ent.rows.find((x) => x.codigo === "LIMITE-EMPRESAS");

      if (anual && mensual && emp && empresas) {
        await client.query(
          "INSERT INTO billing.entitlements_plan (plan_id, entitlement_id, valor_entero, valor_booleano) VALUES ($1, $2, 10, NULL) ON CONFLICT (plan_id, entitlement_id) DO UPDATE SET valor_entero = 10",
          [mensual.id, emp.id],
        );
        await client.query(
          "INSERT INTO billing.entitlements_plan (plan_id, entitlement_id, valor_entero, valor_booleano) VALUES ($1, $2, 20, NULL) ON CONFLICT (plan_id, entitlement_id) DO UPDATE SET valor_entero = 20",
          [anual.id, emp.id],
        );
        await client.query(
          "INSERT INTO billing.entitlements_plan (plan_id, entitlement_id, valor_entero, valor_booleano) VALUES ($1, $2, 1, NULL) ON CONFLICT (plan_id, entitlement_id) DO UPDATE SET valor_entero = 1",
          [mensual.id, empresas.id],
        );
      }

      return {
        productos: productoRows.length,
        planes: plans.length,
        moneda: "COP",
      };
    });

    return success({ seeded: true, ...seeded });
  } catch (error) {
    return fromUnknownError(error);
  }
}
