"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Assignee {
  id: string;
  name: string;
  photo_url?: string | null;
}
interface Task {
  id: string;
  title: string;
  phase?: string | null;
  start_date: string;
  end_date: string;
  progress: number;
  status: string;
  assignees: Assignee[];
  generated_by_ai: boolean;
}
interface Member {
  id: string;
  name: string;
}

const PHASES: { key: string; label: string; color: string }[] = [
  { key: "hipotesis", label: "Hipótesis", color: "#662483" },
  { key: "fuentes", label: "Fuentes", color: "#00B2BF" },
  { key: "evidencia", label: "Evidencia", color: "#F39200" },
  { key: "sintesis", label: "Síntesis", color: "#E6332A" },
  { key: "evaluacion", label: "Evaluación", color: "#0F1116" },
];
const phaseColor = (p?: string | null) => PHASES.find((x) => x.key === p)?.color ?? "#5B6275";
const phaseLabel = (p?: string | null) => PHASES.find((x) => x.key === p)?.label ?? "Otras";

const DAY = 86_400_000;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Fechas del Gantt: date-only, siempre en UTC para que la escala no se corra. */
const parseDay = (s: string) => Date.parse(`${s}T00:00:00Z`);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fmtDay = (s: string) => {
  const d = new Date(parseDay(s));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

function Avatar({ a, cls }: { a: Assignee; cls: string }) {
  return a.photo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={a.photo_url} alt={a.name} title={a.name}
      className={`${cls} rounded-full object-cover border-2 border-white shadow-soft`} />
  ) : (
    <span title={a.name}
      className={`${cls} rounded-full bg-brand-purple text-white flex items-center justify-center font-bold border-2 border-white shadow-soft`}>
      {a.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Pila de avatares superpuestos (máx. 3 visibles + contador). */
function AvatarStack({ list, size = "h-5 w-5 text-[9px]" }: { list: Assignee[]; size?: string }) {
  if (!list.length) return null;
  const shown = list.slice(0, 3);
  return (
    <span className="inline-flex items-center -space-x-1.5 shrink-0" title={list.map((a) => a.name).join(", ")}>
      {shown.map((a) => (
        <Avatar key={a.id} a={a} cls={size} />
      ))}
      {list.length > 3 && (
        <span className={`${size} rounded-full bg-brand-bg text-brand-slate flex items-center justify-center font-bold border-2 border-white`}>
          +{list.length - 3}
        </span>
      )}
    </span>
  );
}

/** Selector de VARIOS responsables (checkboxes en dropdown). */
function AssigneePicker({
  members, value, onChange, className = "",
}: {
  members: Member[];
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const label =
    value.length === 0
      ? "— Sin asignar —"
      : members
          .filter((m) => value.includes(m.id))
          .map((m) => m.name.split(" ")[0])
          .join(", ") || `${value.length} responsables`;
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        className="input !w-full text-left truncate flex items-center justify-between gap-1"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`truncate ${value.length ? "" : "text-brand-mist"}`}>{label}</span>
        <span className="text-[9px] text-brand-slate shrink-0">▼</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 glass rounded-xl z-30 max-h-52 overflow-y-auto animate-pop">
          {members.map((m) => (
            <label
              key={m.id}
              className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-white/70"
            >
              <input
                type="checkbox"
                className="accent-[#E6332A]"
                checked={value.includes(m.id)}
                onChange={() => toggle(m.id)}
              />
              <span className="truncate">{m.name}</span>
            </label>
          ))}
          {members.length === 0 && (
            <div className="px-3 py-2 text-xs text-brand-slate">Sin miembros en el proyecto.</div>
          )}
        </div>
      )}
    </div>
  );
}

type SortKey = "start" | "title" | "phase" | "progress" | "end";

