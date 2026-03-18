"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { fetchJson, isSuccess } from "@/lib/client/api";
import { formatDateOnly } from "@/lib/client/date-format";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeaderCard } from "@/components/ui/page-header-card";
import { AppModal } from "@/components/ui/modal";

type EmpresaBase = {
  id: string;
  nombre: string;
  nit: string | null;
  timezone: string;
  activa: boolean;
};

type EmpresaCard = {
  empresa_id: string;
  empresa_nombre: string;
  telefono: string | null;
  departamento: string | null;
  ciudad: string | null;
  direccion: string | null;
  estado_suscripcion: string | null;
  periodo_fin: string | null;
  plan_nombre: string | null;
  owner_nombre: string | null;
  owner_email: string | null;
};

type Lookup = {
  productos: Array<{ value: string; label: string }>;
};

type SuscripcionRow = {
  id: string;
  empresa_id: string;
  precio_plan_id: string | null;
  billing_cycle: string | null;
  estado: string | null;
  fecha_inicio?: string | null;
  periodo_actual_inicio?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  periodo_actual_fin?: string | null;
  fecha_fin?: string | null;
};

type ItemSuscripcionRow = {
  id: string;
  suscripcion_id: string;
  producto_id: string | null;
  producto_nombre?: string | null;
  cantidad: number | null;
  estado: string | null;
  origen: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
};

type PrecioPlanRow = {
  id: string;
  valor: number | string | null;
  periodo: string | null;
};

type ProductoRow = {
  id: string;
  nombre: string | null;
};

type PlanItemView = {
  id: string;
  producto: string;
  cantidad: number;
  estado: string;
  vigencia: string;
};

type SubscriptionPlanHistoryRow = {
  historial_id: string;
  suscripcion_id: string;
  plan_nombre: string;
  billing_cycle: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  motivo: string | null;
};

type SubscriptionBillingRow = {
  factura_id: string;
  fecha_emision: string;
  fecha_vencimiento?: string | null;
  total: string | number;
  estado: string;
};

type FacturaRow = {
  id: string;
  suscripcion_id: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  estado: string | null;
  total: string | number | null;
};

type SubscriptionHistoryPayload = {
  history: SubscriptionPlanHistoryRow[];
  invoices: SubscriptionBillingRow[];
};

type PaymentComplianceState = "AL_DIA" | "PENDIENTE" | "VENCIDO" | "SIN_FACTURA" | "NO_APLICA";

type HistoryEvent = {
  key: string;
  label: string;
  detail: string;
  date: string | null;
};

type TraceRow = {
  id: string;
  empresa: string;
  nit: string;
  plan_actual: string;
  estado_empresa: "ACTIVA" | "INACTIVA" | "POR_VENCER" | "SUSPENDIDO";
  estado_suscripcion_vista: "ACTIVA" | "POR_VENCER" | "SUSPENDIDO" | "SIN_SUSCRIPCION";
  suscripcion_id: string | null;
  fecha_creacion_suscripcion: string | null;
  fecha_vencimiento_suscripcion: string | null;
  fecha_vencimiento_certificado: string | null;
  dias_vigencia_suscripcion: number | null;
  dias_vigencia_certificado: number | null;
  dias_vigencia: number | null;
  estado_certificado: "VIGENTE" | "POR_VENCER" | "VENCIDO" | "SIN_CERTIFICADO";
  descripcion: string;
  estado_suscripcion: string;
  owner: string;
  owner_email: string;
  telefono: string;
  departamento: string;
  ciudad: string;
  direccion: string;
  billing_cycle: string;
  plan_cost: string;
  periodo_actual_inicio: string | null;
  cumplimiento_mensual: PaymentComplianceState;
  cumplimiento_factura_id: string | null;
  cumplimiento_factura_estado: string | null;
  cumplimiento_factura_emision: string | null;
  cumplimiento_factura_vencimiento: string | null;
  cumplimiento_factura_total: string | number | null;
  plan_items: PlanItemView[];
  additional_items: PlanItemView[];
};

type KpiFilter = "TODOS" | "ACTIVAS" | "POR_VENCER_3" | "INACTIVAS";
type PaymentKpiFilter = "TODOS" | "AL_DIA" | "PENDIENTE" | "VENCIDO" | "SIN_FACTURA";

function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const today = new Date();
  const end = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  const delta = end.getTime() - new Date(`${today.toISOString().slice(0, 10)}T00:00:00`).getTime();
  return Math.floor(delta / (1000 * 60 * 60 * 24));
}

function resolveCertificateState(periodEnd: string | null): TraceRow["estado_certificado"] {
  const days = daysUntil(periodEnd);
  if (days == null) return "SIN_CERTIFICADO";
  if (days < 0) return "VENCIDO";
  if (days <= 3) return "POR_VENCER";
  return "VIGENTE";
}

