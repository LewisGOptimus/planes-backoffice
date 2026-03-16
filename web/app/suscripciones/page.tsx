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

type Row = Record<string, unknown> & { id?: string };

type Lookup = {
  empresas: Array<{ value: string; label: string }>;
  planes: Array<{ value: string; label: string }>;
  productos: Array<{ value: string; label: string }>;
  suscripciones: Array<{ value: string; label: string }>;
  usuarios: Array<{ value: string; label: string }>;
  precios_planes: Array<{ id: string; plan_id: string; periodo: string; valor: string }>;
};

type SubscriptionEntitlementRow = {
  entitlement_id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  valor_entero: number | null;
  valor_booleano: boolean | null;
  origen: string;
  efectivo_desde: string;
  efectivo_hasta: string | null;
};

type PlanEntitlementRow = {
  entitlement_id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  valor_entero: number | null;
  valor_booleano: boolean | null;
};

type SubscriptionPlanHistoryRow = {
  historial_id: string;
  suscripcion_id: string;
  plan_id: string;
  plan_nombre: string;
  billing_cycle: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  motivo: string | null;
  precio_plan_id: string | null;
  created_at: string;
};

type SubscriptionBillingRow = {
  factura_id: string;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  estado: string;
  subtotal: string | null;
  descuento_monto: string | null;
  total: string;
  metodo_pago: string;
  notas: string | null;
};

type SubscriptionHistoryPayload = {
  history: SubscriptionPlanHistoryRow[];
  invoices: SubscriptionBillingRow[];
};

type ProductCatalogRow = {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  es_consumible: boolean;
};

type ProductPriceRow = {
  id: string;
  producto_id: string;
  periodo: string;
  moneda_id: string;
  valor: string;
  activo: boolean;
  valido_desde: string | null;
  valido_hasta: string | null;
};

type DraftItem = {
  origen: string;
  producto_id: string;
  precio_id: string;
  cantidad: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_efectiva_inicio: string;
  fecha_efectiva_fin: string;
};

type DiscountDraft = {
  tipo: "" | "PERCENT" | "FIXED";
  valor: string;
  motivo: string;
};

type RenewDraft = {
  fecha_inicio: string;
  billing_cycle: "MENSUAL" | "TRIMESTRAL" | "ANUAL";
  precio_plan_id: string;
};

type PlanChangeReason = "NUEVO_PLAN" | "RENOVACION" | "CAMBIO_PLAN";

const EMPTY_DRAFT: DraftItem = {
  origen: "ADDON",
  producto_id: "",
  precio_id: "",
  cantidad: "1",
  fecha_inicio: "",
  fecha_fin: "",
  fecha_efectiva_inicio: "",
  fecha_efectiva_fin: "",
};

const EMPTY_DISCOUNT: DiscountDraft = {
  tipo: "",
  valor: "",
  motivo: "",
};

const EMPTY_RENEW_DRAFT: RenewDraft = {
  fecha_inicio: "",
  billing_cycle: "MENSUAL",
  precio_plan_id: "",
};

function computeDiscountPreview(subtotal: number, discount: DiscountDraft) {
  if (!Number.isFinite(subtotal) || subtotal <= 0 || !discount.tipo || discount.valor.trim() === "") {
    return { subtotal: Number.isFinite(subtotal) ? subtotal : 0, discount: 0, total: Math.max(0, subtotal || 0) };
  }
  const value = Number(discount.valor);
  if (!Number.isFinite(value) || value < 0) {
    return { subtotal, discount: 0, total: subtotal };
  }
  const raw = discount.tipo === "PERCENT" ? subtotal * (value / 100) : value;
  const amount = Number(Math.min(subtotal, Math.max(0, raw)).toFixed(2));
  return { subtotal: Number(subtotal.toFixed(2)), discount: amount, total: Number((subtotal - amount).toFixed(2)) };
}

function badge(value: string) {
  return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-semibold">{value}</span>;
}

function isPriceValidForDate(price: ProductPriceRow, date: string): boolean {
  if (!price.activo) return false;
  if (!date) return true;
  if (price.valido_desde && price.valido_desde > date) return false;
  if (price.valido_hasta && price.valido_hasta < date) return false;
  return true;
}

