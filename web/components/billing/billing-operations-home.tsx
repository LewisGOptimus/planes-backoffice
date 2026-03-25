"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson, isSuccess } from "@/lib/client/api";
import { formatDateOnly } from "@/lib/client/date-format";
import { formatMoney } from "@/lib/client/currency-format";
import { BillingAction, BillingAlert, CustomerSearchItem, ImpactPreviewResponse, OperationsDashboardResponse } from "@/lib/types/billing-v2";
import { PageHeaderCard } from "../ui/page-header-card";

const ACTION_OPTIONS: Array<{ id: BillingAction; label: string; template: Record<string, string> }> = [
  { id: "renew_subscription", label: "Renovar suscripcion", template: { suscripcion_id: "", billing_date: new Date().toISOString().slice(0, 10), generate_invoice: "true", discount_type: "", discount_value: "", discount_reason: "" } },
  { id: "purchase_consumable", label: "Cobrar consumible", template: { suscripcion_id: "", producto_id: "", cantidad: "100", billing_date: new Date().toISOString().slice(0, 10) } },
  { id: "upgrade_midcycle_limit", label: "Upgrade con prorrateo", template: { suscripcion_id: "", entitlement_id: "", nuevo_limite: "20", producto_id: "", billing_date: new Date().toISOString().slice(0, 10) } },
  { id: "purchase_fixed_term_service", label: "Servicio vigencia fija", template: { suscripcion_id: "", producto_id: "", billing_date: new Date().toISOString().slice(0, 10), effective_start: new Date().toISOString().slice(0, 10), effective_end: new Date(Date.now() + 31536000000).toISOString().slice(0, 10) } },
  { id: "create_subscription", label: "Crear suscripcion", template: { empresa_id: "", plan_id: "", billing_cycle: "ANUAL", billing_date: new Date().toISOString().slice(0, 10), modo_renovacion: "MANUAL" } },
  { id: "create_deferred_installment_plan", label: "Crear diferido N cuotas", template: { suscripcion_id: "", monto_total: "0", cantidad_cuotas: "3", frecuencia: "MENSUAL", fecha_primera_cuota: new Date().toISOString().slice(0, 10) } },
  { id: "add_company_with_subscription", label: "Agregar empresa + suscripcion", template: { usuario_id: "", nombre: "", plan_id: "", billing_date: new Date().toISOString().slice(0, 10) } },
  { id: "pay_deferred_installment", label: "Pagar cuota diferida", template: { cuota_id: "", fecha_pago: new Date().toISOString().slice(0, 10), metodo_pago: "MANUAL", referencia_pago: "" } },
  { id: "update_plan_prices", label: "Actualizar precios", template: { plan_id: "", incremento_mensual: "10000", incremento_anual: "100000", billing_date: new Date().toISOString().slice(0, 10) } },
];

type FieldType = "text" | "number" | "date" | "select";
type LookupKey = "empresas" | "suscripciones" | "planes" | "usuarios" | "productos" | "entitlements";

type FieldConfig = {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
  lookup?: LookupKey;
  staticOptions?: Array<{ value: string; label: string }>;
};

