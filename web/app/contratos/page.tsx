"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeaderCard } from "@/components/ui/page-header-card";
import { AppModal } from "@/components/ui/modal";
import { fetchJson, isSuccess } from "@/lib/client/api";
import { formatDateOnly } from "@/lib/client/date-format";
import { formatMoney } from "@/lib/client/currency-format";

type Row = Record<string, unknown> & { id?: string };

type Lookups = {
  usuarios: Array<{ value: string; label: string }>;
  empresas: Array<{ value: string; label: string }>;
  planes: Array<{ value: string; label: string }>;
};

type EmpresaRow = {
  id: string;
  nombre: string;
  nit: string | null;
};

type UsuarioEmpresaRow = {
  usuario_id: string;
  empresa_id: string;
};

type FormState = {
  usuario_id: string;
  empresa_id: string;
  tipo_contrato: "anual" | "mensual";
  nombre_cliente_empresa: string;
  nit: string;
  nit_indicativo: string;
  plan_id: string;
  plan_nombre: string;
  precio: string;
  fecha_contrato: string;
  fecha_primer_pago: string;
  adicionales: string;
  activo: "true" | "false";
};

const EMPTY_FORM: FormState = {
  usuario_id: "",
  empresa_id: "",
  tipo_contrato: "anual",
  nombre_cliente_empresa: "",
  nit: "",
  nit_indicativo: "",
  plan_id: "",
  plan_nombre: "",
  precio: "",
  fecha_contrato: "",
  fecha_primer_pago: "",
  adicionales: "",
  activo: "true",
};

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "t";
}

function cycleFromContractType(value: "anual" | "mensual"): "ANUAL" | "MENSUAL" {
  return value === "anual" ? "ANUAL" : "MENSUAL";
}

function pickPlanName(optionLabel: string): string {
  const idx = optionLabel.indexOf("(");
  return idx > 0 ? optionLabel.slice(0, idx).trim() : optionLabel.trim();
}