export default function SuscripcionesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [lookups, setLookups] = useState<Lookup>({ empresas: [], planes: [], productos: [], suscripciones: [], usuarios: [], precios_planes: [] });
  const [catalog, setCatalog] = useState<ProductCatalogRow[]>([]);
  const [prices, setPrices] = useState<ProductPriceRow[]>([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("Listo");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    empresa_id: "",
    plan_id: "",
    billing_cycle: "MENSUAL",
    modo_renovacion: "MANUAL",
    fecha_inicio: "",
    estado: "ACTIVA",
    generar_factura: "false",
    operational_status: "EN_SERVICIO",
    grace_days_granted: "0",
    grace_until: "",
    periodo_actual_inicio: "",
  });
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [draft, setDraft] = useState<DraftItem>(EMPTY_DRAFT);
  const [addItemModalOpen, setAddItemModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [renewModalOpen, setRenewModalOpen] = useState(false);
  const [renewTargetId, setRenewTargetId] = useState("");
  const [renewDraft, setRenewDraft] = useState<RenewDraft>(EMPTY_RENEW_DRAFT);
  const [planChangeModalOpen, setPlanChangeModalOpen] = useState(false);
  const [previousPlanEndDate, setPreviousPlanEndDate] = useState("");
  const [newPlanStartDate, setNewPlanStartDate] = useState("");
  const [planChangeReason, setPlanChangeReason] = useState<PlanChangeReason>("CAMBIO_PLAN");
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelDate, setCancelDate] = useState(new Date().toISOString().slice(0, 10));
  const [entitlementSearch, setEntitlementSearch] = useState("");
  const [autoInvoiceOnAddItem, setAutoInvoiceOnAddItem] = useState(true);
  const [createDiscount, setCreateDiscount] = useState<DiscountDraft>(EMPTY_DISCOUNT);
  const [addItemDiscount, setAddItemDiscount] = useState<DiscountDraft>(EMPTY_DISCOUNT);
  const [selectedEntitlements, setSelectedEntitlements] = useState<SubscriptionEntitlementRow[]>([]);
  const [selectedPlanEntitlements, setSelectedPlanEntitlements] = useState<PlanEntitlementRow[]>([]);
  const [historyRows, setHistoryRows] = useState<SubscriptionPlanHistoryRow[]>([]);
  const [historyInvoices, setHistoryInvoices] = useState<SubscriptionBillingRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const showApiError = (res: { error: { code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE_VIOLATION" | "INTERNAL_ERROR" | "UNAUTHORIZED"; message: string } }) => {
    const msg = toHumanConsumableError(res.error.message) ?? toHumanError(res.error.code, res.error.message);
    setMessage(msg);
    toast.error(msg);
  };

  const refresh = async () => {
    try {
      const [s, i, l, p, pr] = await Promise.all([
        fetchJson<Row[]>("/api/v1/suscripciones"),
        fetchJson<Row[]>("/api/v1/items-suscripcion"),
        fetchJson<Lookup>("/api/backoffice/lookups"),
        fetchJson<ProductCatalogRow[]>("/api/v1/productos"),
        fetchJson<ProductPriceRow[]>("/api/v1/precios"),
      ]);
      if (isSuccess(s)) setRows(s.data);
      if (isSuccess(i)) setItems(i.data);
      if (isSuccess(l)) setLookups(l.data);
      if (isSuccess(p)) setCatalog(p.data);
      if (isSuccess(pr)) setPrices(pr.data);
    } catch {
      toast.error("Error de red al cargar suscripciones.");
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const selectedItems = useMemo(() => items.filter((x) => String(x.suscripcion_id) === selected), [items, selected]);
  const selectedSubscription = useMemo(
    () => rows.find((x) => String(x.id ?? "") === selected) ?? null,
    [rows, selected],
  );
  const selectedSubscriptionPlanPrice = useMemo(() => {
    if (!selectedSubscription) return null;

    const selectedPriceId = String(selectedSubscription.precio_plan_id ?? "");
    if (selectedPriceId) {
      const byId = lookups.precios_planes.find((p) => p.id === selectedPriceId);
      if (byId) return byId;
    }

    const planId = String(selectedSubscription.plan_id ?? "");
    const cycle = String(selectedSubscription.billing_cycle ?? selectedSubscription.periodo ?? "");
    if (!planId || !cycle) return null;
    return lookups.precios_planes.find((p) => p.plan_id === planId && p.periodo === cycle) ?? null;
  }, [lookups.precios_planes, selectedSubscription]);
  const draftProduct = useMemo(() => catalog.find((p) => p.id === draft.producto_id) ?? null, [catalog, draft.producto_id]);
  const selectedDraftPrice = useMemo(() => prices.find((p) => p.id === draft.precio_id) ?? null, [prices, draft.precio_id]);
  const selectedPlanPrice = useMemo(() => {
    if (!form.plan_id || !form.billing_cycle) return null;
    return lookups.precios_planes.find((p) => p.plan_id === form.plan_id && p.periodo === form.billing_cycle) ?? null;
  }, [lookups.precios_planes, form.plan_id, form.billing_cycle]);
  const renewTargetSubscription = useMemo(
    () => rows.find((x) => String(x.id ?? "") === renewTargetId) ?? null,
    [rows, renewTargetId],
  );
  const availableRenewPrices = useMemo(() => {
    const planId = String(renewTargetSubscription?.plan_id ?? "");
    if (!planId) return [];
    return lookups.precios_planes.filter((p) => p.plan_id === planId && p.periodo === renewDraft.billing_cycle);
  }, [lookups.precios_planes, renewTargetSubscription, renewDraft.billing_cycle]);
  const createInvoicePreview = useMemo(
    () => computeDiscountPreview(Number(selectedPlanPrice?.valor ?? 0), createDiscount),
    [selectedPlanPrice, createDiscount],
  );
  const addItemInvoicePreview = useMemo(
    () => computeDiscountPreview(Number((Number(selectedDraftPrice?.valor ?? 0) * Number(draft.cantidad || 0)).toFixed(2)), addItemDiscount),
    [selectedDraftPrice, draft.cantidad, addItemDiscount],
  );
  const selectedOverrideEntitlements = useMemo(
    () => selectedEntitlements.filter((ent) => ent.origen !== "PLAN"),
    [selectedEntitlements],
  );
  const visibleOverrideEntitlements = useMemo(() => {
    const term = entitlementSearch.trim().toLowerCase();
    if (!term) return selectedOverrideEntitlements;
    return selectedOverrideEntitlements.filter((ent) =>
      `${ent.nombre} ${ent.codigo} ${ent.tipo} ${ent.origen}`.toLowerCase().includes(term),
    );
  }, [selectedOverrideEntitlements, entitlementSearch]);
  const visiblePlanEntitlements = useMemo(() => {
    const term = entitlementSearch.trim().toLowerCase();
    if (!term) return selectedPlanEntitlements;
    return selectedPlanEntitlements.filter((ent) => `${ent.nombre} ${ent.codigo} ${ent.tipo}`.toLowerCase().includes(term));
  }, [selectedPlanEntitlements, entitlementSearch]);
  const activeItemsCount = useMemo(
    () => selectedItems.filter((it) => String(it.estado ?? "").toUpperCase() === "ACTIVO").length,
    [selectedItems],
  );
  const openOverrideEntitlementsCount = useMemo(
    () => selectedOverrideEntitlements.filter((ent) => !ent.efectivo_hasta).length,
    [selectedOverrideEntitlements],
  );
  const openEntitlementsCount = useMemo(
    () => selectedPlanEntitlements.length + openOverrideEntitlementsCount,
    [selectedPlanEntitlements, openOverrideEntitlementsCount],
  );
  const planEntitlements = useMemo(
    () => visiblePlanEntitlements,
    [visiblePlanEntitlements],
  );
  const overrideEntitlements = useMemo(
    () => visibleOverrideEntitlements,
    [visibleOverrideEntitlements],
  );
  const totalEntitlementsCount = useMemo(
    () => selectedPlanEntitlements.length + selectedOverrideEntitlements.length,
    [selectedPlanEntitlements, selectedOverrideEntitlements],
  );

  const availableDraftPrices = useMemo(() => {
    if (!draft.producto_id) return [];
    return prices
      .filter((p) => p.producto_id === draft.producto_id)
      .filter((p) => isPriceValidForDate(p, draft.fecha_inicio || new Date().toISOString().slice(0, 10)))
      .sort((a, b) => `${b.valido_desde ?? ""}${b.id}`.localeCompare(`${a.valido_desde ?? ""}${a.id}`));
  }, [prices, draft.producto_id, draft.fecha_inicio]);

  const resetDraft = (startDate = "") => setDraft({ ...EMPTY_DRAFT, fecha_inicio: startDate });
  const openCreate = () => {
    const today = new Date().toISOString().slice(0, 10);
    setEditing(null);
    setForm({
      empresa_id: "",
      plan_id: "",
      billing_cycle: "MENSUAL",
      modo_renovacion: "MANUAL",
      fecha_inicio: today,
      estado: "ACTIVA",
      generar_factura: "false",
      operational_status: "EN_SERVICIO",
      grace_days_granted: "0",
      grace_until: "",
      periodo_actual_inicio: today,
    });
    setDraftItems([]);
    resetDraft(today);
    setCreateDiscount(EMPTY_DISCOUNT);
    setModal(true);
  };

  const openEdit = (row: Row) => {
    setEditing(String(row.id));
    setForm({
      empresa_id: String(row.empresa_id ?? ""),
      plan_id: String(row.plan_id ?? ""),
      billing_cycle: String(row.billing_cycle ?? row.periodo ?? "MENSUAL"),
      modo_renovacion: String(row.modo_renovacion ?? "MANUAL"),
      fecha_inicio: String(row.fecha_inicio ?? ""),
      estado: String(row.estado ?? "ACTIVA"),
      generar_factura: "false",
      operational_status: String(row.operational_status ?? "EN_SERVICIO"),
      grace_days_granted: String(row.grace_days_granted ?? 0),
      grace_until: String(row.grace_until ?? ""),
      periodo_actual_inicio: String(row.periodo_actual_inicio ?? row.fecha_inicio ?? ""),
    });
    setDraftItems([]);
    resetDraft(String(row.fecha_inicio ?? ""));
    setCreateDiscount(EMPTY_DISCOUNT);
    setModal(true);
  };

  const validateItem = (value: DraftItem): string | null => {
    if (!value.producto_id) return "Selecciona un producto.";
    if (!value.fecha_inicio) return "Define la fecha de inicio del item.";
    const qty = Number(value.cantidad);
    if (!Number.isFinite(qty) || qty <= 0) return "La cantidad debe ser mayor a 0.";
    if (value.fecha_fin && value.fecha_fin < value.fecha_inicio) return "La fecha fin no puede ser menor que fecha inicio.";
    if (value.fecha_efectiva_inicio && value.fecha_efectiva_fin && value.fecha_efectiva_fin < value.fecha_efectiva_inicio) {
      return "La vigencia efectiva final no puede ser menor a la inicial.";
    }

    const product = catalog.find((p) => p.id === value.producto_id);
    if (!product) return "El producto no existe.";

    const validPrices = prices
      .filter((p) => p.producto_id === value.producto_id)
      .filter((p) => isPriceValidForDate(p, value.fecha_inicio));

    if (product.es_consumible && !value.precio_id) return "Para consumibles debes seleccionar un precio vigente.";
    if (value.precio_id && !validPrices.find((p) => p.id === value.precio_id)) {
      return "El precio seleccionado no pertenece al producto o no esta vigente para la fecha indicada.";
    }

    return null;
  };

  const submitEdit = async (extra: Record<string, unknown> = {}) => {
    if (!editing) return;
    const payload = {
      ...form,
      ...extra,
      generar_factura: undefined,
      grace_days_granted: Number(form.grace_days_granted || 0),
    };
    const res = await fetchJson<Row>(`/api/v1/suscripciones/${editing}`, { method: "PATCH", body: payload });
    if (isSuccess(res)) {
      setMessage("Suscripcion actualizada.");
      toast.success("Suscripcion actualizada.");
      setPlanChangeModalOpen(false);
      setPreviousPlanEndDate("");
      setNewPlanStartDate("");
      setPlanChangeReason("CAMBIO_PLAN");
      setCancelModalOpen(false);
      setCancelReason("");
      setCancelDate(new Date().toISOString().slice(0, 10));
      setModal(false);
      await refresh();
      return;
    }
    showApiError(res);
  };

  const save = async () => {
    try {
      if (editing) {
        const current = rows.find((r) => String(r.id ?? "") === editing);
        const previousPlan = String(current?.plan_id ?? "");
        const nextPlan = String(form.plan_id ?? "");
        const previousCycle = String(current?.billing_cycle ?? current?.periodo ?? "");
        const nextCycle = String(form.billing_cycle ?? "");
        if (previousPlan !== nextPlan || previousCycle !== nextCycle) {
          const defaultEnd = String(current?.periodo_actual_fin ?? "").slice(0, 10);
          const defaultStart = String(form.periodo_actual_inicio || form.fecha_inicio || "").slice(0, 10);
          setPreviousPlanEndDate(defaultEnd || new Date().toISOString().slice(0, 10));
          setNewPlanStartDate(defaultStart || new Date().toISOString().slice(0, 10));
          setPlanChangeReason(previousPlan !== nextPlan ? "CAMBIO_PLAN" : "RENOVACION");
          setPlanChangeModalOpen(true);
          return;
        }
        const previousState = String(current?.estado ?? "");
        const nextState = String(form.estado ?? "");
        if (previousState !== "CANCELADA" && nextState === "CANCELADA") {
          setCancelReason("");
          setCancelDate(new Date().toISOString().slice(0, 10));
          setCancelModalOpen(true);
          return;
        }
        await submitEdit();
        return;
      }

      const payload: Record<string, unknown> = {
        empresa_id: form.empresa_id,
        plan_id: form.plan_id,
        billing_cycle: form.billing_cycle,
        modo_renovacion: form.modo_renovacion,
        fecha_inicio: form.fecha_inicio,
        generar_factura: form.generar_factura === "true",
        items_suscripcion: draftItems,
      };
      if (form.generar_factura === "true" && createDiscount.tipo) {
        payload.descuento_tipo = createDiscount.tipo;
        payload.descuento_valor = createDiscount.valor;
        payload.descuento_motivo = createDiscount.motivo.trim() || null;
      }

      const res = await fetchJson<{ suscripcion_id: string; factura_id: string | null }>("/api/backoffice/suscripciones/create-with-options", { method: "POST", body: payload });
      if (isSuccess(res)) {
        const msg = res.data.factura_id ? "Suscripcion creada con factura." : "Suscripcion creada sin factura.";
        setMessage(msg);
        toast.success(msg);
        setModal(false);
        await refresh();
        return;
      }
      showApiError(res);
    } catch {
      toast.error("Error de red al guardar suscripcion.");
    }
  };

  const confirmCancellationAndSave = async () => {
    if (!cancelReason.trim()) {
      toast.error("El motivo de cancelacion es obligatorio.");
      return;
    }
    if (!cancelDate) {
      toast.error("La fecha de cancelacion es obligatoria.");
      return;
    }
    try {
      await submitEdit({
        motivo_cancelacion: cancelReason.trim(),
        canceled_at: `${cancelDate}T00:00:00.000Z`,
      });
    } catch {
      toast.error("Error de red al guardar cancelacion.");
    }
  };

  const confirmPlanChangeAndSave = async () => {
    if (!previousPlanEndDate) {
      toast.error("La fecha final del plan anterior es obligatoria.");
      return;
    }
    if (!newPlanStartDate) {
      toast.error("La fecha de inicio del nuevo plan es obligatoria.");
      return;
    }
    if (previousPlanEndDate > newPlanStartDate) {
      toast.error("La fecha final del plan anterior no puede ser mayor a la fecha de inicio del nuevo plan.");
      return;
    }
    try {
      await submitEdit({
        periodo_actual_inicio: newPlanStartDate,
        fecha_fin_plan_anterior: previousPlanEndDate,
        motivo_cambio_plan: planChangeReason,
      });
    } catch {
      toast.error("Error de red al guardar cambio de plan.");
    }
  };

  const openRenewModal = (row: Row) => {
    const today = new Date().toISOString().slice(0, 10);
    const planId = String(row.plan_id ?? "");
    const cycle = String(row.billing_cycle ?? row.periodo ?? "MENSUAL") as RenewDraft["billing_cycle"];
    const defaultPrice = lookups.precios_planes.find((p) => p.plan_id === planId && p.periodo === cycle)?.id ?? "";
    setRenewTargetId(String(row.id ?? ""));
    setRenewDraft({
      fecha_inicio: today,
      billing_cycle: cycle,
      precio_plan_id: defaultPrice,
    });
    setRenewModalOpen(true);
  };

  const submitRenewal = async () => {
    if (!renewTargetId) return;
    if (!renewDraft.fecha_inicio) {
      toast.error("Debes definir la fecha de inicio de la renovacion.");
      return;
    }
    if (!renewDraft.precio_plan_id) {
      toast.error("Debes seleccionar el precio aplicable.");
      return;
    }
    try {
      const res = await fetchJson<Row>(`/api/backoffice/suscripciones/${renewTargetId}/renovar`, {
        method: "POST",
        body: {
          fecha_inicio: renewDraft.fecha_inicio,
          billing_cycle: renewDraft.billing_cycle,
          precio_plan_id: renewDraft.precio_plan_id,
        },
      });
      if (isSuccess(res)) {
        setMessage("Suscripcion renovada.");
        toast.success("Suscripcion renovada.");
        setRenewModalOpen(false);
        setRenewTargetId("");
        setRenewDraft(EMPTY_RENEW_DRAFT);
        await refresh();
        return;
      }
      showApiError(res);
    } catch {
      toast.error("Error de red al renovar suscripcion.");
    }
  };

  const addDraftItem = () => {
    const error = validateItem(draft);
    if (error) {
      toast.error(error);
      return;
    }
    setDraftItems((prev) => [...prev, { ...draft }]);
    resetDraft(form.fecha_inicio);
  };

  const addItemExisting = async () => {
    if (!selected) return;
    const error = validateItem(draft);
    if (error) {
      toast.error(error);
      return;
    }

    try {
      const hasPrice = Boolean(selectedDraftPrice);
      const unitPrice = selectedDraftPrice ? Number(selectedDraftPrice.valor) : 0;
      const itemTotal = Number((unitPrice * Number(draft.cantidad)).toFixed(2));
      const payload: Record<string, unknown> = {
        suscripcion_id: selected,
        producto_id: draft.producto_id,
        precio_id: draft.precio_id || null,
        cantidad: Number(draft.cantidad),
        fecha_inicio: draft.fecha_inicio,
        fecha_fin: draft.fecha_fin || null,
        fecha_efectiva_inicio: draft.fecha_efectiva_inicio || null,
        fecha_efectiva_fin: draft.fecha_efectiva_fin || null,
        generar_factura: autoInvoiceOnAddItem,
      };
      if (autoInvoiceOnAddItem && addItemDiscount.tipo) {
        payload.descuento_tipo = addItemDiscount.tipo;
        payload.descuento_valor = addItemDiscount.valor;
        payload.descuento_motivo = addItemDiscount.motivo.trim() || null;
      }
      const res = await fetchJson<{ item_suscripcion_id: string; factura_id: string | null }>("/api/backoffice/suscripciones/add-item-with-options", { method: "POST", body: payload });
      if (isSuccess(res)) {
        const msg = res.data.factura_id
          ? `Item agregado y facturado por ${formatMoney(itemTotal)}.`
          : hasPrice
            ? `Item agregado por ${formatMoney(itemTotal)} (sin factura).`
            : "Item agregado sin factura.";
        setMessage(msg);
        toast.success(msg);
        resetDraft(new Date().toISOString().slice(0, 10));
        setAutoInvoiceOnAddItem(true);
        setAddItemDiscount(EMPTY_DISCOUNT);
        setAddItemModalOpen(false);
        await refresh();
        return;
      }
      showApiError(res);
    } catch {
      toast.error("Error de red al agregar item.");
    }
  };

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!selected) {
        setSelectedEntitlements([]);
        return;
      }
      try {
        const res = await fetchJson<SubscriptionEntitlementRow[]>(`/api/backoffice/suscripciones/${selected}/entitlements`);
        if (isSuccess(res)) setSelectedEntitlements(res.data);
      } catch {
        toast.error("Error de red al cargar entitlements de la suscripcion.");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [selected]);

  useEffect(() => {
    const t = setTimeout(async () => {
      const planId = String(selectedSubscription?.plan_id ?? "");
      if (!planId) {
        setSelectedPlanEntitlements([]);
        return;
      }
      try {
        const res = await fetchJson<PlanEntitlementRow[]>(`/api/backoffice/planes/${planId}/entitlements`);
        if (isSuccess(res)) setSelectedPlanEntitlements(res.data);
      } catch {
        toast.error("Error de red al cargar entitlements del plan.");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [selectedSubscription?.plan_id]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!historyModalOpen || !selected) {
        setHistoryRows([]);
        setHistoryInvoices([]);
        setHistoryLoading(false);
        return;
      }
      try {
        setHistoryLoading(true);
        const res = await fetchJson<SubscriptionHistoryPayload>(`/api/backoffice/suscripciones/${selected}/historial`);
        if (isSuccess(res)) {
          setHistoryRows(res.data.history ?? []);
          setHistoryInvoices(res.data.invoices ?? []);
        }
      } catch {
        toast.error("Error de red al cargar historial de planes.");
      } finally {
        setHistoryLoading(false);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [historyModalOpen, selected]);

  const historyWithInvoices = useMemo(
    () =>
      historyRows.map((h) => {
        const relatedInvoices = historyInvoices.filter((inv) => {
          const issueDate = String(inv.fecha_emision ?? "");
          if (!issueDate) return false;
          if (issueDate < h.vigente_desde) return false;
          if (h.vigente_hasta && issueDate > h.vigente_hasta) return false;
          return true;
        });
        return { history: h, invoices: relatedInvoices };
      }),
    [historyRows, historyInvoices],
  );

  const companyLabel = (id: string) => lookups.empresas.find((x) => x.value === id)?.label ?? id;
  const planLabel = (id: string) => lookups.planes.find((x) => x.value === id)?.label ?? id;
  const productLabel = (id: string) => lookups.productos.find((x) => x.value === id)?.label ?? id;
  const priceLabel = (id: string) => {
    const p = prices.find((x) => x.id === id);
    if (!p) return "-";
    return `${p.periodo} | ${formatMoney(p.valor)}`;
  };
  const isExpiredSubscription = (periodEnd: unknown) => {
    const d = String(periodEnd ?? "");
    if (!d) return false;
    const today = new Date().toISOString().slice(0, 10);
    return d < today;
  };

  const renderGuidedItemBuilder = (mode: "existing" | "draft") => (
    <div className="mt-2 rounded border border-slate-200 p-3">
      <p className="text-xs font-semibold">Flujo guiado item: Producto - Precio - Cantidad - Vigencia</p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <label className="text-xs">1. Producto<select value={draft.producto_id} onChange={(e) => setDraft((p) => ({ ...p, producto_id: e.target.value, precio_id: "" }))} className="mt-1 ui-input"><option value="">Producto...</option>{lookups.productos.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        <label className="text-xs">2. Precio ({draftProduct?.es_consumible ? "obligatorio" : "opcional"})<select value={draft.precio_id} onChange={(e) => setDraft((p) => ({ ...p, precio_id: e.target.value }))} className="mt-1 ui-input" disabled={!draft.producto_id}><option value="">Seleccionar precio...</option>{availableDraftPrices.map((pr) => <option key={pr.id} value={pr.id}>{`${pr.periodo} | ${formatMoney(pr.valor)} | ${formatDateOnly(pr.valido_desde)} - ${formatDateOnly(pr.valido_hasta)}`}</option>)}</select></label>
        <label className="text-xs">3. Cantidad<input type="number" value={draft.cantidad} onChange={(e) => setDraft((p) => ({ ...p, cantidad: e.target.value }))} className="mt-1 ui-input" /></label>
        <div className="md:col-span-2 border-t border-slate-200 pt-2">
          <p className="text-[11px] text-slate-600">Fechas (guia rapida)</p>
          <ul className="mt-1 list-disc pl-4 text-[11px] text-slate-600">
            <li>Cuando compras un paquete que se activa de inmediato, usa las mismas fechas para pago y vigencia efectiva. Ejemplo: compra de 100 documentos para usar hoy.</li>
            <li>Cuando haces un upgrade a mitad del ciclo, la vigencia efectiva inicia el dia del cambio y termina con el ciclo actual. Ejemplo: subir limite de empleados desde el 15 hasta fin de mes.</li>
            <li>Cuando vendes un servicio con validez fija independiente del cobro, separa pago y vigencia efectiva. Ejemplo: certificado pagado hoy que entra en vigencia la proxima semana.</li>
          </ul>
        </div>
        <label className="text-xs">4. Fecha inicio (pago)<input type="date" value={draft.fecha_inicio} onChange={(e) => setDraft((p) => ({ ...p, fecha_inicio: e.target.value, precio_id: "" }))} className="mt-1 ui-input" /></label>
        <label className="text-xs">Vigencia fin (pago)<input type="date" value={draft.fecha_fin} onChange={(e) => setDraft((p) => ({ ...p, fecha_fin: e.target.value }))} className="mt-1 ui-input" /></label>
        <label className="text-xs">Vigencia efectiva inicio<input type="date" value={draft.fecha_efectiva_inicio} onChange={(e) => setDraft((p) => ({ ...p, fecha_efectiva_inicio: e.target.value }))} className="mt-1 ui-input" /></label>
        <label className="text-xs">Vigencia efectiva fin<input type="date" value={draft.fecha_efectiva_fin} onChange={(e) => setDraft((p) => ({ ...p, fecha_efectiva_fin: e.target.value }))} className="mt-1 ui-input" /></label>
      </div>
      {draft.producto_id && availableDraftPrices.length === 0 && <p className="mt-2 text-xs text-amber-700">No hay precios vigentes para este producto en la fecha seleccionada.</p>}
      {draftProduct?.es_consumible && <p className="mt-1 text-xs text-slate-600">Para consumibles, `precio_id` es obligatorio y se valida por vigencia.</p>}
      {mode === "existing" && (
        <div className="mt-3 space-y-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoInvoiceOnAddItem}
              onChange={(e) => setAutoInvoiceOnAddItem(e.target.checked)}
            />
            Facturar automaticamente al agregar este item
          </label>
          <p>
            Valor unitario: {selectedDraftPrice ? formatMoney(selectedDraftPrice.valor) : "-"} | Cantidad: {draft.cantidad || "0"} | Total factura:{" "}
            {selectedDraftPrice ? formatMoney(Number(selectedDraftPrice.valor) * Number(draft.cantidad || 0)) : "-"}
          </p>
          {autoInvoiceOnAddItem && (
            <div className="grid gap-2 md:grid-cols-3">
              <label className="text-xs">Tipo descuento
                <select value={addItemDiscount.tipo} onChange={(e) => setAddItemDiscount((p) => ({ ...p, tipo: e.target.value as DiscountDraft["tipo"] }))} className="mt-1 ui-input">
                  <option value="">Sin descuento</option>
                  <option value="PERCENT">Porcentaje</option>
                  <option value="FIXED">Monto fijo</option>
                </select>
              </label>
              <label className="text-xs">Valor descuento
                <input type="number" value={addItemDiscount.valor} onChange={(e) => setAddItemDiscount((p) => ({ ...p, valor: e.target.value }))} className="mt-1 ui-input" />
              </label>
              <label className="text-xs">Motivo
                <input type="text" value={addItemDiscount.motivo} onChange={(e) => setAddItemDiscount((p) => ({ ...p, motivo: e.target.value }))} className="mt-1 ui-input" />
              </label>
            </div>
          )}
          {autoInvoiceOnAddItem && (
            <p>
              Subtotal: {formatMoney(addItemInvoicePreview.subtotal)} | Descuento: {formatMoney(addItemInvoicePreview.discount)} | Neto: {formatMoney(addItemInvoicePreview.total)}
            </p>
          )}
          {autoInvoiceOnAddItem && !selectedDraftPrice && <p className="text-amber-700">Para facturar automaticamente debes seleccionar un precio.</p>}
        </div>
      )}
      <button
        onClick={mode === "existing" ? addItemExisting : addDraftItem}
        disabled={mode === "existing" && autoInvoiceOnAddItem && !selectedDraftPrice}
        className="mt-3 ui-btn ui-btn-primary ui-btn-sm disabled:opacity-50"
      >
        {mode === "existing" ? "Agregar item a suscripcion" : "Agregar item manual"}
      </button>
    </div>
  );

  return (
    <main className="main-stack">
      <PageHeaderCard title="Suscripciones" description="Aquí se gestionan las suscripciones">
        <button
          onClick={openCreate}
          className="ui-btn ui-btn-primary ui-btn-sm"
        >
          Nueva suscripcion
        </button>
      </PageHeaderCard>
      <section className="main-card">
        <DataTable<Row>
          className="max-h-[350px] overflow-auto rounded border border-slate-200"
          rows={rows}
          getRowKey={(r, idx) => `${String(r.id ?? "")}-${idx}`}
          columns={[
            {
              key: "__index",
              header: "#",
              cellClassName: "w-[40px]",
              render: (_r, idx) => idx + 1,
            },
            {
              key: "empresa",
              header: "Empresa",
              render: (r) => companyLabel(String((r as any).empresa_id)),
            },
            {
              key: "plan",
              header: "Plan",
              render: (r) => planLabel(String((r as any).plan_id)),
            },
            {
              key: "estado",
              header: "Estado",
              render: (r) => badge(String((r as any).estado)),
            },
            {
              key: "operativo",
              header: "Operativo",
              render: (r) =>
                badge(String((r as any).operational_status ?? "EN_SERVICIO")),
            },
            {
              key: "prorroga",
              header: "Prorroga",
              render: (r) =>
                `${String((r as any).grace_days_granted ?? 0)} dias`,
            },
            {
              key: "periodo",
              header: "Periodo",
              render: (r) =>
                badge(String((r as any).billing_cycle ?? (r as any).periodo)),
            },
            {
              key: "fin_ciclo",
              header: "Fin ciclo",
              render: (r) => formatDateOnly((r as any).periodo_actual_fin),
            },
            {
              key: "acciones",
              header: "Acciones",
              render: (r) => (
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => {
                      setSelected(String((r as any).id));
                      setAutoInvoiceOnAddItem(true);
                      setAddItemDiscount(EMPTY_DISCOUNT);
                      setEntitlementSearch("");
                      setDetailsModalOpen(true);
                    }}
                    className="ui-btn ui-btn-outline ui-btn-sm"
                  >
                    Items
                  </button>
                  <button
                    onClick={() => {
                      setSelected(String((r as any).id));
                      setHistoryModalOpen(true);
                    }}
                    className="ui-btn ui-btn-outline ui-btn-sm"
                  >
                    Historial
                  </button>
                  {isExpiredSubscription((r as any).periodo_actual_fin) && (
                    <button
                      onClick={() => openRenewModal(r)}
                      className="ui-btn ui-btn-primary ui-btn-sm"
                    >
                      Renovar
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(r)}
                    className="ui-btn ui-btn-primary ui-btn-sm"
                  >
                    Editar
                  </button>
                </div>
              ),
            },
          ] as DataTableColumn<Row>[]}
        />
      </section>

      <AppModal
        open={detailsModalOpen}
        onClose={() => {
          setDetailsModalOpen(false);
          setEntitlementSearch("");
          setSelected("");
          setSelectedEntitlements([]);
          setSelectedPlanEntitlements([]);
        }}
        maxWidthClassName="max-w-6xl"
        title="Detalle de suscripcion"
      >
        {!selectedSubscription ? (
          <p className="text-sm text-slate-600">Selecciona una suscripcion para ver el detalle.</p>
        ) : (
          <div className="main-stack">
            <div className="rounded-xl border border-[#DCE8F7] bg-[linear-gradient(180deg,#FDFEFF_0%,#F6FAFF_100%)] p-3">
              <p className="text-sm font-semibold text-slate-900">
                {companyLabel(String(selectedSubscription.empresa_id ?? ""))} - {planLabel(String(selectedSubscription.plan_id ?? ""))}
              </p>
              <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-6">
                <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                  <p className="text-slate-500">Estado</p>
                  <p className="font-semibold text-slate-900">{String(selectedSubscription.estado ?? "ACTIVA")}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                  <p className="text-slate-500">Ciclo</p>
                  <p className="font-semibold text-slate-900">{String(selectedSubscription.billing_cycle ?? selectedSubscription.periodo ?? "-")}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                  <p className="text-slate-500">Prorroga</p>
                  <p className="font-semibold text-slate-900">{String(selectedSubscription.grace_days_granted ?? 0)} dias</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                  <p className="text-slate-500">Fecha inicial</p>
                  <p className="font-semibold text-slate-900">{formatDateOnly(selectedSubscription.fecha_inicio)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                  <p className="text-slate-500">Fecha final</p>
                  <p className="font-semibold text-slate-900">{formatDateOnly(selectedSubscription.periodo_actual_fin)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                  <p className="text-slate-500">Valor plan actual</p>
                  <p className="font-semibold text-slate-900">
                    {selectedSubscriptionPlanPrice ? formatMoney(selectedSubscriptionPlanPrice.valor) : "-"}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <section className="rounded-2xl border border-[#DCE8F7] bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FBFF_100%)] p-3.5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold text-slate-900">Items del plan</h4>
                  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                    {activeItemsCount}/{selectedItems.length}
                  </span>
                </div>
                {selectedItems.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">
                    Sin items en esta suscripcion.
                  </p>
                ) : (
                  <ul className="max-h-80 space-y-2 overflow-auto pr-1">
                    {selectedItems.map((it, idx) => {
                      const itemState = String(it.estado ?? "").toUpperCase();
                      const isActiveItem = itemState === "ACTIVO";
                      return (
                        <li key={`${String(it.id ?? "")}-${idx}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{productLabel(String(it.producto_id))}</p>
                              <p className="text-xs text-slate-500">{it.precio_id ? priceLabel(String(it.precio_id)) : "Sin precio asociado"}</p>
                            </div>
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                isActiveItem ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                              }`}
                            >
                              {itemState || "SIN ESTADO"}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                            <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium">
                              Cantidad: {String(it.cantidad ?? "-")}
                            </span>
                            <span>
                              Vigencia: {formatDateOnly(it.fecha_inicio)} - {formatDateOnly(it.fecha_fin)}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="rounded-2xl border border-[#DCE8F7] bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FBFF_100%)] p-3.5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold text-slate-900">Entitlements de la suscripcion</h4>
                  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{openEntitlementsCount}/{totalEntitlementsCount}</span>
                </div>
                {planEntitlements.length === 0 && overrideEntitlements.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">
                    Sin entitlements vigentes.
                  </p>
                ) : (
                  <div className="max-h-80 space-y-3 overflow-auto pr-1">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Asignados al plan</p>
                      </div>
                      {planEntitlements.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">
                          Sin entitlements de plan en la vista actual.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {planEntitlements.map((ent) => {
                            return (
                              <li
                                key={`plan-${ent.entitlement_id}`}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">{ent.nombre}</p>
                                    <p className="text-xs text-slate-500">{ent.codigo}</p>
                                  </div>
                                  <span
                                    className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700"
                                  >
                                    ACTIVO
                                  </span>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                                  <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium">Tipo: {ent.tipo}</span>
                                  <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium">Origen: PLAN</span>
                                  <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium">
                                    Valor: {ent.valor_entero ?? String(ent.valor_booleano ?? "-")}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Overrides de suscripcion</p>
                      </div>
                      {overrideEntitlements.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">
                          Sin overrides en la vista actual.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {overrideEntitlements.map((ent) => {
                            const isOpenEntitlement = !ent.efectivo_hasta;
                            return (
                              <li
                                key={`${ent.entitlement_id}-${ent.origen}-${ent.efectivo_desde}`}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">{ent.nombre}</p>
                                    <p className="text-xs text-slate-500">{ent.codigo}</p>
                                  </div>
                                  <span
                                    className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                      isOpenEntitlement ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                                    }`}
                                  >
                                    {isOpenEntitlement ? "ACTIVO" : "INACTIVO"}
                                  </span>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                                  <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium">Tipo: {ent.tipo}</span>
                                  <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium">Origen: {ent.origen}</span>
                                  <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium">
                                    Valor: {ent.valor_entero ?? String(ent.valor_booleano ?? "-")}
                                  </span>
                                </div>
                                <p className="mt-2 text-[11px] text-slate-600">
                                  Vigencia: {formatDateOnly(ent.efectivo_desde)} - {formatDateOnly(ent.efectivo_hasta)}
                                </p>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </AppModal>

      <p className="text-xs text-slate-600">{message}</p>

      <AppModal
        open={historyModalOpen}
        onClose={() => {
          setHistoryModalOpen(false);
          setSelected("");
          setHistoryRows([]);
          setHistoryInvoices([]);
        }}
        maxWidthClassName="max-w-5xl"
        title="Historial de planes y facturacion"
      >
        {!selectedSubscription ? (
          <p className="text-sm text-slate-600">Selecciona una suscripcion para ver el historial.</p>
        ) : historyLoading ? (
          <p className="text-sm text-slate-600">Cargando historial...</p>
        ) : historyWithInvoices.length === 0 ? (
          <p className="text-sm text-slate-600">No hay historial de planes para esta suscripcion.</p>
        ) : (
          <div className="main-stack">
            <div className="rounded-xl border border-[#DCE8F7] bg-[linear-gradient(180deg,#FDFEFF_0%,#F6FAFF_100%)] p-3">
              <p className="text-sm font-semibold text-slate-900">
                {companyLabel(String(selectedSubscription.empresa_id ?? ""))} - {planLabel(String(selectedSubscription.plan_id ?? ""))}
              </p>
              <p className="mt-1 text-xs text-slate-600">Seguimiento de planes durante el tiempo y facturacion emitida en cada tramo.</p>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-auto pr-1">
              {historyWithInvoices.map(({ history, invoices }) => (
                <section key={history.historial_id} className="rounded-2xl border border-[#DCE8F7] bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FBFF_100%)] p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">{history.plan_nombre}</h4>
                      <p className="text-xs text-slate-500">
                        Vigencia: {formatDateOnly(history.vigente_desde)} - {formatDateOnly(history.vigente_hasta)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">Ciclo: {history.billing_cycle}</span>
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">Facturas: {invoices.length}</span>
                      {history.motivo && <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">Motivo: {history.motivo}</span>}
                    </div>
                  </div>
                  {invoices.length === 0 ? (
                    <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">
                      Sin facturas en este tramo.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {invoices.map((inv) => (
                        <li key={`${history.historial_id}-${inv.factura_id}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Factura {inv.factura_id.slice(0, 8)}</p>
                              <p className="text-xs text-slate-500">Emision: {formatDateOnly(inv.fecha_emision)} | Vence: {formatDateOnly(inv.fecha_vencimiento)}</p>
                            </div>
                            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">{inv.estado}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                            <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium">Subtotal: {formatMoney(inv.subtotal ?? "0")}</span>
                            <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium">Descuento: {formatMoney(inv.descuento_monto ?? "0")}</span>
                            <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium">Total: {formatMoney(inv.total)}</span>
                            <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-medium">Pago: {inv.metodo_pago}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          </div>
        )}
      </AppModal>

      <AppModal
        open={modal}
        onClose={() => setModal(false)}
        maxWidthClassName="max-w-3xl"
        title={editing ? "Editar suscripcion" : "Nueva suscripcion"}
      >
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <label className="text-xs">Empresa<select value={form.empresa_id} onChange={(e) => setForm((p) => ({ ...p, empresa_id: e.target.value }))} className="mt-1 ui-input"><option value="">Empresa...</option>{lookups.empresas.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
              <label className="text-xs">Plan<select value={form.plan_id} onChange={(e) => setForm((p) => ({ ...p, plan_id: e.target.value }))} className="mt-1 ui-input"><option value="">Plan...</option>{lookups.planes.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
              <label className="text-xs">Ciclo de cobro<select value={form.billing_cycle} onChange={(e) => setForm((p) => ({ ...p, billing_cycle: e.target.value }))} className="mt-1 ui-input"><option value="MENSUAL">MENSUAL</option><option value="TRIMESTRAL">TRIMESTRAL</option><option value="ANUAL">ANUAL</option></select></label>
              <label className="text-xs">Modo renovacion<select value={form.modo_renovacion} onChange={(e) => setForm((p) => ({ ...p, modo_renovacion: e.target.value }))} className="mt-1 ui-input"><option value="MANUAL">MANUAL</option><option value="AUTOMATICA">AUTOMATICA</option></select></label>
              <label className="text-xs">Fecha inicio<input type="date" value={form.fecha_inicio} onChange={(e) => { const v = e.target.value; setForm((p) => ({ ...p, fecha_inicio: v })); setDraft((p) => ({ ...p, fecha_inicio: v })); }} className="mt-1 ui-input" /></label>
              {editing ? (
                <label className="text-xs">Estado<select value={form.estado} onChange={(e) => setForm((p) => ({ ...p, estado: e.target.value }))} className="mt-1 ui-input"><option value="ACTIVA">ACTIVA</option><option value="PAUSADA">PAUSADA</option><option value="CANCELADA">CANCELADA</option><option value="EXPIRADA">EXPIRADA</option></select></label>
              ) : (
                <label className="text-xs">Generar factura<select value={form.generar_factura} onChange={(e) => setForm((p) => ({ ...p, generar_factura: e.target.value }))} className="mt-1 ui-input"><option value="false">No</option><option value="true">Si (EMITIDA)</option></select></label>
              )}
            </div>
            {editing && <div className="mt-3 rounded border border-slate-200 p-3"><p className="text-xs font-semibold">Prorroga de servicio</p><div className="mt-2 grid gap-2 md:grid-cols-2"><label className="text-xs">Estado operativo<select value={form.operational_status} onChange={(e) => setForm((p) => ({ ...p, operational_status: e.target.value }))} className="mt-1 ui-input"><option value="EN_SERVICIO">EN_SERVICIO</option><option value="EN_PRORROGA">EN_PRORROGA</option></select></label><label className="text-xs">Dias de prorroga<input type="number" min="0" value={form.grace_days_granted} onChange={(e) => setForm((p) => ({ ...p, grace_days_granted: e.target.value }))} className="mt-1 ui-input" /></label></div><p className="mt-2 text-[11px] text-slate-600">Se cuentan desde el fin del ciclo actual antes del bloqueo total.</p></div>}
            {!editing && form.generar_factura === "true" && (
              <div className="mt-3 rounded border border-slate-200 p-3">
                <p className="text-xs font-semibold">Descuento de factura (suscripcion base)</p>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <label className="text-xs">Tipo descuento
                    <select value={createDiscount.tipo} onChange={(e) => setCreateDiscount((p) => ({ ...p, tipo: e.target.value as DiscountDraft["tipo"] }))} className="mt-1 ui-input">
                      <option value="">Sin descuento</option>
                      <option value="PERCENT">Porcentaje</option>
                      <option value="FIXED">Monto fijo</option>
                    </select>
                  </label>
                  <label className="text-xs">Valor descuento<input type="number" value={createDiscount.valor} onChange={(e) => setCreateDiscount((p) => ({ ...p, valor: e.target.value }))} className="mt-1 ui-input" /></label>
                  <label className="text-xs">Motivo<input type="text" value={createDiscount.motivo} onChange={(e) => setCreateDiscount((p) => ({ ...p, motivo: e.target.value }))} className="mt-1 ui-input" /></label>
                </div>
                <p className="mt-2 text-xs text-slate-600">Subtotal: {formatMoney(createInvoicePreview.subtotal)} | Descuento: {formatMoney(createInvoicePreview.discount)} | Neto: {formatMoney(createInvoicePreview.total)}</p>
              </div>
            )}
            {!editing && (
              <div className="mt-3 rounded border border-slate-200 p-3">
                <p className="text-xs font-semibold">Items manuales opcionales</p>
                {renderGuidedItemBuilder("draft")}
                <ul className="mt-2 space-y-1 text-xs">
                  {draftItems.map((d, idx) => <li key={`${d.producto_id}-${idx}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1"><span>{productLabel(d.producto_id)} | precio {d.precio_id ? priceLabel(d.precio_id) : "-"} | cant {d.cantidad} | pago {d.fecha_inicio || form.fecha_inicio}</span><button onClick={() => setDraftItems((prev) => prev.filter((_, i) => i !== idx))} className="ui-btn ui-btn-danger ui-btn-sm">Quitar</button></li>)}
                </ul>
              </div>
            )}
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => setModal(false)} className="ui-btn ui-btn-outline">Cancelar</button>
              <button onClick={save} className="ui-btn ui-btn-primary">Guardar</button>
            </div>
      </AppModal>

      <AppModal
        open={cancelModalOpen}
        onClose={() => {
          setCancelModalOpen(false);
          setCancelReason("");
          setCancelDate(new Date().toISOString().slice(0, 10));
        }}
        maxWidthClassName="max-w-lg"
        title="Confirmar cancelacion"
      >
        <div className="main-stack">
          <p className="text-sm text-slate-600">
            Para cancelar la suscripcion debes registrar el motivo y la fecha de cancelacion.
          </p>
          <div className="grid gap-2">
            <label className="text-xs">
              Motivo de cancelacion
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="mt-1 ui-input min-h-24"
                placeholder="Ej. Solicitud del cliente, migracion a otro plan, cierre de cuenta..."
              />
            </label>
            <label className="text-xs">
              Fecha de cancelacion
              <input
                type="date"
                value={cancelDate}
                onChange={(e) => setCancelDate(e.target.value)}
                className="mt-1 ui-input"
              />
            </label>
          </div>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              onClick={() => {
                setCancelModalOpen(false);
                setCancelReason("");
                setCancelDate(new Date().toISOString().slice(0, 10));
              }}
              className="ui-btn ui-btn-outline"
            >
              Volver
            </button>
            <button onClick={confirmCancellationAndSave} className="ui-btn ui-btn-primary">
              Confirmar y guardar
            </button>
          </div>
        </div>
      </AppModal>

      <AppModal
        open={planChangeModalOpen}
        onClose={() => {
          setPlanChangeModalOpen(false);
          setPreviousPlanEndDate("");
          setNewPlanStartDate("");
          setPlanChangeReason("CAMBIO_PLAN");
        }}
        maxWidthClassName="max-w-lg"
        title="Confirmar cambio de plan o ciclo"
      >
        <div className="main-stack">
          <p className="text-sm text-slate-600">
            Para aplicar el cambio debes indicar el cierre del plan anterior y el inicio del nuevo tramo.
          </p>
          <div className="grid gap-2">
            <label className="text-xs">
              Fecha final del plan anterior
              <input
                type="date"
                value={previousPlanEndDate}
                onChange={(e) => setPreviousPlanEndDate(e.target.value)}
                className="mt-1 ui-input"
              />
            </label>
            <label className="text-xs">
              Fecha de inicio del nuevo plan
              <input
                type="date"
                value={newPlanStartDate}
                onChange={(e) => setNewPlanStartDate(e.target.value)}
                className="mt-1 ui-input"
              />
            </label>
            <label className="text-xs">
              Razon
              <select
                value={planChangeReason}
                onChange={(e) => setPlanChangeReason(e.target.value as PlanChangeReason)}
                className="mt-1 ui-input"
              >
                <option value="NUEVO_PLAN">nuevo plan</option>
                <option value="RENOVACION">motivo renovacion</option>
                <option value="CAMBIO_PLAN">cambio de plan</option>
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              onClick={() => {
                setPlanChangeModalOpen(false);
                setPreviousPlanEndDate("");
                setNewPlanStartDate("");
                setPlanChangeReason("CAMBIO_PLAN");
              }}
              className="ui-btn ui-btn-outline"
            >
              Cancelar
            </button>
            <button onClick={confirmPlanChangeAndSave} className="ui-btn ui-btn-primary">
              Confirmar y guardar
            </button>
          </div>
        </div>
      </AppModal>

      <AppModal
        open={addItemModalOpen}
        onClose={() => setAddItemModalOpen(false)}
        maxWidthClassName="max-w-3xl"
        title="Agregar item de suscripcion"
      >
        {renderGuidedItemBuilder("existing")}
        <div className="mt-3 flex justify-end">
          <button onClick={() => setAddItemModalOpen(false)} className="ui-btn ui-btn-outline">Cerrar</button>
        </div>
      </AppModal>

      <AppModal
        open={renewModalOpen}
        onClose={() => {
          setRenewModalOpen(false);
          setRenewTargetId("");
          setRenewDraft(EMPTY_RENEW_DRAFT);
        }}
        maxWidthClassName="max-w-3xl"
        title="Renovar suscripcion vencida"
      >
        {!renewTargetSubscription ? (
          <p className="text-sm text-slate-600">Selecciona una suscripcion para renovar.</p>
        ) : (
          <div className="main-stack">
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <p className="font-semibold text-slate-900">{companyLabel(String(renewTargetSubscription.empresa_id ?? ""))}</p>
              <p>Plan actual: {planLabel(String(renewTargetSubscription.plan_id ?? ""))}</p>
              <p>Vencio: {formatDateOnly(renewTargetSubscription.periodo_actual_fin)}</p>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="text-xs">
                Fecha inicio renovacion
                <input type="date" value={renewDraft.fecha_inicio} onChange={(e) => setRenewDraft((p) => ({ ...p, fecha_inicio: e.target.value }))} className="mt-1 ui-input" />
              </label>
              <label className="text-xs">
                Ciclo
                <select value={renewDraft.billing_cycle} onChange={(e) => setRenewDraft((p) => ({ ...p, billing_cycle: e.target.value as RenewDraft["billing_cycle"], precio_plan_id: "" }))} className="mt-1 ui-input">
                  <option value="MENSUAL">MENSUAL</option>
                  <option value="TRIMESTRAL">TRIMESTRAL</option>
                  <option value="ANUAL">ANUAL</option>
                </select>
              </label>
              <label className="text-xs">
                Precio aplicable
                <select value={renewDraft.precio_plan_id} onChange={(e) => setRenewDraft((p) => ({ ...p, precio_plan_id: e.target.value }))} className="mt-1 ui-input">
                  <option value="">Seleccionar precio...</option>
                  {availableRenewPrices.map((pr) => (
                    <option key={pr.id} value={pr.id}>{`${pr.periodo} | ${formatMoney(pr.valor)}`}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => setRenewModalOpen(false)} className="ui-btn ui-btn-outline">Cancelar</button>
              <button onClick={submitRenewal} className="ui-btn ui-btn-primary">Renovar</button>
            </div>
          </div>
        )}
      </AppModal>
    </main>
  );
}