const ACTION_FORM_FIELDS: Record<BillingAction, FieldConfig[]> = {
  renew_subscription: [
    { key: "suscripcion_id", label: "Suscripcion", type: "select", lookup: "suscripciones" },
    { key: "billing_date", label: "Fecha de renovacion", type: "date" },
    { key: "generate_invoice", label: "Generar factura", type: "select", staticOptions: [{ value: "true", label: "Si" }, { value: "false", label: "No" }] },
    { key: "discount_type", label: "Tipo descuento", type: "select", staticOptions: [{ value: "PERCENT", label: "Porcentaje" }, { value: "FIXED", label: "Monto fijo" }] },
    { key: "discount_value", label: "Valor descuento", type: "number" },
    { key: "discount_reason", label: "Motivo descuento", type: "text", placeholder: "Campana de retencion" },
  ],
  purchase_consumable: [
    { key: "suscripcion_id", label: "Suscripcion", type: "select", lookup: "suscripciones" },
    { key: "producto_id", label: "Producto", type: "select", lookup: "productos" },
    { key: "cantidad", label: "Cantidad", type: "number" },
    { key: "billing_date", label: "Fecha de cobro", type: "date" },
  ],
  upgrade_midcycle_limit: [
    { key: "suscripcion_id", label: "Suscripcion", type: "select", lookup: "suscripciones" },
    { key: "entitlement_id", label: "Limite a actualizar", type: "select", lookup: "entitlements", help: "Este cambio crea o actualiza un override manual del entitlement." },
    { key: "nuevo_limite", label: "Nuevo valor del limite", type: "number" },
    { key: "producto_id", label: "Producto a facturar (opcional)", type: "select", lookup: "productos" },
    { key: "billing_date", label: "Fecha del cambio", type: "date" },
  ],
  purchase_fixed_term_service: [
    { key: "suscripcion_id", label: "Suscripcion", type: "select", lookup: "suscripciones" },
    { key: "producto_id", label: "Producto", type: "select", lookup: "productos" },
    { key: "billing_date", label: "Fecha de cobro", type: "date" },
    { key: "effective_start", label: "Vigencia efectiva desde", type: "date" },
    { key: "effective_end", label: "Vigencia efectiva hasta", type: "date" },
  ],
  create_subscription: [
    { key: "empresa_id", label: "Empresa", type: "select", lookup: "empresas" },
    { key: "plan_id", label: "Plan", type: "select", lookup: "planes" },
    { key: "billing_cycle", label: "Ciclo de cobro", type: "select", staticOptions: [{ value: "MENSUAL", label: "Mensual" }, { value: "TRIMESTRAL", label: "Trimestral" }, { value: "ANUAL", label: "Anual" }] },
    { key: "modo_renovacion", label: "Modo de renovacion", type: "select", staticOptions: [{ value: "MANUAL", label: "Manual" }, { value: "AUTOMATICA", label: "Automatica" }] },
    { key: "billing_date", label: "Fecha de inicio", type: "date" },
  ],
  create_deferred_installment_plan: [
    { key: "suscripcion_id", label: "Suscripcion", type: "select", lookup: "suscripciones" },
    { key: "monto_total", label: "Monto total", type: "number" },
    { key: "cantidad_cuotas", label: "Cantidad de cuotas", type: "number" },
    { key: "frecuencia", label: "Frecuencia", type: "select", staticOptions: [{ value: "MENSUAL", label: "Mensual" }, { value: "TRIMESTRAL", label: "Trimestral" }, { value: "ANUAL", label: "Anual" }] },
    { key: "fecha_primera_cuota", label: "Primera cuota", type: "date" },
  ],
  add_company_with_subscription: [
    { key: "usuario_id", label: "Usuario responsable", type: "select", lookup: "usuarios" },
    { key: "nombre", label: "Nombre de la empresa", type: "text", placeholder: "Empresa Demo S.A.S." },
    { key: "plan_id", label: "Plan", type: "select", lookup: "planes" },
    { key: "billing_date", label: "Fecha de alta", type: "date" },
  ],
  pay_deferred_installment: [
    { key: "cuota_id", label: "Id cuota", type: "text", placeholder: "UUID de la cuota" },
    { key: "fecha_pago", label: "Fecha de pago", type: "date" },
    { key: "metodo_pago", label: "Metodo de pago", type: "select", staticOptions: [{ value: "MANUAL", label: "Manual" }, { value: "PASARELA", label: "Pasarela" }] },
    { key: "referencia_pago", label: "Referencia", type: "text", placeholder: "TRX-001" },
  ],
  update_plan_prices: [
    { key: "plan_id", label: "Plan", type: "select", lookup: "planes" },
    { key: "incremento_mensual", label: "Incremento mensual", type: "number" },
    { key: "incremento_anual", label: "Incremento anual", type: "number" },
    { key: "billing_date", label: "Vigencia desde", type: "date" },
  ],
};

function toText(v: unknown) {
  return String(v ?? "");
}