export default function GanttPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [view, setView] = useState<"gantt" | "lista">("gantt");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "start", dir: 1 });
  const [draft, setDraft] = useState<any[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState({
    title: "", phase: "fuentes", start_date: "", end_date: "", assignees: [] as string[],
  });
  const [editing, setEditing] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [preview, setPreview] = useState<{ id: string; start: number; end: number } | null>(null);
  const dragRef = useRef<{
    task: Task; mode: "move" | "left" | "right"; startX: number; areaWidth: number;
  } | null>(null);
  const canWrite = project?.my_permission === "write" || project?.my_permission === "admin";

  const load = useCallback(() => {
    apiFetch<Task[]>(`/api/v1/projects/${params.id}/gantt`).then(setTasks).catch(() => {});
  }, [params.id]);

  useEffect(load, [load]);
  useEffect(() => {
    apiFetch<{ users: Member[] }>(`/api/v1/projects/${params.id}/chat/mentionables`)
      .then((r) => setMembers(r.users))
      .catch(() => {});
    const saved = localStorage.getItem("vex_gantt_view");
    if (saved === "lista") setView("lista");
  }, [params.id]);

  const switchView = (v: "gantt" | "lista") => {
    setView(v);
    localStorage.setItem("vex_gantt_view", v);
  };

  // ----- escala temporal -----
  const range = useMemo(() => {
    if (tasks.length === 0) return null;
    const starts = tasks.map((t) => parseDay(t.start_date));
    const ends = tasks.map((t) => parseDay(t.end_date));
    const min = Math.min(...starts) - DAY * 2;
    const max = Math.max(...ends) + DAY * 3;
    return { min, span: Math.max(max - min, DAY * 14) };
  }, [tasks]);

  const pct = (ms: number) => (range ? ((ms - range.min) / range.span) * 100 : 0);

  const barPos = (t: Task) => {
    const p = preview?.id === t.id ? preview : null;
    const start = p ? p.start : parseDay(t.start_date);
    const end = p ? p.end : parseDay(t.end_date);
    const left = pct(start);
    const width = Math.max(((end - start + DAY) / (range?.span ?? 1)) * 100, 1.5);
    return { left: `${left}%`, width: `${width}%`, start, end };
  };

  const todayMs = useMemo(() => {
    const n = new Date();
    return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  const monthMarks = useMemo(() => {
    if (!range) return [];
    const marks: { ms: number; label: string }[] = [];
    const d = new Date(range.min);
    d.setUTCDate(1);
    if (+d < range.min) d.setUTCMonth(d.getUTCMonth() + 1);
    while (+d < range.min + range.span) {
      marks.push({ ms: +d, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return marks;
  }, [range]);

  const weekMarks = useMemo(() => {
    if (!range) return [];
    const marks: number[] = [];
    for (let ms = range.min; ms < range.min + range.span; ms += DAY * 7) marks.push(ms);
    return marks;
  }, [range]);

  // ----- drag de barras (mover / estirar) -----
  const onBarPointerDown = (e: React.PointerEvent, t: Task, mode: "move" | "left" | "right") => {
    if (!canWrite || !range) return;
    e.preventDefault();
    e.stopPropagation();
    const area = (e.currentTarget as HTMLElement).closest("[data-gantt-area]") as HTMLElement;
    dragRef.current = { task: t, mode, startX: e.clientX, areaWidth: area?.offsetWidth || 800 };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !range) return;
      const days = Math.round(((ev.clientX - d.startX) / d.areaWidth) * (range.span / DAY));
      let start = parseDay(d.task.start_date);
      let end = parseDay(d.task.end_date);
      if (d.mode === "move") { start += days * DAY; end += days * DAY; }
      if (d.mode === "left") start = Math.min(start + days * DAY, end);
      if (d.mode === "right") end = Math.max(end + days * DAY, start);
      setPreview({ id: d.task.id, start, end });
    };
    const onUp = async () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setPreview((p) => {
        if (d && p && p.id === d.task.id) {
          const start_date = isoDay(p.start);
          const end_date = isoDay(p.end);
          if (start_date !== d.task.start_date || end_date !== d.task.end_date) {
            setTasks((prev) =>
              prev.map((x) => (x.id === d.task.id ? { ...x, start_date, end_date } : x))
            );
            apiFetch(`/api/v1/projects/${params.id}/gantt/${d.task.id}`, {
              method: "PATCH",
              body: JSON.stringify({ start_date, end_date }),
            }).catch(load);
          }
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ----- CRUD -----
  const addTask = async () => {
    if (!form.title || !form.start_date || !form.end_date) return;
    await apiFetch(`/api/v1/projects/${params.id}/gantt`, {
      method: "POST",
      body: JSON.stringify(form),
    });
    setForm({ title: "", phase: "fuentes", start_date: "", end_date: "", assignees: [] });
    load();
  };

  const openEditor = (t: Task) => {
    setEditing(t);
    setConfirmDelete(false);
    setEditForm({
      title: t.title, phase: t.phase ?? "", start_date: t.start_date, end_date: t.end_date,
      progress: t.progress, assignees: t.assignees.map((a) => a.id),
    });
  };

  const saveEditor = async () => {
    if (!editing || !editForm) return;
    try {
      await apiFetch(`/api/v1/projects/${params.id}/gantt/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify(editForm),
      });
      setEditing(null);
      load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const deleteEditing = async () => {
    if (!editing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    await apiFetch(`/api/v1/projects/${params.id}/gantt/${editing.id}`, { method: "DELETE" });
    setEditing(null);
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

  // ----- KPIs -----
  const kpis = useMemo(() => {
    if (!tasks.length) return null;
    const total = tasks.length;
    let weighted = 0;
    let dur = 0;
    let overdue = 0;
    let active = 0;
    for (const t of tasks) {
      const d = (parseDay(t.end_date) - parseDay(t.start_date)) / DAY + 1;
      weighted += t.progress * d;
      dur += d;
      if (parseDay(t.end_date) < todayMs && t.progress < 100) overdue++;
      if (parseDay(t.start_date) <= todayMs && parseDay(t.end_date) >= todayMs) active++;
    }
    return { total, avg: Math.round(weighted / Math.max(dur, 1)), overdue, active };
  }, [tasks, todayMs]);

  const grouped = useMemo(() => {
    const order = [...PHASES.map((p) => p.key), null];
    return order
      .map((key) => ({
        phase: key,
        items: tasks
          .filter((t) => (t.phase ?? null) === key)
          .sort((a, b) => parseDay(a.start_date) - parseDay(b.start_date)),
      }))
      .filter((g) => g.items.length > 0);
  }, [tasks]);

  const sorted = useMemo(() => {
    const list = [...tasks];
    const { key, dir } = sort;
    list.sort((a, b) => {
      const v =
        key === "title" ? a.title.localeCompare(b.title)
        : key === "phase" ? (a.phase ?? "z").localeCompare(b.phase ?? "z")
        : key === "progress" ? a.progress - b.progress
        : key === "end" ? parseDay(a.end_date) - parseDay(b.end_date)
        : parseDay(a.start_date) - parseDay(b.start_date);
      return v * dir;
    });
    return list;
  }, [tasks, sort]);

  const sortBy = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : 1 }));

  const sortIcon = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "");

  const taskState = (t: Task) => {
    if (t.progress >= 100) return { label: "Completada", cls: "badge-success" };
    if (parseDay(t.end_date) < todayMs) return { label: "Atrasada", cls: "badge-primary" };
    if (parseDay(t.start_date) <= todayMs) return { label: "En curso", cls: "badge-cyan" };
    return { label: "Pendiente", cls: "badge-neutral" };
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Tareas", value: kpis.total, cls: "text-brand-ink" },
            { label: "Avance ponderado", value: `${kpis.avg}%`, cls: "text-brand-cyan" },
            { label: "Atrasadas", value: kpis.overdue, cls: kpis.overdue ? "text-brand-primary" : "text-emerald-600" },
            { label: "En curso hoy", value: kpis.active, cls: "text-brand-orange" },
          ].map((k) => (
            <div key={k.label} className="card px-4 py-3">
              <div className={`font-display text-3xl leading-none ${k.cls}`}>{k.value}</div>
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mt-1">{k.label}</div>
            </div>
          ))}
        </div>
      )}

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
              {PHASES.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="w-48">
            <label className="label">Responsables</label>
            <AssigneePicker members={members} value={form.assignees}
              onChange={(assignees) => setForm({ ...form, assignees })} />
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
        <div className="flex gap-3 mb-3 flex-wrap items-center">
          {/* Toggle de vista (como otros gestores: cronograma o lista) */}
          <div className="inline-flex rounded-lg border border-brand-border overflow-hidden">
            {(["gantt", "lista"] as const).map((v) => (
              <button
                key={v}
                onClick={() => switchView(v)}
                className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider2 transition-colors ${
                  view === v ? "bg-brand-ink text-white" : "bg-white text-brand-slate hover:text-brand-ink"
                }`}
              >
                {v === "gantt" ? "📊 Gantt" : "☰ Lista"}
              </button>
            ))}
          </div>
          {view === "gantt" && (
            <>
              {PHASES.map((p) => (
                <span key={p.key} className="flex items-center gap-1.5 text-xs text-brand-slate">
                  <span className="h-2.5 w-2.5 rounded" style={{ background: p.color }} />
                  {p.label}
                </span>
              ))}
              <span className="ml-auto text-[11px] text-brand-slate hidden lg:block">
                Arrastrá para mover · estirá los bordes · click para editar
              </span>
            </>
          )}
        </div>

        {tasks.length === 0 || !range ? (
          <p className="text-sm text-brand-slate text-center py-8">
            Sin tareas en el cronograma todavía.
          </p>
        ) : view === "lista" ? (
          /* ---------- VISTA LISTA ---------- */
          <div className="overflow-x-auto scrollbar-thin -mx-1 px-1">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left border-b-2 border-brand-border">
                  {([
                    ["title", "Tarea"], ["phase", "Fase"], [null, "Responsables"],
                    ["start", "Inicio"], ["end", "Fin"], [null, "Duración"],
                    ["progress", "Progreso"], [null, "Estado"],
                  ] as [SortKey | null, string][]).map(([key, label]) => (
                    <th
                      key={label}
                      className={`py-2 px-2 text-[10px] uppercase tracking-wider2 text-brand-slate ${
                        key ? "cursor-pointer hover:text-brand-ink select-none" : ""
                      }`}
                      onClick={() => key && sortBy(key)}
                    >
                      {label}
                      {key ? sortIcon(key) : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => {
                  const st = taskState(t);
                  const days = (parseDay(t.end_date) - parseDay(t.start_date)) / DAY + 1;
                  return (
                    <tr
                      key={t.id}
                      className={`border-b border-brand-border/60 hover:bg-brand-bg-soft transition-colors ${
                        canWrite ? "cursor-pointer" : ""
                      }`}
                      onClick={() => canWrite && openEditor(t)}
                    >
                      <td className="py-2.5 px-2 font-semibold text-brand-ink max-w-[260px]">
                        <span className="truncate block">
                          {t.generated_by_ai ? "🤖 " : ""}{t.title}
                        </span>
                      </td>
                      <td className="py-2.5 px-2">
                        <span
                          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: `${phaseColor(t.phase)}1a`, color: phaseColor(t.phase) }}
                        >
                          {phaseLabel(t.phase)}
                        </span>
                      </td>
                      <td className="py-2.5 px-2">
                        {t.assignees.length ? (
                          <span className="flex items-center gap-1.5">
                            <AvatarStack list={t.assignees} />
                            <span className="text-xs text-brand-slate truncate max-w-[140px]">
                              {t.assignees.map((a) => a.name.split(" ")[0]).join(", ")}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-brand-mist">Sin asignar</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-xs text-brand-slate whitespace-nowrap">{fmtDay(t.start_date)}</td>
                      <td className="py-2.5 px-2 text-xs text-brand-slate whitespace-nowrap">{fmtDay(t.end_date)}</td>
                      <td className="py-2.5 px-2 text-xs text-brand-slate whitespace-nowrap">{days} d</td>
                      <td className="py-2.5 px-2 w-36">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-brand-bg overflow-hidden">
                            <div className="h-full rounded-full"
                              style={{ width: `${t.progress}%`, background: phaseColor(t.phase) }} />
                          </div>
                          <span className="text-[10px] font-bold text-brand-slate w-8 text-right">{t.progress}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-2">
                        <span className={st.cls}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* ---------- VISTA GANTT ---------- */
          <div className="overflow-x-auto scrollbar-thin -mx-1 px-1">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[230px_1fr] gap-3 mb-1">
                <div />
                <div className="relative h-5 border-b border-brand-border">
                  {monthMarks.map((m) => (
                    <span
                      key={m.ms}
                      className="absolute top-0 text-[10px] font-bold uppercase tracking-wider2 text-brand-slate border-l border-brand-border pl-1.5"
                      style={{ left: `${pct(m.ms)}%` }}
                    >
                      {m.label}
                    </span>
                  ))}
                </div>
              </div>

              {grouped.map((g) => {
                const meta = PHASES.find((p) => p.key === g.phase);
                return (
                  <div key={g.phase ?? "otras"} className="mb-1.5">
                    <div className="grid grid-cols-[230px_1fr] gap-3 items-center">
                      <div className="flex items-center gap-1.5 py-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: meta?.color ?? "#5B6275" }} />
                        <span className="text-[10px] font-bold uppercase tracking-wider2 text-brand-slate">
                          {meta?.label ?? "Otras"} · {g.items.length}
                        </span>
                      </div>
                      <div />
                    </div>
                    {g.items.map((t) => {
                      const color = phaseColor(t.phase);
                      const bp = barPos(t);
                      const isPreview = preview?.id === t.id;
                      const overdue = parseDay(t.end_date) < todayMs && t.progress < 100;
                      const done = t.progress >= 100;
                      return (
                        <div key={t.id} className="grid grid-cols-[230px_1fr] gap-3 items-center group">
                          <button
                            className="text-left text-xs py-1 min-w-0 hover:bg-brand-bg-soft rounded px-1 -mx-1 transition-colors"
                            onClick={() => canWrite && openEditor(t)}
                            title={canWrite ? "Editar tarea" : undefined}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <AvatarStack list={t.assignees} />
                              <span className={`font-semibold truncate ${done ? "text-brand-mist line-through" : "text-brand-ink"}`}>
                                {t.generated_by_ai ? "🤖 " : ""}{t.title}
                              </span>
                              {done && <span className="text-emerald-600 text-[11px]">✓</span>}
                              {overdue && (
                                <span className="badge-primary !text-[8px] shrink-0">atrasada</span>
                              )}
                            </div>
                            <div className="text-[10px] text-brand-mist ml-0.5">
                              {fmtDay(isPreview ? isoDay(bp.start) : t.start_date)} →{" "}
                              {fmtDay(isPreview ? isoDay(bp.end) : t.end_date)}
                              {t.assignees.length
                                ? ` · ${t.assignees.map((a) => a.name.split(" ")[0]).join(", ")}`
                                : " · sin responsable"}
                            </div>
                          </button>

                          <div data-gantt-area className="relative h-8">
                            {weekMarks.map((ms) => (
                              <span key={ms} className="absolute inset-y-0 w-px bg-brand-border/50"
                                style={{ left: `${pct(ms)}%` }} />
                            ))}
                            {todayMs >= range.min && todayMs <= range.min + range.span && (
                              <span
                                className="absolute inset-y-0 w-0.5 bg-brand-primary z-10 pointer-events-none"
                                style={{ left: `${pct(todayMs)}%` }}
                              />
                            )}
                            <div
                              className={`absolute top-1 bottom-1 rounded-md transition-shadow ${
                                canWrite ? "cursor-grab active:cursor-grabbing" : ""
                              } ${isPreview ? "shadow-elevated ring-2 ring-brand-cyan/60 z-20" : "group-hover:shadow-elevated"} ${
                                overdue ? "ring-1 ring-brand-primary/70" : ""
                              }`}
                              style={{ left: bp.left, width: bp.width, background: `${color}2b` }}
                              onPointerDown={(e) => onBarPointerDown(e, t, "move")}
                              title={`${t.title} · ${t.progress}%${
                                t.assignees.length ? ` · ${t.assignees.map((a) => a.name).join(", ")}` : ""
                              }`}
                            >
                              <div
                                className={`h-full rounded-md ${done ? "" : "gantt-fill"}`}
                                style={{ width: `${t.progress}%`, background: color }}
                              />
                              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-brand-ink/70 pointer-events-none">
                                {t.progress}%
                              </span>
                              {canWrite && (
                                <>
                                  <span
                                    className="absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize rounded-l-md opacity-0 group-hover:opacity-100 bg-white/50"
                                    onPointerDown={(e) => onBarPointerDown(e, t, "left")}
                                    title="Cambiar inicio"
                                  />
                                  <span
                                    className="absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize rounded-r-md opacity-0 group-hover:opacity-100 bg-white/50"
                                    onPointerDown={(e) => onBarPointerDown(e, t, "right")}
                                    title="Cambiar fin"
                                  />
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Editor de tarea (slide-over) */}
      {editing && editForm && (
        <div className="fixed inset-0 z-40" onClick={() => setEditing(null)}>
          <div className="absolute inset-0 bg-brand-ink/20" />
          <div
            className="absolute inset-y-0 right-0 w-full sm:w-[380px] bg-white shadow-elevated flex flex-col animate-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between bg-brand-bg/60">
              <div className="font-display text-base uppercase text-brand-ink">Editar tarea</div>
              <button
                className="h-7 w-7 rounded-md hover:bg-brand-bg text-brand-slate text-sm font-bold"
                onClick={() => setEditing(null)}
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="label">Tarea</label>
                <input className="input" value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
              </div>
              <div>
                <label className="label">Responsables</label>
                <AssigneePicker members={members} value={editForm.assignees}
                  onChange={(assignees) => setEditForm({ ...editForm, assignees })} />
                {editForm.assignees.length > 0 && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <AvatarStack
                      list={members
                        .filter((m) => editForm.assignees.includes(m.id))
                        .map((m) => ({ id: m.id, name: m.name }))}
                      size="h-6 w-6 text-[10px]"
                    />
                    <span className="text-[11px] text-brand-slate">
                      {editForm.assignees.length}{" "}
                      {editForm.assignees.length === 1 ? "responsable" : "responsables"}
                    </span>
                  </div>
                )}
              </div>
              <div>
                <label className="label">Fase</label>
                <select className="input" value={editForm.phase}
                  onChange={(e) => setEditForm({ ...editForm, phase: e.target.value })}>
                  {PHASES.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Inicio</label>
                  <input type="date" className="input" value={editForm.start_date}
                    onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })} />
                </div>
                <div>
                  <label className="label">Fin</label>
                  <input type="date" className="input" value={editForm.end_date}
                    onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">Progreso: {editForm.progress}%</label>
                <input type="range" min={0} max={100} step={5} value={editForm.progress}
                  className="w-full accent-[#E6332A]"
                  onChange={(e) => setEditForm({ ...editForm, progress: Number(e.target.value) })} />
              </div>
            </div>
            <div className="border-t border-brand-border p-3 flex gap-2">
              <button className="btn-primary flex-1" onClick={saveEditor}>Guardar</button>
              <button
                className={`btn-danger ${confirmDelete ? "!bg-brand-primary !text-white" : ""}`}
                onClick={deleteEditing}
              >
                {confirmDelete ? "¿Eliminar?" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
