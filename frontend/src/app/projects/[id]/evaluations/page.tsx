"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, formatDate } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Evaluation {
  id: string;
  status: string;
  overall_score?: number;
  scores?: Record<string, { score: number; justificacion: string }>;
  report_md?: string;
  last_error?: string;
  cost_usd: number;
  created_at: string;
}

export default function EvaluationsPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [selected, setSelected] = useState<Evaluation | null>(null);
  const [running, setRunning] = useState(false);
  const canWrite = project?.my_permission === "write" || project?.my_permission === "admin";

  const load = useCallback(() => {
    apiFetch<Evaluation[]>(`/api/v1/projects/${params.id}/evaluations`)
      .then((list) => {
        setEvaluations(list);
        if (list.some((e) => e.status === "pending" || e.status === "running")) {
          setTimeout(load, 4000);
        }
      })
      .catch(() => {});
  }, [params.id]);

  useEffect(load, [load]);

  const run = async () => {
    setRunning(true);
    try {
      await apiFetch(`/api/v1/projects/${params.id}/evaluations`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setRunning(false);
    }
  };

  const scoreColor = (s?: number) =>
    s == null ? "text-brand-slate" : s >= 7.5 ? "text-emerald-600" : s >= 5 ? "text-brand-orange" : "text-brand-primary";

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-3">
        {canWrite && (
          <div className="card p-5">
            <h2 className="label mb-2">Evaluador experto</h2>
            <p className="text-xs text-brand-slate mb-3 leading-relaxed">
              El agente evaluador lee el documento, verifica el respaldo de las
              afirmaciones contra las fuentes y califica el proyecto según la rúbrica
              de método científico de investigación de mercado.
            </p>
            <button className="btn-primary w-full" onClick={run} disabled={running}>
              {running ? "Encolando…" : "▶ Evaluar el proyecto"}
            </button>
          </div>
        )}

        <div className="card divide-y divide-brand-border">
          {evaluations.map((e) => (
            <button
              key={e.id}
              className={`w-full text-left px-4 py-3 hover:bg-brand-bg-soft transition-colors ${
                selected?.id === e.id ? "bg-brand-primary-light/40" : ""
              }`}
              onClick={() => setSelected(e)}
            >
              <div className="flex items-center justify-between">
                <span className={`font-display text-2xl ${scoreColor(e.overall_score)}`}>
                  {e.overall_score != null ? e.overall_score.toFixed(1) : "—"}
                </span>
                <span
                  className={
                    e.status === "done"
                      ? "badge-success"
                      : e.status === "failed"
                        ? "badge-primary"
                        : "badge-cyan"
                  }
                >
                  {e.status === "running" ? "evaluando…" : e.status}
                </span>
              </div>
              <div className="text-xs text-brand-mist mt-1">{formatDate(e.created_at)}</div>
              {e.last_error && (
                <div className="text-xs text-brand-primary-dark mt-1">{e.last_error}</div>
              )}
            </button>
          ))}
          {evaluations.length === 0 && (
            <div className="p-6 text-center text-sm text-brand-slate">
              Sin evaluaciones todavía.
            </div>
          )}
        </div>
      </div>

      <div className="lg:col-span-2">
        {!selected ? (
          <div className="card p-10 text-center text-sm text-brand-slate">
            Seleccioná una evaluación para ver el informe completo.
          </div>
        ) : (
          <div className="space-y-4">
            {selected.scores && (
              <div className="card p-5">
                <h2 className="label mb-3">Puntajes por criterio</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(selected.scores).map(([criterio, v]) => (
                    <div key={criterio} className="rounded-md border border-brand-border p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold uppercase tracking-wider2 text-brand-slate">
                          {criterio}
                        </span>
                        <span className={`font-display text-xl ${scoreColor(v.score)}`}>
                          {v.score}/10
                        </span>
                      </div>
                      <p className="text-xs text-brand-graphite leading-relaxed">
                        {v.justificacion}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {selected.report_md && (
              <div className="card p-6 prose-vex">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.report_md}</ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
