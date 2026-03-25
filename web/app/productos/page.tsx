"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJson, isSuccess } from "@/lib/client/api";
import { formatDateOnly } from "@/lib/client/date-format";
import { formatMoney } from "@/lib/client/currency-format";
import { toHumanConsumableError, toHumanError } from "@/lib/client/error-mapping";
import toast from "react-hot-toast";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeaderCard } from "@/components/ui/page-header-card";
import { AppModal } from "@/components/ui/modal";

type ProductType = "SOFTWARE" | "MODULO" | "ADDON" | "CONSUMIBLE" | "SERVICIO";
type ScopeType = "EMPRESA" | "USUARIO" | "GLOBAL";
type PricePeriod = "MENSUAL" | "TRIMESTRAL" | "ANUAL" | "VITALICIO" | "UNICO";
type ProductVisibility = "PUBLIC" | "PRIVATE";

type ProductoRow = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  tipo: ProductType;
  alcance: ScopeType;
  es_consumible: boolean;
  visibility: ProductVisibility;
  activo: boolean;
};

type PrecioRow = {
  id: string;
  producto_id: string;
  periodo: PricePeriod;
  moneda_id: string;
  valor: string;
  permite_prorrateo: boolean;
  activo: boolean;
  valido_desde: string | null;
  valido_hasta: string | null;
};

type Lookups = {
  monedas: Array<{ value: string; label: string }>;
  productos: Array<{ value: string; label: string }>;
};

type ProductForm = {
  codigo: string;
  nombre: string;
  descripcion: string;
  tipo: ProductType;
  alcance: ScopeType;
  es_consumible: string;
  visibility: ProductVisibility;
  activo: string;
};

type PriceForm = {
  moneda_id: string;
  periodo: PricePeriod;
  valor: string;
  permite_prorrateo: string;
  valido_desde: string;
  valido_hasta: string;
};

const EMPTY_PRODUCT_FORM: ProductForm = {
  codigo: "",
  nombre: "",
  descripcion: "",
  tipo: "SERVICIO",
  alcance: "EMPRESA",
  es_consumible: "false",
  visibility: "PRIVATE",
  activo: "true",
};

const EMPTY_PRICE_FORM: PriceForm = {
  moneda_id: "",
  periodo: "MENSUAL",
  valor: "",
  permite_prorrateo: "false",
  valido_desde: "",
  valido_hasta: "",
};

type BadgeVariant = "default" | "success" | "danger";

function Badge({ text, variant = "default" }: { text: string; variant?: BadgeVariant }) {
  const baseClasses = "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold";
  const variantClasses =
    variant === "success"
      ? "bg-emerald-100 text-emerald-700"
      : variant === "danger"
        ? "bg-red-100 text-red-700"
        : "bg-slate-100 text-slate-700";

  return <span className={`${baseClasses} ${variantClasses}`}>{text}</span>;
}

