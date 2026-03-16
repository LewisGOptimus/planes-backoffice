"use client";

import { useMemo, useState } from "react";
import { useAppState } from "@/lib/client/app-state";
import { fetchJson, isSuccess } from "@/lib/client/api";
import { toHumanError } from "@/lib/client/error-mapping";
import { WorkflowDefinition } from "@/lib/types/workflows";

export function WorkflowRunner({ workflow }: { workflow: WorkflowDefinition }) {
  const [payloadText, setPayloadText] = useState(JSON.stringify(workflow.payloadTemplate, null, 2));
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState<string>("");
  const [humanResult, setHumanResult] = useState<string>("");
  const { addHistory } = useAppState();

  const validJson = useMemo(() => {
    try {
      JSON.parse(payloadText);
      return true;
    } catch {
      return false;
    }
  }, [payloadText]);

  const runWorkflow = async () => {
    if (!validJson) return;
    setLoading(true);
    setResultText("");
    setHumanResult("");

    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    const response = await fetchJson<unknown>(`/api/v1/workflows/${workflow.id}`, {
      method: "POST",
      body: payload,
    });

    if (isSuccess(response)) {
      setHumanResult(`Caso ejecutado correctamente. Se registraron cambios para el caso ${workflow.caso}.`);
      setResultText(JSON.stringify(response.data, null, 2));
      addHistory({ title: workflow.titulo, endpoint: `/api/v1/workflows/${workflow.id}`, ok: true });
    } else {
      setHumanResult(toHumanError(response.error.code, response.error.message));
      setResultText(JSON.stringify(response.error, null, 2));
      addHistory({ title: workflow.titulo, endpoint: `/api/v1/workflows/${workflow.id}`, ok: false });
    }

    setLoading(false);
  };

  return (
    <section className="rounded-2xl border border-cyan-200/20 bg-slate-900/70 p-5">
      <header className="mb-4">
        <h2 className="font-serif text-3xl text-cyan-100">Caso {workflow.caso}: {workflow.titulo}</h2>
        <p className="mt-1 text-slate-300">{workflow.descripcion}</p>
        <p className="mt-2 text-xs text-slate-400">Campos minimos: {workflow.camposMinimos.join(", ")}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <label className="mb-2 block text-sm text-slate-300">Payload del workflow</label>
          <textarea
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            className="h-96 w-full rounded-xl border border-slate-700 bg-slate-950/80 p-3 font-mono text-xs text-slate-100 outline-none focus:border-cyan-400"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={runWorkflow}
              disabled={loading || !validJson}
              className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Ejecutando..." : "Ejecutar caso"}
            </button>
            {!validJson && <span className="text-sm text-amber-200">Payload JSON invalido</span>}
          </div>
        </div>

        <div className="space-y-3">
          <article className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
            <h3 className="text-sm font-semibold text-cyan-100">Resultado de negocio</h3>
            <p className="mt-2 text-sm text-slate-300">{humanResult || "Ejecuta el caso para ver impacto de negocio."}</p>
          </article>
          <article className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
            <h3 className="text-sm font-semibold text-cyan-100">Resultado tecnico (JSON)</h3>
            <pre className="mt-2 max-h-80 overflow-auto text-xs text-slate-200">{resultText || "Sin resultado"}</pre>
          </article>
          <article className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
            <h3 className="text-sm font-semibold text-cyan-100">Timeline esperado</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-300">
              <li>Validacion de reglas de negocio</li>
              <li>Ejecucion transaccional del workflow</li>
              <li>Creacion/actualizacion de entidades relacionadas</li>
              <li>Respuesta con ids y estado final</li>
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