export function BillingOperationsHome() {
  const [dashboard, setDashboard] = useState<OperationsDashboardResponse | null>(null);
  const [alerts, setAlerts] = useState<BillingAlert[]>([]);
  const [customers, setCustomers] = useState<CustomerSearchItem[]>([]);
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<BillingAction>("renew_subscription");
  const [payload, setPayload] = useState<Record<string, string>>({ ...ACTION_OPTIONS[0].template });
  const [preview, setPreview] = useState<ImpactPreviewResponse | null>(null);
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [lookups, setLookups] = useState<{
    empresas: Array<{ value: string; label: string }>;
    suscripciones: Array<{ value: string; label: string }>;
    planes: Array<{ value: string; label: string }>;
    usuarios: Array<{ value: string; label: string }>;
    productos: Array<{ value: string; label: string }>;
    entitlements: Array<{ value: string; label: string }>;
  }>({ empresas: [], suscripciones: [], planes: [], usuarios: [], productos: [], entitlements: [] });

  const loadDashboard = async () => {
    const [dashRes, alertRes] = await Promise.all([
      fetchJson<OperationsDashboardResponse>("/api/v2/billing/operations/dashboard"),
      fetchJson<BillingAlert[]>("/api/v2/billing/alerts?state=open"),
    ]);
    if (isSuccess(dashRes)) setDashboard(dashRes.data);
    if (isSuccess(alertRes)) setAlerts(alertRes.data);
  };

  useEffect(() => {
    const init = async () => {
      await loadDashboard();
      const res = await fetchJson<typeof lookups>("/api/v2/billing/lookups");
      if (isSuccess(res)) setLookups(res.data);
    };
    void init();
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setCustomers([]);
        return;
      }
      const res = await fetchJson<CustomerSearchItem[]>(`/api/v2/billing/customers?query=${encodeURIComponent(query)}`);
      if (isSuccess(res)) setCustomers(res.data);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const runAlertsJob = async () => {
    setLoading(true);
    const runRes = await fetchJson<{ generated: number }>("/api/v2/billing/jobs/alerts/run", { method: "POST" });
    setLoading(false);
    if (isSuccess(runRes)) {
      setResult(`Alertas generadas: ${runRes.data.generated}`);
      await loadDashboard();
    }
  };

  const runPreview = async () => {
    setLoading(true);
    const res = await fetchJson<ImpactPreviewResponse>(`/api/v2/billing/actions/${action}/preview`, { method: "POST", body: payload });
    setLoading(false);
    if (isSuccess(res)) {
      setPreview(res.data);
      setResult("");
      return;
    }
    setResult(res.error.message);
  };

  const runExecute = async () => {
    setLoading(true);
    const res = await fetchJson<{ operation_id: string; result: unknown }>(`/api/v2/billing/actions/${action}/execute`, {
      method: "POST",
      body: payload,
      headers: { "x-source-channel": "billing-home" },
    });
    setLoading(false);
    if (isSuccess(res)) {
      setResult(`Operacion ${res.data.operation_id} ejecutada.`);
      setPreview(null);
      await loadDashboard();
      return;
    }
    setResult(res.error.message);
  };

  const markAlert = async (id: string, status: "in_progress" | "resolved") => {
    const res = await fetchJson<BillingAlert>(`/api/v2/billing/alerts/${id}`, { method: "PATCH", body: { status } });
    if (isSuccess(res)) {
      await loadDashboard();
    }
  };

  const optionsForField = (field: FieldConfig) => {
    if (field.staticOptions) return field.staticOptions;
    if (!field.lookup) return [];
    return lookups[field.lookup];
  };

  const shouldShowField = (field: FieldConfig) => {
    if (action !== "renew_subscription") return true;
    const invoiceEnabled = toText(payload.generate_invoice || "true") === "true";
    if (!invoiceEnabled && (field.key === "discount_type" || field.key === "discount_value" || field.key === "discount_reason")) {
      return false;
    }
    return true;
  };

  return (
    <main className="main-stack">
      <PageHeaderCard
        title="Operaciones de Billing"
        description="Cola operativa, alertas y acciones con preview obligatorio."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="main-card-subtle"><p className="text-xs text-slate-500">Renovaciones 30d</p><p className="text-2xl font-semibold">{dashboard?.kpis.renewals_next_30_days ?? 0}</p></article>
        <article className="main-card-subtle"><p className="text-xs text-slate-500">Suscripciones vencidas</p><p className="text-2xl font-semibold">{dashboard?.kpis.overdue_subscriptions ?? 0}</p></article>
        <article className="main-card-subtle"><p className="text-xs text-slate-500">Facturas emitidas sin pago</p><p className="text-2xl font-semibold">{dashboard?.kpis.unpaid_invoices ?? 0}</p></article>
        <article className="main-card-subtle"><p className="text-xs text-slate-500">Cuotas vencidas</p><p className="text-2xl font-semibold">{dashboard?.kpis.overdue_installments ?? 0}</p></article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <article className="main-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-900">Bandeja operacional</h3><button onClick={runAlertsJob} disabled={loading} className="ui-btn ui-btn-primary ui-btn-sm">Ejecutar batch alertas</button></div>
          <div className="max-h-[420px] overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50"><tr><th className="px-2 py-2 text-left">Tipo</th><th className="px-2 py-2 text-left">Severidad</th><th className="px-2 py-2 text-left">Estado</th><th className="px-2 py-2 text-left">Acciones</th></tr></thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">{a.alert_type}</td>
                    <td className="px-2 py-2">{a.severity}</td>
                    <td className="px-2 py-2">{a.status}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Link href={`/clientes/${a.empresa_id}`} className="ui-btn ui-btn-outline ui-btn-sm">Cliente</Link>
                        <button onClick={() => markAlert(a.id, "in_progress")} className="ui-btn ui-btn-secondary ui-btn-sm">Tomar</button>
                        <button onClick={() => markAlert(a.id, "resolved")} className="ui-btn ui-btn-secondary ui-btn-sm">Resolver</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="main-card">
          <h3 className="font-semibold text-slate-900">Busqueda de clientes</h3>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre, NIT o email" className="mt-2 ui-input" />
          <div className="mt-3 max-h-[340px] space-y-2 overflow-auto">
            {customers.map((c) => (
              <Link key={c.customer_id} href={`/clientes/${c.customer_id}`} className="block rounded border border-slate-200 p-2 text-xs hover:bg-slate-50">
                <p className="font-semibold text-slate-800">{c.nombre}</p>
                <p className="text-slate-600">{c.primary_contact ?? "sin contacto"}</p>
                <p className="text-slate-500">Renovacion: {formatDateOnly(c.renewal_date)}</p>
              </Link>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2"><Link href="/clientes" className="ui-btn ui-btn-outline ui-btn-sm">Ver clientes</Link><Link href="/precios" className="ui-btn ui-btn-outline ui-btn-sm">Price Book</Link></div>
        </article>
      </section>

      <section className="main-card">
        <h3 className="font-semibold text-slate-900">Acciones (Preview {"->"} Confirmar)</h3>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <label className="text-xs">Accion<select value={action} onChange={(e) => { const next = e.target.value as BillingAction; setAction(next); setPayload({ ...(ACTION_OPTIONS.find((x) => x.id === next)?.template ?? {}) }); setPreview(null); setResult(""); }} className="mt-1 ui-input">{ACTION_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {ACTION_FORM_FIELDS[action].filter(shouldShowField).map((field) => (
            <label key={field.key} className="text-xs text-slate-700">
              {field.label}
              {optionsForField(field).length > 0 ? (
                <select value={toText(payload[field.key])} onChange={(e) => setPayload((p) => ({ ...p, [field.key]: e.target.value }))} className="mt-1 ui-input">
                  <option value="">Seleccionar...</option>
                  {optionsForField(field).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  type={field.type}
                  value={toText(payload[field.key])}
                  placeholder={field.placeholder}
                  onChange={(e) => setPayload((p) => ({ ...p, [field.key]: e.target.value }))}
                  className="mt-1 ui-input"
                />
              )}
              {field.help && <p className="mt-1 text-[11px] text-slate-500">{field.help}</p>}
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button onClick={runPreview} disabled={loading} className="ui-btn ui-btn-primary">1) Preview</button>
          <button onClick={runExecute} disabled={loading || !preview} className="ui-btn ui-btn-secondary">2) Confirmar</button>
        </div>
        {preview && (
          <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs">
            <p className="font-semibold">{preview.summary}</p>
            {preview.lines.map((line, idx) => (
              <p key={idx} className="mt-1">{line.label}: {formatMoney(line.amount)} | pago {formatDateOnly(line.billing_date)} | efectivo {formatDateOnly(line.effective_start)} a {formatDateOnly(line.effective_end)}</p>
            ))}
            <p className="mt-2 font-semibold">Total: {formatMoney(preview.totals.total)}</p>
            <p className="mt-1">Subtotal: {formatMoney(preview.totals.subtotal)} | Descuento: {formatMoney(preview.totals.discount)}</p>
          </div>
        )}
        {result && <p className="mt-2 text-xs text-slate-700">{result}</p>}
      </section>
    </main>
  );
}
