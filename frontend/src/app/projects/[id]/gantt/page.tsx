"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Task {
  id: string;
  title: string;
  phase?: string;
  start_date: string;
  end_date: string;
  progress: number;
  status: string;
  generated_by_ai: boolean;
}

const PHASE_COLORS: Record<string, string> = {
  hipotesis: "#662483",
  fuentes: "#00B2BF",
  evidencia: "#F39200",
  sintesis: "#E6332A",
  evaluacion: "#0F1116",
};

const DAY = 86_400_000;

export default function GanttPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState<any[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState({ title: "", phase: "fuentes", start_date: "", end_date: "" });
  const canWrite = project?.my_permission === "write" || project?.my_permission === "admin";

  const load = useCallback(() => {
    apiFetch<Task[]>(`/api/v1/projects/${params.id}/gantt`).then(setTasks).catch(() => {});
  }, [params.id]);

  useEffect(load, [load]);

  const range = useMemo(() => {
    if (tasks.length === 0) return null;
    const starts = tasks.map((t) => +new Date(t.start_date));
    const ends = tasks.map((t) => +new Date(t.end_date));
    const min = Math.min(...starts);
    const max = Math.max(...ends) + DAY;
    return { min, span: Math.max(max - min, DAY * 7) };
  }, [tasks]);

  const pos = (t: Task) => {
    if (!range) return { left: "0%", width: "10%" };
    const left = ((+new Date(t.start_date) - range.min) / range.span) * 100;
    const width = ((+new Date(t.end_date) - +new Date(t.start_date) + DAY) / range.span) * 100;
    return { left: `${left}%`, width: `${Math.max(width, 2)}%` };
  };

  const addTask = async () => {
    if (!form.title || !form.start_date || !form.end_date) return;
    await apiFetch(`/api/v1/projects/${params.id}/gantt`, {
      method: "POST",
      body: JSON.stringify(form),
    });
    setForm({ title: "", phase: "fuentes", start_date: "", end_date: "" });
    load();
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await apiFetch<any>(`/api/v1/projects/${params.id}/gantt/generate`, {
        method: "POST",
      });
      setDraft(res.draft);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const confirmDraft = async () => {
    if (!draft) return;
    for (const t of draft) {
      try {
        await apiFetch(`/api/v1/projects/${params.id}/gantt`, {
          method: "POST",
          body: JSON.stringify({ ...t }),
        });
      } catch {}
    }
    setDraft(null);
    load();
  };

  const setProgress = async (t: Task, progress: number) => {
    await apiFetch(`/api/v1/projects/${params.id}/gantt/${t.id}`, {
      method: "PATCH",
      body: JSON.stringify({ progress }),
    });
    load();
  };

  const remove = async (t: Task) => {
    if (!confirm(`¿Eliminar «${t.title}»?`)) return;
    await apiFetch(`/api/v1/projects/${params.id}/gantt/${t.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="card p-4 flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-48">
            <label className="label">Tarea</label>
            <input className="input" value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label className="label">Fase</label>
            <select className="input" value={form.phase}
              onChange={(e) => setForm({ ...form, phase: e.target.value })}>
              {Object.keys(PHASE_COLORS).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Inicio</label>
            <input type="date" className="input" value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div>
            <label className="label">Fin</label>
            <input type="date" className="input" value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </div>
          <button className="btn-primary" onClick={addTask}>Agregar</button>
          <button className="btn-secondary" onClick={generate} disabled={generating}>
            {generating ? "Generando…" : "✨ Generar con IA"}
          </button>
        </div>
      )}

      {draft && (
        <div className="card p-4 border-brand-cyan/50 animate-pop">
          <div className="label !text-brand-cyan mb-2">Cronograma propuesto por la IA</div>
          <ul className="text-sm space-y-1 mb-3">
            {draft.map((t, i) => (
              <li key={i}>
                <b>{t.title}</b> · {t.phase} · {t.start_date} → {t.end_date}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button className="btn-primary !py-1.5 text-xs" onClick={confirmDraft}>
              Confirmar e insertar
            </button>
            <button className="btn-ghost text-xs" onClick={() => setDraft(null)}>
              Descartar
            </button>
          </div>
        </div>
      )}

      <div className="card p-5">
        <div className="flex gap-3 mb-4 flex-wrap">
          {Object.entries(PHASE_COLORS).map(([phase, color]) => (
            <span key={phase} className="flex items-center gap-1.5 text-xs text-brand-slate">
              <span className="h-2.5 w-2.5 rounded" style={{ background: color }} />
              {phase}
            </span>
          ))}
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-brand-slate text-center py-8">
            Sin tareas en el cronograma todavía.
          </p>
        ) : (
          <div className="space-y-2 overflow-x-auto scrollbar-thin -mx-1 px-1">
            {/* min-w para que el cronograma conserve su forma; en mobile scrollea */}
            {tasks.map((t) => (
              <div
                key={t.id}
                className="grid grid-cols-[140px_1fr_auto] sm:grid-cols-[220px_1fr_auto] gap-3 items-center min-w-[560px]"
              >
                <div className="text-xs">
                  <div className="font-semibold text-brand-ink truncate">
                    {t.generated_by_ai ? "🤖 " : ""}{t.title}
                  </div>
                  <div className="text-brand-mist">{t.start_date} → {t.end_date}</div>
                </div>
                <div className="relative h-7 bg-brand-bg rounded">
                  <div
                    className="absolute top-1 bottom-1 rounded"
                    style={{ ...pos(t), background: `${PHASE_COLORS[t.phase ?? ""] ?? "#5B6275"}33` }}
                  >
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${t.progress}%`,
                        background: PHASE_COLORS[t.phase ?? ""] ?? "#5B6275",
                      }}
                    />
                  </div>
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-brand-slate">
                    {t.progress}%
                  </span>
                </div>
                {canWrite ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="range" min={0} max={100} step={10} value={t.progress}
                      onChange={(e) => setProgress(t, Number(e.target.value))}
                      className="w-20 accent-[#E6332A]"
                    />
                    <button className="btn-ghost text-xs !px-1.5" onClick={() => remove(t)}>✕</button>
                  </div>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