export default function ContratosPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [lookups, setLookups] = useState<Lookups>({ usuarios: [], empresas: [], planes: [] });
  const [companies, setCompanies] = useState<EmpresaRow[]>([]);
  const [userCompanies, setUserCompanies] = useState<UsuarioEmpresaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const refresh = async () => {
    setLoading(true);
    try {
      const [contractsRes, lookupsRes, companiesRes, userCompaniesRes] = await Promise.all([
        fetchJson<Row[]>("/api/v1/contratos"),
        fetchJson<Lookups>("/api/backoffice/lookups"),
        fetchJson<EmpresaRow[]>("/api/v1/empresas"),
        fetchJson<UsuarioEmpresaRow[]>("/api/v1/usuarios-empresas"),
      ]);
      if (isSuccess(contractsRes)) {
        setRows(contractsRes.data);
      }
      if (isSuccess(lookupsRes)) {
        setLookups({
          usuarios: lookupsRes.data.usuarios ?? [],
          empresas: lookupsRes.data.empresas ?? [],
          planes: lookupsRes.data.planes ?? [],
        });
      }
      if (isSuccess(companiesRes)) {
        setCompanies(companiesRes.data);
      }
      if (isSuccess(userCompaniesRes)) {
        setUserCompanies(userCompaniesRes.data);
      }
    } catch {
      toast.error("Error de red al cargar contratos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const planLabelById = useMemo(
    () =>
      lookups.planes.reduce<Record<string, string>>((acc, item) => {
        acc[item.value] = item.label;
        return acc;
      }, {}),
    [lookups.planes],
  );

  const openCreate = () => {
    const today = new Date().toISOString().slice(0, 10);
    setEditingId(null);
    setForm({ ...EMPTY_FORM, fecha_contrato: today, fecha_primer_pago: today });
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditingId(String(row.id ?? ""));
    setForm({
      usuario_id: "",
      empresa_id: String(row.empresa_id ?? ""),
      tipo_contrato: String(row.tipo_contrato ?? "mensual").toLowerCase() === "anual" ? "anual" : "mensual",
      nombre_cliente_empresa: String(row.nombre_cliente_empresa ?? ""),
      nit: String(row.nit ?? ""),
      nit_indicativo: String(row.nit_indicativo ?? ""),
      plan_id: String(row.plan_id ?? ""),
      plan_nombre: String(row.plan_nombre ?? ""),
      precio: String(row.precio ?? ""),
      fecha_contrato: String(row.fecha_contrato ?? "").slice(0, 10),
      fecha_primer_pago: String(row.fecha_primer_pago ?? "").slice(0, 10),
      adicionales: String(row.adicionales ?? ""),
      activo: asBool(row.activo) ? "true" : "false",
    });
    setModalOpen(true);
  };

  const userLabelById = useMemo(
    () =>
      lookups.usuarios.reduce<Record<string, string>>((acc, user) => {
        acc[user.value] = user.label;
        return acc;
      }, {}),
    [lookups.usuarios],
  );

  const companyById = useMemo(
    () =>
      companies.reduce<Record<string, EmpresaRow>>((acc, company) => {
        acc[company.id] = company;
        return acc;
      }, {}),
    [companies],
  );

  const availableCompanies = useMemo(() => {
    if (editingId) return lookups.empresas;
    if (!form.usuario_id) return [];
    const allowed = new Set(
      userCompanies
        .filter((rel) => String(rel.usuario_id) === form.usuario_id)
        .map((rel) => String(rel.empresa_id)),
    );
    return lookups.empresas.filter((empresa) => allowed.has(empresa.value));
  }, [editingId, form.usuario_id, userCompanies, lookups.empresas]);

  const handleUserChange = (usuarioId: string) => {
    setForm((prev) => ({
      ...prev,
      usuario_id: usuarioId,
      empresa_id: "",
      nombre_cliente_empresa: "",
      nit: "",
      nit_indicativo: "",
    }));
  };

  const handleCompanyChange = (empresaId: string) => {
    const selected = companyById[empresaId];
    setForm((prev) => ({
      ...prev,
      empresa_id: empresaId,
      nombre_cliente_empresa: selected?.nombre ?? "",
      nit: String(selected?.nit ?? "").trim(),
      nit_indicativo: "",
    }));
  };

  const handlePlanChange = (planId: string) => {
    const label = lookups.planes.find((p) => p.value === planId)?.label ?? "";
    setForm((prev) => ({
      ...prev,
      plan_id: planId,
      plan_nombre: label ? pickPlanName(label) : prev.plan_nombre,
    }));
  };

  const downloadContractDocx = async (contractId: string) => {
    const response = await fetch(`/api/backoffice/contratos/${contractId}/docx`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("No se pudo generar el DOCX");
    }
    const blob = await response.blob();
    const contentDisposition = response.headers.get("content-disposition") ?? "";
    const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
    const filename = filenameMatch?.[1] ?? `contrato_${contractId}.docx`;
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };

  const save = async () => {
    if (!editingId && !form.usuario_id) {
      toast.error("Selecciona un usuario.");
      return;
    }
    if (!editingId && !form.empresa_id) {
      toast.error("Selecciona una empresa del usuario.");
      return;
    }
    if (!form.nombre_cliente_empresa.trim()) {
      toast.error("El nombre cliente o empresa es obligatorio.");
      return;
    }
    if (!form.nit.trim()) {
      toast.error("El NIT es obligatorio.");
      return;
    }
    if (!/^\d+$/.test(form.nit.trim())) {
      toast.error("El NIT solo debe contener números.");
      return;
    }
    if (form.nit_indicativo.trim() && !/^\d+$/.test(form.nit_indicativo.trim())) {
      toast.error("El dígito de verificación solo debe contener números.");
      return;
    }
    if (!form.plan_nombre.trim()) {
      toast.error("El plan es obligatorio.");
      return;
    }
    if (!form.fecha_contrato) {
      toast.error("La fecha de contrato es obligatoria.");
      return;
    }
    if (!form.fecha_primer_pago) {
      toast.error("La fecha de primer pago es obligatoria.");
      return;
    }
    const price = Number(form.precio);
    if (!Number.isFinite(price) || price < 0) {
      toast.error("El precio debe ser un número mayor o igual a 0.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        tipo_contrato: form.tipo_contrato,
        billing_cycle: cycleFromContractType(form.tipo_contrato),
        empresa_id: form.empresa_id || null,
        nombre_cliente_empresa: form.nombre_cliente_empresa.trim(),
        nit: form.nit.trim(),
        nit_indicativo: form.nit_indicativo.trim(),
        plan_id: form.plan_id || null,
        plan_nombre: form.plan_nombre.trim(),
        precio: price.toFixed(2),
        fecha_contrato: form.fecha_contrato,
        fecha_primer_pago: form.fecha_primer_pago,
        adicionales: form.adicionales.trim(),
        activo: form.activo === "true",
        representante_nombre: form.usuario_id ? userLabelById[form.usuario_id] ?? form.nombre_cliente_empresa.trim() : form.nombre_cliente_empresa.trim(),
      };
      const endpoint = editingId ? `/api/v1/contratos/${editingId}` : "/api/v1/contratos";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetchJson<Row>(endpoint, { method, body: payload });
      if (!isSuccess(res)) {
        toast.error(res.error.message);
        return;
      }
      const savedId = String(res.data.id ?? editingId ?? "");
      if (!savedId) {
        toast.error("No se pudo identificar el contrato guardado para generar DOCX.");
        return;
      }
      await downloadContractDocx(savedId);
      toast.success(editingId ? "Contrato actualizado y DOCX generado." : "Contrato creado y DOCX generado.");
      setModalOpen(false);
      setEditingId(null);
      await refresh();
    } catch {
      toast.error("Error al guardar o generar el DOCX.");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (row: Row) => {
    const id = String(row.id ?? "");
    if (!id) return;
    const nextActive = !asBool(row.activo);
    try {
      const res = await fetchJson<Row>(`/api/v1/contratos/${id}`, {
        method: "PATCH",
        body: { activo: nextActive },
      });
      if (!isSuccess(res)) {
        toast.error(res.error.message);
        return;
      }
      toast.success(nextActive ? "Contrato activado." : "Contrato inactivado.");
      await refresh();
    } catch {
      toast.error("Error de red al actualizar estado.");
    }
  };

  const columns: DataTableColumn<Row>[] = [
    { key: "__index", header: "#", cellClassName: "w-[40px]", render: (_row, index) => index + 1 },
    { key: "tipo_contrato", header: "Tipo", render: (row) => String(row.tipo_contrato ?? "-").toUpperCase() },
    { key: "nombre_cliente_empresa", header: "Cliente/Empresa", render: (row) => String(row.nombre_cliente_empresa ?? "-") },
    {
      key: "nit",
      header: "NIT",
      render: (row) =>
        `${String(row.nit ?? "-")}${String(row.nit_indicativo ?? "").trim() ? `-${String(row.nit_indicativo).trim()}` : ""}`,
    },
    {
      key: "plan_nombre",
      header: "Plan",
      render: (row) => String(row.plan_nombre ?? (planLabelById[String(row.plan_id ?? "")] ? pickPlanName(planLabelById[String(row.plan_id ?? "")]) : "-")),
    },
    { key: "precio", header: "Precio", render: (row) => formatMoney(row.precio ?? "0") },
    { key: "fecha_contrato", header: "Fecha contrato", render: (row) => formatDateOnly(row.fecha_contrato) },
    { key: "fecha_primer_pago", header: "Primer pago", render: (row) => formatDateOnly(row.fecha_primer_pago) },
    {
      key: "activo",
      header: "Estado",
      render: (row) =>
        asBool(row.activo) ? (
          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">ACTIVO</span>
        ) : (
          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">INACTIVO</span>
        ),
    },
    {
      key: "__actions",
      header: "Acciones",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          <button onClick={() => openEdit(row)} className="ui-btn ui-btn-outline ui-btn-sm">Actualizar</button>
          <button
            onClick={() => void toggleStatus(row)}
            className={`ui-btn ui-btn-sm ${asBool(row.activo) ? "ui-btn-danger" : "ui-btn-primary"}`}
          >
            {asBool(row.activo) ? "Inactivar" : "Activar"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <main className="main-stack">
      <PageHeaderCard title="Generador de contratos" description="Zoe Utils">
        <button onClick={openCreate} className="ui-btn ui-btn-primary ui-btn-sm">Nuevo contrato</button>
      </PageHeaderCard>

      <section className="main-card">
        {loading ? (
          <p className="text-sm text-slate-600">Cargando contratos...</p>
        ) : (
          <DataTable<Row>
            rows={rows}
            getRowKey={(row, index) => `${String(row.id ?? "")}-${index}`}
            columns={columns}
            emptyMessage="No hay contratos registrados."
            className="max-h-[64vh]"
          />
        )}
      </section>

      <AppModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingId(null);
        }}
        title={editingId ? "Actualizar contrato" : "Nuevo contrato"}
        maxWidthClassName="max-w-5xl"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs">
            Usuario
            <select
              value={form.usuario_id}
              onChange={(event) => handleUserChange(event.target.value)}
              className="mt-1 ui-input"
            >
              <option value="">Seleccione usuario...</option>
              {lookups.usuarios.map((user) => (
                <option key={user.value} value={user.value}>{user.label}</option>
              ))}
            </select>
          </label>

          <label className="text-xs">
            Empresa del usuario
            <select
              value={form.empresa_id}
              onChange={(event) => handleCompanyChange(event.target.value)}
              className="mt-1 ui-input"
              disabled={!editingId && !form.usuario_id}
            >
              <option value="">Seleccione empresa...</option>
              {availableCompanies.map((empresa) => (
                <option key={empresa.value} value={empresa.value}>{empresa.label}</option>
              ))}
            </select>
          </label>

          <label className="text-xs md:col-span-1">
            Tipo de contrato
            <select
              value={form.tipo_contrato}
              onChange={(event) => setForm((prev) => ({ ...prev, tipo_contrato: event.target.value === "anual" ? "anual" : "mensual" }))}
              className="mt-1 ui-input"
            >
              <option value="anual">Contrato de suscripción anual</option>
              <option value="mensual">Contrato mensual</option>
            </select>
          </label>

          <label className="text-xs md:col-span-2">
            Nombre cliente o empresa
            <input
              value={form.nombre_cliente_empresa}
              readOnly
              className="mt-1 ui-input bg-slate-50"
            />
          </label>

          <label className="text-xs">
            NIT
            <input
              value={form.nit}
              readOnly
              className="mt-1 ui-input bg-slate-50"
            />
          </label>

          <label className="text-xs">
            Dígito de verificación
            <input
              value={form.nit_indicativo}
              onChange={(event) => setForm((prev) => ({ ...prev, nit_indicativo: event.target.value }))}
              placeholder="Ej: 1"
              className="mt-1 ui-input"
            />
          </label>

          <label className="text-xs">
            Plan
            <select
              value={form.plan_id}
              onChange={(event) => handlePlanChange(event.target.value)}
              className="mt-1 ui-input"
            >
              <option value="">Seleccione...</option>
              {lookups.planes.map((plan) => (
                <option key={plan.value} value={plan.value}>{pickPlanName(plan.label)}</option>
              ))}
            </select>
          </label>

          <label className="text-xs">
            Precio
            <input
              value={form.precio}
              onChange={(event) => setForm((prev) => ({ ...prev, precio: event.target.value }))}
              className="mt-1 ui-input"
            />
          </label>

          <label className="text-xs">
            Fecha de contrato
            <input
              type="date"
              value={form.fecha_contrato}
              onChange={(event) => setForm((prev) => ({ ...prev, fecha_contrato: event.target.value }))}
              className="mt-1 ui-input"
            />
          </label>

          <label className="text-xs">
            Fecha de primer pago
            <input
              type="date"
              value={form.fecha_primer_pago}
              onChange={(event) => setForm((prev) => ({ ...prev, fecha_primer_pago: event.target.value }))}
              className="mt-1 ui-input"
            />
          </label>

          <label className="text-xs md:col-span-2">
            Adicionales
            <textarea
              value={form.adicionales}
              onChange={(event) => setForm((prev) => ({ ...prev, adicionales: event.target.value }))}
              className="mt-1 ui-input min-h-24"
            />
          </label>

          <label className="text-xs md:col-span-2">
            Estado del contrato
            <select
              value={form.activo}
              onChange={(event) => setForm((prev) => ({ ...prev, activo: event.target.value === "false" ? "false" : "true" }))}
              className="mt-1 ui-input"
            >
              <option value="true">ACTIVO</option>
              <option value="false">INACTIVO</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={() => {
              setModalOpen(false);
              setEditingId(null);
            }}
            className="ui-btn ui-btn-outline"
            disabled={saving}
          >
            Cancelar
          </button>
          <button onClick={() => void save()} className="ui-btn ui-btn-primary" disabled={saving}>
            {saving ? "Guardando..." : editingId ? "Actualizar y generar DOCX" : "Guardar y generar DOCX"}
          </button>
        </div>
      </AppModal>
    </main>
  );
}
