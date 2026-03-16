"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJson, isSuccess } from "@/lib/client/api";
import { formatDateOnly } from "@/lib/client/date-format";
import { formatMoney } from "@/lib/client/currency-format";
import toast from "react-hot-toast";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeaderCard } from "@/components/ui/page-header-card";
import { AppModal } from "@/components/ui/modal";

type Row = Record<string, unknown> & { id?: string };

type Lookups = {
  productos: Array<{ value: string; label: string }>;
  monedas: Array<{ value: string; label: string }>;
  entitlements: Array<{ value: string; label: string }>;
};

type DraftPrice = {
  moneda_id: string;
  periodo: string;
  valor: string;
  valido_desde: string;
  valido_hasta: string;
};

type EntitlementRow = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
};

type PlanEntitlementRow = {
  plan_id: string;
  entitlement_id: string;
  valor_entero: number | null;
  valor_booleano: boolean | null;
};

type DraftPlanEntitlement = {
  entitlement_id: string;
  valor_entero: string;
  valor_booleano: string;
};

const EMPTY_PRICE: DraftPrice = { moneda_id: "", periodo: "MENSUAL", valor: "0", valido_desde: "", valido_hasta: "" };
const EMPTY_ENTITLEMENT_DRAFT: DraftPlanEntitlement = { entitlement_id: "", valor_entero: "", valor_booleano: "" };

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

function isActivo(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === true) return true;
  return false;
}

