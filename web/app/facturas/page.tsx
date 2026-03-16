"use client";

import { useCallback, useEffect, useState } from "react";
import { CrudModule } from "@/components/backoffice/crud-module";
import { fetchJson, isSuccess } from "@/lib/client/api";
import toast from "react-hot-toast";
import { PageHeaderCard } from "@/components/ui/page-header-card";

type Lookups = {
  empresas: Array<{ value: string; label: string }>;
  suscripciones: Array<{ value: string; label: string }>;
};

export default function FacturasPage() {
  const [lookups, setLookups] = useState<Lookups>({ empresas: [], suscripciones: [] });
  const [openCreate, setOpenCreate] = useState<(() => void) | null>(null);
  const handleCreateRef = useCallback((fn: () => void) => {
    setOpenCreate(() => fn);
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetchJson<Lookups>("/api/backoffice/lookups");
        if (isSuccess(res)) {
          setLookups({ empresas: res.data.empresas, suscripciones: res.data.suscripciones });
        }
      } catch {
        toast.error("Error de red al cargar empresas y suscripciones.");
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
    <div className="main-stack">
    <PageHeaderCard title="Facturas" description="Aquí se gestionan las facturas">
      <button
        onClick={() => openCreate?.()}
        className="ui-btn ui-btn-primary ui-btn-sm"
        disabled={!openCreate}
      >
        Nuevo
      </button>
    </PageHeaderCard>
     
    <CrudModule
      title="Facturas"
      resource="facturas"
      hideModuleHeader
      onCreateRef={handleCreateRef}
      fields={[
        { key: "empresa_id", label: "Empresa", type: "select", options: lookups.empresas },
        { key: "suscripcion_id", label: "Suscripcion", type: "select", options: lookups.suscripciones },
        { key: "fecha_emision", label: "Fecha emision", type: "date" },
        { key: "fecha_vencimiento", label: "Fecha vencimiento", type: "date" },
        { key: "subtotal", label: "Subtotal", type: "number" },
        { key: "descuento_tipo", label: "Tipo descuento", type: "select", options: [{ value: "PERCENT", label: "PERCENT" }, { value: "FIXED", label: "FIXED" }] },
        { key: "descuento_valor", label: "Valor descuento", type: "number" },
        { key: "descuento_monto", label: "Monto descuento", type: "number" },
        { key: "descuento_motivo", label: "Motivo descuento", type: "text" },
        { key: "total", label: "Total", type: "number" },
        { key: "estado", label: "Estado", type: "select", options: [{ value: "BORRADOR", label: "BORRADOR" }, { value: "EMITIDA", label: "EMITIDA" }, { value: "PAGADA", label: "PAGADA" }, { value: "ANULADA", label: "ANULADA" }] },
        { key: "metodo_pago", label: "Metodo", type: "select", options: [{ value: "MANUAL", label: "MANUAL" }, { value: "PASARELA", label: "PASARELA" }] },
      ]}
      columns={[
        { key: "empresa_id", label: "Empresa" },
        { key: "suscripcion_id", label: "Suscripcion" },
        { key: "fecha_emision", label: "Fecha" },
        { key: "subtotal", label: "Subtotal" },
        { key: "descuento_monto", label: "Descuento" },
        { key: "total", label: "Total" },
        { key: "estado", label: "Estado", badge: true },
        { key: "metodo_pago", label: "Metodo", badge: true },
      ]}
      initial={{ empresa_id: "", suscripcion_id: "", fecha_emision: "", fecha_vencimiento: "", subtotal: "0", descuento_tipo: "", descuento_valor: "", descuento_monto: "0", descuento_motivo: "", total: "0", estado: "EMITIDA", metodo_pago: "MANUAL" }}
    />
    </div>
    </>
  );
}
