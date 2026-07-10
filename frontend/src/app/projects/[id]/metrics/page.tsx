"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, formatDate } from "@/lib/api";

export default function MetricsPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<any>(`/api/v1/projects/${params.id}/metrics`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (error) return <div className="card p-8 text-center text-brand-primary-dark">{error}</div>;
  if (!data) return <div className="card p-8 text-center text-brand-slate">Cargando…</div>;

  const kpis = [
    { label: "Versiones", value: data.totales.versiones },
    { label: "Fuentes", value: data.totales.fuentes },
    { label: "Notas", value: data.totales.notas },
    { label: "Consultas a la IA", value: data.totales.consultas_ia },
    { label: "Costo IA (USD)", value: `$${data.costo_ia_usd.toFixed(2)}` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="card p-4 text-center">
            <div className="font-display text-3xl text-brand-ink">{k.value}</div>
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mt-1">
              {k.label}
            </div>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3 label !mb-0 border-b border-brand-border">
          Aporte por consultor (documento maestro)
        </div>
        <div className="divide-y divide-brand-border">
          <div className="px-5 py-2 grid grid-cols-5 text-xs font-semibold uppercase tracking-wider2 text-brand-slate">
            <span className="col-span-2">Consultor</span>
            <span>Ediciones</span>
            <span>Palabras + / −</span>
            <span>Última edición</span>
          </div>
          {data.aportes.map((a: any) => (
            <div key={a.author_id} className="px-5 py-3 grid grid-cols-5 text-sm items-center">
              <span className="col-span-2 font-semibold text-brand-ink">{a.author_name}</span>
              <span>{a.ediciones}</span>
              <span>
                <span className="text-emerald-700">+{a.palabras_agregadas.toLocaleString("es-PY")}</span>{" "}
                <span className="text-red-600">−{a.palabras_quitadas.toLocaleString("es-PY")}</span>
              </span>
              <span className="text-xs text-brand-slate">{formatDate(a.ultima_edicion)}</span>
            </div>
          ))}
          {data.aportes.length === 0 && (
            <div className="p-6 text-center text-sm text-brand-slate">Sin ediciones todavía.</div>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="label mb-3">Fuentes subidas por usuario</h2>
          {Object.entries(data.fuentes_por_usuario).map(([name, count]: any) => (
            <div key={name} className="flex justify-between text-sm py-1.5 border-b border-brand-border last:border-0">
              <span>{name}</span>
              <b>{count}</b>
            </div>
          ))}
          {Object.keys(data.fuentes_por_usuario).length === 0 && (
            <p className="text-sm text-brand-slate">Sin fuentes.</p>
          )}
        </div>
        <div className="card p-5">
          <h2 className="label mb-3">Actividad del proyecto (auditoría)</h2>
          {data.actividad.map((a: any) => (
            <div key={a.action} className="flex justify-between text-sm py-1.5 border-b border-brand-border last:border-0">
              <span className="badge-neutral">{a.action}</span>
              <b>{a.count}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
