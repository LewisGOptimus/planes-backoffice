"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { fetchJson, isSuccess } from "@/lib/client/api";
import { formatDateOnly } from "@/lib/client/date-format";
import { toHumanError } from "@/lib/client/error-mapping";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeaderCard } from "@/components/ui/page-header-card";
import { AppModal } from "@/components/ui/modal";
import type { ApiErrorPayload } from "@/lib/types/api";

type Lookup = {
  empresas: Array<{ value: string; label: string }>;
  planes: Array<{ value: string; label: string }>;
  suscripciones: Array<{ value: string; label: string }>;
};

type Entitlement = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: "BOOLEANO" | "LIMITE" | "CONTADOR";
  alcance: "EMPRESA" | "USUARIO";
  descripcion: string | null;
};

type PlanEntitlement = {
  plan_id: string;
  entitlement_id: string;
  codigo: string;
  nombre: string;
  tipo: "BOOLEANO" | "LIMITE" | "CONTADOR";
  valor_entero: number | null;
  valor_booleano: boolean | null;
};

type SubscriptionEntitlement = {
  suscripcion_id: string;
  entitlement_id: string;
  codigo: string;
  nombre: string;
  tipo: "BOOLEANO" | "LIMITE" | "CONTADOR";
  valor_entero: number | null;
  valor_booleano: boolean | null;
  origen: "PLAN" | "ADDON" | "MANUAL" | "LEGACY";
  efectivo_desde: string;
  efectivo_hasta: string | null;
};

type EmpresaEntitlement = {
  fuente: string;
  codigo: string;
  nombre: string;
  tipo: string;
  valor_entero: number | null;
  valor_booleano: boolean | null;
};

type EntitlementForm = {
  codigo: string;
  nombre: string;
  tipo: Entitlement["tipo"];
  alcance: Entitlement["alcance"];
  descripcion: string;
};

type TypedValueForm = {
  entitlement_id: string;
  valor_entero: string;
  valor_booleano: "" | "true" | "false";
};

type OverrideForm = TypedValueForm & {
  origen: "ADDON" | "MANUAL" | "LEGACY";
  efectivo_desde: string;
  efectivo_hasta: string;
};
type EntitlementPanel = "catalogo" | "planes" | "suscripciones" | "empresa";

const EMPTY_ENTITLEMENT: EntitlementForm = {
  codigo: "",
  nombre: "",
  tipo: "LIMITE",
  alcance: "EMPRESA",
  descripcion: "",
};

const EMPTY_TYPED: TypedValueForm = {
  entitlement_id: "",
  valor_entero: "",
  valor_booleano: "",
};

const EMPTY_OVERRIDE: OverrideForm = {
  ...EMPTY_TYPED,
  origen: "ADDON",
  efectivo_desde: new Date().toISOString().slice(0, 10),
  efectivo_hasta: "",
};

const valueLabel = (row: { valor_entero: number | null; valor_booleano: boolean | null }) =>
  row.valor_entero ?? String(row.valor_booleano ?? "-");

function badge(text: string) {
  return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold">{text}</span>;
}

