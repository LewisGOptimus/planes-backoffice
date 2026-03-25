import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/types";
import { getPublicProductByIdentifier, listBackofficeProducts, listPublicProducts } from "@/lib/services/product-catalog";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: mockQuery,
}));

function emptyResult() {
  return { rows: [], rowCount: 0 };
}

describe("product catalog service", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue(emptyResult());
  });

  it("builds backoffice filters for visibility, sell mode, and active status", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM billing.productos p")) {
        return {
          rows: [
            {
              id: "prod-1",
              codigo: "CONTABILIDAD",
              nombre: "Contabilidad",
              descripcion: null,
              tipo: "MODULO",
              alcance: "EMPRESA",
              es_consumible: false,
              visibility: "PUBLIC",
              activo: true,
            },
          ],
          rowCount: 1,
        };
      }
      return emptyResult();
    });

    const params = new URLSearchParams({
      q: "conta",
      visibility: "PUBLIC",
      activo: "true",
    });

    const rows = await listBackofficeProducts(params);
    expect(rows).toHaveLength(1);

    const productQueryCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === "string" && sql.includes("FROM billing.productos p"),
    );

    expect(productQueryCall).toBeDefined();
    expect(productQueryCall?.[0]).toContain("p.visibility = $");
    expect(productQueryCall?.[0]).toContain("p.activo = $");
    expect(productQueryCall?.[1]).toEqual(["%conta%", "PUBLIC", true]);
  });

  it("maps active public products with their valid prices", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM billing.productos p")) {
        return {
          rows: [
            {
              id: "prod-1",
              codigo: "DOCS-ELECTRONICOS",
              nombre: "Documentos Electronicos",
              descripcion: "Pool de documentos",
              tipo: "CONSUMIBLE",
              alcance: "EMPRESA",
              es_consumible: true,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM billing.precios pr")) {
        return {
          rows: [
            {
              id: "price-1",
              producto_id: "prod-1",
              periodo: "MENSUAL",
              moneda_id: "cop-id",
              moneda_codigo: "COP",
              valor: "25000",
              permite_prorrateo: false,
              valido_desde: "2026-03-01",
              valido_hasta: null,
            },
          ],
          rowCount: 1,
        };
      }
      return emptyResult();
    });

    const products = await listPublicProducts(new URLSearchParams({ as_of: "2026-03-20" }));
    expect(products).toEqual([
      {
        id: "prod-1",
        codigo: "DOCS-ELECTRONICOS",
        nombre: "Documentos Electronicos",
        descripcion: "Pool de documentos",
        tipo: "CONSUMIBLE",
        alcance: "EMPRESA",
        es_consumible: true,
        prices: [
          {
            id: "price-1",
            periodo: "MENSUAL",
            moneda_id: "cop-id",
            moneda_codigo: "COP",
            valor: 25000,
            permite_prorrateo: false,
            valido_desde: "2026-03-01",
            valido_hasta: null,
          },
        ],
      },
    ]);
  });

  it("throws not found when a public product identifier is unavailable", async () => {
    await expect(getPublicProductByIdentifier("missing", new URLSearchParams())).rejects.toBeInstanceOf(AppError);
  });
});
