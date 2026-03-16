"use client";

import { useState } from "react";
import { fetchJson, isSuccess } from "@/lib/client/api";
import toast from "react-hot-toast";
import { PageHeaderCard } from "@/components/ui/page-header-card";

type StatusProps = { loading: boolean; message: string };

function BackofficeLoader({ loading, message }: StatusProps) {
  if (!loading && message === "Listo") return null;
  const isPositiveMessage = /correctamente/i.test(message);
  const tone = loading
    ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#1E3A8A]"
    : isPositiveMessage
      ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]"
      : "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]";
  return (
    <p className={`mt-4 inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium ${tone}`}>
      {loading ? "Procesando..." : message}
    </p>
  );
}

export default function BackOfficePage() {
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("Listo");
  const [loading, setLoading] = useState(false);

  const runSeed = async () => {
    try {
      setLoading(true);
      const res = await fetchJson<{ seeded: boolean }>("/api/backoffice/seed", {
        method: "POST",
        headers: { "x-backoffice-key": key },
      });
      setLoading(false);
      if (isSuccess(res)) {
        setMessage("Semilla cargada correctamente.");
        toast.success("Semilla cargada correctamente.");
        return;
      }
      setMessage(res.error.message);
      toast.error(res.error.message);
    } catch {
      setLoading(false);
      setMessage("Error de red al cargar semilla.");
      toast.error("Error de red al cargar semilla.");
    }
  };

  const runClean = async () => {
    if (!confirm("Esto limpiará completamente common/core/billing. ¿Deseas continuar?")) return;
    try {
      setLoading(true);
      const res = await fetchJson<{ cleaned: boolean }>("/api/backoffice/clean", {
        method: "POST",
        headers: { "x-backoffice-key": key },
      });
      setLoading(false);
      if (isSuccess(res)) {
        setMessage("Base limpiada correctamente.");
        toast.success("Base limpiada correctamente.");
        return;
      }
      setMessage(res.error.message);
      toast.error(res.error.message);
    } catch {
      setLoading(false);
      setMessage("Error de red al limpiar base.");
      toast.error("Error de red al limpiar base.");
    }
  };

  return (
    <main className="main-stack">
      <PageHeaderCard title="BackOffice" description="Acciones administrativas del entorno y preparación de datos.">
        <span className="inline-flex items-center rounded-full border border-[#BFDBFE] bg-white/80 px-3 py-1 text-xs font-semibold text-[#1D4ED8]">
          Entorno corporativo seguro
        </span>
      </PageHeaderCard>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
        <article className="main-card p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748B]">Operaciones críticas</p>
          <h3 className="mt-1 text-lg font-semibold text-[#1E293B]">Gestión de semilla y limpieza controlada</h3>
          <p className="mt-2 text-sm text-[#64748B]">
            Ejecuta cargas iniciales o limpieza del entorno con una clave administrativa válida.
          </p>

          <div className="mt-5 rounded-2xl border border-[#D7E5F7] bg-[linear-gradient(180deg,#F9FCFF_0%,#F3F8FF_100%)] p-4">
            <label className="ui-label pl-1">Clave BackOffice</label>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="BACKOFFICE_ADMIN_KEY"
              className="mt-2 ui-input max-w-md"
            />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button onClick={runSeed} disabled={loading} className="ui-btn ui-btn-primary">
                Cargar semilla
              </button>
              <button onClick={runClean} disabled={loading} className="ui-btn ui-btn-secondary">
                Limpiar base
              </button>
            </div>
            <BackofficeLoader loading={loading} message={message} />
          </div>
        </article>

        <aside className="main-card-subtle p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748B]">Guía operativa</p>
          <h3 className="mt-1 text-base font-semibold text-[#1E293B]">Buenas prácticas recomendadas</h3>
          <ul className="mt-3 space-y-2 text-sm text-[#475569]">
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#007bff]" />
              Ejecuta la semilla solo cuando se reinicie el ambiente o inicie una nueva prueba.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#007bff]" />
              Confirma previamente que no haya validaciones activas antes de limpiar.
            </li>
            <li className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#007bff]" />
              Registra el resultado de cada operación para trazabilidad.
            </li>
          </ul>

          <div className="mt-4 rounded-xl border border-[#DCE7F5] bg-white/80 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#64748B]">Estado actual</p>
            <p className="mt-1 text-sm font-medium text-[#334155]">{loading ? "Procesando solicitud..." : message}</p>
          </div>
        </aside>
      </section>
    </main>
  );
}

