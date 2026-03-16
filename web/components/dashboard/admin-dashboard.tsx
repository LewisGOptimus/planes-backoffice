"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJson, isSuccess } from "@/lib/client/api";
import { useAppState } from "@/lib/client/app-state";
import { formatDateOnly, looksLikeDateField } from "@/lib/client/date-format";
import { formatMoney, looksLikeMoneyField } from "@/lib/client/currency-format";
import { toHumanError } from "@/lib/client/error-mapping";
import { WorkflowId } from "@/lib/types/workflows";
import { AppModal } from "@/components/ui/modal";

type Row = Record<string, unknown> & { id?: string };
type FormMode = "create" | "edit";
type TechnicalTab = "cases" | "diagnostics";
type View =
  | { kind: "entity"; key: string }
  | { kind: "overview" }
  | { kind: "technical"; tab: TechnicalTab };

type EntityConfig = {
  key: string;
  label: string;
  resource: string;
  description: string;
  mutable: boolean;
  fields: Array<{ key: string; label: string; type?: "text" | "date" | "number" | "select"; options?: string[] }>;
  columns: Array<{ key: string; label: string }>;
  initial: Record<string, string>;
};

type PlanItemDraft = { productoId: string; incluido: boolean; cantidad: string };
type SubscriptionWizard = { empresaId: string; planId: string; precioPlanId: string; fechaInicio: string; modoRenovacion: "MANUAL" | "AUTOMATICA" };

type CaseConfig = {
  id: WorkflowId;
  caso: number;
  title: string;
  fields: Array<{ name: string; label: string; type?: "text" | "date" | "number" }>;
  initial: Record<string, string>;
};

const ENTITIES: EntityConfig[] = [
  { key: "usuarios", label: "Usuarios", resource: "usuarios", description: "Usuarios de negocio.", mutable: true, fields: [{ key: "email", label: "Email" }, { key: "nombre", label: "Nombre" }, { key: "activo", label: "Activo", type: "select", options: ["true", "false"] }], columns: [{ key: "id", label: "ID" }, { key: "email", label: "Email" }, { key: "nombre", label: "Nombre" }, { key: "activo", label: "Activo" }], initial: { email: "", nombre: "", activo: "true" } },
  { key: "empresas", label: "Empresas", resource: "empresas", description: "Empresas cliente.", mutable: true, fields: [{ key: "nombre", label: "Nombre" }, { key: "nit", label: "NIT" }, { key: "timezone", label: "Zona horaria" }, { key: "activa", label: "Activa", type: "select", options: ["true", "false"] }], columns: [{ key: "id", label: "ID" }, { key: "nombre", label: "Nombre" }, { key: "nit", label: "NIT" }, { key: "activa", label: "Activa" }], initial: { nombre: "", nit: "", timezone: "UTC", activa: "true" } },
  { key: "productos", label: "Productos", resource: "productos", description: "Catalogo de productos.", mutable: true, fields: [{ key: "codigo", label: "Codigo" }, { key: "nombre", label: "Nombre" }, { key: "descripcion", label: "Descripcion" }, { key: "tipo", label: "Tipo", type: "select", options: ["SOFTWARE", "MODULO", "ADDON", "CONSUMIBLE", "SERVICIO"] }, { key: "alcance", label: "Alcance", type: "select", options: ["EMPRESA", "USUARIO", "GLOBAL"] }, { key: "es_consumible", label: "Consumible", type: "select", options: ["true", "false"] }, { key: "activo", label: "Activo", type: "select", options: ["true", "false"] }], columns: [{ key: "id", label: "ID" }, { key: "codigo", label: "Codigo" }, { key: "nombre", label: "Nombre" }, { key: "tipo", label: "Tipo" }, { key: "activo", label: "Activo" }], initial: { codigo: "", nombre: "", descripcion: "", tipo: "SERVICIO", alcance: "EMPRESA", es_consumible: "false", activo: "true" } },
  { key: "planes", label: "Planes", resource: "planes", description: "Planes comerciales.", mutable: true, fields: [{ key: "codigo", label: "Codigo" }, { key: "nombre", label: "Nombre" }, { key: "descripcion", label: "Descripcion" }, { key: "periodo", label: "Periodo", type: "select", options: ["MENSUAL", "TRIMESTRAL", "ANUAL"] }, { key: "activo", label: "Activo", type: "select", options: ["true", "false"] }], columns: [{ key: "id", label: "ID" }, { key: "codigo", label: "Codigo" }, { key: "nombre", label: "Nombre" }, { key: "periodo", label: "Periodo" }, { key: "activo", label: "Activo" }], initial: { codigo: "", nombre: "", descripcion: "", periodo: "MENSUAL", activo: "true" } },
  { key: "precios-planes", label: "Precios de Plan", resource: "precios-planes", description: "Precios vigentes por plan.", mutable: false, fields: [], columns: [{ key: "id", label: "ID" }, { key: "plan_id", label: "Plan" }, { key: "periodo", label: "Periodo" }, { key: "valor", label: "Valor" }, { key: "valido_desde", label: "Desde" }, { key: "valido_hasta", label: "Hasta" }], initial: {} },
  { key: "suscripciones", label: "Suscripciones", resource: "suscripciones", description: "Suscripciones por empresa.", mutable: true, fields: [{ key: "empresa_id", label: "Empresa" }, { key: "plan_id", label: "Plan" }, { key: "precio_plan_id", label: "Precio plan" }, { key: "estado", label: "Estado", type: "select", options: ["ACTIVA", "PAUSADA", "CANCELADA", "EXPIRADA"] }, { key: "periodo", label: "Periodo", type: "select", options: ["MENSUAL", "TRIMESTRAL", "ANUAL"] }, { key: "modo_renovacion", label: "Modo", type: "select", options: ["MANUAL", "AUTOMATICA"] }, { key: "fecha_inicio", label: "Fecha inicio", type: "date" }, { key: "periodo_actual_inicio", label: "Periodo inicio", type: "date" }, { key: "periodo_actual_fin", label: "Periodo fin", type: "date" }], columns: [{ key: "id", label: "ID" }, { key: "empresa_id", label: "Empresa" }, { key: "plan_id", label: "Plan" }, { key: "estado", label: "Estado" }, { key: "periodo_actual_fin", label: "Fin" }], initial: { empresa_id: "", plan_id: "", precio_plan_id: "", estado: "ACTIVA", periodo: "MENSUAL", modo_renovacion: "MANUAL", fecha_inicio: "2026-02-23", periodo_actual_inicio: "2026-02-23", periodo_actual_fin: "2026-03-23" } },
  { key: "facturas", label: "Facturas", resource: "facturas", description: "Facturacion emitida.", mutable: false, fields: [], columns: [{ key: "id", label: "ID" }, { key: "empresa_id", label: "Empresa" }, { key: "suscripcion_id", label: "Suscripcion" }, { key: "fecha_emision", label: "Fecha" }, { key: "total", label: "Total" }, { key: "estado", label: "Estado" }], initial: {} },
  { key: "prorrateos", label: "Prorrateos", resource: "prorrateos", description: "Ajustes de ciclo.", mutable: false, fields: [], columns: [{ key: "id", label: "ID" }, { key: "suscripcion_id", label: "Suscripcion" }, { key: "producto_id", label: "Producto" }, { key: "valor_prorrateado", label: "Prorrateado" }], initial: {} },
];

