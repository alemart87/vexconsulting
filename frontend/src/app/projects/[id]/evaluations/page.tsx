"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, formatDate, parseApiDate } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Evaluation {
  id: string;
  status: string;
  overall_score?: number;
  scores?: Record<string, { score: number; justificacion: string }>;
  report_md?: string;
  last_error?: string;
  created_at: string;
  finished_at?: string | null;
}

const CRITERIA_LABELS: Record<string, string> = {
  problema: "Planteamiento del problema",
  hipotesis: "Hipótesis",
  fuentes: "Fuentes y método",
  evidencia: "Evidencia",
  sintesis: "Síntesis y discusión",
  conclusiones: "Conclusiones",
  redaccion: "Redacción y presentación",
};

/** Qué está haciendo el agente, según el tiempo transcurrido. */
const STAGES: [number, string][] = [
  [25, "Leyendo el documento maestro"],
  [90, "Contrastando afirmaciones contra las fuentes"],
  [180, "Calificando cada criterio de la rúbrica"],
  [Infinity, "Redactando el informe final"],
];

const verdictFor = (s?: number) =>
  s == null
    ? null
    : s >= 8
      ? { label: "Sólido", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
      : s >= 6
        ? { label: "Aceptable con mejoras", cls: "bg-orange-50 text-orange-700 border-orange-200" }
        : { label: "Requiere trabajo", cls: "bg-red-50 text-red-700 border-red-200" };

const scoreColor = (s?: number) =>
  s == null ? "text-brand-slate" : s >= 8 ? "text-emerald-600" : s >= 6 ? "text-brand-orange" : "text-brand-primary";

const barColor = (s: number) => (s >= 8 ? "bg-emerald-500" : s >= 6 ? "bg-brand-orange" : "bg-brand-primary");

export default function EvaluationsPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [selected, setSelected] = useState<Evaluation | null>(null);
  const [launching, setLaunching] = useState(false);
  const [justFinishedId, setJustFinishedId] = useState<string | null>(null);
  const [, setTick] = useState(0); // fuerza re-render del reloj de progreso
  const inProgressIdsRef = useRef<Set<string>>(new Set());
  const openedFromLinkRef = useRef(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const canWrite = project?.my_permission === "write" || project?.my_permission === "admin";

  const inProgress = evaluations.find((e) => e.status === "pending" || e.status === "running");

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<Evaluation[]>(`/api/v1/projects/${params.id}/evaluations`);
      // ¿Terminó alguna que estaba corriendo? → abrir su informe automáticamente
      const finished = list.find(
        (e) => inProgressIdsRef.current.has(e.id) && e.status === "done"
      );
      inProgressIdsRef.current = new Set(
        list.filter((e) => e.status === "pending" || e.status === "running").map((e) => e.id)
      );
      setEvaluations(list);
      if (finished) {
        setSelected(finished);
        setJustFinishedId(finished.id);
      } else {
        // Mantener el seleccionado actualizado (p. ej. si falló)
        setSelected((sel) => (sel ? list.find((e) => e.id === sel.id) ?? sel : sel));
      }
      // Deep link ?open=... (desde la campana de notificaciones)
      if (!openedFromLinkRef.current && typeof window !== "undefined") {
        openedFromLinkRef.current = true;
        const wanted = new URLSearchParams(window.location.search).get("open");
        const target = wanted ? list.find((e) => e.id === wanted) : null;
        if (target) setSelected(target);
      }
    } catch {}
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Polling mientras haya una evaluación en curso + reloj cada segundo
  useEffect(() => {
    if (!inProgress) return;
    const poll = setInterval(load, 4000);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [inProgress, load]);

  const run = async () => {
    if (launching || inProgress) return;
    setLaunching(true);
    setJustFinishedId(null);
    try {
      const ev = await apiFetch<Evaluation>(`/api/v1/projects/${params.id}/evaluations`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      inProgressIdsRef.current.add(ev.id);
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLaunching(false);
    }
  };

  const elapsedSec = inProgress
    ? Math.max(0, Math.floor((Date.now() - parseApiDate(inProgress.created_at).getTime()) / 1000))
    : 0;
  const stage = STAGES.find(([limit]) => elapsedSec < limit)?.[1] ?? STAGES[STAGES.length - 1][1];
  const mmss = `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`;

  const verdict = verdictFor(selected?.overall_score);

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
            {inProgress ? (
              <div className="rounded-lg border border-brand-cyan/40 bg-brand-cyan/5 p-4">
                <div className="flex items-center gap-2.5">
                  <span className="h-4 w-4 shrink-0 rounded-full border-2 border-brand-cyan border-t-transparent animate-spin" />
                  <span className="text-sm font-bold text-brand-ink">Evaluación en curso</span>
                  <span className="ml-auto text-xs font-semibold text-brand-slate tabular-nums">{mmss}</span>
                </div>
                <div className="shimmer-text text-xs font-semibold mt-2">{stage}…</div>
                <p className="text-[11px] text-brand-slate mt-2 leading-relaxed">
                  El agente trabaja solo — podés seguir usando la plataforma. Te va a
                  llegar una notificación 🔔 y el informe se abre acá al terminar.
                </p>
              </div>
            ) : (
              <button className="btn-primary w-full" onClick={run} disabled={launching}>
                {launching ? "Encolando…" : "▶ Evaluar el proyecto"}
              </button>
            )}
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
                  {e.status === "running" || e.status === "pending" ? "evaluando…" : e.status}
                </span>
              </div>
              <div className="text-xs text-brand-mist mt-1">{formatDate(e.created_at)}</div>
              {e.last_error && (
                <div className="text-xs text-brand-primary-dark mt-1 line-clamp-2">{e.last_error}</div>
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
            {justFinishedId === selected.id && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3 animate-pop">
                <div className="text-sm text-emerald-800">
                  <span className="font-bold">✅ Evaluación completada.</span> El informe del
                  evaluador está listo abajo.
                </div>
                <button
                  className="btn-secondary !py-1.5 !px-3 text-xs shrink-0"
                  onClick={() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  Ver informe ↓
                </button>
              </div>
            )}

            {/* Cabecera: puntaje general + veredicto */}
            <div className="card p-5 flex items-center gap-5 flex-wrap">
              <div className="text-center">
                <div className={`font-display text-5xl leading-none ${scoreColor(selected.overall_score)}`}>
                  {selected.overall_score != null ? selected.overall_score.toFixed(1) : "—"}
                </div>
                <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mt-1">de 10</div>
              </div>
              <div className="min-w-0 flex-1">
                {verdict && (
                  <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-md border ${verdict.cls}`}>
                    {verdict.label}
                  </span>
                )}
                <div className="text-xs text-brand-slate mt-1.5">
                  Evaluado el {formatDate(selected.finished_at || selected.created_at)} · rúbrica de
                  método científico
                </div>
              </div>
              {selected.status === "failed" && (
                <div className="w-full text-xs text-brand-primary-dark bg-red-50 border border-red-200 rounded-md p-3">
                  {selected.last_error}
                </div>
              )}
            </div>

            {selected.scores && (
              <div className="card p-5">
                <h2 className="label mb-3">Puntajes por criterio</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(selected.scores).map(([criterio, v]) => (
                    <div key={criterio} className="rounded-md border border-brand-border p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold uppercase tracking-wider2 text-brand-slate">
                          {CRITERIA_LABELS[criterio] ?? criterio}
                        </span>
                        <span className={`font-display text-xl ${scoreColor(v.score)}`}>
                          {v.score}/10
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-brand-bg overflow-hidden mb-2">
                        <div
                          className={`h-full rounded-full score-bar ${barColor(v.score)}`}
                          style={{ width: `${Math.min(100, v.score * 10)}%` }}
                        />
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
              <div ref={reportRef} className="card p-6 prose-vex">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.report_md}</ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
