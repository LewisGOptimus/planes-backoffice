import { PoolClient } from "pg";
import { AppError } from "@/lib/api/types";
import { query } from "@/lib/db";

export const PRODUCT_VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;

type ProductVisibility = (typeof PRODUCT_VISIBILITIES)[number];

type Queryable = {
  query: typeof query;
};

type BackofficeProductRow = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  tipo: string;
  alcance: string;
  es_consumible: boolean;
  activo: boolean;
  visibility: ProductVisibility;
};

type PublicProductRow = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  tipo: string;
  alcance: string;
  es_consumible: boolean;
};

type ProductPriceRow = {
  id: string;
  producto_id: string;
  periodo: string;
  moneda_id: string;
  moneda_codigo: string;
  valor: string;
  permite_prorrateo: boolean;
  valido_desde: string | null;
  valido_hasta: string | null;
};

type PublicProduct = PublicProductRow & {
  prices: Array<{
    id: string;
    periodo: string;
    moneda_id: string;
    moneda_codigo: string;
    valor: number;
    permite_prorrateo: boolean;
    valido_desde: string | null;
    valido_hasta: string | null;
  }>;
};

function getRunner(client?: PoolClient): Queryable {
  return client ?? { query };
}

function asEnumValue<T extends readonly string[]>(raw: string | null, allowed: T, field: string): T[number] | null {
  if (!raw) return null;
  if ((allowed as readonly string[]).includes(raw)) {
    return raw as T[number];
  }
  throw new AppError(400, "VALIDATION_ERROR", `${field} is invalid`);
}

function parseBooleanFilter(raw: string | null, field: string): boolean | null {
  if (raw === null || raw === "") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new AppError(400, "VALIDATION_ERROR", `${field} must be true or false`);
}

function parseIsoDate(raw: string | null, field: string): string | null {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} must use YYYY-MM-DD`);
  }
  return raw;
}

function mapPublicProducts(products: PublicProductRow[], prices: ProductPriceRow[]): PublicProduct[] {
  const pricesByProduct = new Map<string, PublicProduct["prices"]>();

  for (const price of prices) {
    const current = pricesByProduct.get(price.producto_id) ?? [];
    current.push({
      id: price.id,
      periodo: price.periodo,
      moneda_id: price.moneda_id,
      moneda_codigo: price.moneda_codigo,
      valor: Number(price.valor),
      permite_prorrateo: price.permite_prorrateo,
      valido_desde: price.valido_desde,
      valido_hasta: price.valido_hasta,
    });
    pricesByProduct.set(price.producto_id, current);
  }

  return products.map((product) => ({
    ...product,
    prices: pricesByProduct.get(product.id) ?? [],
  }));
}

export async function ensureProductCatalogSchema(client?: PoolClient) {
  const runner = getRunner(client);

  await runner.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'product_visibility'
          AND n.nspname = 'billing'
      ) THEN
        CREATE TYPE billing.product_visibility AS ENUM ('PUBLIC', 'PRIVATE');
      END IF;
    END $$;
  `);

  await runner.query(
    "ALTER TABLE billing.productos ADD COLUMN IF NOT EXISTS visibility billing.product_visibility NOT NULL DEFAULT 'PRIVATE'",
  );
}

export async function listBackofficeProducts(searchParams: URLSearchParams) {
  await ensureProductCatalogSchema();

  const values: unknown[] = [];
  const filters: string[] = [];

  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const visibility = asEnumValue(searchParams.get("visibility"), PRODUCT_VISIBILITIES, "visibility");
  const tipo = (searchParams.get("tipo") ?? "").trim();
  const activo = parseBooleanFilter(searchParams.get("activo"), "activo");

  if (q) {
    values.push(`%${q}%`);
    filters.push(`(lower(p.nombre) LIKE $${values.length} OR lower(p.codigo) LIKE $${values.length})`);
  }
  if (visibility) {
    values.push(visibility);
    filters.push(`p.visibility = $${values.length}::billing.product_visibility`);
  }
  if (tipo) {
    values.push(tipo);
    filters.push(`p.tipo::text = $${values.length}`);
  }
  if (activo !== null) {
    values.push(activo);
    filters.push(`p.activo = $${values.length}`);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await query<BackofficeProductRow>(
    `SELECT
        p.id::text,
        p.codigo,
        p.nombre,
        p.descripcion,
        p.tipo::text AS tipo,
        p.alcance::text AS alcance,
        p.es_consumible,
        p.activo,
        p.visibility::text AS visibility
      FROM billing.productos p
      ${where}
      ORDER BY p.nombre, p.codigo`,
    values,
  );

  return result.rows;
}

export async function listPublicProducts(searchParams: URLSearchParams): Promise<PublicProduct[]> {
  await ensureProductCatalogSchema();

  const identifier = (searchParams.get("identifier") ?? "").trim();
  const asOf = parseIsoDate(searchParams.get("as_of"), "as_of") ?? new Date().toISOString().slice(0, 10);

  const values: unknown[] = [asOf];
  const filters = [
    "p.activo = true",
    "p.visibility = 'PUBLIC'::billing.product_visibility",
  ];

  if (identifier) {
    values.push(identifier);
    filters.push(`(p.id::text = $${values.length} OR p.codigo = $${values.length})`);
  }

  const productsResult = await query<PublicProductRow>(
    `SELECT
        p.id::text,
        p.codigo,
        p.nombre,
        p.descripcion,
        p.tipo::text AS tipo,
        p.alcance::text AS alcance,
        p.es_consumible
      FROM billing.productos p
      WHERE ${filters.join(" AND ")}
      ORDER BY p.nombre, p.codigo`,
    values,
  );

  const products = productsResult.rows;
  if (products.length === 0) {
    return [];
  }

  const priceResult = await query<ProductPriceRow>(
    `SELECT
        pr.id::text,
        pr.producto_id::text,
        pr.periodo::text,
        pr.moneda_id::text,
        m.codigo AS moneda_codigo,
        pr.valor::text,
        pr.permite_prorrateo,
        pr.valido_desde::text,
        pr.valido_hasta::text
      FROM billing.precios pr
      JOIN common.monedas m ON m.id = pr.moneda_id
      WHERE pr.producto_id = ANY($1::uuid[])
        AND pr.activo = true
        AND (pr.valido_desde IS NULL OR pr.valido_desde <= $2::date)
        AND (pr.valido_hasta IS NULL OR pr.valido_hasta >= $2::date)
      ORDER BY pr.producto_id, pr.periodo, pr.valido_desde DESC NULLS LAST, pr.created_at DESC`,
    [products.map((product) => product.id), asOf],
  );

  return mapPublicProducts(products, priceResult.rows);
}

export async function getPublicProductByIdentifier(identifier: string, searchParams: URLSearchParams) {
  const params = new URLSearchParams(searchParams);
  params.set("identifier", identifier);
  const products = await listPublicProducts(params);
  const product = products[0] ?? null;
  if (!product) {
    throw new AppError(404, "NOT_FOUND", "Public product not found");
  }
  return product;
}

export function assertValidProductShape(payload: Record<string, unknown>) {
  const visibility = asEnumValue(
    typeof payload.visibility === "string" ? payload.visibility : null,
    PRODUCT_VISIBILITIES,
    "visibility",
  );
  return { visibility };
}