function toDateStart(value?: string | null): Date {
  if (!value) return new Date("1900-01-01T00:00:00.000Z");
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateEnd(value?: string | null): Date {
  if (!value) return new Date("2999-12-31T00:00:00.000Z");
  return new Date(`${value}T00:00:00.000Z`);
}

function datesOverlap(aFrom?: string | null, aTo?: string | null, bFrom?: string | null, bTo?: string | null): boolean {
  const startA = toDateStart(aFrom);
  const endA = toDateEnd(aTo);
  const startB = toDateStart(bFrom);
  const endB = toDateEnd(bTo);
  return startA <= endB && startB <= endA;
}

function mapApiMessage(
  code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE_VIOLATION" | "INTERNAL_ERROR" | "UNAUTHORIZED",
  message: string,
) {
  return toHumanConsumableError(message) ?? toHumanError(code, message);
}

async function loadProductData() {
  const [productsResponse, pricesResponse, lookupsResponse] = await Promise.all([
    fetchJson<ProductoRow[]>("/api/backoffice/productos"),
    fetchJson<PrecioRow[]>("/api/v1/precios"),
    fetchJson<Lookups>("/api/backoffice/lookups"),
  ]);

  return { productsResponse, pricesResponse, lookupsResponse };
}

export default function ProductosPage() {
  const [productos, setProductos] = useState<ProductoRow[]>([]);
  const [precios, setPrecios] = useState<PrecioRow[]>([]);
  const [lookups, setLookups] = useState<Lookups>({ monedas: [], productos: [] });
  const [selectedProductId, setSelectedProductId] = useState("");
  const [message, setMessage] = useState("Listo");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>(EMPTY_PRODUCT_FORM);
  const [priceForm, setPriceForm] = useState<PriceForm>(EMPTY_PRICE_FORM);
  const [managePricesModalOpen, setManagePricesModalOpen] = useState(false);

  const refresh = async () => {
    try {
      const { productsResponse, pricesResponse, lookupsResponse } = await loadProductData();

      if (isSuccess(productsResponse)) setProductos(productsResponse.data);
      if (isSuccess(pricesResponse)) setPrecios(pricesResponse.data);
      if (isSuccess(lookupsResponse)) setLookups(lookupsResponse.data);
    } catch {
      toast.error("Error de red al cargar productos.");
    }
  };

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const { productsResponse, pricesResponse, lookupsResponse } = await loadProductData();
          if (!active) return;
          if (isSuccess(productsResponse)) setProductos(productsResponse.data);
          if (isSuccess(pricesResponse)) setPrecios(pricesResponse.data);
          if (isSuccess(lookupsResponse)) setLookups(lookupsResponse.data);
        } catch {
          if (active) toast.error("Error de red al cargar productos.");
        }
      })();
    }, 0);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, []);

  const resolvedSelectedProductId = useMemo(
    () => (productos.some((producto) => producto.id === selectedProductId) ? selectedProductId : ""),
    [productos, selectedProductId],
  );

  const productoSeleccionado = useMemo(
    () => productos.find((producto) => producto.id === resolvedSelectedProductId) ?? null,
    [productos, resolvedSelectedProductId],
  );

  const preciosSeleccionados = useMemo(
    () =>
      precios
        .filter((price) => price.producto_id === resolvedSelectedProductId)
        .sort((left, right) => `${right.valido_desde ?? ""}${right.id}`.localeCompare(`${left.valido_desde ?? ""}${left.id}`)),
    [precios, resolvedSelectedProductId],
  );

  const monedas = lookups.monedas;
  const monedaLabel = (id: string) => monedas.find((moneda) => moneda.value === id)?.label ?? id;

  const openCreate = () => {
    setEditingId(null);
    setProductForm(EMPTY_PRODUCT_FORM);
    setModalOpen(true);
  };

  const openEdit = (row: ProductoRow) => {
    setEditingId(row.id);
    setProductForm({
      codigo: row.codigo,
      nombre: row.nombre,
      descripcion: row.descripcion ?? "",
      tipo: row.tipo,
      alcance: row.alcance,
      es_consumible: String(row.es_consumible),
      visibility: row.visibility,
      activo: String(row.activo),
    });
    setModalOpen(true);
  };

  const saveProduct = async () => {
    const payload = {
      codigo: productForm.codigo,
      nombre: productForm.nombre,
      descripcion: productForm.descripcion || null,
      tipo: productForm.tipo,
      alcance: productForm.alcance,
      es_consumible: productForm.tipo === "CONSUMIBLE" ? true : productForm.es_consumible === "true",
      visibility: productForm.visibility,
      activo: productForm.activo === "true",
    };

    try {
      if (editingId) {
        const updated = await fetchJson<ProductoRow>(`/api/v1/productos/${editingId}`, { method: "PATCH", body: payload });
        if (!isSuccess(updated)) {
          const msg = mapApiMessage(updated.error.code, updated.error.message);
          toast.error(msg);
          setMessage(msg);
          return;
        }
        toast.success("Producto actualizado.");
        setMessage("Producto actualizado.");
        setModalOpen(false);
        await refresh();
        return;
      }

      const created = await fetchJson<ProductoRow>("/api/v1/productos", { method: "POST", body: payload });
      if (!isSuccess(created)) {
        const msg = mapApiMessage(created.error.code, created.error.message);
        toast.error(msg);
        setMessage(msg);
        return;
      }

      toast.success("Producto creado.");
      setMessage("Producto creado.");
      setModalOpen(false);
      await refresh();
    } catch {
      toast.error("No se pudo guardar el producto.");
    }
  };

  const deleteProduct = async (id: string) => {
    try {
      const response = await fetchJson<ProductoRow>(`/api/v1/productos/${id}`, { method: "DELETE" });
      if (isSuccess(response)) {
        toast.success("Producto eliminado.");
        setMessage("Producto eliminado.");
        if (selectedProductId === id) setSelectedProductId("");
        await refresh();
        return;
      }
      const msg = mapApiMessage(response.error.code, response.error.message);
      toast.error(msg);
      setMessage(msg);
    } catch {
      toast.error("Error de red al eliminar producto.");
    }
  };

  const addPrice = async () => {
    if (!selectedProductId) return;
    if (!priceForm.moneda_id || Number(priceForm.valor) <= 0) {
      toast.error("Debes seleccionar moneda y un valor mayor a 0.");
      return;
    }
    if (priceForm.valido_desde && priceForm.valido_hasta && priceForm.valido_desde > priceForm.valido_hasta) {
      toast.error("La fecha de inicio no puede ser mayor a la fecha de fin.");
      return;
    }

    const overlaps = preciosSeleccionados.some(
      (price) =>
        price.activo &&
        price.moneda_id === priceForm.moneda_id &&
        price.periodo === priceForm.periodo &&
        datesOverlap(priceForm.valido_desde || null, priceForm.valido_hasta || null, price.valido_desde, price.valido_hasta),
    );
    if (overlaps) {
      toast.error("Ya existe un precio activo con vigencia solapada para la misma moneda y periodo.");
      return;
    }

    try {
      const response = await fetchJson<PrecioRow>("/api/v1/precios", {
        method: "POST",
        body: {
          producto_id: selectedProductId,
          moneda_id: priceForm.moneda_id,
          periodo: priceForm.periodo,
          valor: Number(priceForm.valor),
          permite_prorrateo:
            (productoSeleccionado?.tipo === "CONSUMIBLE" ? "false" : priceForm.permite_prorrateo) === "true",
          activo: true,
          valido_desde: priceForm.valido_desde || null,
          valido_hasta: priceForm.valido_hasta || null,
        },
      });
      if (isSuccess(response)) {
        toast.success("Precio agregado.");
        setMessage("Precio agregado.");
        setPriceForm((current) => ({ ...EMPTY_PRICE_FORM, periodo: current.periodo }));
        setManagePricesModalOpen(false);
        await refresh();
        return;
      }
      const msg = mapApiMessage(response.error.code, response.error.message);
      toast.error(msg);
      setMessage(msg);
    } catch {
      toast.error("Error de red al agregar precio.");
    }
  };

  const invalidatePrice = async (priceId: string) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const response = await fetchJson<PrecioRow>(`/api/v1/precios/${priceId}`, {
        method: "PATCH",
        body: { activo: false, valido_hasta: today },
      });
      if (isSuccess(response)) {
        toast.success("Precio invalidado.");
        setMessage("Precio invalidado.");
        await refresh();
        return;
      }
      toast.error(response.error.message);
      setMessage(response.error.message);
    } catch {
      toast.error("Error de red al invalidar precio.");
    }
  };

  const deletePrice = async (priceId: string) => {
    try {
      const response = await fetchJson<PrecioRow>(`/api/v1/precios/${priceId}`, { method: "DELETE" });
      if (isSuccess(response)) {
        toast.success("Precio eliminado.");
        setMessage("Precio eliminado.");
        await refresh();
        return;
      }
      toast.error(response.error.message);
      setMessage(response.error.message);
    } catch {
      toast.error("Error de red al eliminar precio.");
    }
  };

  return (
    <main className="main-stack">
      <PageHeaderCard title="Productos" description="Catalogo operativo con separacion entre productos publicos y privados.">
        <button onClick={openCreate} className="ui-btn ui-btn-primary ui-btn-sm">
          Nuevo producto
        </button>
      </PageHeaderCard>
        

      <section className="main-card">
        <DataTable<ProductoRow>
          className="max-h-[420px] overflow-auto rounded border border-slate-200"
          rows={productos}
          getRowKey={(row, index) => `${row.id}-${index}`}
          columns={[
            {
              key: "__index",
              header: "#",
              cellClassName: "text-slate-700 w-[40px]",
              render: (_row, index) => index + 1,
            },
            { key: "codigo", header: "Codigo", cellClassName: "text-slate-700" },
            { key: "nombre", header: "Nombre", cellClassName: "text-slate-700" },
            {
              key: "visibility",
              header: "Visibilidad",
              cellClassName: "text-slate-700",
              render: (row) => <Badge text={row.visibility} variant={row.visibility === "PUBLIC" ? "success" : "default"} />,
            },
            {
              key: "alcance",
              header: "Alcance",
              cellClassName: "text-slate-700",
              render: (row) => <Badge text={row.alcance} />,
            },
            {
              key: "tipo",
              header: "Tipo",
              cellClassName: "text-slate-700",
              render: (row) => <Badge text={row.tipo} />,
            },
            {
              key: "activo",
              header: "Estado",
              cellClassName: "text-slate-700",
              render: (row) => <Badge text={row.activo ? "ACTIVO" : "INACTIVO"} variant={row.activo ? "success" : "danger"} />,
            },
            {
              key: "__actions",
              header: "Acciones",
              render: (row) => (
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => setSelectedProductId(row.id)} className="ui-btn ui-btn-outline ui-btn-sm">
                    Gestionar
                  </button>
                  <button onClick={() => openEdit(row)} className="ui-btn ui-btn-primary ui-btn-sm">
                    Editar
                  </button>
                  <button onClick={() => deleteProduct(row.id)} className="ui-btn ui-btn-danger ui-btn-sm">
                    Eliminar
                  </button>
                </div>
              ),
            },
          ] as DataTableColumn<ProductoRow>[]}
        />
      </section>

      {productoSeleccionado && (
        <section className="grid gap-4 xl:grid-cols-2">
          <article className="main-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">Perfil del producto</h3>
              <Badge text={productoSeleccionado.tipo} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge text={productoSeleccionado.visibility} variant={productoSeleccionado.visibility === "PUBLIC" ? "success" : "default"} />
              <Badge text={productoSeleccionado.alcance} />
              <Badge text={productoSeleccionado.activo ? "ACTIVO" : "INACTIVO"} variant={productoSeleccionado.activo ? "success" : "danger"} />
            </div>
            <p className="mt-3 text-sm text-slate-700">{productoSeleccionado.descripcion ?? "Sin descripcion comercial."}</p>
            {productoSeleccionado.tipo === "CONSUMIBLE" && <p className="mt-3 text-xs text-slate-500">Producto marcado como consumible.</p>}
          </article>

          <article className="main-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">Precios del producto</h3>
              <button onClick={() => setManagePricesModalOpen(true)} className="ui-btn ui-btn-primary ui-btn-sm">
                Agregar precio
              </button>
            </div>
            <ul className="mt-3 space-y-2 text-xs">
              {preciosSeleccionados.map((price) => (
                <li key={price.id} className="rounded border border-slate-200 p-2">
                  <p>
                    {monedaLabel(price.moneda_id)} | {price.periodo} | {formatMoney(price.valor)} | {formatDateOnly(price.valido_desde)} - {formatDateOnly(price.valido_hasta)}
                  </p>
                  <div className="mt-1 flex gap-1">
                    <Badge text={price.activo ? "ACTIVO" : "INACTIVO"} variant={price.activo ? "success" : "danger"} />
                    <Badge text={price.permite_prorrateo ? "PRORRATEA" : "SIN PRORRATEO"} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={() => invalidatePrice(price.id)} className="ui-btn ui-btn-secondary ui-btn-sm">
                      Invalidar hoy
                    </button>
                    <button onClick={() => deletePrice(price.id)} className="ui-btn ui-btn-danger ui-btn-sm">
                      Eliminar
                    </button>
                  </div>
                </li>
              ))}
              {preciosSeleccionados.length === 0 && <li className="text-slate-500">Sin precios registrados.</li>}
            </ul>
          </article>

        </section>
      )}

      <p className="text-xs text-slate-600">{message}</p>

      <AppModal open={modalOpen} onClose={() => setModalOpen(false)} maxWidthClassName="max-w-4xl" title={editingId ? "Editar producto" : "Nuevo producto"}>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <label className="text-xs">
            Codigo
            <input value={productForm.codigo} onChange={(event) => setProductForm((current) => ({ ...current, codigo: event.target.value }))} className="mt-1 ui-input" />
          </label>
          <label className="text-xs">
            Nombre
            <input value={productForm.nombre} onChange={(event) => setProductForm((current) => ({ ...current, nombre: event.target.value }))} className="mt-1 ui-input" />
          </label>
          <label className="text-xs">
            Descripcion
            <input value={productForm.descripcion} onChange={(event) => setProductForm((current) => ({ ...current, descripcion: event.target.value }))} className="mt-1 ui-input" />
          </label>
          <label className="text-xs">
            Tipo
            <select
              value={productForm.tipo}
              onChange={(event) => {
                const nextType = event.target.value as ProductType;
                setProductForm((current) => ({
                  ...current,
                  tipo: nextType,
                  es_consumible: nextType === "CONSUMIBLE" ? "true" : current.es_consumible,
                }));
              }}
              className="mt-1 ui-input"
            >
              <option value="SOFTWARE">SOFTWARE</option>
              <option value="MODULO">MODULO</option>
              <option value="ADDON">ADDON</option>
              <option value="CONSUMIBLE">CONSUMIBLE</option>
              <option value="SERVICIO">SERVICIO</option>
            </select>
          </label>
          <label className="text-xs">
            Alcance
            <select value={productForm.alcance} onChange={(event) => setProductForm((current) => ({ ...current, alcance: event.target.value as ScopeType }))} className="mt-1 ui-input">
              <option value="EMPRESA">EMPRESA</option>
              <option value="USUARIO">USUARIO</option>
              <option value="GLOBAL">GLOBAL</option>
            </select>
          </label>
          <label className="text-xs">
            Es consumible
            <select disabled={productForm.tipo === "CONSUMIBLE"} value={productForm.tipo === "CONSUMIBLE" ? "true" : productForm.es_consumible} onChange={(event) => setProductForm((current) => ({ ...current, es_consumible: event.target.value }))} className="mt-1 ui-input">
              <option value="true">Si</option>
              <option value="false">No</option>
            </select>
          </label>
          <label className="text-xs">
            Visibilidad
            <select value={productForm.visibility} onChange={(event) => setProductForm((current) => ({ ...current, visibility: event.target.value as ProductVisibility }))} className="mt-1 ui-input">
              <option value="PUBLIC">PUBLIC</option>
              <option value="PRIVATE">PRIVATE</option>
            </select>
          </label>
          <label className="text-xs">
            Estado
            <select value={productForm.activo} onChange={(event) => setProductForm((current) => ({ ...current, activo: event.target.value }))} className="mt-1 ui-input">
              <option value="true">Activo</option>
              <option value="false">Inactivo</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button onClick={() => setModalOpen(false)} className="ui-btn ui-btn-outline">
            Cancelar
          </button>
          <button onClick={saveProduct} className="ui-btn ui-btn-primary">
            Guardar
          </button>
        </div>
      </AppModal>

      {productoSeleccionado && (
        <AppModal open={managePricesModalOpen} onClose={() => setManagePricesModalOpen(false)} maxWidthClassName="max-w-2xl" title="Agregar precio al producto">
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <label className="text-xs">
                Moneda
                <select value={priceForm.moneda_id} onChange={(event) => setPriceForm((current) => ({ ...current, moneda_id: event.target.value }))} className="mt-1 ui-input">
                  <option value="">Moneda...</option>
                  {monedas.map((currency) => (
                    <option key={currency.value} value={currency.value}>
                      {currency.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                Periodo
                <select value={priceForm.periodo} onChange={(event) => setPriceForm((current) => ({ ...current, periodo: event.target.value as PricePeriod }))} className="mt-1 ui-input">
                  <option value="MENSUAL">MENSUAL</option>
                  <option value="TRIMESTRAL">TRIMESTRAL</option>
                  <option value="ANUAL">ANUAL</option>
                  <option value="VITALICIO">VITALICIO</option>
                  <option value="UNICO">UNICO</option>
                </select>
              </label>
              <label className="text-xs">
                Valor
                <input type="number" value={priceForm.valor} onChange={(event) => setPriceForm((current) => ({ ...current, valor: event.target.value }))} className="mt-1 ui-input" />
              </label>
              <label className="text-xs">
                Permite prorrateo
                <select disabled={productoSeleccionado.tipo === "CONSUMIBLE"} value={productoSeleccionado.tipo === "CONSUMIBLE" ? "false" : priceForm.permite_prorrateo} onChange={(event) => setPriceForm((current) => ({ ...current, permite_prorrateo: event.target.value }))} className="mt-1 ui-input">
                  <option value="false">No</option>
                  <option value="true">Si</option>
                </select>
              </label>
              <label className="text-xs">
                Vigente desde
                <input type="date" value={priceForm.valido_desde} onChange={(event) => setPriceForm((current) => ({ ...current, valido_desde: event.target.value }))} className="mt-1 ui-input" />
              </label>
              <label className="text-xs">
                Vigente hasta
                <input type="date" value={priceForm.valido_hasta} onChange={(event) => setPriceForm((current) => ({ ...current, valido_hasta: event.target.value }))} className="mt-1 ui-input" />
              </label>
            </div>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => setManagePricesModalOpen(false)} className="ui-btn ui-btn-outline">
                Cancelar
              </button>
              <button onClick={addPrice} className="ui-btn ui-btn-primary">
                Agregar precio
              </button>
            </div>
          </AppModal>
      )}
    </main>
  );
}
