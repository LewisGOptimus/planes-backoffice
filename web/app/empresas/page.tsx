"use client";

import { useEffect, useState } from "react";
import { fetchJson, isSuccess } from "@/lib/client/api";
import { formatDateOnly } from "@/lib/client/date-format";
import { formatMoney } from "@/lib/client/currency-format";
import { toHumanConsumableError, toHumanError } from "@/lib/client/error-mapping";
import toast from "react-hot-toast";
import { PageHeaderCard } from "@/components/ui/page-header-card";
import { AppModal } from "@/components/ui/modal";

type EmpresaCard = {
  empresa_id: string;
  empresa_nombre: string;
  telefono: string | null;
  departamento: string | null;
  ciudad: string | null;
  direccion: string | null;
  owner_user_id: string | null;
  owner_nombre: string | null;
  owner_email: string | null;
  suscripcion_id: string | null;
  estado_suscripcion: string | null;
  plan_nombre: string | null;
  periodo_fin: string | null;
  ultima_factura_fecha: string | null;
  ultima_factura_total: string | null;
  total_abierto: string | null;
};

type EmpresaRow = {
  id: string;
  nombre: string;
  nit: string | null;
  telefono: string | null;
  departamento: string | null;
  ciudad: string | null;
  direccion: string | null;
  timezone: string;
  activa: boolean;
};
type Lookups = { usuarios: Array<{ value: string; label: string }> };

type ConsumablePoolRow = {
  suscripcion_id: string;
  producto_id: string;
  producto_codigo: string;
  producto_nombre: string;
  comprado: number;
  consumido: number;
  restante: number;
  vigencia_pago_inicio: string | null;
  vigencia_pago_fin: string | null;
  vigencia_efectiva_inicio: string | null;
  vigencia_efectiva_fin: string | null;
  estado_item: string;
};

type BadgeTone = "neutral" | "brand" | "success" | "warning";