export default function PlanesPage() {
  const [planes, setPlanes] = useState<Row[]>([]);
  const [itemsPlan, setItemsPlan] = useState<Row[]>([]);
  const [precios, setPrecios] = useState<Row[]>([]);
  const [preciosProductos, setPreciosProductos] = useState<Row[]>([]);
  const [entitlementsPlan, setEntitlementsPlan] = useState<PlanEntitlementRow[]>([]);
  const [entitlements, setEntitlements] = useState<EntitlementRow[]>([]);
  const [lookups, setLookups] = useState<Lookups>({ productos: [], monedas: [], entitlements: [] });
  const [selectedPlan, setSelectedPlan] = useState("");
  const [message, setMessage] = useState("Listo");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState({ codigo: "", nombre: "", descripcion: "", pricing_mode: "BUNDLE", periodo: "MENSUAL", grace_days: "0", activo: "true" });
  const [draftProducts, setDraftProducts] = useState<string[]>([]);
  const [draftNewItemProduct, setDraftNewItemProduct] = useState("");
  const [draftPriceForm, setDraftPriceForm] = useState<DraftPrice>(EMPTY_PRICE);
  const [draftPrices, setDraftPrices] = useState<DraftPrice[]>([]);
  const [manageProductsModal, setManageProductsModal] = useState(false);
  const [managePricesModal, setManagePricesModal] = useState(false);
  const [manageNewItemProduct, setManageNewItemProduct] = useState("");
  const [managePriceForm, setManagePriceForm] = useState<DraftPrice>(EMPTY_PRICE);
  const [manageEntitlementsModal, setManageEntitlementsModal] = useState(false);
  const [manageEntitlementForm, setManageEntitlementForm] = useState<DraftPlanEntitlement>(EMPTY_ENTITLEMENT_DRAFT);
  const [draftEntitlements, setDraftEntitlements] = useState<DraftPlanEntitlement[]>([]);

  const refresh = async () => {
    try {
      const [p, i, pp, pprod, ep, ent, lk] = await Promise.all([
        fetchJson<Row[]>("/api/v1/planes"),
        fetchJson<Row[]>("/api/v1/items-plan"),
        fetchJson<Row[]>("/api/v1/precios-planes"),
        fetchJson<Row[]>("/api/v1/precios"),
        fetchJson<PlanEntitlementRow[]>("/api/v1/entitlements-plan"),
        fetchJson<EntitlementRow[]>("/api/v1/entitlements"),
        fetchJson<Lookups>("/api/backoffice/lookups"),
      ]);
      if (isSuccess(p)) setPlanes(p.data);
      if (isSuccess(i)) setItemsPlan(i.data);
      if (isSuccess(pp)) setPrecios(pp.data);
      if (isSuccess(pprod)) setPreciosProductos(pprod.data);
      if (isSuccess(lk)) setLookups({ productos: lk.data.productos, monedas: lk.data.monedas, entitlements: lk.data.entitlements ?? [] });
      if (isSuccess(ep)) setEntitlementsPlan(ep.data);
      if (isSuccess(ent)) setEntitlements(ent.data);
    } catch {
      toast.error("Error de red al cargar planes.");
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const itemsSelected = useMemo(() => itemsPlan.filter((x) => String(x.plan_id) === selectedPlan), [itemsPlan, selectedPlan]);
  const preciosSelected = useMemo(() => precios.filter((x) => String(x.plan_id) === selectedPlan), [precios, selectedPlan]);
  const entitlementsSelected = useMemo(
    () => entitlementsPlan.filter((x) => String(x.plan_id) === selectedPlan),
    [entitlementsPlan, selectedPlan],
  );

  const openCreate = () => {
    setEditing(null);
    setStep(1);
    setForm({ codigo: "", nombre: "", descripcion: "", pricing_mode: "BUNDLE", periodo: "MENSUAL", grace_days: "0", activo: "true" });
    setDraftProducts([]);
    setDraftPrices([]);
    setDraftNewItemProduct("");
    setDraftPriceForm(EMPTY_PRICE);
    setDraftEntitlements([]);
    setManageEntitlementForm(EMPTY_ENTITLEMENT_DRAFT);
    setManagePriceForm(EMPTY_PRICE);
    setManageNewItemProduct("");
    setModal(true);
  };

  const openEdit = (row: Row) => {
    setEditing(String(row.id));
    setStep(1);
    setForm({
      codigo: String(row.codigo ?? ""),
      nombre: String(row.nombre ?? ""),
      descripcion: String(row.descripcion ?? ""),
      pricing_mode: String(row.pricing_mode ?? "BUNDLE"),
      periodo: String(row.periodo ?? "MENSUAL"),
      grace_days: String(row.grace_days ?? 0),
      activo: String(row.activo ?? true),
    });
    setDraftProducts(itemsPlan.filter((x) => String(x.plan_id) === String(row.id)).map((x) => String(x.producto_id)));
    setDraftPrices([]);
    setDraftEntitlements([]);
    setDraftNewItemProduct("");
    setDraftPriceForm(EMPTY_PRICE);
    setModal(true);
  };

  const savePlan = async () => {
    if (!editing && draftProducts.length === 0) {
      setMessage("Debe asignar minimo un producto al plan.");
      toast.error("Debe asignar minimo un producto al plan.");
      return;
    }

    if (!editing && form.pricing_mode !== "SUM_COMPONENTS" && draftPrices.length === 0) {
      setMessage("Debe crear al menos un precio inicial.");
      toast.error("Debe crear al menos un precio inicial.");
      return;
    }

    try {
      if (editing) {
        const payload = { ...form, activo: form.activo === "true" };
        const res = await fetchJson<Row>(`/api/v1/planes/${editing}`, { method: "PATCH", body: payload });
        if (!isSuccess(res)) {
          setMessage(res.error.message);
          toast.error(res.error.message);
          return;
        }
        setModal(false);
        setMessage("Plan actualizado.");
        toast.success("Plan actualizado.");
        await refresh();
        return;
      }

      const payload = {
        codigo: form.codigo,
        nombre: form.nombre,
        descripcion: form.descripcion,
        pricing_mode: form.pricing_mode,
        periodo: form.periodo,
        grace_days: Number(form.grace_days || 0),
        activo: form.activo === "true",
        productos: draftProducts,
        precios: draftPrices.map((p) => ({
          moneda_id: p.moneda_id,
          periodo: p.periodo,
          valor: Number(p.valor),
          valido_desde: p.valido_desde || null,
          valido_hasta: p.valido_hasta || null,
        })),
        entitlements: draftEntitlements.map((e) => ({
          entitlement_id: e.entitlement_id,
          valor_entero: e.valor_entero.trim() === "" ? null : Number(e.valor_entero),
          valor_booleano:
            e.valor_booleano === ""
              ? null
              : e.valor_booleano === "true",
        })),
      };

      const res = await fetchJson<{ plan_id: string }>("/api/backoffice/planes/create-with-setup", { method: "POST", body: payload });
      if (!isSuccess(res)) {
        setMessage(res.error.message);
        toast.error(res.error.message);
        return;
      }

      setModal(false);
      setMessage("Plan creado correctamente.");
      toast.success("Plan creado correctamente.");
      await refresh();
    } catch {
      toast.error("Error de red al guardar plan.");
    }
  };

  const deletePlan = async (id: string) => {
    try {
      const res = await fetchJson<Row>(`/api/v1/planes/${id}`, { method: "DELETE" });
      if (isSuccess(res)) {
        setMessage("Plan eliminado.");
        toast.success("Plan eliminado.");
        await refresh();
        return;
      }
      setMessage(res.error.message);
      toast.error(res.error.message);
    } catch {
      toast.error("Error de red al eliminar plan.");
    }
  };

  const addProductToPlan = async () => {
    if (!selectedPlan || !manageNewItemProduct) return;
    try {
      const res = await fetchJson<Row>("/api/v1/items-plan", { method: "POST", body: { plan_id: selectedPlan, producto_id: manageNewItemProduct, incluido: true } });
      if (isSuccess(res)) {
        setManageNewItemProduct("");
        setManageProductsModal(false);
        setMessage("Producto agregado al plan.");
        toast.success("Producto agregado al plan.");
        await refresh();
        return;
      }
      setMessage(res.error.message);
      toast.error(res.error.message);
    } catch {
      toast.error("Error de red al agregar producto.");
    }
  };

  const removeProductFromPlan = async (planId: string, productId: string) => {
    try {
      const res = await fetchJson<Row>(`/api/v1/items-plan/${encodeURIComponent(planId)}/${encodeURIComponent(productId)}`, { method: "DELETE" });
      if (isSuccess(res)) {
        setMessage("Producto removido del plan.");
        toast.success("Producto removido del plan.");
        await refresh();
        return;
      }
      setMessage(res.error.message);
      toast.error(res.error.message);
    } catch {
      toast.error("Error de red al remover producto.");
    }
  };

  const addPrice = async () => {
    if (!selectedPlan) return;
    try {
      const payload = {
        plan_id: selectedPlan,
        moneda_id: managePriceForm.moneda_id,
        periodo: managePriceForm.periodo,
        valor: Number(managePriceForm.valor),
        activo: true,
        valido_desde: managePriceForm.valido_desde || null,
        valido_hasta: managePriceForm.valido_hasta || null,
      };
      const res = await fetchJson<Row>("/api/v1/precios-planes", { method: "POST", body: payload });
      if (isSuccess(res)) {
        setMessage("Precio agregado.");
        toast.success("Precio agregado.");
        setManagePriceForm(EMPTY_PRICE);
        setManagePricesModal(false);
        await refresh();
        return;
      }
      setMessage(res.error.message);
      toast.error(res.error.message);
    } catch {
      toast.error("Error de red al agregar precio.");
    }
  };

  const addPlanEntitlement = async () => {
    if (!selectedPlan || !manageEntitlementForm.entitlement_id) return;
    if (entitlementsSelected.some((x) => x.entitlement_id === manageEntitlementForm.entitlement_id)) {
      toast.error("Ese entitlement ya existe en el plan.");
      return;
    }
    try {
      const payload = {
        plan_id: selectedPlan,
        entitlement_id: manageEntitlementForm.entitlement_id,
        valor_entero: manageEntitlementForm.valor_entero.trim() === "" ? null : Number(manageEntitlementForm.valor_entero),
        valor_booleano:
          manageEntitlementForm.valor_booleano === ""
            ? null
            : manageEntitlementForm.valor_booleano === "true",
      };
      const res = await fetchJson<Row>("/api/v1/entitlements-plan", { method: "POST", body: payload });
      if (isSuccess(res)) {
        setManageEntitlementForm(EMPTY_ENTITLEMENT_DRAFT);
        setManageEntitlementsModal(false);
        setMessage("Entitlement agregado al plan.");
        toast.success("Entitlement agregado al plan.");
        await refresh();
        return;
      }
      setMessage(res.error.message);
      toast.error(res.error.message);
    } catch {
      toast.error("Error de red al agregar entitlement.");
    }
  };

  const removePlanEntitlement = async (planId: string, entitlementId: string) => {
    try {
      const res = await fetchJson<Row>(
        `/api/v1/entitlements-plan/${encodeURIComponent(planId)}/${encodeURIComponent(entitlementId)}`,
        { method: "DELETE" },
      );
      if (isSuccess(res)) {
        setMessage("Entitlement removido del plan.");
        toast.success("Entitlement removido del plan.");
        await refresh();
        return;
      }
      setMessage(res.error.message);
      toast.error(res.error.message);
    } catch {
      toast.error("Error de red al remover entitlement.");
    }
  };

  const invalidatePrice = async (priceId: string) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetchJson<Row>(`/api/v1/precios-planes/${priceId}`, {
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
      const res = await fetchJson<Row>(`/api/v1/precios-planes/${priceId}`, { method: "DELETE" });
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

  const pushDraftPrice = () => {
    if (!draftPriceForm.moneda_id || Number(draftPriceForm.valor) <= 0) {
      toast.error("Completa moneda y valor valido para el precio.");
      return;
    }
    setDraftPrices((prev) => [...prev, { ...draftPriceForm }]);
    setDraftPriceForm(EMPTY_PRICE);
  };

  const pushDraftEntitlement = () => {
    if (!manageEntitlementForm.entitlement_id) {
      toast.error("Selecciona un entitlement.");
      return;
    }
    if (draftEntitlements.some((x) => x.entitlement_id === manageEntitlementForm.entitlement_id)) {
      toast.error("Ese entitlement ya esta agregado al borrador.");
      return;
    }
    setDraftEntitlements((prev) => [...prev, { ...manageEntitlementForm }]);
    setManageEntitlementForm(EMPTY_ENTITLEMENT_DRAFT);
  };

  const productName = (id: string) => lookups.productos.find((p) => p.value === id)?.label ?? id;
  const monedaName = (id: string) => lookups.monedas.find((m) => m.value === id)?.label ?? id;
  const entitlementName = (id: string) => lookups.entitlements.find((e) => e.value === id)?.label ?? id;
  const entitlementType = (id: string) => entitlements.find((e) => e.id === id)?.tipo ?? "LIMITE";
  const planPriceLabelById = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const isTrue = (v: unknown) => v === true || String(v).toLowerCase() === "true";
    const isVigente = (desde: unknown, hasta: unknown) => {
      const d = String(desde ?? "");
      const h = String(hasta ?? "");
      if (d && d > today) return false;
      if (h && h < today) return false;
      return true;
    };
    const out = new Map<string, string>();
    for (const plan of planes) {
      const planId = String(plan.id ?? "");
      const pricingMode = String(plan.pricing_mode ?? "BUNDLE");
      const periodo = String(plan.periodo ?? "MENSUAL");
      if (!planId) continue;

      if (pricingMode === "SUM_COMPONENTS") {
        const included = itemsPlan.filter((ip) => String(ip.plan_id) === planId && isTrue(ip.incluido));
        if (included.length === 0) {
          out.set(planId, "INVÁLIDO");
          continue;
        }
        let total = 0;
        let invalid = false;
        for (const item of included) {
          const productId = String(item.producto_id ?? "");
          const qty = Math.max(1, Number(item.cantidad ?? 1));
          const vigentePrices = preciosProductos
            .filter((pp) => String(pp.producto_id) === productId && String(pp.periodo) === periodo && isTrue(pp.activo) && isVigente(pp.valido_desde, pp.valido_hasta))
            .sort((a, b) => String(b.valido_desde ?? "").localeCompare(String(a.valido_desde ?? "")));
          if (vigentePrices.length === 0) {
            invalid = true;
            break;
          }
          total += Number(vigentePrices[0]?.valor ?? 0) * qty;
        }
        out.set(planId, invalid ? "INVÁLIDO" : formatMoney(total));
        continue;
      }

      const vigente = precios
        .filter((pr) => String(pr.plan_id) === planId && String(pr.periodo) === periodo && isTrue(pr.activo) && isVigente(pr.valido_desde, pr.valido_hasta))
        .sort((a, b) => String(b.valido_desde ?? "").localeCompare(String(a.valido_desde ?? "")));
      out.set(planId, vigente.length === 0 ? "INVÁLIDO" : formatMoney(vigente[0]?.valor));
    }
    return out;
  }, [planes, itemsPlan, preciosProductos, precios]);

  return (
    <main className="main-stack">
      <PageHeaderCard title="Planes">
        <button
          onClick={openCreate}
          className="ui-btn ui-btn-primary ui-btn-sm"
        >
          Nuevo plan
        </button>
      </PageHeaderCard>

      <section className="main-card">
        <DataTable<Row>
          className="max-h-[340px] overflow-auto rounded border border-slate-200"
          rows={planes}
          getRowKey={(row, index) => `${String(row.id ?? "")}-${index}`}
          columns={[
            {
              key: "__index",
              header: "#",
              cellClassName: "w-[40px]",
              render: (_row, index) => index + 1,
            },
            {
              key: "nombre",
              header: "Nombre",
            },
            {
              key: "pricing_mode",
              header: "Pricing",
              render: (row) => (
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-semibold">
                  {String((row as any).pricing_mode ?? "BUNDLE")}
                </span>
              ),
            },
            {
              key: "precio",
              header: "Precio",
              render: (row) =>
                planPriceLabelById.get(String((row as any).id)) ?? "INVÁLIDO",
            },
            {
              key: "periodo",
              header: "Ciclo default",
              render: (row) => (
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-semibold">
                  {String((row as any).periodo)}
                </span>
              ),
            },
            {
              key: "activo",
              header: "Estado",
              render: (row) => {
                const activo = isActivo((row as any).activo);
                return (
                  <Badge
                    text={activo ? "ACTIVO" : "INACTIVO"}
                    variant={activo ? "success" : "danger"}
                  />
                );
              },
            },
            {
              key: "__actions",
              header: "Acciones",
              render: (row) => (
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setSelectedPlan(String((row as any).id))}
                    className="ui-btn ui-btn-outline ui-btn-sm"
                  >
                    Gestionar
                  </button>
                  <button
                    onClick={() => openEdit(row as any)}
                    className="ui-btn ui-btn-primary ui-btn-sm"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => deletePlan(String((row as any).id))}
                    className="ui-btn ui-btn-danger ui-btn-sm"
                  >
                    Eliminar
                  </button>
                </div>
              ),
            },
          ] as DataTableColumn<Row>[]}
        />
      </section>

      {selectedPlan && (
        <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <article className="main-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">Productos del plan</h3>
              <button onClick={() => setManageProductsModal(true)} className="ui-btn ui-btn-primary ui-btn-sm">Agregar producto</button>
            </div>
            <ul className="mt-3 space-y-2 text-xs">{itemsSelected.map((x) => <li key={`${String(x.plan_id)}-${String(x.producto_id)}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2"><span>{productName(String(x.producto_id))}</span><button onClick={() => removeProductFromPlan(String(x.plan_id), String(x.producto_id))} className="ui-btn ui-btn-danger ui-btn-sm">Quitar</button></li>)}</ul>
          </article>

          <article className="main-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">Precios del plan</h3>
              <button onClick={() => setManagePricesModal(true)} className="ui-btn ui-btn-primary ui-btn-sm">Agregar precio</button>
            </div>
            <ul className="mt-3 space-y-2 text-xs">
              {preciosSelected.map((pr) => (
                <li key={String(pr.id)} className="rounded border border-slate-200 p-2">
                  <p>{monedaName(String(pr.moneda_id))} | {String(pr.periodo)} | {formatMoney(pr.valor)} | desde {formatDateOnly(pr.valido_desde)} hasta {formatDateOnly(pr.valido_hasta)}</p>
                  <p className="mt-1">
                    <Badge
                      text={isActivo(pr.activo) ? "ACTIVO" : "INACTIVO"}
                      variant={isActivo(pr.activo) ? "success" : "danger"}
                    />
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={() => invalidatePrice(String(pr.id))} className="ui-btn ui-btn-secondary ui-btn-sm">Invalidar hoy</button>
                    <button onClick={() => deletePrice(String(pr.id))} className="ui-btn ui-btn-danger ui-btn-sm">Eliminar</button>
                  </div>
                </li>
              ))}
            </ul>
          </article>

          <article className="main-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">Entitlements del plan</h3>
              <button onClick={() => setManageEntitlementsModal(true)} className="ui-btn ui-btn-primary ui-btn-sm">Agregar entitlement</button>
            </div>
            <ul className="mt-3 space-y-2 text-xs">
              {entitlementsSelected.map((ep) => (
                <li key={`${ep.plan_id}-${ep.entitlement_id}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2">
                  <span>
                    {entitlementName(ep.entitlement_id)} | valor: {ep.valor_entero ?? String(ep.valor_booleano ?? "-")}
                  </span>
                  <button
                    onClick={() => removePlanEntitlement(ep.plan_id, ep.entitlement_id)}
                    className="ui-btn ui-btn-danger ui-btn-sm"
                  >
                    Quitar
                  </button>
                </li>
              ))}
              {entitlementsSelected.length === 0 && <li className="rounded border border-dashed border-slate-300 p-2 text-slate-500">Sin entitlements configurados.</li>}
            </ul>
          </article>
        </section>
      )}

      <p className="text-xs text-slate-600">{message}</p>

      <AppModal
        open={modal}
        onClose={() => setModal(false)}
        maxWidthClassName="max-w-3xl"
        title={editing ? "Editar plan" : "Nuevo plan"}
      >

            {!editing && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => setStep(1)} className={`rounded px-3 py-1.5 text-xs ${step === 1 ? "bg-[var(--color-primary)] text-white" : "border border-slate-300"}`}>Paso 1: Plan + productos</button>
                <button onClick={() => {
                  if (draftProducts.length === 0) {
                    toast.error("Antes de continuar agrega al menos un producto.");
                    return;
                  }
                  setStep(2);
                }} className={`rounded px-3 py-1.5 text-xs ${step === 2 ? "bg-[var(--color-primary)] text-white" : "border border-slate-300"}`}>Paso 2: Precios iniciales</button>
              </div>
            )}

            {(editing || step === 1) && (
              <>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <label className="text-xs">Codigo<input value={form.codigo} onChange={(e) => setForm((p) => ({ ...p, codigo: e.target.value }))} className="mt-1 ui-input" /></label>
                  <label className="text-xs">Nombre<input value={form.nombre} onChange={(e) => setForm((p) => ({ ...p, nombre: e.target.value }))} className="mt-1 ui-input" /></label>
                  <label className="text-xs">Descripcion<input value={form.descripcion} onChange={(e) => setForm((p) => ({ ...p, descripcion: e.target.value }))} className="mt-1 ui-input" /></label>
                  <label className="text-xs">Tipo de precio<select value={form.pricing_mode} onChange={(e) => setForm((p) => ({ ...p, pricing_mode: e.target.value }))} className="mt-1 ui-input"><option value="BUNDLE">Precio fijo del plan</option><option value="SUM_COMPONENTS">Suma de productos</option></select></label>
                  <label className="text-xs">Periodo<select value={form.periodo} onChange={(e) => { const value = e.target.value; setForm((p) => ({ ...p, periodo: value })); setDraftPriceForm((pp) => ({ ...pp, periodo: value })); }} className="mt-1 ui-input"><option value="MENSUAL">MENSUAL</option><option value="TRIMESTRAL">TRIMESTRAL</option><option value="ANUAL">ANUAL</option></select></label>
                  <label className="text-xs">Dias de prorroga<input type="number" min="0" value={form.grace_days} onChange={(e) => setForm((p) => ({ ...p, grace_days: e.target.value }))} className="mt-1 ui-input" /></label>
                  <label className="text-xs">Activo<select value={form.activo} onChange={(e) => setForm((p) => ({ ...p, activo: e.target.value }))} className="mt-1 ui-input"><option value="true">Activo</option><option value="false">Inactivo</option></select></label>
                </div>

                {!editing && (
                  <div className="mt-3 rounded border border-slate-200 p-3">
                    <p className="text-xs font-semibold">Productos obligatorios (minimo 1)</p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row"><select value={draftNewItemProduct} onChange={(e) => setDraftNewItemProduct(e.target.value)} className="ui-input"><option value="">Producto...</option>{lookups.productos.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select><button onClick={() => { if (draftNewItemProduct && !draftProducts.includes(draftNewItemProduct)) setDraftProducts((prev) => [...prev, draftNewItemProduct]); }} className="ui-btn ui-btn-primary ui-btn-sm">Agregar</button></div>
                    <ul className="mt-2 space-y-1 text-xs">{draftProducts.map((p) => <li key={p} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1"><span>{productName(p)}</span><button onClick={() => setDraftProducts((prev) => prev.filter((x) => x !== p))} className="ui-btn ui-btn-danger ui-btn-sm">Quitar</button></li>)}</ul>
                  </div>
                )}
              </>
            )}

            {!editing && step === 2 && (
              <div className="mt-3 rounded border border-slate-200 p-3">
                <p className="text-xs font-semibold">Precios iniciales (minimo 1)</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <label className="text-xs">Moneda<select value={draftPriceForm.moneda_id} onChange={(e) => setDraftPriceForm((p) => ({ ...p, moneda_id: e.target.value }))} className="mt-1 ui-input"><option value="">Moneda...</option>{lookups.monedas.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
                  <label className="text-xs">Periodo<select value={draftPriceForm.periodo} onChange={(e) => setDraftPriceForm((p) => ({ ...p, periodo: e.target.value }))} className="mt-1 ui-input"><option value="MENSUAL">MENSUAL</option><option value="TRIMESTRAL">TRIMESTRAL</option><option value="ANUAL">ANUAL</option></select></label>
                  <label className="text-xs">Valor<input type="number" value={draftPriceForm.valor} onChange={(e) => setDraftPriceForm((p) => ({ ...p, valor: e.target.value }))} className="mt-1 ui-input" /></label>
                  <label className="text-xs">Vigente desde<input type="date" value={draftPriceForm.valido_desde} onChange={(e) => setDraftPriceForm((p) => ({ ...p, valido_desde: e.target.value }))} className="mt-1 ui-input" /></label>
                  <label className="text-xs">Vigente hasta<input type="date" value={draftPriceForm.valido_hasta} onChange={(e) => setDraftPriceForm((p) => ({ ...p, valido_hasta: e.target.value }))} className="mt-1 ui-input" /></label>
                </div>
                <button onClick={pushDraftPrice} className="mt-2 ui-btn ui-btn-primary ui-btn-sm">Agregar precio inicial</button>
                <ul className="mt-2 space-y-1 text-xs">{draftPrices.map((dp, idx) => <li key={`${dp.moneda_id}-${dp.periodo}-${idx}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1"><span>{monedaName(dp.moneda_id)} | {dp.periodo} | {formatMoney(dp.valor)} | {formatDateOnly(dp.valido_desde)} - {formatDateOnly(dp.valido_hasta)}</span><button onClick={() => setDraftPrices((prev) => prev.filter((_, i) => i !== idx))} className="ui-btn ui-btn-danger ui-btn-sm">Quitar</button></li>)}</ul>

                <div className="mt-4 border-t border-slate-200 pt-3">
                  <p className="text-xs font-semibold">Entitlements iniciales (opcional)</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    <label className="text-xs">Entitlement<select value={manageEntitlementForm.entitlement_id} onChange={(e) => setManageEntitlementForm((p) => ({ ...p, entitlement_id: e.target.value, valor_booleano: "", valor_entero: "" }))} className="mt-1 ui-input"><option value="">Entitlement...</option>{lookups.entitlements.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}</select></label>
                    <label className="text-xs">Valor entero<input type="number" value={manageEntitlementForm.valor_entero} onChange={(e) => setManageEntitlementForm((p) => ({ ...p, valor_entero: e.target.value }))} className="mt-1 ui-input" disabled={entitlementType(manageEntitlementForm.entitlement_id) === "BOOLEANO"} /></label>
                    <label className="text-xs">Valor booleano<select value={manageEntitlementForm.valor_booleano} onChange={(e) => setManageEntitlementForm((p) => ({ ...p, valor_booleano: e.target.value }))} className="mt-1 ui-input" disabled={entitlementType(manageEntitlementForm.entitlement_id) !== "BOOLEANO"}><option value="">Sin definir</option><option value="true">Si</option><option value="false">No</option></select></label>
                  </div>
                  <button onClick={pushDraftEntitlement} className="mt-2 ui-btn ui-btn-primary ui-btn-sm">Agregar entitlement</button>
                  <ul className="mt-2 space-y-1 text-xs">{draftEntitlements.map((de, idx) => <li key={`${de.entitlement_id}-${idx}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1"><span>{entitlementName(de.entitlement_id)} | valor: {de.valor_entero || de.valor_booleano || "-"}</span><button onClick={() => setDraftEntitlements((prev) => prev.filter((_, i) => i !== idx))} className="ui-btn ui-btn-danger ui-btn-sm">Quitar</button></li>)}</ul>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button onClick={() => setModal(false)} className="ui-btn ui-btn-outline">Cancelar</button><button onClick={savePlan} className="ui-btn ui-btn-primary">Guardar</button></div>
      </AppModal>

      <AppModal
        open={manageProductsModal}
        onClose={() => setManageProductsModal(false)}
        title="Agregar producto al plan"
      >
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select value={manageNewItemProduct} onChange={(e) => setManageNewItemProduct(e.target.value)} className="ui-input">
                <option value="">Seleccionar producto...</option>
                {lookups.productos.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <button onClick={addProductToPlan} className="ui-btn ui-btn-primary ui-btn-sm">Agregar</button>
            </div>
            <div className="mt-3 flex justify-end">
              <button onClick={() => setManageProductsModal(false)} className="ui-btn ui-btn-outline">Cerrar</button>
            </div>
      </AppModal>

      <AppModal
        open={managePricesModal}
        onClose={() => setManagePricesModal(false)}
        maxWidthClassName="max-w-2xl"
        title="Agregar precio al plan"
      >
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <label className="text-xs">Moneda<select value={managePriceForm.moneda_id} onChange={(e) => setManagePriceForm((p) => ({ ...p, moneda_id: e.target.value }))} className="mt-1 ui-input"><option value="">Moneda...</option>{lookups.monedas.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
              <label className="text-xs">Periodo<select value={managePriceForm.periodo} onChange={(e) => setManagePriceForm((p) => ({ ...p, periodo: e.target.value }))} className="mt-1 ui-input"><option value="MENSUAL">MENSUAL</option><option value="TRIMESTRAL">TRIMESTRAL</option><option value="ANUAL">ANUAL</option></select></label>
              <label className="text-xs">Valor<input type="number" value={managePriceForm.valor} onChange={(e) => setManagePriceForm((p) => ({ ...p, valor: e.target.value }))} className="mt-1 ui-input" /></label>
              <label className="text-xs">Vigente desde<input type="date" value={managePriceForm.valido_desde} onChange={(e) => setManagePriceForm((p) => ({ ...p, valido_desde: e.target.value }))} className="mt-1 ui-input" /></label>
              <label className="text-xs">Vigente hasta<input type="date" value={managePriceForm.valido_hasta} onChange={(e) => setManagePriceForm((p) => ({ ...p, valido_hasta: e.target.value }))} className="mt-1 ui-input" /></label>
            </div>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => setManagePricesModal(false)} className="ui-btn ui-btn-outline">Cancelar</button>
              <button onClick={addPrice} className="ui-btn ui-btn-primary">Agregar precio</button>
            </div>
      </AppModal>

      <AppModal
        open={manageEntitlementsModal}
        onClose={() => setManageEntitlementsModal(false)}
        maxWidthClassName="max-w-2xl"
        title="Agregar entitlement al plan"
      >
        
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <label className="text-xs">Entitlement<select value={manageEntitlementForm.entitlement_id} onChange={(e) => setManageEntitlementForm((p) => ({ ...p, entitlement_id: e.target.value, valor_booleano: "", valor_entero: "" }))} className="mt-1 ui-input"><option value="">Entitlement...</option>{lookups.entitlements.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}</select></label>
              <label className="text-xs">Valor entero<input type="number" value={manageEntitlementForm.valor_entero} onChange={(e) => setManageEntitlementForm((p) => ({ ...p, valor_entero: e.target.value }))} className="mt-1 ui-input" disabled={entitlementType(manageEntitlementForm.entitlement_id) === "BOOLEANO"} /></label>
              <label className="text-xs">Valor booleano<select value={manageEntitlementForm.valor_booleano} onChange={(e) => setManageEntitlementForm((p) => ({ ...p, valor_booleano: e.target.value }))} className="mt-1 ui-input" disabled={entitlementType(manageEntitlementForm.entitlement_id) !== "BOOLEANO"}><option value="">Sin definir</option><option value="true">Si</option><option value="false">No</option></select></label>
            </div>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => setManageEntitlementsModal(false)} className="ui-btn ui-btn-outline">Cancelar</button>
              <button onClick={addPlanEntitlement} className="ui-btn ui-btn-primary">Agregar entitlement</button>
            </div>
      </AppModal>
    </main>
  );
}
