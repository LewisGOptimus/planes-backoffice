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

type ProductoRow = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  unidad_consumo: string | null;
  descripcion_operativa: string | null;
  tipo: ProductType;
  alcance: ScopeType;
  es_consumible: boolean;
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
};

type ProductForm = {
  codigo: string;
  nombre: string;
  descripcion: string;
  unidad_consumo: string;
  descripcion_operativa: string;
  tipo: ProductType;
  alcance: ScopeType;
  es_consumible: string;
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

const CONSUMABLE_UNIT_OPTIONS = ["DOCUMENTO", "TRANSACCION", "EVENTO"] as const;

const EMPTY_PRODUCT_FORM: ProductForm = {
  codigo: "",
  nombre: "",
  descripcion: "",
  unidad_consumo: "",
  descripcion_operativa: "",
  tipo: "SERVICIO",
  alcance: "EMPRESA",
  es_consumible: "false",
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

function mapApiMessage(code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE_VIOLATION" | "INTERNAL_ERROR" | "UNAUTHORIZED", message: string) {
  return toHumanConsumableError(message) ?? toHumanError(code, message);
}

export default function ProductosPage() {
  const [productos, setProductos] = useState<ProductoRow[]>([]);
  const [precios, setPrecios] = useState<PrecioRow[]>([]);
  const [lookups, setLookups] = useState<Lookups>({ monedas: [] });
  const [selectedProductId, setSelectedProductId] = useState("");
  const [message, setMessage] = useState("Listo");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>(EMPTY_PRODUCT_FORM);
  const [unitMode, setUnitMode] = useState<"SELECT" | "OTRA">("SELECT");
  const [customUnit, setCustomUnit] = useState("");

  const [priceForm, setPriceForm] = useState<PriceForm>(EMPTY_PRICE_FORM);
  const [managePricesModalOpen, setManagePricesModalOpen] = useState(false);

  const refresh = async () => {
    try {
      const [pr, pc, lk] = await Promise.all([
        fetchJson<ProductoRow[]>("/api/v1/productos"),
        fetchJson<PrecioRow[]>("/api/v1/precios"),
        fetchJson<Lookups>("/api/backoffice/lookups"),
      ]);
      if (isSuccess(pr)) setProductos(pr.data);
      if (isSuccess(pc)) setPrecios(pc.data);
      if (isSuccess(lk)) setLookups({ monedas: lk.data.monedas });
    } catch {
      toast.error("Error de red al cargar productos.");
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const productoSeleccionado = useMemo(
    () => productos.find((p) => p.id === selectedProductId) ?? null,
    [productos, selectedProductId],
  );
  const preciosSeleccionados = useMemo(
    () =>
      precios
        .filter((p) => p.producto_id === selectedProductId)
        .sort((a, b) => `${b.valido_desde ?? ""}${b.id}`.localeCompare(`${a.valido_desde ?? ""}${a.id}`)),
    [precios, selectedProductId],
  );

  const monedas = lookups.monedas;
  const monedaLabel = (id: string) => monedas.find((m) => m.value === id)?.label ?? id;

  const openCreate = () => {
    setEditingId(null);
    setProductForm(EMPTY_PRODUCT_FORM);
    setUnitMode("SELECT");
    setCustomUnit("");
    setPriceForm(EMPTY_PRICE_FORM);
    setModalOpen(true);
  };

  const openEdit = (row: ProductoRow) => {
    const dbUnit = (row.unidad_consumo ?? "").trim();
    const isPreset = CONSUMABLE_UNIT_OPTIONS.includes(dbUnit as (typeof CONSUMABLE_UNIT_OPTIONS)[number]);
    setUnitMode(isPreset ? "SELECT" : "OTRA");
    setCustomUnit(isPreset ? "" : dbUnit);
    setEditingId(row.id);
    setProductForm({
      codigo: row.codigo,
      nombre: row.nombre,
      descripcion: row.descripcion ?? "",
      unidad_consumo: dbUnit,
      descripcion_operativa: row.descripcion_operativa ?? "",
      tipo: row.tipo,
      alcance: row.alcance,
      es_consumible: String(row.es_consumible),
      activo: String(row.activo),
    });
    setPriceForm(EMPTY_PRICE_FORM);
    setModalOpen(true);
  };

  const saveProduct = async () => {
    const resolvedUnit = unitMode === "OTRA" ? customUnit.trim() : productForm.unidad_consumo.trim();
    if (productForm.tipo === "CONSUMIBLE" && !resolvedUnit) {
      toast.error("Para productos CONSUMIBLE debes definir la unidad de consumo.");
      return;
    }

    const formToSave: ProductForm = {
      ...productForm,
      unidad_consumo: resolvedUnit,
      es_consumible: productForm.tipo === "CONSUMIBLE" ? "true" : productForm.es_consumible,
    };

    try {
      const payload = {
        codigo: formToSave.codigo,
        nombre: formToSave.nombre,
        descripcion: formToSave.descripcion || null,
        unidad_consumo: formToSave.tipo === "CONSUMIBLE" ? formToSave.unidad_consumo : null,
        descripcion_operativa: formToSave.tipo === "CONSUMIBLE" ? formToSave.descripcion_operativa || null : null,
        tipo: formToSave.tipo,
        alcance: formToSave.alcance,
        es_consumible: formToSave.es_consumible === "true",
        activo: formToSave.activo === "true",
      };

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
      const res = await fetchJson<ProductoRow>(`/api/v1/productos/${id}`, { method: "DELETE" });
      if (isSuccess(res)) {
        toast.success("Producto eliminado.");
        setMessage("Producto eliminado.");
        if (selectedProductId === id) setSelectedProductId("");
        await refresh();
        return;
      }
      const msg = mapApiMessage(res.error.code, res.error.message);
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
      (p) =>
        p.activo &&
        p.moneda_id === priceForm.moneda_id &&
        p.periodo === priceForm.periodo &&
        datesOverlap(priceForm.valido_desde || null, priceForm.valido_hasta || null, p.valido_desde, p.valido_hasta),
    );
    if (overlaps) {
      toast.error("Ya existe un precio activo con vigencia solapada para la misma moneda y periodo.");
      return;
    }

    try {
      const res = await fetchJson<PrecioRow>("/api/v1/precios", {
        method: "POST",
        body: {
          producto_id: selectedProductId,
          moneda_id: priceForm.moneda_id,
          periodo: priceForm.periodo,
          valor: Number(priceForm.valor),
          permite_prorrateo: (productoSeleccionado?.tipo === "CONSUMIBLE" ? "false" : priceForm.permite_prorrateo) === "true",
          activo: true,
          valido_desde: priceForm.valido_desde || null,
          valido_hasta: priceForm.valido_hasta || null,
        },
      });
      if (isSuccess(res)) {
        toast.success("Precio agregado.");
        setMessage("Precio agregado.");
        setPriceForm((prev) => ({ ...EMPTY_PRICE_FORM, periodo: prev.periodo }));
        setManagePricesModalOpen(false);
        await refresh();
        return;
      }
      const msg = mapApiMessage(res.error.code, res.error.message);
      toast.error(msg);
      setMessage(msg);
    } catch {
      toast.error("Error de red al agregar precio.");
    }
  };

  const invalidatePrice = async (priceId: string) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetchJson<PrecioRow>(`/api/v1/precios/${priceId}`, {
        method: "PATCH",
        body: { activo: false, valido_hasta: today },
      });
      if (isSuccess(res)) {
        toast.success("Precio invalidado.");
        setMessage("Precio invalidado.");
        await refresh();
        return;
      }
      toast.error(res.error.message);
      setMessage(res.error.message);
    } catch {
      toast.error("Error de red al invalidar precio.");
    }
  };

  const deletePrice = async (priceId: string) => {
    try {
      const res = await fetchJson<PrecioRow>(`/api/v1/precios/${priceId}`, { method: "DELETE" });
      if (isSuccess(res)) {
        toast.success("Precio eliminado.");
        setMessage("Precio eliminado.");
        await refresh();
        return;
      }
      toast.error(res.error.message);
      setMessage(res.error.message);
    } catch {
      toast.error("Error de red al eliminar precio.");
    }
  };

  return (
    <main className="main-stack">
      <PageHeaderCard
        title="Productos"
        description="Productos de la aplicación."
      >
        <button onClick={openCreate} className="ui-btn ui-btn-primary ui-btn-sm">Nuevo producto</button>
      </PageHeaderCard>


      <section className="main-card">
        <DataTable<ProductoRow>
          className="max-h-[360px] overflow-auto rounded border border-slate-200"
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
              key: "tipo",
              header: "Tipo",
              cellClassName: "text-slate-700",
              render: (row) => <Badge text={row.tipo} />,
            },
            {
              key: "alcance",
              header: "Alcance",
              cellClassName: "text-slate-700",
              render: (row) => <Badge text={row.alcance} />,
            },
            {
              key: "unidad_consumo",
              header: "Unidad",
              cellClassName: "text-slate-700",
              render: (row) =>
                row.tipo === "CONSUMIBLE" ? (
                  <Badge text={row.unidad_consumo ?? "SIN UNIDAD"} />
                ) : (
                  "-"
                ),
            },
            {
              key: "es_consumible",
              header: "Consumible",
              cellClassName: "text-slate-700",
              render: (row) => <Badge text={row.es_consumible ? "SI" : "NO"} />,
            },
          {
              key: "activo",
              header: "Estado",
              cellClassName: "text-slate-700",
              render: (row) => (
                <Badge
                  text={row.activo ? "ACTIVO" : "INACTIVO"}
                  variant={row.activo ? "success" : "danger"}
                />
              ),
            },
            {
              key: "__actions",
              header: "Acciones",
              render: (row) => (
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setSelectedProductId(row.id)}
                    className="ui-btn ui-btn-outline ui-btn-sm"
                  >
                    Gestionar
                  </button>
                  <button
                    onClick={() => openEdit(row)}
                    className="ui-btn ui-btn-primary ui-btn-sm"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => deleteProduct(row.id)}
                    className="ui-btn ui-btn-danger ui-btn-sm"
                  >
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
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Detalle operativo</h3>
              <Badge text={productoSeleccionado.tipo} />
            </div>
            {productoSeleccionado.tipo === "CONSUMIBLE" && (
              <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-800">Perfil consumible</p>
                <p className="mt-1 text-xs text-slate-700">Este producto representa un pool de creditos consumibles.</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-600">Unidad:</span>
                  <Badge text={productoSeleccionado.unidad_consumo ?? "SIN UNIDAD"} />
                </div>
                <p className="mt-2 text-xs text-slate-600">{productoSeleccionado.descripcion_operativa ?? "Sin descripcion operativa."}</p>
              </div>
            )}
          </article>

          <article className="main-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">Precios del producto</h3>
              <div className="flex flex-wrap items-center gap-1">
                <Badge text={productoSeleccionado.tipo} />
                {productoSeleccionado.tipo === "SERVICIO" && <Badge text="PRORRATEO CONFIGURABLE" />}
                <button onClick={() => setManagePricesModalOpen(true)} className="ui-btn ui-btn-primary ui-btn-sm">Agregar precio</button>
              </div>
            </div>
            {productoSeleccionado.tipo === "CONSUMIBLE" && <p className="mt-2 text-xs text-slate-600">Para consumibles usa un precio activo y vigente para habilitar su venta y consumo en suscripciones.</p>}

            <ul className="mt-3 space-y-2 text-xs">
              {preciosSeleccionados.map((pr) => (
                <li key={pr.id} className="rounded border border-slate-200 p-2">
                  <p>{monedaLabel(pr.moneda_id)} | {pr.periodo} | {formatMoney(pr.valor)} | {formatDateOnly(pr.valido_desde)} - {formatDateOnly(pr.valido_hasta)}</p>
                  <div className="mt-1 flex gap-1">
                    <Badge
                      text={pr.activo ? "ACTIVO" : "INACTIVO"}
                      variant={pr.activo ? "success" : "danger"}
                    />
                    <Badge text={pr.permite_prorrateo ? "PRORRATEA" : "SIN PRORRATEO"} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={() => invalidatePrice(pr.id)} className="ui-btn ui-btn-secondary ui-btn-sm">Invalidar hoy</button>
                    <button onClick={() => deletePrice(pr.id)} className="ui-btn ui-btn-danger ui-btn-sm">Eliminar</button>
                  </div>
                </li>
              ))}
              {preciosSeleccionados.length === 0 && <li className="text-slate-500">Sin precios registrados.</li>}
            </ul>
          </article>
        </section>
      )}

      <p className="text-xs text-slate-600">{message}</p>

      <AppModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        maxWidthClassName="max-w-3xl"
        title={editingId ? "Editar producto" : "Nuevo producto"}
      >
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <label className="text-xs">Codigo<input value={productForm.codigo} onChange={(e) => setProductForm((p) => ({ ...p, codigo: e.target.value }))} className="mt-1 ui-input" /></label>
              <label className="text-xs">Nombre<input value={productForm.nombre} onChange={(e) => setProductForm((p) => ({ ...p, nombre: e.target.value }))} className="mt-1 ui-input" /></label>
              <label className="text-xs">Descripcion<input value={productForm.descripcion} onChange={(e) => setProductForm((p) => ({ ...p, descripcion: e.target.value }))} className="mt-1 ui-input" /></label>
              <label className="text-xs">Tipo<select value={productForm.tipo} onChange={(e) => { const nextType = e.target.value as ProductType; setProductForm((p) => ({ ...p, tipo: nextType, es_consumible: nextType === "CONSUMIBLE" ? "true" : p.es_consumible, unidad_consumo: nextType === "CONSUMIBLE" ? p.unidad_consumo : "", descripcion_operativa: nextType === "CONSUMIBLE" ? p.descripcion_operativa : "" })); if (nextType !== "CONSUMIBLE") { setUnitMode("SELECT"); setCustomUnit(""); } }} className="mt-1 ui-input"><option value="SOFTWARE">SOFTWARE</option><option value="MODULO">MODULO</option><option value="ADDON">ADDON</option><option value="CONSUMIBLE">CONSUMIBLE</option><option value="SERVICIO">SERVICIO</option></select></label>
              <label className="text-xs">Alcance<select value={productForm.alcance} onChange={(e) => setProductForm((p) => ({ ...p, alcance: e.target.value as ScopeType }))} className="mt-1 ui-input"><option value="EMPRESA">EMPRESA</option><option value="USUARIO">USUARIO</option><option value="GLOBAL">GLOBAL</option></select></label>
              <label className="text-xs">Es consumible<select disabled={productForm.tipo === "CONSUMIBLE"} value={productForm.tipo === "CONSUMIBLE" ? "true" : productForm.es_consumible} onChange={(e) => setProductForm((p) => ({ ...p, es_consumible: e.target.value }))} className="mt-1 ui-input"><option value="true">Si</option><option value="false">No</option></select></label>
              <label className="text-xs">Estado<select value={productForm.activo} onChange={(e) => setProductForm((p) => ({ ...p, activo: e.target.value }))} className="mt-1 ui-input"><option value="true">Activo</option><option value="false">Inactivo</option></select></label>
            </div>

            {productForm.tipo === "CONSUMIBLE" && (
              <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-800">Perfil consumible</p>
                <p className="mt-1 text-xs text-slate-600">Este producto representa un pool de creditos consumibles.</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <label className="text-xs">
                    Unidad de consumo
                    <select
                      value={unitMode === "OTRA" ? "OTRA" : productForm.unidad_consumo}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === "OTRA") {
                          setUnitMode("OTRA");
                          setProductForm((p) => ({ ...p, unidad_consumo: "" }));
                          return;
                        }
                        setUnitMode("SELECT");
                        setCustomUnit("");
                        setProductForm((p) => ({ ...p, unidad_consumo: value }));
                      }}
                      className="mt-1 ui-input"
                    >
                      <option value="">Seleccionar...</option>
                      {CONSUMABLE_UNIT_OPTIONS.map((unit) => (
                        <option key={unit} value={unit}>{unit}</option>
                      ))}
                      <option value="OTRA">OTRA (escribir manual)</option>
                    </select>
                  </label>
                  {unitMode === "OTRA" && (
                    <label className="text-xs">
                      Unidad personalizada
                      <input
                        value={customUnit}
                        onChange={(e) => setCustomUnit(e.target.value)}
                        className="mt-1 ui-input"
                        placeholder="Ej: DOCUMENTO-NOMINA"
                      />
                    </label>
                  )}
                </div>
                <label className="mt-2 block text-xs">
                  Descripcion operativa
                  <textarea
                    value={productForm.descripcion_operativa}
                    onChange={(e) => setProductForm((p) => ({ ...p, descripcion_operativa: e.target.value }))}
                    rows={2}
                    className="mt-1 ui-input"
                    placeholder="Como se consume este pool en operacion."
                  />
                </label>
              </div>
            )}

            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => setModalOpen(false)} className="ui-btn ui-btn-outline">Cancelar</button>
              <button onClick={saveProduct} className="ui-btn ui-btn-primary">Guardar</button>
            </div>
      </AppModal>

      {productoSeleccionado && (
        <AppModal
          open={managePricesModalOpen}
          onClose={() => setManagePricesModalOpen(false)}
          maxWidthClassName="max-w-2xl"
          title="Agregar precio al producto"
        >
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <label className="text-xs">Moneda<select value={priceForm.moneda_id} onChange={(e) => setPriceForm((p) => ({ ...p, moneda_id: e.target.value }))} className="mt-1 ui-input"><option value="">Moneda...</option>{monedas.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
              <label className="text-xs">Periodo<select value={priceForm.periodo} onChange={(e) => setPriceForm((p) => ({ ...p, periodo: e.target.value as PricePeriod }))} className="mt-1 ui-input"><option value="MENSUAL">MENSUAL</option><option value="TRIMESTRAL">TRIMESTRAL</option><option value="ANUAL">ANUAL</option><option value="VITALICIO">VITALICIO</option><option value="UNICO">UNICO</option></select></label>
              <label className="text-xs">Valor<input type="number" value={priceForm.valor} onChange={(e) => setPriceForm((p) => ({ ...p, valor: e.target.value }))} className="mt-1 ui-input" /></label>
              <label className="text-xs">Permite prorrateo<select disabled={productoSeleccionado.tipo === "CONSUMIBLE"} value={productoSeleccionado.tipo === "CONSUMIBLE" ? "false" : priceForm.permite_prorrateo} onChange={(e) => setPriceForm((p) => ({ ...p, permite_prorrateo: e.target.value }))} className="mt-1 ui-input"><option value="false">No</option><option value="true">Si</option></select></label>
              <label className="text-xs">Vigente desde<input type="date" value={priceForm.valido_desde} onChange={(e) => setPriceForm((p) => ({ ...p, valido_desde: e.target.value }))} className="mt-1 ui-input" /></label>
              <label className="text-xs">Vigente hasta<input type="date" value={priceForm.valido_hasta} onChange={(e) => setPriceForm((p) => ({ ...p, valido_hasta: e.target.value }))} className="mt-1 ui-input" /></label>
            </div>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => setManagePricesModalOpen(false)} className="ui-btn ui-btn-outline">Cancelar</button>
              <button onClick={addPrice} className="ui-btn ui-btn-primary">Agregar precio</button>
            </div>
        </AppModal>
      )}
    </main>
  );
}