function certificateBadge(value: TraceRow["estado_certificado"]) {
  const styles = {
    VIGENTE: "bg-emerald-100 text-emerald-700",
    POR_VENCER: "bg-amber-100 text-amber-700",
    VENCIDO: "bg-red-100 text-red-700",
    SIN_CERTIFICADO: "bg-slate-200 text-slate-700",
  }[value];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles}`}>{value}</span>;
}

function subscriptionBadge(value: TraceRow["estado_suscripcion_vista"]) {
  const styles = {
    ACTIVA: "bg-emerald-100 text-emerald-700",
    POR_VENCER: "bg-amber-100 text-amber-700",
    SUSPENDIDO: "bg-red-100 text-red-700",
    SIN_SUSCRIPCION: "bg-slate-200 text-slate-700",
  }[value];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles}`}>{value}</span>;
}

function paymentBadge(value: PaymentComplianceState) {
  const styles = {
    AL_DIA: "bg-emerald-100 text-emerald-700",
    PENDIENTE: "bg-amber-100 text-amber-700",
    VENCIDO: "bg-red-100 text-red-700",
    SIN_FACTURA: "bg-slate-200 text-slate-700",
    NO_APLICA: "bg-slate-100 text-slate-500",
  }[value];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles}`}>{value}</span>;
}

function billingCycleLabel(value: string | null | undefined): "Mensual" | "Anual" | null {
  const normalized = String(value ?? "").toUpperCase();
  if (!normalized || normalized === "-") return null;
  if (normalized.includes("ANUAL") || normalized.includes("YEAR")) return "Anual";
  if (normalized.includes("MENS") || normalized.includes("MONTH")) return "Mensual";
  return null;
}

function toDateOnly(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function isWithinPeriod(date: string, from: string, to: string) {
  return date >= from && date <= to;
}

function isPaidInvoiceStatus(value: string) {
  const state = String(value ?? "").toUpperCase();
  return state === "PAGADA" || state === "PAGADO" || state === "COBRADA";
}

export default function TrazabilidadEmpresasPage() {
  const [rows, setRows] = useState<TraceRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<"TODOS" | TraceRow["estado_certificado"]>("TODOS");
  const [subscriptionFilter, setSubscriptionFilter] = useState<"TODOS" | TraceRow["estado_suscripcion_vista"]>("TODOS");
  const [kpiFilter, setKpiFilter] = useState<KpiFilter>("TODOS");
  const [paymentKpiFilter, setPaymentKpiFilter] = useState<PaymentKpiFilter>("TODOS");
  const [search, setSearch] = useState("");
  const [selectedPlanRow, setSelectedPlanRow] = useState<TraceRow | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);

  const refresh = async () => {
    try {
      const [empresasRes, cardsRes, suscripcionesRes, itemsRes, facturasRes, preciosPlanesRes, productosRes, lookupsRes] = await Promise.all([
        fetchJson<EmpresaBase[]>("/api/v1/empresas"),
        fetchJson<EmpresaCard[]>("/api/backoffice/empresas/cards"),
        fetchJson<SuscripcionRow[]>("/api/v1/suscripciones"),
        fetchJson<ItemSuscripcionRow[]>("/api/v1/items-suscripcion"),
        fetchJson<FacturaRow[]>("/api/v1/facturas"),
        fetchJson<PrecioPlanRow[]>("/api/v1/precios-planes"),
        fetchJson<ProductoRow[]>("/api/v1/productos"),
        fetchJson<Lookup>("/api/backoffice/lookups"),
      ]);
      if (!isSuccess(empresasRes) || !isSuccess(cardsRes) || !isSuccess(suscripcionesRes) || !isSuccess(itemsRes) || !isSuccess(facturasRes) || !isSuccess(preciosPlanesRes) || !isSuccess(productosRes) || !isSuccess(lookupsRes)) {
        toast.error("No se pudo cargar la trazabilidad de empresas.");
        return;
      }

      const cardsByEmpresa = new Map(cardsRes.data.map((x) => [x.empresa_id, x]));
      const priceById = new Map(preciosPlanesRes.data.map((x) => [String(x.id), x]));
      const productLookupById = new Map((lookupsRes.data.productos ?? []).map((p) => [String(p.value), String(p.label).trim()]));
      const productNameById = new Map(productosRes.data.map((p) => [String(p.id), String(p.nombre ?? "").trim()]));
      const suscripcionesByEmpresa = new Map<string, SuscripcionRow[]>();
      suscripcionesRes.data.forEach((s) => {
        const list = suscripcionesByEmpresa.get(String(s.empresa_id)) ?? [];
        list.push(s);
        suscripcionesByEmpresa.set(String(s.empresa_id), list);
      });
      const itemsBySuscripcion = new Map<string, ItemSuscripcionRow[]>();
      itemsRes.data.forEach((it) => {
        const key = String(it.suscripcion_id);
        const list = itemsBySuscripcion.get(key) ?? [];
        list.push(it);
        itemsBySuscripcion.set(key, list);
      });
      const facturasBySuscripcion = new Map<string, FacturaRow[]>();
      facturasRes.data.forEach((factura) => {
        const subId = String(factura.suscripcion_id ?? "").trim();
        if (!subId) return;
        const list = facturasBySuscripcion.get(subId) ?? [];
        list.push(factura);
        facturasBySuscripcion.set(subId, list);
      });

      const sortSubscriptions = (list: SuscripcionRow[]) =>
        [...list].sort((a, b) => {
          const aEnd = String(a.periodo_actual_fin ?? a.fecha_fin ?? "");
          const bEnd = String(b.periodo_actual_fin ?? b.fecha_fin ?? "");
          if (aEnd !== bEnd) return bEnd.localeCompare(aEnd);
          const aUpd = String(a.updated_at ?? a.created_at ?? "");
          const bUpd = String(b.updated_at ?? b.created_at ?? "");
          return bUpd.localeCompare(aUpd);
        });

      const pickSubscription = (empresaId: string) => {
        const list = sortSubscriptions(suscripcionesByEmpresa.get(empresaId) ?? []);
        const active = list.find((x) => String(x.estado ?? "").toUpperCase() === "ACTIVA");
        return active ?? list[0] ?? null;
      };

      const itemToView = (it: ItemSuscripcionRow): PlanItemView => ({
        id: String(it.id),
        producto:
          String(it.producto_nombre ?? "").trim() ||
          productLookupById.get(String(it.producto_id ?? "")) ||
          productNameById.get(String(it.producto_id ?? "")) ||
          "Producto sin nombre",
        cantidad: Math.max(1, Number(it.cantidad ?? 1)),
        estado: String(it.estado ?? "N/A"),
        vigencia: `${formatDateOnly(it.fecha_inicio)} - ${formatDateOnly(it.fecha_fin)}`,
      });

      const traceRows: TraceRow[] = empresasRes.data.map((empresa) => {
        const card = cardsByEmpresa.get(empresa.id);
        const sub = pickSubscription(empresa.id);
        const subItems = sub ? itemsBySuscripcion.get(String(sub.id)) ?? [] : [];
        const planItems = subItems.filter((it) => String(it.origen ?? "").toUpperCase() === "PLAN").map(itemToView);
        const additionalItems = subItems.filter((it) => String(it.origen ?? "").toUpperCase() !== "PLAN").map(itemToView);
        const subscriptionStart = sub?.periodo_actual_inicio ?? sub?.fecha_inicio ?? null;
        const subscriptionEnd = sub?.periodo_actual_fin ?? sub?.fecha_fin ?? card?.periodo_fin ?? null;
        const certificateEnd = subscriptionEnd ?? card?.periodo_fin ?? null;
        const subscriptionDays = daysUntil(subscriptionEnd);
        const certificateDays = daysUntil(certificateEnd);
        const certificateState = resolveCertificateState(certificateEnd);
        const d = certificateDays;
        const priceRow = sub?.precio_plan_id ? priceById.get(String(sub.precio_plan_id)) : null;
        const numericCost = Number(priceRow?.valor ?? 0);
        const planCost = Number.isFinite(numericCost) && numericCost > 0 ? `$ ${numericCost.toLocaleString("es-CO")}` : "-";
        const cycleLabel = String(sub?.billing_cycle ?? priceRow?.periodo ?? "").toUpperCase() || "-";
        const isSuspendedByExpiry = subscriptionDays != null && subscriptionDays < 0;
        const isExpiringSoon =
          (subscriptionDays != null && subscriptionDays >= 0 && subscriptionDays <= 3) ||
          (certificateDays != null && certificateDays >= 0 && certificateDays <= 3);
        const hasSubscription = Boolean(sub?.id);
        const subscriptionInvoices = sub?.id ? facturasBySuscripcion.get(String(sub.id)) ?? [] : [];
        const normalizedStart = toDateOnly(subscriptionStart);
        const normalizedEnd = toDateOnly(subscriptionEnd);
        const currentPeriodInvoices =
          normalizedStart && normalizedEnd
            ? subscriptionInvoices.filter((invoice) => {
                const invoiceDate = toDateOnly(invoice.fecha_emision);
                if (!invoiceDate) return false;
                return isWithinPeriod(invoiceDate, normalizedStart, normalizedEnd);
              })
            : subscriptionInvoices;
        const sortedCurrentPeriodInvoices = [...currentPeriodInvoices].sort((a, b) => {
          const aDate = toDateOnly(a.fecha_emision);
          const bDate = toDateOnly(b.fecha_emision);
          if (aDate !== bDate) return bDate.localeCompare(aDate);
          return String(b.id ?? "").localeCompare(String(a.id ?? ""));
        });
        const representativeInvoice = sortedCurrentPeriodInvoices[0] ?? null;
        const representativeInvoiceStatus = String(representativeInvoice?.estado ?? "").toUpperCase();
        const effectiveDueDate = toDateOnly(representativeInvoice?.fecha_vencimiento) || normalizedEnd;
        let paymentCompliance: PaymentComplianceState = "NO_APLICA";
        if (hasSubscription) {
          if (!representativeInvoice) {
            paymentCompliance = "SIN_FACTURA";
          } else if (isPaidInvoiceStatus(representativeInvoiceStatus)) {
            paymentCompliance = "AL_DIA";
          } else if ((daysUntil(effectiveDueDate) ?? 0) < 0) {
            paymentCompliance = "VENCIDO";
          } else {
            paymentCompliance = "PENDIENTE";
          }
        }
        const subscriptionVisualState: TraceRow["estado_suscripcion_vista"] =
          !hasSubscription ? "SIN_SUSCRIPCION" : isSuspendedByExpiry ? "SUSPENDIDO" : isExpiringSoon ? "POR_VENCER" : "ACTIVA";
        const empresaEstado: TraceRow["estado_empresa"] =
          isSuspendedByExpiry ? "SUSPENDIDO" : isExpiringSoon ? "POR_VENCER" : !empresa.activa ? "INACTIVA" : "ACTIVA";
        const statusDesc =
          certificateState === "SIN_CERTIFICADO"
            ? "No hay suscripcion/certificado activo asociado."
            : certificateState === "VENCIDO"
              ? `Certificado vencido hace ${Math.abs(d ?? 0)} dia(s).`
              : certificateState === "POR_VENCER"
                ? `Certificado por vencer en ${d ?? 0} dia(s).`
                : `Certificado vigente. Restan ${d ?? 0} dia(s).`;

        return {
          id: empresa.id,
          empresa: empresa.nombre,
          nit: empresa.nit ?? "-",
          plan_actual: card?.plan_nombre ?? "Sin plan",
          estado_empresa: empresaEstado,
          estado_suscripcion_vista: subscriptionVisualState,
          suscripcion_id: sub?.id ?? null,
          fecha_creacion_suscripcion: sub?.created_at ?? null,
          fecha_vencimiento_suscripcion: subscriptionEnd,
          fecha_vencimiento_certificado: certificateEnd,
          dias_vigencia_suscripcion: subscriptionDays,
          dias_vigencia_certificado: certificateDays,
          dias_vigencia: d,
          estado_certificado: certificateState,
          descripcion: `${statusDesc} Suscripcion: ${card?.estado_suscripcion ?? "N/A"}${card?.plan_nombre ? ` | Plan: ${card.plan_nombre}` : ""}`,
          estado_suscripcion: card?.estado_suscripcion ?? "SIN_SUSCRIPCION",
          owner: card?.owner_nombre ?? card?.owner_email ?? "Sin responsable",
          owner_email: card?.owner_email ?? "-",
          telefono: card?.telefono ?? "-",
          departamento: card?.departamento ?? "-",
          ciudad: card?.ciudad ?? "-",
          direccion: card?.direccion ?? "-",
          billing_cycle: cycleLabel,
          plan_cost: planCost,
          periodo_actual_inicio: subscriptionStart,
          cumplimiento_mensual: paymentCompliance,
          cumplimiento_factura_id: representativeInvoice?.id ?? null,
          cumplimiento_factura_estado: representativeInvoiceStatus || null,
          cumplimiento_factura_emision: representativeInvoice?.fecha_emision ?? null,
          cumplimiento_factura_vencimiento: representativeInvoice?.fecha_vencimiento ?? null,
          cumplimiento_factura_total: representativeInvoice?.total ?? null,
          plan_items: planItems,
          additional_items: additionalItems,
        };
      });

      setRows(traceRows);
    } catch {
      toast.error("Error de red al cargar trazabilidad de empresas.");
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const kpiOk =
        kpiFilter === "TODOS" ||
        (kpiFilter === "ACTIVAS" && row.estado_suscripcion_vista === "ACTIVA") ||
        (kpiFilter === "INACTIVAS" && row.estado_suscripcion_vista === "SUSPENDIDO") ||
        (kpiFilter === "POR_VENCER_3" && row.estado_suscripcion_vista === "POR_VENCER");
      const paymentKpiOk = paymentKpiFilter === "TODOS" || row.cumplimiento_mensual === paymentKpiFilter;
      const statusOk = statusFilter === "TODOS" || row.estado_certificado === statusFilter;
      const subscriptionOk = subscriptionFilter === "TODOS" || row.estado_suscripcion_vista === subscriptionFilter;
      const searchOk =
        !term ||
        `${row.empresa} ${row.nit} ${row.plan_actual} ${row.descripcion} ${row.owner} ${row.estado_suscripcion} ${row.estado_empresa} ${row.estado_suscripcion_vista} ${row.cumplimiento_mensual}`.toLowerCase().includes(term);
      return kpiOk && paymentKpiOk && statusOk && subscriptionOk && searchOk;
    });
  }, [rows, search, statusFilter, subscriptionFilter, kpiFilter, paymentKpiFilter]);

  const activeCompanies = useMemo(() => rows.filter((r) => r.estado_suscripcion_vista === "ACTIVA").length, [rows]);
  const expiringIn3Days = useMemo(
    () => rows.filter((r) => r.estado_suscripcion_vista === "POR_VENCER").length,
    [rows],
  );
  const inactiveCompanies = useMemo(() => rows.filter((r) => r.estado_suscripcion_vista === "SUSPENDIDO").length, [rows]);
  const paymentAlDiaCount = useMemo(() => rows.filter((r) => r.cumplimiento_mensual === "AL_DIA").length, [rows]);
  const paymentPendienteCount = useMemo(() => rows.filter((r) => r.cumplimiento_mensual === "PENDIENTE").length, [rows]);
  const paymentVencidoCount = useMemo(() => rows.filter((r) => r.cumplimiento_mensual === "VENCIDO").length, [rows]);
  const paymentSinFacturaCount = useMemo(() => rows.filter((r) => r.cumplimiento_mensual === "SIN_FACTURA").length, [rows]);

  const openPlanInfo = (row: TraceRow) => {
    setSelectedPlanRow(row);
    setPlanModalOpen(true);
  };

  const openHistory = async (row: TraceRow) => {
    if (!row.suscripcion_id) {
      toast.error("La empresa no tiene una suscripción asociada para historial.");
      return;
    }
    setHistoryModalOpen(true);
    setHistoryLoading(true);
    setHistoryEvents([]);
    try {
      const res = await fetchJson<SubscriptionHistoryPayload>(`/api/backoffice/suscripciones/${row.suscripcion_id}/historial`);
      if (!isSuccess(res)) {
        toast.error("No se pudo cargar el historial.");
        return;
      }
      const events: HistoryEvent[] = [];
      (res.data.history ?? []).forEach((h) => {
        const reason = String(h.motivo ?? "").toUpperCase();
        if (reason.includes("RENOV")) {
          events.push({
            key: `${h.historial_id}-renew`,
            label: "Renovó",
            detail: `${h.plan_nombre} (${h.billing_cycle})`,
            date: h.vigente_desde,
          });
        }
        if (reason.includes("CAMBIO")) {
          events.push({
            key: `${h.historial_id}-change`,
            label: "Cambió plan",
            detail: `${h.plan_nombre} (${h.billing_cycle})`,
            date: h.vigente_desde,
          });
        }
      });
      (res.data.invoices ?? []).forEach((inv) => {
        const status = String(inv.estado ?? "").toUpperCase();
        events.push({
          key: `${inv.factura_id}-issued`,
          label: "Factura emitida",
          detail: `Factura ${inv.factura_id.slice(0, 8)} por ${inv.total}`,
          date: inv.fecha_emision,
        });
        if (isPaidInvoiceStatus(status)) {
          events.push({
            key: `${inv.factura_id}-paid`,
            label: "Factura pagada",
            detail: `Factura ${inv.factura_id.slice(0, 8)} en estado ${status}`,
            date: inv.fecha_emision,
          });
          return;
        }
        const overdueRefDate = inv.fecha_vencimiento ?? inv.fecha_emision;
        if ((daysUntil(overdueRefDate) ?? 0) < -30) {
          events.push({
            key: `${inv.factura_id}-overdue`,
            label: "Factura vencida",
            detail: `Factura ${inv.factura_id.slice(0, 8)} pendiente por más de 30 días`,
            date: overdueRefDate,
          });
        }
      });
      if (row.estado_suscripcion_vista === "SUSPENDIDO") {
        events.push({
          key: `${row.id}-blocked`,
          label: "Se bloqueó",
          detail: "Suscripción vencida (estado suspendido).",
          date: row.fecha_vencimiento_suscripcion,
        });
      }
      setHistoryEvents(events);
    } catch {
      toast.error("Error de red al cargar historial.");
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <main className="main-stack">
      <PageHeaderCard
        title="Trazabilidad de Empresas"
        description="Vista principal para seguimiento operativo de vigencia y estado certificado por empresa."
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => setKpiFilter((prev) => (prev === "ACTIVAS" ? "TODOS" : "ACTIVAS"))}
          className={`rounded-xl border px-3 py-2.5 text-left transition ${kpiFilter === "ACTIVAS" ? "border-emerald-400 bg-emerald-100" : "border-emerald-200 bg-emerald-50"}`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Empresas activas</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-800">{activeCompanies}</p>
        </button>
        <button
          type="button"
          onClick={() => setKpiFilter((prev) => (prev === "POR_VENCER_3" ? "TODOS" : "POR_VENCER_3"))}
          className={`rounded-xl border px-3 py-2.5 text-left transition ${kpiFilter === "POR_VENCER_3" ? "border-amber-400 bg-amber-100" : "border-amber-200 bg-amber-50"}`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Por vencer (3 días)</p>
          <p className="mt-1 text-2xl font-semibold text-amber-800">{expiringIn3Days}</p>
        </button>
        <button
          type="button"
          onClick={() => setKpiFilter((prev) => (prev === "INACTIVAS" ? "TODOS" : "INACTIVAS"))}
          className={`rounded-xl border px-3 py-2.5 text-left transition ${kpiFilter === "INACTIVAS" ? "border-slate-400 bg-slate-200" : "border-slate-200 bg-slate-100"}`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Suspendidas</p>
          <p className="mt-1 text-2xl font-semibold text-slate-800">{inactiveCompanies}</p>
        </button>
      </section>

      <section className="main-card-subtle flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Filtro pago:</span>
        <button
          type="button"
          onClick={() => setPaymentKpiFilter("TODOS")}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            paymentKpiFilter === "TODOS" ? "border-[#2563EB] bg-[#DBEAFE] text-[#1D4ED8]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Todos
        </button>
        <button
          type="button"
          onClick={() => setPaymentKpiFilter((prev) => (prev === "AL_DIA" ? "TODOS" : "AL_DIA"))}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            paymentKpiFilter === "AL_DIA" ? "border-emerald-400 bg-emerald-100 text-emerald-800" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          }`}
        >
          Al día ({paymentAlDiaCount})
        </button>
        <button
          type="button"
          onClick={() => setPaymentKpiFilter((prev) => (prev === "PENDIENTE" ? "TODOS" : "PENDIENTE"))}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            paymentKpiFilter === "PENDIENTE" ? "border-amber-400 bg-amber-100 text-amber-800" : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
          }`}
        >
          Pendiente ({paymentPendienteCount})
        </button>
        <button
          type="button"
          onClick={() => setPaymentKpiFilter((prev) => (prev === "VENCIDO" ? "TODOS" : "VENCIDO"))}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            paymentKpiFilter === "VENCIDO" ? "border-red-400 bg-red-100 text-red-800" : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
          }`}
        >
          Vencido ({paymentVencidoCount})
        </button>
        <button
          type="button"
          onClick={() => setPaymentKpiFilter((prev) => (prev === "SIN_FACTURA" ? "TODOS" : "SIN_FACTURA"))}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            paymentKpiFilter === "SIN_FACTURA" ? "border-slate-400 bg-slate-200 text-slate-800" : "border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          Sin factura ({paymentSinFacturaCount})
        </button>
      </section>

      <section className="main-card">
        <div className="mb-3 grid gap-2 md:grid-cols-[1fr_220px_220px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ui-input"
            placeholder="Buscar por empresa, NIT, descripcion, responsable..."
          />
          <select value={subscriptionFilter} onChange={(e) => setSubscriptionFilter(e.target.value as typeof subscriptionFilter)} className="ui-input">
            <option value="TODOS">Estado suscripción</option>
            <option value="ACTIVA">ACTIVA</option>
            <option value="POR_VENCER">POR_VENCER</option>
            <option value="SUSPENDIDO">SUSPENDIDO</option>
            <option value="SIN_SUSCRIPCION">SIN_SUSCRIPCION</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="ui-input">
            <option value="TODOS">Estado certificado</option>
            <option value="VIGENTE">VIGENTE</option>
            <option value="POR_VENCER">POR_VENCER</option>
            <option value="VENCIDO">VENCIDO</option>
            <option value="SIN_CERTIFICADO">SIN_CERTIFICADO</option>
          </select>
        </div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-600">
            Filtro KPI: <span className="font-semibold text-slate-800">{kpiFilter === "TODOS" ? "Ninguno" : kpiFilter === "ACTIVAS" ? "ACTIVAS" : kpiFilter === "POR_VENCER_3" ? "POR_VENCER" : "SUSPENDIDAS"}</span>
            {" | "}
            Filtro pago: <span className="font-semibold text-slate-800">{paymentKpiFilter === "TODOS" ? "Ninguno" : paymentKpiFilter}</span>
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => setKpiFilter("TODOS")}>
              Limpiar KPI estado
            </button>
            <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => setPaymentKpiFilter("TODOS")}>
              Limpiar KPI pago
            </button>
          </div>
        </div>

        <DataTable<TraceRow>
          className="max-h-[540px] overflow-auto rounded border border-slate-200"
          rows={filteredRows}
          getRowKey={(row) => row.id}
          columns={[
            {
              key: "empresa",
              header: "Empresa",
              render: (r) => (
                <div>
                  <p className="font-semibold text-slate-900">{r.empresa}</p>
                  <p className="text-xs text-slate-500">{r.owner}</p>
                </div>
              ),
            },
            { key: "nit", header: "NIT" },
            {
              key: "contacto",
              header: "Contacto",
              render: (r) => (
                <div className="text-xs text-slate-700">
                  <p>{r.owner_email || "-"}</p>
                  <p>{r.telefono || "-"}</p>
                </div>
              ),
            },
            {
              key: "plan_actual",
              header: "Plan Actual",
              render: (r) => {
                const cycle = billingCycleLabel(r.billing_cycle);
                return (
                  <div className="flex items-center gap-2">
                    <span>{r.plan_actual}</span>
                    {cycle ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{cycle}</span> : null}
                  </div>
                );
              },
            },
            {
              key: "fecha_creacion_suscripcion",
              header: "Fecha creación suscripción",
              render: (r) => formatDateOnly(r.fecha_creacion_suscripcion),
            },
            {
              key: "estado_suscripcion",
              header: "Estado suscripción",
              render: (r) => subscriptionBadge(r.estado_suscripcion_vista),
            },
            {
              key: "cumplimiento_mensual",
              header: "Cumplimiento mensual",
              render: (r) => paymentBadge(r.cumplimiento_mensual),
            },
            {
              key: "fecha_vencimiento",
              header: "Fecha vencimiento",
              render: (r) => formatDateOnly(r.fecha_vencimiento_suscripcion),
            },
            {
              key: "estado_certificado",
              header: "Estado certificado",
              render: (r) => (
                <div className="flex flex-wrap items-center gap-2">
                  {certificateBadge(r.estado_certificado)}
                  <span className="text-xs text-slate-600">
                    {r.dias_vigencia == null ? "-" : `${r.dias_vigencia} día(s)`}
                  </span>
                </div>
              ),
            },
            {
              key: "acciones",
              header: "Acciones",
              render: (r) => (
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => openPlanInfo(r)} className="ui-btn ui-btn-outline ui-btn-sm">Informacion del plan</button>
                  <button
                    onClick={() => void openHistory(r)}
                    disabled={!r.suscripcion_id}
                    className="ui-btn ui-btn-primary ui-btn-sm disabled:opacity-50"
                  >
                    Historial
                  </button>
                </div>
              ),
            },
          ] as DataTableColumn<TraceRow>[]}
        />
      </section>

      <AppModal
        open={planModalOpen}
        onClose={() => {
          setPlanModalOpen(false);
          setSelectedPlanRow(null);
        }}
        maxWidthClassName="max-w-2xl"
        panelClassName="max-h-[96vh]"
        bodyClassName="max-h-[76vh]"
        title="Informacion Suscripcion"
      >
        {!selectedPlanRow ? (
          <p className="text-sm text-slate-600">Selecciona una empresa para ver el plan adquirido.</p>
        ) : (
          <div className="rounded-2xl border border-slate-300 bg-white p-5">
            <div className="space-y-3 text-sm text-slate-800">
              <p className="font-semibold uppercase tracking-wide text-slate-900">Información de la empresa</p>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <p className="text-xs font-semibold text-slate-500">Nombre</p>
                  <p className="text-sm font-semibold text-slate-900">{selectedPlanRow.empresa || "Sin información"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <p className="text-xs font-semibold text-slate-500">NIT</p>
                  <p className="text-sm font-semibold text-slate-900">{selectedPlanRow.nit || "Sin información"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <p className="text-xs font-semibold text-slate-500">Representante</p>
                  <p className="text-sm font-semibold text-slate-900">{selectedPlanRow.owner || "Sin información"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <p className="text-xs font-semibold text-slate-500">Correo</p>
                  <p className="text-sm font-semibold text-slate-900">{selectedPlanRow.owner_email || "Sin información"}</p>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <p className="text-xs font-semibold text-slate-500">Telefono</p>
                  <p className="text-sm text-slate-900">{selectedPlanRow.telefono || "Sin información"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <p className="text-xs font-semibold text-slate-500">Departamento</p>
                  <p className="text-sm text-slate-900">{selectedPlanRow.departamento || "Sin información"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <p className="text-xs font-semibold text-slate-500">Ciudad</p>
                  <p className="text-sm text-slate-900">{selectedPlanRow.ciudad || "Sin información"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <p className="text-xs font-semibold text-slate-500">Direccion</p>
                  <p className="text-sm text-slate-900">{selectedPlanRow.direccion || "Sin información"}</p>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <p className="text-xs font-semibold text-slate-500">Estado certificado</p>
                  <p className="text-sm font-semibold text-slate-900">{selectedPlanRow.estado_certificado || "Sin información"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <p className="text-xs font-semibold text-slate-500">Vence suscripción</p>
                  <p className="text-sm font-semibold text-slate-900">{formatDateOnly(selectedPlanRow.fecha_vencimiento_suscripcion) || "Sin información"}</p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Plan adquirido</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {selectedPlanRow.plan_actual || "Sin información"} | Costo: {selectedPlanRow.plan_cost || "Sin información"} | Tipo: {selectedPlanRow.billing_cycle || "Sin información"}
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Seguimiento de pago mensual</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-[11px] font-semibold text-slate-500">Período evaluado</p>
                    <p className="text-sm font-semibold text-slate-900">
                      {formatDateOnly(selectedPlanRow.periodo_actual_inicio)} - {formatDateOnly(selectedPlanRow.fecha_vencimiento_suscripcion)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-[11px] font-semibold text-slate-500">Estado pago período</p>
                    <div className="mt-1">{paymentBadge(selectedPlanRow.cumplimiento_mensual)}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-[11px] font-semibold text-slate-500">Factura asociada</p>
                    <p className="text-sm font-semibold text-slate-900">{selectedPlanRow.cumplimiento_factura_id ? selectedPlanRow.cumplimiento_factura_id.slice(0, 8) : "-"}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-[11px] font-semibold text-slate-500">Estado factura</p>
                    <p className="text-sm font-semibold text-slate-900">{selectedPlanRow.cumplimiento_factura_estado || "-"}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-[11px] font-semibold text-slate-500">Emisión / vencimiento</p>
                    <p className="text-sm font-semibold text-slate-900">
                      {formatDateOnly(selectedPlanRow.cumplimiento_factura_emision)} - {formatDateOnly(selectedPlanRow.cumplimiento_factura_vencimiento)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-[11px] font-semibold text-slate-500">Total factura</p>
                    <p className="text-sm font-semibold text-slate-900">{selectedPlanRow.cumplimiento_factura_total ?? "-"}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-sm font-semibold uppercase text-slate-900">Items del plan</p>
              <div className="overflow-hidden rounded-2xl border border-slate-300">
                <div className="grid grid-cols-4 border-b border-slate-300 bg-slate-50 text-xs font-semibold uppercase text-slate-700">
                  <div className="border-r border-slate-300 px-2 py-2">Producto</div>
                  <div className="border-r border-slate-300 px-2 py-2">Cantidad</div>
                  <div className="border-r border-slate-300 px-2 py-2">Estado</div>
                  <div className="px-2 py-2">Vigencia</div>
                </div>
                {selectedPlanRow.plan_items.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-slate-500">Sin items base del plan.</p>
                ) : (
                  selectedPlanRow.plan_items.map((item) => (
                    <div key={item.id} className="grid grid-cols-4 border-b border-slate-200 text-xs text-slate-800 last:border-b-0">
                      <div className="border-r border-slate-200 px-2 py-2">{item.producto}</div>
                      <div className="border-r border-slate-200 px-2 py-2">{item.cantidad}</div>
                      <div className="border-r border-slate-200 px-2 py-2">{item.estado}</div>
                      <div className="px-2 py-2">{item.vigencia}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-sm font-semibold text-slate-900">Adicionales</p>
              <div className="overflow-hidden rounded-2xl border border-slate-300">
                <div className="grid grid-cols-4 border-b border-slate-300 bg-slate-50 text-xs font-semibold uppercase text-slate-700">
                  <div className="border-r border-slate-300 px-2 py-2">Producto</div>
                  <div className="border-r border-slate-300 px-2 py-2">Cantidad</div>
                  <div className="border-r border-slate-300 px-2 py-2">Estado</div>
                  <div className="px-2 py-2">Vigencia</div>
                </div>
                {selectedPlanRow.additional_items.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-slate-500">Sin adicionales.</p>
                ) : (
                  selectedPlanRow.additional_items.map((item) => (
                    <div key={item.id} className="grid grid-cols-4 border-b border-slate-200 text-xs text-slate-800 last:border-b-0">
                      <div className="border-r border-slate-200 px-2 py-2">{item.producto}</div>
                      <div className="border-r border-slate-200 px-2 py-2">{item.cantidad}</div>
                      <div className="border-r border-slate-200 px-2 py-2">{item.estado}</div>
                      <div className="px-2 py-2">{item.vigencia}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </AppModal>

      <AppModal
        open={historyModalOpen}
        onClose={() => {
          setHistoryModalOpen(false);
          setHistoryEvents([]);
        }}
        maxWidthClassName="max-w-3xl"
        title="Historial de eventos clave"
      >
        {historyLoading ? (
          <p className="text-sm text-slate-600">Cargando historial...</p>
        ) : historyEvents.length === 0 ? (
          <p className="text-sm text-slate-600">No hay eventos clave registrados para mostrar.</p>
        ) : (
          <ul className="space-y-2">
            {historyEvents.map((ev) => (
              <li key={ev.key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-sm font-semibold text-slate-900">{ev.label}</p>
                <p className="text-xs text-slate-700">{ev.detail}</p>
                <p className="text-xs text-slate-500">{formatDateOnly(ev.date)}</p>
              </li>
            ))}
          </ul>
        )}
      </AppModal>
    </main>
  );
}