const CASES: CaseConfig[] = [
  { id: "onboard-legacy-support", caso: 1, title: "Legacy + soporte", fields: [{ name: "email", label: "Email" }, { name: "nombre", label: "Nombre" }, { name: "empresaNombre", label: "Empresa" }, { name: "precioSoporte", label: "Precio", type: "number" }, { name: "fecha", label: "Fecha", type: "date" }], initial: { email: "", nombre: "", empresaNombre: "", precioSoporte: "1200000", fecha: "2026-02-23" } },
  { id: "onboard-new-annual", caso: 2, title: "Nuevo anual", fields: [{ name: "email", label: "Email" }, { name: "nombre", label: "Nombre" }, { name: "empresaNombre", label: "Empresa" }, { name: "planCodigo", label: "Cod plan" }, { name: "planNombre", label: "Nom plan" }, { name: "valorPlan", label: "Valor", type: "number" }, { name: "fecha", label: "Fecha", type: "date" }], initial: { email: "", nombre: "", empresaNombre: "", planCodigo: "PLAN-ANUAL-BASE", planNombre: "Plan Anual Base", valorPlan: "1800000", fecha: "2026-02-23" } },
  { id: "migrate-from-excel", caso: 3, title: "Migracion excel", fields: [{ name: "usuarioId", label: "Usuario ID" }, { name: "empresaId", label: "Empresa ID" }, { name: "planId", label: "Plan ID" }, { name: "fecha", label: "Fecha", type: "date" }], initial: { usuarioId: "", empresaId: "", planId: "", fecha: "2026-02-23" } },
  { id: "accountant-multi-company-subscriptions", caso: 4, title: "Contador 3 empresas", fields: [{ name: "email", label: "Email" }, { name: "nombre", label: "Nombre" }, { name: "planCodigo", label: "Plan" }, { name: "valorPlan", label: "Valor", type: "number" }, { name: "fecha", label: "Fecha", type: "date" }], initial: { email: "", nombre: "", planCodigo: "PLAN-CONTABILIDAD-MENSUAL", valorPlan: "120000", fecha: "2026-02-23" } },
  { id: "renew-subscription", caso: 5, title: "Renovar", fields: [{ name: "suscripcionId", label: "Suscripcion ID" }, { name: "fechaRenovacion", label: "Fecha", type: "date" }], initial: { suscripcionId: "", fechaRenovacion: "2026-02-23" } },
  { id: "update-plan-prices", caso: 6, title: "Actualizar precios", fields: [{ name: "planId", label: "Plan ID" }, { name: "incrementoMensual", label: "Inc mensual", type: "number" }, { name: "incrementoAnual", label: "Inc anual", type: "number" }, { name: "vigenteDesde", label: "Vigente", type: "date" }], initial: { planId: "", incrementoMensual: "10000", incrementoAnual: "100000", vigenteDesde: "2026-02-23" } },
  { id: "purchase-consumable", caso: 7, title: "Consumibles", fields: [{ name: "suscripcionId", label: "Suscripcion ID" }, { name: "productoCodigo", label: "Producto" }, { name: "cantidad", label: "Cantidad", type: "number" }, { name: "fecha", label: "Fecha", type: "date" }], initial: { suscripcionId: "", productoCodigo: "DOCS-ELECTRONICOS", cantidad: "100", fecha: "2026-02-23" } },
  { id: "add-company-with-subscription", caso: 8, title: "Nueva empresa + sub", fields: [{ name: "usuarioId", label: "Usuario ID" }, { name: "nombre", label: "Empresa" }, { name: "planId", label: "Plan ID" }, { name: "fecha", label: "Fecha", type: "date" }], initial: { usuarioId: "", nombre: "", planId: "", fecha: "2026-02-23" } },
  { id: "upgrade-midcycle-limit", caso: 9, title: "Upgrade limite", fields: [{ name: "suscripcionId", label: "Suscripcion ID" }, { name: "entitlementCodigo", label: "Entitlement" }, { name: "nuevoLimite", label: "Limite", type: "number" }, { name: "productoId", label: "Producto ID" }, { name: "fecha", label: "Fecha", type: "date" }], initial: { suscripcionId: "", entitlementCodigo: "LIMITE-EMPLEADOS", nuevoLimite: "20", productoId: "", fecha: "2026-02-23" } },
  { id: "purchase-fixed-term-service", caso: 10, title: "Servicio fijo", fields: [{ name: "suscripcionId", label: "Suscripcion ID" }, { name: "productoCodigo", label: "Producto" }, { name: "fechaPago", label: "Pago", type: "date" }, { name: "fechaEfectivaInicio", label: "Inicio", type: "date" }, { name: "fechaEfectivaFin", label: "Fin", type: "date" }], initial: { suscripcionId: "", productoCodigo: "CERTIFICADO-DIGITAL", fechaPago: "2026-02-23", fechaEfectivaInicio: "2026-03-01", fechaEfectivaFin: "2027-02-28" } },
];