export default function EntitlementsPage() {
  const [lookups, setLookups] = useState<Lookup>({ empresas: [], planes: [], suscripciones: [] });
  const [catalog, setCatalog] = useState<Entitlement[]>([]);
  const [planRows, setPlanRows] = useState<PlanEntitlement[]>([]);
  const [subscriptionRows, setSubscriptionRows] = useState<SubscriptionEntitlement[]>([]);
  const [empresaRows, setEmpresaRows] = useState<EmpresaEntitlement[]>([]);

  const [planId, setPlanId] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [empresaId, setEmpresaId] = useState("");

  const [newEntitlementModal, setNewEntitlementModal] = useState(false);
  const [newPlanValueModal, setNewPlanValueModal] = useState(false);
  const [newOverrideModal, setNewOverrideModal] = useState(false);
  const [activePanel, setActivePanel] = useState<EntitlementPanel>("catalogo");

  const [entitlementForm, setEntitlementForm] = useState(EMPTY_ENTITLEMENT);
  const [planValueForm, setPlanValueForm] = useState<TypedValueForm>(EMPTY_TYPED);
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(EMPTY_OVERRIDE);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Gestiona catálogo, planes y overrides de entitlements.");

  const byId = useMemo(() => new Map(catalog.map((x) => [x.id, x])), [catalog]);
  const planType = byId.get(planValueForm.entitlement_id)?.tipo ?? "LIMITE";
  const overrideType = byId.get(overrideForm.entitlement_id)?.tipo ?? "LIMITE";

  const showError = useCallback((payload: ApiErrorPayload) => {
    const msg = toHumanError(payload.error.code, payload.error.message);
    setMessage(msg);
    toast.error(msg);
  }, []);

  const loadLookups = useCallback(async () => {
    const res = await fetchJson<Lookup>("/api/backoffice/lookups");
    if (isSuccess(res)) setLookups({ empresas: res.data.empresas, planes: res.data.planes, suscripciones: res.data.suscripciones });
    else showError(res);
  }, [showError]);

  const loadCatalog = useCallback(async () => {
    const res = await fetchJson<Entitlement[]>("/api/backoffice/entitlements/catalog");
    if (isSuccess(res)) setCatalog(res.data);
    else showError(res);
  }, [showError]);

  const loadPlanRows = useCallback(async (nextPlanId: string) => {
    if (!nextPlanId) return setPlanRows([]);
    const res = await fetchJson<PlanEntitlement[]>(`/api/backoffice/planes/${nextPlanId}/entitlements`);
    if (isSuccess(res)) setPlanRows(res.data);
    else showError(res);
  }, [showError]);

  const loadSubscriptionRows = useCallback(async (nextSubscriptionId: string) => {
    if (!nextSubscriptionId) return setSubscriptionRows([]);
    const res = await fetchJson<SubscriptionEntitlement[]>(
      `/api/backoffice/suscripciones/${nextSubscriptionId}/entitlements?historial=true`,
    );
    if (isSuccess(res)) setSubscriptionRows(res.data);
    else showError(res);
  }, [showError]);

  const loadEmpresaRows = useCallback(async (nextEmpresaId: string) => {
    if (!nextEmpresaId) return setEmpresaRows([]);
    const res = await fetchJson<EmpresaEntitlement[]>(`/api/backoffice/empresas/${nextEmpresaId}/entitlements`);
    if (isSuccess(res)) setEmpresaRows(res.data);
    else showError(res);
  }, [showError]);

  useEffect(() => {
    const t = setTimeout(() => void Promise.all([loadLookups(), loadCatalog()]), 0);
    return () => clearTimeout(t);
  }, [loadCatalog, loadLookups]);

  useEffect(() => {
    const t = setTimeout(() => void loadPlanRows(planId), 0);
    return () => clearTimeout(t);
  }, [loadPlanRows, planId]);

  useEffect(() => {
    const t = setTimeout(() => void loadSubscriptionRows(subscriptionId), 0);
    return () => clearTimeout(t);
  }, [loadSubscriptionRows, subscriptionId]);

  useEffect(() => {
    const t = setTimeout(() => void loadEmpresaRows(empresaId), 0);
    return () => clearTimeout(t);
  }, [empresaId, loadEmpresaRows]);

  const parseTyped = (kind: "BOOLEANO" | "LIMITE" | "CONTADOR", form: TypedValueForm) => {
    if (kind === "BOOLEANO") {
      if (!form.valor_booleano) throw new Error("Para BOOLEANO debes indicar true o false.");
      return { valor_entero: null, valor_booleano: form.valor_booleano === "true" };
    }
    if (!form.valor_entero.trim()) throw new Error("Para LIMITE/CONTADOR debes indicar valor entero.");
    return { valor_entero: Number(form.valor_entero), valor_booleano: null };
  };

  const saveEntitlement = async () => {
    if (!entitlementForm.codigo.trim() || !entitlementForm.nombre.trim()) {
      toast.error("Codigo y nombre son obligatorios.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetchJson<Entitlement>("/api/backoffice/entitlements/catalog", {
        method: "POST",
        body: {
          ...entitlementForm,
          codigo: entitlementForm.codigo.trim(),
          nombre: entitlementForm.nombre.trim(),
          descripcion: entitlementForm.descripcion.trim() || null,
        },
      });
      if (!isSuccess(res)) return showError(res);
      setNewEntitlementModal(false);
      setMessage("Entitlement creado.");
      toast.success("Entitlement creado.");
      await Promise.all([loadCatalog(), loadLookups()]);
    } catch {
      toast.error("Error de red al crear entitlement.");
    } finally {
      setBusy(false);
    }
  };

  const savePlanValue = async () => {
    if (!planId || !planValueForm.entitlement_id) return toast.error("Selecciona plan y entitlement.");
    let typed: { valor_entero: number | null; valor_booleano: boolean | null };
    try {
      typed = parseTyped(planType, planValueForm);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Datos invalidos.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetchJson<PlanEntitlement>(`/api/backoffice/planes/${planId}/entitlements`, {
        method: "POST",
        body: { entitlement_id: planValueForm.entitlement_id, ...typed },
      });
      if (!isSuccess(res)) return showError(res);
      setNewPlanValueModal(false);
      setMessage("Entitlement del plan guardado.");
      toast.success("Entitlement del plan guardado.");
      await loadPlanRows(planId);
    } catch {
      toast.error("Error de red al guardar entitlement del plan.");
    } finally {
      setBusy(false);
    }
  };

  const removePlanValue = async (row: PlanEntitlement) => {
    setBusy(true);
    try {
      const res = await fetchJson<PlanEntitlement>(
        `/api/backoffice/planes/${encodeURIComponent(row.plan_id)}/entitlements/${encodeURIComponent(row.entitlement_id)}`,
        { method: "DELETE" },
      );
      if (!isSuccess(res)) return showError(res);
      setMessage("Entitlement removido del plan.");
      toast.success("Entitlement removido del plan.");
      await loadPlanRows(planId);
    } catch {
      toast.error("Error de red al remover entitlement del plan.");
    } finally {
      setBusy(false);
    }
  };

  const saveOverride = async () => {
    if (!subscriptionId || !overrideForm.entitlement_id) return toast.error("Selecciona suscripción y entitlement.");
    if (!overrideForm.efectivo_desde) return toast.error("Define efectivo_desde.");
    if (overrideForm.efectivo_hasta && overrideForm.efectivo_hasta < overrideForm.efectivo_desde) {
      return toast.error("efectivo_hasta no puede ser menor a efectivo_desde.");
    }
    let typed: { valor_entero: number | null; valor_booleano: boolean | null };
    try {
      typed = parseTyped(overrideType, overrideForm);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Datos invalidos.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetchJson<SubscriptionEntitlement>(
        `/api/backoffice/suscripciones/${subscriptionId}/entitlements`,
        {
          method: "POST",
          body: {
            entitlement_id: overrideForm.entitlement_id,
            origen: overrideForm.origen,
            efectivo_desde: overrideForm.efectivo_desde,
            efectivo_hasta: overrideForm.efectivo_hasta || null,
            ...typed,
          },
        },
      );
      if (!isSuccess(res)) return showError(res);
      setNewOverrideModal(false);
      setMessage("Override guardado.");
      toast.success("Override guardado.");
      await loadSubscriptionRows(subscriptionId);
    } catch {
      toast.error("Error de red al guardar override.");
    } finally {
      setBusy(false);
    }
  };

  const closeOverride = async (row: SubscriptionEntitlement) => {
    if (row.origen === "PLAN") return toast.error("Los de origen PLAN se gestionan desde el plan.");
    const today = new Date().toISOString().slice(0, 10);
    setBusy(true);
    try {
      const res = await fetchJson<SubscriptionEntitlement>(
        `/api/backoffice/suscripciones/${encodeURIComponent(row.suscripcion_id)}/entitlements/${encodeURIComponent(row.entitlement_id)}/${encodeURIComponent(row.efectivo_desde)}`,
        { method: "PATCH", body: { efectivo_hasta: today } },
      );
      if (!isSuccess(res)) return showError(res);
      setMessage("Override cerrado con fecha de hoy.");
      toast.success("Override cerrado con fecha de hoy.");
      await loadSubscriptionRows(subscriptionId);
    } catch {
      toast.error("Error de red al cerrar override.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="main-stack">
      <PageHeaderCard
        title="Entitlements"
        description="Catálogo global, asignación por plan y ajustes puntuales por suscripción."
      >
        <button onClick={() => { setEntitlementForm(EMPTY_ENTITLEMENT); setNewEntitlementModal(true); }} className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy}>
          Nuevo entitlement
        </button>
      </PageHeaderCard>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Catálogo</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{catalog.length}</p>
          <p className="text-xs text-slate-500">Entitlements registrados</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Plan activo</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{planRows.length}</p>
          <p className="text-xs text-slate-500">{planId ? "Asignaciones en el plan" : "Selecciona un plan"}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Suscripción activa</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{subscriptionRows.length}</p>
          <p className="text-xs text-slate-500">{subscriptionId ? "Entradas en historial" : "Selecciona una suscripción"}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Empresa consultada</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{empresaRows.length}</p>
          <p className="text-xs text-slate-500">{empresaId ? "Entitlements vigentes" : "Selecciona una empresa"}</p>
        </article>
      </section>

      <section className="main-card space-y-4">
        <div className="main-section-header">
          <h3 className="main-section-title">Centro de operaciones</h3>
          <span className="text-xs text-slate-500">Visualiza un proceso a la vez</span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <button
            onClick={() => setActivePanel("catalogo")}
            className={`rounded-xl border px-3 py-2 text-left transition ${activePanel === "catalogo" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}
            disabled={busy}
          >
            <p className="text-xs font-semibold">1. Catálogo</p>
            <p className={`text-[11px] ${activePanel === "catalogo" ? "text-slate-200" : "text-slate-500"}`}>Base global de entitlements</p>
          </button>
          <button
            onClick={() => setActivePanel("planes")}
            className={`rounded-xl border px-3 py-2 text-left transition ${activePanel === "planes" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}
            disabled={busy}
          >
            <p className="text-xs font-semibold">2. Planes</p>
            <p className={`text-[11px] ${activePanel === "planes" ? "text-slate-200" : "text-slate-500"}`}>Asignación por plan</p>
          </button>
          <button
            onClick={() => setActivePanel("suscripciones")}
            className={`rounded-xl border px-3 py-2 text-left transition ${activePanel === "suscripciones" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}
            disabled={busy}
          >
            <p className="text-xs font-semibold">3. Suscripciones</p>
            <p className={`text-[11px] ${activePanel === "suscripciones" ? "text-slate-200" : "text-slate-500"}`}>Overrides y vigencias</p>
          </button>
          <button
            onClick={() => setActivePanel("empresa")}
            className={`rounded-xl border px-3 py-2 text-left transition ${activePanel === "empresa" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}
            disabled={busy}
          >
            <p className="text-xs font-semibold">4. Empresa</p>
            <p className={`text-[11px] ${activePanel === "empresa" ? "text-slate-200" : "text-slate-500"}`}>Consulta de vigentes</p>
          </button>
        </div>

        {activePanel === "catalogo" ? (
          <article className="rounded-xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-900">Catálogo global</h4>
            <p className="mt-1 text-xs text-slate-500">Define el inventario base de entitlements disponibles.</p>
            <DataTable<Entitlement>
              className="mt-3 max-h-[340px] overflow-auto rounded border border-slate-200"
              rows={catalog}
              getRowKey={(r) => r.id}
              emptyMessage="Sin entitlements."
              columns={[
                { key: "codigo", header: "Codigo" },
                { key: "nombre", header: "Nombre" },
                { key: "tipo", header: "Tipo", render: (r) => badge(r.tipo) },
                { key: "alcance", header: "Alcance", render: (r) => badge(r.alcance) },
                { key: "descripcion", header: "Descripcion", render: (r) => r.descripcion || "-" },
              ] as DataTableColumn<Entitlement>[]}
            />
          </article>
        ) : null}

        {activePanel === "planes" ? (
          <article className="rounded-xl border border-slate-200 p-4">
            <div className="main-section-header">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Asignación por plan</h4>
                <p className="mt-1 text-xs text-slate-500">Selecciona un plan y administra sus entitlements.</p>
              </div>
              <button onClick={() => { if (!planId) return toast.error("Selecciona un plan."); setPlanValueForm(EMPTY_TYPED); setNewPlanValueModal(true); }} className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy || !planId}>Asignar</button>
            </div>
            <label className="ui-label mt-3">Plan
              <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="ui-input mt-1">
                <option value="">Seleccionar...</option>
                {lookups.planes.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <DataTable<PlanEntitlement>
              className="mt-3 max-h-[340px] overflow-auto rounded border border-slate-200"
              rows={planRows}
              getRowKey={(r) => `${r.plan_id}-${r.entitlement_id}`}
              emptyMessage="Sin entitlements en el plan."
              columns={[
                { key: "entitlement", header: "Entitlement", render: (r) => `${r.nombre} (${r.codigo})` },
                { key: "tipo", header: "Tipo", render: (r) => badge(r.tipo) },
                { key: "valor", header: "Valor", render: (r) => valueLabel(r) },
                { key: "acciones", header: "Acciones", render: (r) => <button onClick={() => removePlanValue(r)} className="ui-btn ui-btn-danger ui-btn-sm" disabled={busy}>Quitar</button> },
              ] as DataTableColumn<PlanEntitlement>[]}
            />
          </article>
        ) : null}

        {activePanel === "suscripciones" ? (
          <article className="rounded-xl border border-slate-200 p-4">
            <div className="main-section-header">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Overrides por suscripción</h4>
                <p className="mt-1 text-xs text-slate-500">Ajustes manuales y control de vigencias por suscripción.</p>
              </div>
              <button onClick={() => { if (!subscriptionId) return toast.error("Selecciona una suscripción."); setOverrideForm(EMPTY_OVERRIDE); setNewOverrideModal(true); }} className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy || !subscriptionId}>Nuevo override</button>
            </div>
            <label className="ui-label mt-3">Suscripción
              <select value={subscriptionId} onChange={(e) => setSubscriptionId(e.target.value)} className="ui-input mt-1">
                <option value="">Seleccionar...</option>
                {lookups.suscripciones.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <DataTable<SubscriptionEntitlement>
              className="mt-3 max-h-[340px] overflow-auto rounded border border-slate-200"
              rows={subscriptionRows}
              getRowKey={(r) => `${r.suscripcion_id}-${r.entitlement_id}-${r.efectivo_desde}`}
              emptyMessage="Sin historial."
              columns={[
                { key: "entitlement", header: "Entitlement", render: (r) => `${r.nombre} (${r.codigo})` },
                { key: "origen", header: "Origen", render: (r) => badge(r.origen) },
                { key: "valor", header: "Valor", render: (r) => valueLabel(r) },
                { key: "vigencia", header: "Vigencia", render: (r) => `${formatDateOnly(r.efectivo_desde)} - ${formatDateOnly(r.efectivo_hasta)}` },
                { key: "acciones", header: "Acciones", render: (r) => r.efectivo_hasta ? badge("Cerrado") : <button onClick={() => closeOverride(r)} className="ui-btn ui-btn-outline ui-btn-sm" disabled={busy || r.origen === "PLAN"}>Finalizar hoy</button> },
              ] as DataTableColumn<SubscriptionEntitlement>[]}
            />
          </article>
        ) : null}

        {activePanel === "empresa" ? (
          <article className="rounded-xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-900">Consulta vigentes por empresa</h4>
            <p className="mt-1 text-xs text-slate-500">Vista consolidada de entitlements efectivos en la fecha actual.</p>
            <label className="ui-label mt-3">Empresa
              <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="ui-input mt-1">
                <option value="">Seleccionar...</option>
                {lookups.empresas.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
              </select>
            </label>
            <DataTable<EmpresaEntitlement>
              className="mt-3 max-h-[340px] overflow-auto rounded border border-slate-200"
              rows={empresaRows}
              getRowKey={(r, idx) => `${r.fuente}-${r.codigo}-${idx}`}
              emptyMessage="Sin entitlements vigentes."
              columns={[
                { key: "fuente", header: "Fuente", render: (r) => badge(r.fuente) },
                { key: "codigo", header: "Codigo" },
                { key: "nombre", header: "Nombre" },
                { key: "tipo", header: "Tipo", render: (r) => badge(r.tipo) },
                { key: "valor", header: "Valor", render: (r) => valueLabel(r) },
              ] as DataTableColumn<EmpresaEntitlement>[]}
            />
          </article>
        ) : null}
      </section>

      <p className="text-xs text-slate-600">{message}</p>

      <AppModal open={newEntitlementModal} onClose={() => setNewEntitlementModal(false)} title="Nuevo entitlement" maxWidthClassName="max-w-2xl">
        <div className="grid gap-2 md:grid-cols-2">
          <label className="ui-label">Codigo<input value={entitlementForm.codigo} onChange={(e) => setEntitlementForm((p) => ({ ...p, codigo: e.target.value }))} className="ui-input mt-1" /></label>
          <label className="ui-label">Nombre<input value={entitlementForm.nombre} onChange={(e) => setEntitlementForm((p) => ({ ...p, nombre: e.target.value }))} className="ui-input mt-1" /></label>
          <label className="ui-label">Tipo<select value={entitlementForm.tipo} onChange={(e) => setEntitlementForm((p) => ({ ...p, tipo: e.target.value as EntitlementForm["tipo"] }))} className="ui-input mt-1"><option value="LIMITE">LIMITE</option><option value="CONTADOR">CONTADOR</option><option value="BOOLEANO">BOOLEANO</option></select></label>
          <label className="ui-label">Alcance<select value={entitlementForm.alcance} onChange={(e) => setEntitlementForm((p) => ({ ...p, alcance: e.target.value as EntitlementForm["alcance"] }))} className="ui-input mt-1"><option value="EMPRESA">EMPRESA</option><option value="USUARIO">USUARIO</option></select></label>
          <label className="ui-label md:col-span-2">Descripcion<textarea value={entitlementForm.descripcion} onChange={(e) => setEntitlementForm((p) => ({ ...p, descripcion: e.target.value }))} className="ui-input mt-1 min-h-24" /></label>
        </div>
        <div className="mt-3 flex justify-end gap-2"><button onClick={() => setNewEntitlementModal(false)} className="ui-btn ui-btn-outline" disabled={busy}>Cancelar</button><button onClick={saveEntitlement} className="ui-btn ui-btn-primary" disabled={busy}>Guardar</button></div>
      </AppModal>

      <AppModal open={newPlanValueModal} onClose={() => setNewPlanValueModal(false)} title="Asignar entitlement al plan" maxWidthClassName="max-w-2xl">
        <div className="grid gap-2 md:grid-cols-2">
          <label className="ui-label md:col-span-2">Entitlement<select value={planValueForm.entitlement_id} onChange={(e) => setPlanValueForm((p) => ({ ...p, entitlement_id: e.target.value, valor_entero: "", valor_booleano: "" }))} className="ui-input mt-1"><option value="">Seleccionar...</option>{catalog.map((x) => <option key={x.id} value={x.id}>{`${x.nombre} (${x.codigo} | ${x.tipo})`}</option>)}</select></label>
          <label className="ui-label">Valor entero<input type="number" min="0" value={planValueForm.valor_entero} onChange={(e) => setPlanValueForm((p) => ({ ...p, valor_entero: e.target.value }))} className="ui-input mt-1" disabled={planType === "BOOLEANO"} /></label>
          <label className="ui-label">Valor booleano<select value={planValueForm.valor_booleano} onChange={(e) => setPlanValueForm((p) => ({ ...p, valor_booleano: e.target.value as TypedValueForm["valor_booleano"] }))} className="ui-input mt-1" disabled={planType !== "BOOLEANO"}><option value="">Sin definir</option><option value="true">true</option><option value="false">false</option></select></label>
        </div>
        <div className="mt-3 flex justify-end gap-2"><button onClick={() => setNewPlanValueModal(false)} className="ui-btn ui-btn-outline" disabled={busy}>Cancelar</button><button onClick={savePlanValue} className="ui-btn ui-btn-primary" disabled={busy}>Guardar</button></div>
      </AppModal>

      <AppModal open={newOverrideModal} onClose={() => setNewOverrideModal(false)} title="Nuevo override" maxWidthClassName="max-w-3xl">
        <div className="grid gap-2 md:grid-cols-2">
          <label className="ui-label md:col-span-2">Entitlement<select value={overrideForm.entitlement_id} onChange={(e) => setOverrideForm((p) => ({ ...p, entitlement_id: e.target.value, valor_entero: "", valor_booleano: "" }))} className="ui-input mt-1"><option value="">Seleccionar...</option>{catalog.map((x) => <option key={x.id} value={x.id}>{`${x.nombre} (${x.codigo} | ${x.tipo})`}</option>)}</select></label>
          <label className="ui-label">Origen<select value={overrideForm.origen} onChange={(e) => setOverrideForm((p) => ({ ...p, origen: e.target.value as OverrideForm["origen"] }))} className="ui-input mt-1"><option value="ADDON">ADDON</option><option value="MANUAL">MANUAL</option><option value="LEGACY">LEGACY</option></select></label>
          <label className="ui-label">Valor entero<input type="number" min="0" value={overrideForm.valor_entero} onChange={(e) => setOverrideForm((p) => ({ ...p, valor_entero: e.target.value }))} className="ui-input mt-1" disabled={overrideType === "BOOLEANO"} /></label>
          <label className="ui-label">Valor booleano<select value={overrideForm.valor_booleano} onChange={(e) => setOverrideForm((p) => ({ ...p, valor_booleano: e.target.value as OverrideForm["valor_booleano"] }))} className="ui-input mt-1" disabled={overrideType !== "BOOLEANO"}><option value="">Sin definir</option><option value="true">true</option><option value="false">false</option></select></label>
          <label className="ui-label">Efectivo desde<input type="date" value={overrideForm.efectivo_desde} onChange={(e) => setOverrideForm((p) => ({ ...p, efectivo_desde: e.target.value }))} className="ui-input mt-1" /></label>
          <label className="ui-label">Efectivo hasta<input type="date" value={overrideForm.efectivo_hasta} onChange={(e) => setOverrideForm((p) => ({ ...p, efectivo_hasta: e.target.value }))} className="ui-input mt-1" /></label>
        </div>
        <div className="mt-3 flex justify-end gap-2"><button onClick={() => setNewOverrideModal(false)} className="ui-btn ui-btn-outline" disabled={busy}>Cancelar</button><button onClick={saveOverride} className="ui-btn ui-btn-primary" disabled={busy}>Guardar</button></div>
      </AppModal>
    </main>
  );
}