function Badge({ text, tone = "neutral" }: { text: string; tone?: BadgeTone }) {
  const toneClassName = {
    neutral: "border-slate-200 bg-white text-slate-600",
    brand: "border-[var(--color-primary-100)] bg-[var(--color-primary-50)] text-[var(--color-primary-800)]",
    success: "border-emerald-100 bg-emerald-50 text-emerald-700",
    warning: "border-amber-100 bg-amber-50 text-amber-700",
  }[tone];

  return (
    <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-medium ${toneClassName}`}>
      {text}
    </span>
  );
}

function InfoPanel({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-t border-slate-100 pt-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-1.5 text-[13px] text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {children}
    </div>
  );
}

function parseAmount(value: string | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function EmpresasPage() {
  const [cards, setCards] = useState<EmpresaCard[]>([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState("Listo");
  const [form, setForm] = useState({
    nombre: "",
    nit: "",
    telefono: "",
    departamento: "",
    ciudad: "",
    direccion: "",
    timezone: "UTC",
    activa: "true",
    owner_user_id: "",
  });
  const [usuarios, setUsuarios] = useState<Array<{ value: string; label: string }>>([]);
  const [poolByEmpresa, setPoolByEmpresa] = useState<Record<string, ConsumablePoolRow[]>>({});
  const [poolLoadingEmpresaId, setPoolLoadingEmpresaId] = useState<string | null>(null);
  const [openPoolEmpresaId, setOpenPoolEmpresaId] = useState<string | null>(null);

  const mapError = (code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "BUSINESS_RULE_VIOLATION" | "INTERNAL_ERROR" | "UNAUTHORIZED", message: string) =>
    toHumanConsumableError(message) ?? toHumanError(code, message);

  const refresh = async () => {
    try {
      const [res, lu] = await Promise.all([
        fetchJson<EmpresaCard[]>("/api/backoffice/empresas/cards"),
        fetchJson<Lookups>("/api/backoffice/lookups"),
      ]);
      if (isSuccess(res)) setCards(res.data);
      if (isSuccess(lu)) setUsuarios(lu.data.usuarios);
    } catch {
      toast.error("Error de red al cargar empresas.");
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({
      nombre: "",
      nit: "",
      telefono: "",
      departamento: "",
      ciudad: "",
      direccion: "",
      timezone: "UTC",
      activa: "true",
      owner_user_id: "",
    });
    setModal(true);
  };

  const openEdit = async (empresaId: string) => {
    try {
      const res = await fetchJson<EmpresaRow>(`/api/v1/empresas/${empresaId}`);
      if (!isSuccess(res)) {
        toast.error(res.error.message);
        return;
      }
      const row = res.data;
      setEditing(row.id);
      const owner = cards.find((x) => x.empresa_id === empresaId)?.owner_user_id ?? "";
      setForm({
        nombre: row.nombre,
        nit: row.nit ?? "",
        telefono: row.telefono ?? "",
        departamento: row.departamento ?? "",
        ciudad: row.ciudad ?? "",
        direccion: row.direccion ?? "",
        timezone: row.timezone ?? "UTC",
        activa: String(row.activa),
        owner_user_id: owner,
      });
      setModal(true);
    } catch {
      toast.error("Error de red al cargar empresa.");
    }
  };

  const save = async () => {
    if (!form.owner_user_id) {
      toast.error("Debes seleccionar un usuario dueño.");
      return;
    }
    try {
      const payload = {
        id: editing ?? undefined,
        nombre: form.nombre,
        nit: form.nit,
        telefono: form.telefono,
        departamento: form.departamento,
        ciudad: form.ciudad,
        direccion: form.direccion,
        timezone: form.timezone,
        activa: form.activa === "true",
        owner_user_id: form.owner_user_id,
      };
      const res = await fetchJson<{ empresa_id: string }>("/api/backoffice/empresas/save", { method: "POST", body: payload });
      if (isSuccess(res)) {
        const m = editing ? "Empresa actualizada." : "Empresa creada.";
        setMsg(m);
        toast.success(m);
        setModal(false);
        await refresh();
        return;
      }
      setMsg(res.error.message);
      toast.error(res.error.message);
    } catch {
      toast.error("Error de red al guardar empresa.");
    }
  };

  const remove = async (empresaId: string) => {
    try {
      const res = await fetchJson<EmpresaRow>(`/api/v1/empresas/${empresaId}`, { method: "DELETE" });
      if (isSuccess(res)) {
        setMsg("Empresa eliminada.");
        toast.success("Empresa eliminada.");
        await refresh();
        return;
      }
      setMsg(res.error.message);
      toast.error(res.error.message);
    } catch {
      toast.error("Error de red al eliminar empresa.");
    }
  };

  const togglePool = async (empresaId: string) => {
    if (openPoolEmpresaId === empresaId) {
      setOpenPoolEmpresaId(null);
      return;
    }
    setOpenPoolEmpresaId(empresaId);
    if (poolByEmpresa[empresaId]) return;

    setPoolLoadingEmpresaId(empresaId);
    try {
      const res = await fetchJson<ConsumablePoolRow[]>(`/api/backoffice/empresas/${empresaId}/consumables-pool`);
      if (isSuccess(res)) {
        setPoolByEmpresa((prev) => ({ ...prev, [empresaId]: res.data }));
        return;
      }
      toast.error(mapError(res.error.code, res.error.message));
    } catch {
      toast.error("Error de red al cargar pool de consumibles.");
    } finally {
      setPoolLoadingEmpresaId(null);
    }
  };

  return (
    <main className="main-stack">
      <PageHeaderCard
        title="Empresas"
        description="Empresas de la aplicación."
      >
        <button onClick={openCreate} className="ui-btn ui-btn-primary ui-btn-sm">Nueva</button>
      </PageHeaderCard>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c, idx) => {
          const hasSubscription = Boolean(c.estado_suscripcion);
          const outstandingAmount = parseAmount(c.total_abierto);
          const hasDebt = outstandingAmount > 0;

          return (
            <article
              key={c.empresa_id}
              className="w-full rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                    {c.empresa_nombre.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Empresa #{idx + 1}</p>
                    <h3 className="mt-1 text-[14px] leading-5 font-semibold text-slate-900 break-words">
                      {c.empresa_nombre}
                    </h3>
                    <p className="mt-1 truncate text-xs text-slate-500">{c.owner_email ?? "Sin correo de responsable"}</p>
                  </div>
                </div>
                <Badge
                  text={hasSubscription ? String(c.estado_suscripcion) : "Sin suscripcion"}
                  tone={hasSubscription ? "brand" : "neutral"}
                />
              </div>

              <div className="mt-5 grid gap-1">
                <InfoPanel
                  label="Responsable"
                  value={c.owner_nombre ?? "Sin asignar"}
                  hint={c.owner_user_id ? "Usuario vinculado a la empresa" : "Pendiente asignar usuario dueno"}
                />
                <InfoPanel
                  label="Contacto"
                  value={`${c.telefono ?? "Sin telefono"} | ${c.ciudad ?? "Sin ciudad"}${c.departamento ? `, ${c.departamento}` : ""}`}
                  hint={c.direccion ?? "Sin direccion registrada"}
                />

                <InfoPanel
                  label="Suscripcion"
                  value={c.plan_nombre ?? "Sin plan activo"}
                  hint={`Vence: ${formatDateOnly(c.periodo_fin)}`}
                >
                  <div className="mt-2 flex gap-2">
                    <Badge text={hasSubscription ? "Configurada" : "Pendiente"} tone={hasSubscription ? "success" : "warning"} />
                  </div>
                </InfoPanel>

                <div className="grid gap-3 sm:grid-cols-2">
                  <InfoPanel
                    label="Ultima factura"
                    value={formatMoney(c.ultima_factura_total)}
                    hint={formatDateOnly(c.ultima_factura_fecha)}
                  />
                  <InfoPanel
                    label="Saldo abierto"
                    value={formatMoney(c.total_abierto)}
                    hint={hasDebt ? "Requiere seguimiento" : "Sin cartera pendiente"}
                  >
                    <div className="mt-2">
                      <Badge text={hasDebt ? "Pendiente" : "Al dia"} tone={hasDebt ? "warning" : "success"} />
                    </div>
                  </InfoPanel>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-2 border-t border-slate-100 pt-4 sm:grid-cols-3">
                <button
                  onClick={() => openEdit(c.empresa_id)}
                  className="ui-btn ui-btn-primary ui-btn-sm w-full"
                >
                  Editar
                </button>
                <button
                  onClick={() => remove(c.empresa_id)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Eliminar
                </button>
                <button
                  onClick={() => void togglePool(c.empresa_id)}
                  className={`w-full rounded-2xl border px-3 py-2 text-[11px] font-semibold transition ${
                    openPoolEmpresaId === c.empresa_id
                      ? "border-slate-300 bg-slate-100 text-slate-900"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Pool
                </button>
              </div>

              {openPoolEmpresaId === c.empresa_id && (
                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Consumo</p>
                      <p className="text-[13px] text-slate-700">Pool de creditos consumibles</p>
                    </div>
                    <Badge text={poolLoadingEmpresaId === c.empresa_id ? "Cargando" : `${(poolByEmpresa[c.empresa_id] ?? []).length} items`} tone="brand" />
                  </div>
                  {poolLoadingEmpresaId === c.empresa_id ? (
                    <p className="p-3 text-xs text-slate-600">Cargando pool de consumibles...</p>
                  ) : (
                    <div className="max-h-56 overflow-auto">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Producto</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Comprado</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Consumido</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Restante</th>
                            <th className="px-3 py-2 text-left font-medium text-slate-500">Vigencia</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(poolByEmpresa[c.empresa_id] ?? []).map((row) => (
                            <tr key={`${row.suscripcion_id}-${row.producto_id}`} className="border-t border-slate-200/70">
                              <td className="px-3 py-2 text-slate-700">{row.producto_nombre}</td>
                              <td className="px-3 py-2 text-slate-700">{row.comprado}</td>
                              <td className="px-3 py-2 text-slate-700">{row.consumido}</td>
                              <td className="px-3 py-2 text-slate-700">{row.restante}</td>
                              <td className="px-3 py-2 text-slate-500">{formatDateOnly(row.vigencia_pago_inicio)} - {formatDateOnly(row.vigencia_pago_fin)}</td>
                            </tr>
                          ))}
                          {(poolByEmpresa[c.empresa_id] ?? []).length === 0 && (
                            <tr>
                              <td className="px-3 py-3 text-slate-500" colSpan={5}>No hay pool consumible vigente para esta empresa.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>
      <p className="text-xs text-slate-600">{msg}</p>

      <AppModal
        open={modal}
        onClose={() => setModal(false)}
        maxWidthClassName="max-w-3xl"
        title={editing ? "Editar empresa" : "Nueva empresa"}
      >
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <label className="text-xs">
            Nombre
            <input
              value={form.nombre}
              onChange={(e) => setForm((p) => ({ ...p, nombre: e.target.value }))}
              className="mt-1 ui-input"
              placeholder="Nombre de la empresa"
            />
          </label>
          <label className="text-xs">
            NIT
            <input
              value={form.nit}
              onChange={(e) => setForm((p) => ({ ...p, nit: e.target.value }))}
              className="mt-1 ui-input"
              placeholder="Identificacion tributaria"
            />
          </label>
          <label className="text-xs">
            Telefono
            <input
              value={form.telefono}
              onChange={(e) => setForm((p) => ({ ...p, telefono: e.target.value }))}
              className="mt-1 ui-input"
              placeholder="Telefono de contacto"
            />
          </label>
          <label className="text-xs">
            Departamento
            <input
              value={form.departamento}
              onChange={(e) => setForm((p) => ({ ...p, departamento: e.target.value }))}
              className="mt-1 ui-input"
              placeholder="Departamento"
            />
          </label>
          <label className="text-xs">
            Ciudad
            <input
              value={form.ciudad}
              onChange={(e) => setForm((p) => ({ ...p, ciudad: e.target.value }))}
              className="mt-1 ui-input"
              placeholder="Ciudad"
            />
          </label>
          <label className="text-xs md:col-span-2">
            Direccion
            <input
              value={form.direccion}
              onChange={(e) => setForm((p) => ({ ...p, direccion: e.target.value }))}
              className="mt-1 ui-input"
              placeholder="Direccion de la empresa"
            />
          </label>
          <label className="text-xs">
            Timezone
            <input
              value={form.timezone}
              onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
              className="mt-1 ui-input"
              placeholder="UTC"
            />
          </label>
          <label className="text-xs">
            Estado
            <select
              value={form.activa}
              onChange={(e) => setForm((p) => ({ ...p, activa: e.target.value }))}
              className="mt-1 ui-input"
            >
              <option value="true">Activa</option>
              <option value="false">Inactiva</option>
            </select>
          </label>
          <label className="text-xs md:col-span-2">
            Usuario dueno (obligatorio)
            <select
              value={form.owner_user_id}
              onChange={(e) => setForm((p) => ({ ...p, owner_user_id: e.target.value }))}
              className="mt-1 ui-input"
            >
              <option value="">Seleccionar...</option>
              {usuarios.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button onClick={() => setModal(false)} className="ui-btn ui-btn-outline">Cancelar</button>
          <button onClick={save} className="ui-btn ui-btn-primary">{editing ? "Guardar" : "Crear"}</button>
        </div>
      </AppModal>
    </main>
  );
}