function asText(v: unknown) { return String(v ?? "-"); }
function asBool(v: string) { return v === "true"; }
function asDate(v: unknown): string { return (typeof v === "string" ? v : "").slice(0, 10); }
function inDateRange(target: string, from: unknown, to: unknown) { if (!target) return false; return (!from || asDate(from) <= target) && (!to || asDate(to) >= target); }
function addPeriod(dateIso: string, periodo: string) { const d = new Date(`${dateIso}T00:00:00Z`); if (periodo === "MENSUAL") d.setUTCMonth(d.getUTCMonth() + 1); if (periodo === "TRIMESTRAL") d.setUTCMonth(d.getUTCMonth() + 3); if (periodo === "ANUAL") d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); }

export function AdminDashboard() {
  const { health, history, addHistory, refreshHealth } = useAppState();
  const [view, setView] = useState<View>({ kind: "entity", key: "empresas" });
  const [rowsByResource, setRowsByResource] = useState<Record<string, Row[]>>({});
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("Listo para operar.");
  const [output, setOutput] = useState<unknown>(null);
  const [seedKey, setSeedKey] = useState("");
  const [seedMsg, setSeedMsg] = useState("Pendiente ejecutar seed.");
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingId, setEditingId] = useState("");
  const [isCrudModalOpen, setIsCrudModalOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState("");

  const [wizard, setWizard] = useState<SubscriptionWizard>({ empresaId: "", planId: "", precioPlanId: "", fechaInicio: "2026-02-23", modoRenovacion: "MANUAL" });
  const [planDraftItems, setPlanDraftItems] = useState<PlanItemDraft[]>([]);
  const [draftProduct, setDraftProduct] = useState("");
  const [draftCantidad, setDraftCantidad] = useState("1");
  const [draftIncluido, setDraftIncluido] = useState("true");

  const [entityForms, setEntityForms] = useState<Record<string, Record<string, string>>>(() => {
    const map: Record<string, Record<string, string>> = {};
    for (const e of ENTITIES) map[e.key] = { ...e.initial };
    return map;
  });
  const [caseForms, setCaseForms] = useState<Record<WorkflowId, Record<string, string>>>(() => {
    const map = {} as Record<WorkflowId, Record<string, string>>;
    for (const c of CASES) map[c.id] = { ...c.initial };
    return map;
  });

  const navigateTo = (next: View) => {
    setView(next);
    setIsCrudModalOpen(false);
    setFormMode("create");
    setEditingId("");
    setSearch("");
  };

  const entity = useMemo(() => ENTITIES.find((e) => view.kind === "entity" && e.key === view.key) ?? ENTITIES[0], [view]);
  const preciosPlanesRaw = rowsByResource["precios-planes"];
  const itemsPlanRaw = rowsByResource["items-plan"];
  const itemsSuscripcionRaw = rowsByResource["items-suscripcion"];
  const empresas = useMemo(() => rowsByResource.empresas ?? [], [rowsByResource.empresas]);
  const planes = useMemo(() => rowsByResource.planes ?? [], [rowsByResource.planes]);
  const productos = useMemo(() => rowsByResource.productos ?? [], [rowsByResource.productos]);
  const suscripciones = useMemo(() => rowsByResource.suscripciones ?? [], [rowsByResource.suscripciones]);
  const facturas = useMemo(() => rowsByResource.facturas ?? [], [rowsByResource.facturas]);
  const preciosPlanes = useMemo(() => preciosPlanesRaw ?? [], [preciosPlanesRaw]);
  const itemsPlan = useMemo(() => itemsPlanRaw ?? [], [itemsPlanRaw]);
  const itemsSuscripcion = useMemo(() => itemsSuscripcionRaw ?? [], [itemsSuscripcionRaw]);
  const rows = rowsByResource[entity.resource] ?? [];
  const filteredRows = rows.filter((r) => Object.values(r).map((v) => asText(v).toLowerCase()).join(" ").includes(search.toLowerCase()));

  const companyNameById = useMemo(() => new Map(empresas.map((e) => [String(e.id), asText(e.nombre)])), [empresas]);
  const planNameById = useMemo(() => new Map(planes.map((p) => [String(p.id), `${asText(p.nombre)} (${asText(p.periodo)})`])), [planes]);
  const productNameById = useMemo(() => new Map(productos.map((p) => [String(p.id), `${asText(p.nombre)} (${asText(p.codigo)})`])), [productos]);
  const pricePlanNameById = useMemo(() => new Map(preciosPlanes.map((pp) => [String(pp.id), `${planNameById.get(String(pp.plan_id)) ?? asText(pp.plan_id)} | ${asText(pp.periodo)} | ${formatMoney(pp.valor)}`])), [preciosPlanes, planNameById]);
  const subscriptionNameById = useMemo(() => new Map(suscripciones.map((s) => [String(s.id), `${companyNameById.get(String(s.empresa_id)) ?? asText(s.empresa_id)} | ${planNameById.get(String(s.plan_id)) ?? asText(s.plan_id)}`])), [suscripciones, companyNameById, planNameById]);

  const selectedPlan = useMemo(() => planes.find((p) => String(p.id) === wizard.planId), [planes, wizard.planId]);
  const selectedPlanIncludedItems = useMemo(() => itemsPlan.filter((ip) => String(ip.plan_id) === wizard.planId && (ip.incluido === true || String(ip.incluido) === "true")), [itemsPlan, wizard.planId]);
  const eligiblePrices = useMemo(() => preciosPlanes.filter((p) => String(p.plan_id) === wizard.planId && (p.activo === true || String(p.activo) === "true") && inDateRange(wizard.fechaInicio, p.valido_desde, p.valido_hasta)), [preciosPlanes, wizard.planId, wizard.fechaInicio]);
  const hasActiveSubscription = useMemo(() => suscripciones.some((s) => String(s.empresa_id) === wizard.empresaId && String(s.estado) === "ACTIVA"), [suscripciones, wizard.empresaId]);

  const selectFirstEligiblePrice = (planId: string, fechaInicio: string) => {
    const first = preciosPlanes.find(
      (p) =>
        String(p.plan_id) === planId &&
        (p.activo === true || String(p.activo) === "true") &&
        inDateRange(fechaInicio, p.valido_desde, p.valido_hasta),
    );
    return first?.id ? String(first.id) : "";
  };

  const refresh = async () => {
    const resources = Array.from(new Set([...ENTITIES.map((e) => e.resource), "items-plan", "items-suscripcion"]));
    const data = await Promise.all(resources.map(async (r) => ({ r, v: await fetchJson<Row[]>(`/api/v1/${r}`) })));
    const next: Record<string, Row[]> = {};
    for (const x of data) next[x.r] = isSuccess(x.v) ? x.v.data : [];
    setRowsByResource(next);
  };

  useEffect(() => { const t = setTimeout(() => { void refresh(); }, 0); return () => clearTimeout(t); }, []);

  const runSeed = async () => {
    const res = await fetchJson<unknown>("/api/dev/seed", { method: "POST", headers: { "x-dev-seed-key": seedKey } });
    if (isSuccess(res)) { setSeedMsg("Seed ejecutado correctamente."); setMessage("Entorno preparado."); setOutput(res.data); await refresh(); await refreshHealth(); return; }
    setSeedMsg(toHumanError(res.error.code, res.error.message)); setMessage("Fallo en seed."); setOutput(res.error);
  };

  const openCreateModal = () => {
    setFormMode("create");
    setEditingId("");
    setEntityForms((p) => ({ ...p, [entity.key]: { ...entity.initial } }));
    if (entity.key === "suscripciones") {
      setWizard((p) => ({ ...p, empresaId: "", planId: "", precioPlanId: "", fechaInicio: "2026-02-23", modoRenovacion: "MANUAL" }));
    }
    setPlanDraftItems([]);
    setDraftProduct("");
    setDraftCantidad("1");
    setDraftIncluido("true");
    setIsCrudModalOpen(true);
  };

  const beginEdit = (row: Row) => {
    if (!row.id) return;
    const form: Record<string, string> = {};
    for (const f of entity.fields) form[f.key] = asText(row[f.key]);
    setEntityForms((p) => ({ ...p, [entity.key]: form }));
    if (entity.key === "planes") {
      const pid = String(row.id);
      const draft = itemsPlan.filter((x) => String(x.plan_id) === pid).map((x) => ({ productoId: String(x.producto_id), incluido: x.incluido === true || String(x.incluido) === "true", cantidad: asText(x.cantidad === null ? "" : x.cantidad) }));
      setPlanDraftItems(draft);
      setSelectedPlanId(pid);
    }
    setFormMode("edit");
    setEditingId(String(row.id));
    setIsCrudModalOpen(true);
  };

  const removeRow = async (row: Row) => {
    if (!row.id) return;
    const endpoint = `/api/v1/${entity.resource}/${row.id}`;
    const res = await fetchJson<Row>(endpoint, { method: "DELETE" });
    if (isSuccess(res)) { setMessage(`${entity.label} eliminado.`); setOutput(res.data); addHistory({ title: `Eliminar ${entity.label}`, endpoint, ok: true }); await refresh(); return; }
    setMessage(toHumanError(res.error.code, res.error.message)); setOutput(res.error); addHistory({ title: `Eliminar ${entity.label}`, endpoint, ok: false });
  };

  const syncPlanItems = async (planId: string, items: PlanItemDraft[]) => {
    const current = itemsPlan.filter((x) => String(x.plan_id) === planId);
    const currentMap = new Map(current.map((x) => [String(x.producto_id), x]));
    const draftMap = new Map(items.map((x) => [x.productoId, x]));

    for (const [productoId, item] of draftMap) {
      const exists = currentMap.get(productoId);
      const targetCantidad = item.cantidad.trim() === "" ? null : Number(item.cantidad);
      if (!exists) {
        await fetchJson("/api/v1/items-plan", { method: "POST", body: { plan_id: planId, producto_id: productoId, incluido: item.incluido, cantidad: targetCantidad } });
      } else {
        const sameIncl = (exists.incluido === true || String(exists.incluido) === "true") === item.incluido;
        const sameQty = String(exists.cantidad ?? "") === String(targetCantidad ?? "");
        if (!sameIncl || !sameQty) {
          await fetchJson(`/api/v1/items-plan/${planId}/${productoId}`, { method: "DELETE" });
          await fetchJson("/api/v1/items-plan", { method: "POST", body: { plan_id: planId, producto_id: productoId, incluido: item.incluido, cantidad: targetCantidad } });
        }
      }
    }
    for (const productoId of currentMap.keys()) {
      if (!draftMap.has(productoId)) {
        await fetchJson(`/api/v1/items-plan/${planId}/${productoId}`, { method: "DELETE" });
      }
    }
  };

  const saveEntity = async () => {
    if (!entity.mutable) return;
    const raw = entityForms[entity.key] ?? {};
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) payload[k] = v === "true" || v === "false" ? asBool(v) : v;

    if (entity.key === "planes") {
      if (planDraftItems.length === 0) { setMessage("Un plan debe tener al menos un producto."); return; }
      const endpoint = formMode === "create" ? "/api/v1/planes" : `/api/v1/planes/${editingId}`;
      const method = formMode === "create" ? "POST" : "PATCH";
      const res = await fetchJson<Row>(endpoint, { method, body: payload });
      if (!isSuccess(res)) { setMessage(toHumanError(res.error.code, res.error.message)); setOutput(res.error); return; }
      const planId = String(res.data.id ?? editingId);
      await syncPlanItems(planId, planDraftItems);
      setMessage(`Plan ${formMode === "create" ? "creado" : "actualizado"} correctamente.`);
      setOutput(res.data);
      setIsCrudModalOpen(false);
      await refresh();
      return;
    }

    const endpoint = formMode === "create" ? `/api/v1/${entity.resource}` : `/api/v1/${entity.resource}/${editingId}`;
    const method = formMode === "create" ? "POST" : "PATCH";
    const res = await fetchJson<Row>(endpoint, { method, body: payload });
    if (isSuccess(res)) { setMessage(`${entity.label} ${formMode === "create" ? "creado" : "actualizado"} correctamente.`); setOutput(res.data); setIsCrudModalOpen(false); await refresh(); return; }
    setMessage(toHumanError(res.error.code, res.error.message)); setOutput(res.error);
  };

  const createSubscriptionWizard = async () => {
    if (!wizard.empresaId || !wizard.planId || !wizard.precioPlanId || !wizard.fechaInicio) { setMessage("Completa empresa, plan, precio y fecha."); return; }
    if (hasActiveSubscription) { setMessage("La empresa ya tiene una suscripcion activa."); return; }
    if (selectedPlanIncludedItems.length === 0) { setMessage("El plan no tiene productos incluidos."); return; }
    const price = preciosPlanes.find((p) => String(p.id) === wizard.precioPlanId);
    if (!price || String(price.plan_id) !== wizard.planId || !(price.activo === true || String(price.activo) === "true") || !inDateRange(wizard.fechaInicio, price.valido_desde, price.valido_hasta)) { setMessage("Precio no vigente o invalido."); return; }
    const periodo = String(price.periodo ?? selectedPlan?.periodo ?? "MENSUAL");
    const payload = { empresa_id: wizard.empresaId, plan_id: wizard.planId, precio_plan_id: wizard.precioPlanId, estado: "ACTIVA", periodo, modo_renovacion: wizard.modoRenovacion, fecha_inicio: wizard.fechaInicio, periodo_actual_inicio: wizard.fechaInicio, periodo_actual_fin: addPeriod(wizard.fechaInicio, periodo) };
    const res = await fetchJson<Row>("/api/v1/suscripciones", { method: "POST", body: payload });
    if (!isSuccess(res)) { setMessage(toHumanError(res.error.code, res.error.message)); setOutput(res.error); return; }
    setMessage("Suscripcion creada correctamente.");
    setOutput(res.data);
    setSelectedSubscriptionId(String(res.data.id ?? ""));
    setIsCrudModalOpen(false);
    await refresh();
  };

  const addDraftItem = () => {
    if (!draftProduct) return;
    if (planDraftItems.some((x) => x.productoId === draftProduct)) return;
    setPlanDraftItems((p) => [...p, { productoId: draftProduct, incluido: draftIncluido === "true", cantidad: draftCantidad }]);
    setDraftProduct("");
    setDraftCantidad("1");
  };

  const runCase = async (id: WorkflowId) => {
    const res = await fetchJson(`/api/v1/workflows/${id}`, { method: "POST", body: caseForms[id] });
    if (isSuccess(res)) { setMessage(`Caso ejecutado: ${id}`); setOutput(res.data); await refresh(); return; }
    setMessage(toHumanError(res.error.code, res.error.message)); setOutput(res.error);
  };

  const renderCell = (k: string, v: unknown) => {
    const x = asText(v);
    if (["activo", "activa"].includes(k)) return x === "true" ? "Si" : "No";
    if (k === "empresa_id") return companyNameById.get(x) ?? x;
    if (k === "plan_id") return planNameById.get(x) ?? x;
    if (k === "producto_id") return productNameById.get(x) ?? x;
    if (k === "suscripcion_id") return subscriptionNameById.get(x) ?? x;
    if (k === "precio_plan_id") return pricePlanNameById.get(x) ?? x;
    if (looksLikeDateField(k)) return formatDateOnly(v);
    if (looksLikeMoneyField(k)) return formatMoney(v);
    return x;
  };

  const fieldOptions = (fieldKey: string) => {
    if (entity.key !== "suscripciones") return [] as Array<{ value: string; label: string }>;
    if (fieldKey === "empresa_id") return empresas.map((e) => ({ value: String(e.id), label: asText(e.nombre) }));
    if (fieldKey === "plan_id") return planes.map((p) => ({ value: String(p.id), label: `${asText(p.nombre)} (${asText(p.periodo)})` }));
    if (fieldKey === "precio_plan_id") {
      const planId = entityForms.suscripciones?.plan_id;
      const start = entityForms.suscripciones?.fecha_inicio;
      return preciosPlanes.filter((pp) => String(pp.plan_id) === planId && inDateRange(start, pp.valido_desde, pp.valido_hasta)).map((pp) => ({ value: String(pp.id), label: `${asText(pp.periodo)} | ${formatMoney(pp.valor)}` }));
    }
    return [];
  };

  const overviewCards = useMemo(() => {
    return suscripciones.map((s) => {
      const subId = String(s.id);
      const related = facturas.filter((f) => String(f.suscripcion_id) === subId);
      return {
        id: subId,
        empresa: companyNameById.get(String(s.empresa_id)) ?? asText(s.empresa_id),
        plan: planNameById.get(String(s.plan_id)) ?? asText(s.plan_id),
        estado: asText(s.estado),
        facturas: related.length,
      };
    });
  }, [suscripciones, facturas, companyNameById, planNameById]);

  return (
    <main className="space-y-5">
      <section className="rounded-[16px] border border-[#E2E8F0] bg-white p-5 shadow-(--shadow-soft)">
        <h2 className="text-2xl font-semibold text-[#1E293B]">Dashboard Administrativo</h2>
        <p className="text-sm text-[#64748B]">Operacion de suscripciones y catalogo.</p>
      </section>

      <section className="grid gap-5 xl:grid-cols-[260px_1fr]">
        <aside className="space-y-4">
          <article className="rounded-[16px] border border-[#E2E8F0] bg-white p-5 shadow-(--shadow-soft)">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Entidades</p>
              <div className="space-y-1.5">
                {ENTITIES.map((e) => (
                <button key={e.key} onClick={() => navigateTo({ kind: "entity", key: e.key })} className={`w-full rounded-[10px] border px-3 py-2 text-left text-xs transition-colors ${view.kind === "entity" && view.key === e.key ? "border-[#2563EB] bg-[#2563EB] text-white" : "border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#1E293B]"}`}>{e.label}</button>
              ))}
            </div>
          </article>

          <article className="rounded-[16px] border border-[#E2E8F0] bg-white p-5 shadow-(--shadow-soft)">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Negocio</p>
            <button onClick={() => navigateTo({ kind: "overview" })} className={`w-full rounded-[10px] border px-3 py-2 text-left text-xs transition-colors ${view.kind === "overview" ? "border-[#2563EB] bg-[#2563EB] text-white" : "border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#1E293B]"}`}>Empresas y contratos</button>
          </article>

          <article className="rounded-[16px] border border-[#E2E8F0] bg-white p-5 shadow-(--shadow-soft)">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Tecnico</p>
            <div className="space-y-1.5">
              <button onClick={() => navigateTo({ kind: "technical", tab: "cases" })} className={`w-full rounded-[10px] border px-3 py-2 text-left text-xs transition-colors ${view.kind === "technical" && view.tab === "cases" ? "border-[#2563EB] bg-[#2563EB] text-white" : "border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#1E293B]"}`}>Casos guiados</button>
              <button onClick={() => navigateTo({ kind: "technical", tab: "diagnostics" })} className={`w-full rounded-[10px] border px-3 py-2 text-left text-xs transition-colors ${view.kind === "technical" && view.tab === "diagnostics" ? "border-[#2563EB] bg-[#2563EB] text-white" : "border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#1E293B]"}`}>Diagnostico</button>
            </div>
          </article>
        </aside>

        <section className="space-y-5">
          <article className="rounded-[16px] bg-white p-5 shadow-(--shadow-soft)">
            <h3 className="text-sm font-semibold text-[#1E293B]">Preparar entorno</h3>
            <div className="mt-2 flex gap-2">
              <input value={seedKey} onChange={(e) => setSeedKey(e.target.value)} placeholder="DEV_SEED_KEY" className="ui-input min-w-[240px] text-[#1E293B]" />
              <button onClick={runSeed} className="ui-btn ui-btn-primary">Ejecutar seed</button>
            </div>
            <p className="mt-2 text-sm text-[#64748B]">{seedMsg}</p>
          </article>

          {view.kind === "entity" && (
            <article className="rounded-[16px] bg-white p-5 shadow-(--shadow-soft)">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><h3 className="text-lg font-semibold text-[#1E293B]">{entity.label}</h3><p className="text-sm text-[#64748B]">{entity.description}</p></div>
                {entity.mutable && <button onClick={openCreateModal} className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white">Nuevo</button>}
              </div>
              <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold text-[#1E293B]">Listado ({rows.length})</p><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrar..." className="ui-input w-52 text-xs" /></div>
              <div className="max-h-[560px] overflow-auto rounded border border-[#E2E8F0]">
                <table className="min-w-full text-xs">
                  <thead className="bg-[#F8FAFC]"><tr>{entity.columns.map((c) => <th key={c.key} className="px-2 py-2 text-left text-[#64748B]">{c.label}</th>)}<th className="px-2 py-2 text-left text-[#64748B]">Acciones</th></tr></thead>
                  <tbody>
                    {filteredRows.map((r, idx) => (
                      <tr key={`${asText(r.id)}-${idx}`} className="border-t border-[#F1F5F9]">
                        {entity.columns.map((c) => <td key={c.key} className="px-2 py-2 text-[#64748B]">{renderCell(c.key, r[c.key])}</td>)}
                        <td className="px-2 py-2">
                          <div className="flex gap-1.5">
                            {entity.mutable && <button onClick={() => beginEdit(r)} className="ui-btn ui-btn-primary ui-btn-sm">Editar</button>}
                            {entity.mutable && <button onClick={() => removeRow(r)} className="ui-btn ui-btn-danger ui-btn-sm">Eliminar</button>}
                            {entity.key === "planes" && r.id && <button onClick={() => setSelectedPlanId(String(r.id))} className="ui-btn ui-btn-secondary ui-btn-sm">Composicion</button>}
                            {entity.key === "suscripciones" && r.id && <button onClick={() => setSelectedSubscriptionId(String(r.id))} className="ui-btn ui-btn-primary ui-btn-sm">Seleccionar</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {entity.key === "planes" && selectedPlanId && (
                <div className="mt-4 rounded-xl border border-[#E2E8F0] p-3">
                  <p className="text-sm font-semibold text-[#1E293B]">Composicion del plan</p>
                  <p className="mb-2 text-xs text-[#64748B]">{planNameById.get(selectedPlanId) ?? selectedPlanId}</p>
                  <div className="max-h-60 overflow-auto rounded border border-[#E2E8F0]">
                    <table className="min-w-full text-xs">
                      <thead className="bg-[#F8FAFC]"><tr><th className="px-2 py-2 text-left text-[#64748B]">Producto</th><th className="px-2 py-2 text-left text-[#64748B]">Incluido</th><th className="px-2 py-2 text-left text-[#64748B]">Cantidad</th></tr></thead>
                      <tbody>{itemsPlan.filter((x) => String(x.plan_id) === selectedPlanId).map((x) => <tr key={`${asText(x.plan_id)}-${asText(x.producto_id)}`} className="border-t border-[#F1F5F9]"><td className="px-2 py-2 text-[#64748B]">{productNameById.get(String(x.producto_id)) ?? asText(x.producto_id)}</td><td className="px-2 py-2 text-[#64748B]">{asText(x.incluido)}</td><td className="px-2 py-2 text-[#64748B]">{asText(x.cantidad)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}

              {entity.key === "suscripciones" && selectedSubscriptionId && (
                <div className="mt-4 rounded-xl border border-[#E2E8F0] p-3">
                  <p className="text-sm font-semibold text-[#1E293B]">Items de suscripcion seleccionada</p>
                  <div className="max-h-60 overflow-auto rounded border border-[#E2E8F0]">
                    <table className="min-w-full text-xs">
                      <thead className="bg-[#F8FAFC]"><tr><th className="px-2 py-2 text-left text-[#64748B]">Producto</th><th className="px-2 py-2 text-left text-[#64748B]">Cantidad</th><th className="px-2 py-2 text-left text-[#64748B]">Origen</th><th className="px-2 py-2 text-left text-[#64748B]">Estado</th></tr></thead>
                      <tbody>{itemsSuscripcion.filter((x) => String(x.suscripcion_id) === selectedSubscriptionId).map((x) => <tr key={asText(x.id)} className="border-t border-[#F1F5F9]"><td className="px-2 py-2 text-[#64748B]">{productNameById.get(String(x.producto_id)) ?? asText(x.producto_id)}</td><td className="px-2 py-2 text-[#64748B]">{asText(x.cantidad)}</td><td className="px-2 py-2 text-[#64748B]">{asText(x.origen)}</td><td className="px-2 py-2 text-[#64748B]">{asText(x.estado)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </article>
          )}

          {view.kind === "overview" && (
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {overviewCards.map((c) => (
                <article key={c.id} className="rounded-[16px] border border-[#E2E8F0] bg-white p-5 shadow-(--shadow-soft)">
                  <p className="text-xs uppercase tracking-wide text-[#64748B]">Empresa</p>
                  <p className="text-sm font-semibold text-[#1E293B]">{c.empresa}</p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-[#64748B]">Plan contratado</p>
                  <p className="text-sm text-[#1E293B]">{c.plan}</p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-[#64748B]">Suscripcion</p>
                  <p className="text-xs text-[#64748B]">{c.id}</p>
                  <p className="mt-2 text-xs uppercase tracking-wide text-[#64748B]">Facturas asociadas</p>
                  <p className="text-sm text-[#1E293B]">{c.facturas}</p>
                  <p className="mt-2 text-xs text-[#64748B]">Estado: {c.estado}</p>
                </article>
              ))}
            </section>
          )}

          {view.kind === "technical" && view.tab === "cases" && (
            <article className="rounded-[16px] border border-[#E2E8F0] bg-white p-5 shadow-(--shadow-soft)">
              <h3 className="text-lg font-semibold text-[#1E293B]">Casos guiados</h3>
              <div className="mt-3 space-y-3">
                {CASES.map((c) => (
                  <div key={c.id} className="rounded-xl border border-[#E2E8F0] p-3">
                    <p className="text-sm font-semibold text-[#1E293B]">Caso {c.caso}: {c.title}</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {c.fields.map((f) => <label key={`${c.id}-${f.name}`} className="text-xs text-[#64748B]">{f.label}<input value={caseForms[c.id][f.name] ?? ""} onChange={(e) => setCaseForms((p) => ({ ...p, [c.id]: { ...p[c.id], [f.name]: e.target.value } }))} type={f.type ?? "text"} className="mt-1 ui-input" /></label>)}
                    </div>
                    <button onClick={() => runCase(c.id)} className="mt-2 ui-btn ui-btn-primary ui-btn-sm">Ejecutar</button>
                  </div>
                ))}
              </div>
            </article>
          )}

          {view.kind === "technical" && view.tab === "diagnostics" && (
            <article className="rounded-[16px] border border-[#E2E8F0] bg-white p-5 shadow-(--shadow-soft)">
              <h3 className="text-lg font-semibold text-[#1E293B]">Diagnostico</h3>
              <p className="mt-2 text-sm text-[#64748B]">Estado API: {health.api} | DB: {health.db}</p>
              <p className="mt-2 text-sm text-[#64748B]">{message}</p>
              <details className="mt-3"><summary className="cursor-pointer text-xs text-[#64748B]">Salida tecnica</summary><pre className="mt-2 max-h-64 overflow-auto rounded border border-[#E2E8F0] bg-[#F8FAFC] p-2 text-xs text-[#64748B]">{output ? JSON.stringify(output, null, 2) : "Sin salida"}</pre></details>
              <ul className="mt-3 space-y-2">{history.slice(0, 8).map((h) => <li key={h.id} className="rounded border border-[#E2E8F0] bg-[#F8FAFC] p-2 text-xs"><p className="font-semibold text-[#1E293B]">{h.title}</p><p className="text-[#64748B]">{h.endpoint}</p></li>)}</ul>
            </article>
          )}
        </section>
      </section>

      {entity.mutable && (
        <AppModal
          open={isCrudModalOpen}
          onClose={() => setIsCrudModalOpen(false)}
          maxWidthClassName="max-w-4xl"
          title={formMode === "create" ? `Nuevo ${entity.label}` : `Editar ${entity.label}`}
        >
          {entity.key === "suscripciones" && formMode === "create" ? (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2">
                <label className="text-xs text-[#64748B]">Empresa<select value={wizard.empresaId} onChange={(e) => setWizard((p) => ({ ...p, empresaId: e.target.value }))} className="mt-1 ui-input"><option value="">Seleccionar...</option>{empresas.map((e) => <option key={String(e.id)} value={String(e.id)}>{asText(e.nombre)}</option>)}</select></label>
                <label className="text-xs text-[#64748B]">Plan<select value={wizard.planId} onChange={(e) => { const planId = e.target.value; setWizard((p) => ({ ...p, planId, precioPlanId: selectFirstEligiblePrice(planId, p.fechaInicio) })); }} className="mt-1 ui-input"><option value="">Seleccionar...</option>{planes.map((p) => <option key={String(p.id)} value={String(p.id)}>{asText(p.nombre)} ({asText(p.periodo)})</option>)}</select></label>
                <label className="text-xs text-[#64748B]">Fecha inicio<input type="date" value={wizard.fechaInicio} onChange={(e) => { const fechaInicio = e.target.value; setWizard((p) => ({ ...p, fechaInicio, precioPlanId: p.planId ? selectFirstEligiblePrice(p.planId, fechaInicio) : "" })); }} className="mt-1 ui-input" /></label>
                <label className="text-xs text-[#64748B]">Precio vigente<select value={wizard.precioPlanId} onChange={(e) => setWizard((p) => ({ ...p, precioPlanId: e.target.value }))} className="mt-1 ui-input"><option value="">Seleccionar...</option>{eligiblePrices.map((pp) => <option key={String(pp.id)} value={String(pp.id)}>{asText(pp.periodo)} | {formatMoney(pp.valor)}</option>)}</select></label>
              </div>
              <div className="rounded border border-[#E2E8F0] bg-[#F8FAFC] p-2 text-xs text-[#64748B]">Productos incluidos del plan: {selectedPlanIncludedItems.length}</div>
              <div className="flex justify-end gap-2"><button onClick={() => setIsCrudModalOpen(false)} className="ui-btn ui-btn-outline">Cancelar</button><button onClick={createSubscriptionWizard} className="ui-btn ui-btn-primary">Crear suscripcion</button></div>
            </div>
          ) : entity.key === "planes" ? (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2">
                {entity.fields.map((f) => (
                  <label key={f.key} className="text-xs text-[#64748B]">{f.label}{f.type === "select" ? <select value={entityForms[entity.key]?.[f.key] ?? ""} onChange={(e) => setEntityForms((p) => ({ ...p, [entity.key]: { ...p[entity.key], [f.key]: e.target.value } }))} className="mt-1 ui-input"><option value="">Seleccionar...</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select> : <input value={entityForms[entity.key]?.[f.key] ?? ""} onChange={(e) => setEntityForms((p) => ({ ...p, [entity.key]: { ...p[entity.key], [f.key]: e.target.value } }))} type={f.type ?? "text"} className="mt-1 ui-input" />}</label>
                ))}
              </div>
              <div className="rounded border border-[#E2E8F0] p-3">
                <p className="text-xs font-semibold text-[#1E293B]">Productos del plan (obligatorio)</p>
                <div className="mt-2 grid gap-2 md:grid-cols-4">
                  <select value={draftProduct} onChange={(e) => setDraftProduct(e.target.value)} className="ui-input text-xs"><option value="">Producto...</option>{productos.map((p) => <option key={String(p.id)} value={String(p.id)}>{asText(p.nombre)} ({asText(p.codigo)})</option>)}</select>
                  <input value={draftCantidad} onChange={(e) => setDraftCantidad(e.target.value)} type="number" min="0" placeholder="Cantidad" className="ui-input text-xs" />
                  <select value={draftIncluido} onChange={(e) => setDraftIncluido(e.target.value)} className="ui-input text-xs"><option value="true">Incluido</option><option value="false">No incluido</option></select>
                  <button onClick={addDraftItem} className="ui-btn ui-btn-primary ui-btn-sm">Agregar</button>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-[#64748B]">{planDraftItems.map((i) => <li key={i.productoId} className="flex items-center justify-between rounded border border-[#E2E8F0] px-2 py-1"><span>{productNameById.get(i.productoId) ?? i.productoId} | cantidad: {i.cantidad || "-"} | {i.incluido ? "incluido" : "no incluido"}</span><button onClick={() => setPlanDraftItems((p) => p.filter((x) => x.productoId !== i.productoId))} className="ui-btn ui-btn-danger ui-btn-sm">Quitar</button></li>)}</ul>
              </div>
              <div className="flex justify-end gap-2"><button onClick={() => setIsCrudModalOpen(false)} className="ui-btn ui-btn-outline">Cancelar</button><button onClick={saveEntity} className="ui-btn ui-btn-primary">{formMode === "create" ? "Guardar plan" : "Actualizar plan"}</button></div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2">
                {entity.fields.map((f) => {
                  const rel = fieldOptions(f.key);
                  const options = f.type === "select" ? (f.options ?? []) : rel.map((x) => x.value);
                  const relLabels = new Map(rel.map((x) => [x.value, x.label]));
                  return <label key={f.key} className="text-xs text-[#64748B]">{f.label}{(f.type === "select" || rel.length > 0) ? <select value={entityForms[entity.key]?.[f.key] ?? ""} onChange={(e) => setEntityForms((p) => ({ ...p, [entity.key]: { ...p[entity.key], [f.key]: e.target.value } }))} className="mt-1 ui-input"><option value="">Seleccionar...</option>{options.map((o) => <option key={o} value={o}>{relLabels.get(o) ?? o}</option>)}</select> : <input value={entityForms[entity.key]?.[f.key] ?? ""} onChange={(e) => setEntityForms((p) => ({ ...p, [entity.key]: { ...p[entity.key], [f.key]: e.target.value } }))} type={f.type ?? "text"} className="mt-1 ui-input" />}</label>;
                })}
              </div>
              <div className="flex justify-end gap-2"><button onClick={() => setIsCrudModalOpen(false)} className="ui-btn ui-btn-outline">Cancelar</button><button onClick={saveEntity} className="ui-btn ui-btn-primary">{formMode === "create" ? "Guardar" : "Actualizar"}</button></div>
            </div>
          )}
        </AppModal>
      )}
    </main>
  );
}
