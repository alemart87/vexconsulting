"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Note {
  id: string;
  title: string;
  body_md?: string;
  status: string;
  kind: string;
  created_by_name?: string;
  created_by_agent: boolean;
}

const COLUMNS = [
  { status: "pendiente", label: "Pendientes", accent: "border-t-brand-slate" },
  { status: "en_progreso", label: "En progreso", accent: "border-t-brand-cyan" },
  { status: "resuelta", label: "Resueltas", accent: "border-t-emerald-500" },
  { status: "descartada", label: "Descartadas", accent: "border-t-brand-mist" },
];

const KIND_META: Record<string, { emoji: string; edge: string; label: string }> = {
  nota: { emoji: "📝", edge: "border-l-brand-slate/50", label: "Nota" },
  hipotesis: { emoji: "🧪", edge: "border-l-brand-purple", label: "Hipótesis" },
  hallazgo: { emoji: "💡", edge: "border-l-brand-cyan", label: "Hallazgo" },
  tarea: { emoji: "✅", edge: "border-l-brand-orange", label: "Tarea" },
};

export default function NotesPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("nota");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [landedId, setLandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const dragCounters = useRef<Record<string, number>>({});
  const canWrite = project?.my_permission === "write" || project?.my_permission === "admin";

  const load = useCallback(() => {
    apiFetch<Note[]>(`/api/v1/projects/${params.id}/notes`).then(setNotes).catch(() => {});
  }, [params.id]);

  useEffect(load, [load]);

  // ?note=... (desde una notificación): resaltar y llevar a esa nota
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("note");
    if (wanted) setHighlight(wanted);
  }, []);

  useEffect(() => {
    if (!highlight || !notes.some((n) => n.id === highlight)) return;
    document
      .getElementById(`note-${highlight}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => setHighlight(null), 6000);
    return () => clearTimeout(timer);
  }, [highlight, notes]);

  const create = async () => {
    if (!title.trim()) return;
    await apiFetch(`/api/v1/projects/${params.id}/notes`, {
      method: "POST",
      body: JSON.stringify({ title: title.trim(), kind }),
    });
    setTitle("");
    load();
  };

  const move = async (note: Note, status: string) => {
    if (note.status === status) return;
    // Optimista: la tarjeta aterriza al instante; si falla, se recarga
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, status } : n)));
    setLandedId(note.id);
    setTimeout(() => setLandedId((v) => (v === note.id ? null : v)), 700);
    try {
      await apiFetch(`/api/v1/projects/${params.id}/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    } catch {
      load();
    }
  };

  const remove = async (note: Note) => {
    if (confirmDeleteId !== note.id) {
      setConfirmDeleteId(note.id);
      setTimeout(() => setConfirmDeleteId((v) => (v === note.id ? null : v)), 3000);
      return;
    }
    setConfirmDeleteId(null);
    await apiFetch(`/api/v1/projects/${params.id}/notes/${note.id}`, { method: "DELETE" });
    load();
  };

  // --- Drag & drop nativo (columnas como zonas de soltado) ---
  const onDragStart = (e: React.DragEvent, note: Note) => {
    e.dataTransfer.setData("text/plain", note.id);
    e.dataTransfer.effectAllowed = "move";
    // Un tick después para no afectar la imagen fantasma del drag
    setTimeout(() => setDraggingId(note.id), 0);
  };
  const onDragEnd = () => {
    setDraggingId(null);
    setOverCol(null);
    dragCounters.current = {};
  };
  const onColEnter = (status: string) => {
    dragCounters.current[status] = (dragCounters.current[status] || 0) + 1;
    setOverCol(status);
  };
  const onColLeave = (status: string) => {
    dragCounters.current[status] = (dragCounters.current[status] || 0) - 1;
    if (dragCounters.current[status] <= 0) {
      setOverCol((v) => (v === status ? null : v));
    }
  };
  const onColDrop = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    const note = notes.find((n) => n.id === id);
    if (note) move(note, status);
    onDragEnd();
  };

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="card p-4 flex gap-2 flex-wrap">
          <select className="input !w-36" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="nota">📝 Nota</option>
            <option value="hipotesis">🧪 Hipótesis</option>
            <option value="hallazgo">💡 Hallazgo</option>
            <option value="tarea">✅ Tarea</option>
          </select>
          <input
            className="input flex-1"
            placeholder="Título de la nota / hipótesis / hallazgo…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <button className="btn-primary" onClick={create}>
            Agregar
          </button>
        </div>
      )}

      {canWrite && (
        <p className="text-[11px] text-brand-slate -mt-2 px-1 hidden md:block">
          Arrastrá las tarjetas entre columnas para cambiarles el estado.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 items-start">
        {COLUMNS.map((col) => {
          const colNotes = notes.filter((n) => n.status === col.status);
          const isOver = overCol === col.status && !!draggingId;
          return (
            <div
              key={col.status}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDragEnter={() => onColEnter(col.status)}
              onDragLeave={() => onColLeave(col.status)}
              onDrop={(e) => onColDrop(e, col.status)}
              className={`rounded-lg border-t-4 ${col.accent} bg-brand-bg/60 p-2 min-h-[260px] transition-all duration-150 ${
                isOver
                  ? "ring-2 ring-brand-cyan bg-brand-cyan/10 scale-[1.01] shadow-elevated"
                  : draggingId
                    ? "outline-dashed outline-2 outline-brand-border"
                    : ""
              }`}
            >
              <div className="label !mb-2 px-1 flex items-center justify-between">
                <span>{col.label}</span>
                <span className="text-brand-mist normal-case tracking-normal">{colNotes.length}</span>
              </div>
              <div className="space-y-2">
                {colNotes.map((n) => {
                  const meta = KIND_META[n.kind] ?? KIND_META.nota;
                  const isDragging = draggingId === n.id;
                  return (
                    <div
                      key={n.id}
                      id={`note-${n.id}`}
                      draggable={canWrite}
                      onDragStart={(e) => onDragStart(e, n)}
                      onDragEnd={onDragEnd}
                      className={`group card p-3 border-l-4 ${meta.edge} transition-all duration-150 ${
                        canWrite ? "cursor-grab active:cursor-grabbing" : ""
                      } ${
                        isDragging
                          ? "opacity-40 scale-95 rotate-2"
                          : "hover:-translate-y-0.5 hover:shadow-elevated"
                      } ${landedId === n.id ? "animate-pop ring-2 ring-brand-cyan/60" : ""} ${
                        highlight === n.id ? "ring-2 ring-brand-primary shadow-elevated" : ""
                      }`}
                    >
                      <div className="flex items-start gap-1.5">
                        <span title={meta.label}>{meta.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-brand-ink leading-snug">
                            {n.title}
                          </div>
                          {n.body_md && (
                            <p className="text-xs text-brand-slate mt-1 line-clamp-3 whitespace-pre-wrap">
                              {n.body_md}
                            </p>
                          )}
                          <div className="text-[10px] text-brand-mist mt-1.5">
                            {n.created_by_agent ? "🤖 " : ""}
                            {n.created_by_name}
                          </div>
                        </div>
                        {canWrite && (
                          <button
                            className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 transition-all ${
                              confirmDeleteId === n.id
                                ? "bg-brand-primary text-white font-bold"
                                : "text-brand-mist hover:text-brand-primary md:opacity-0 md:group-hover:opacity-100"
                            }`}
                            title={confirmDeleteId === n.id ? "Confirmá para eliminar" : "Eliminar"}
                            onClick={() => remove(n)}
                          >
                            {confirmDeleteId === n.id ? "¿Eliminar?" : "✕"}
                          </button>
                        )}
                      </div>
                      {/* Fallback táctil (mobile no tiene drag & drop nativo) */}
                      {canWrite && (
                        <div className="flex gap-1 mt-2 flex-wrap md:hidden">
                          {COLUMNS.filter((c) => c.status !== n.status).map((c) => (
                            <button
                              key={c.status}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-brand-bg text-brand-slate active:bg-brand-primary active:text-white"
                              onClick={() => move(n, c.status)}
                            >
                              → {c.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {isOver && (
                  <div className="rounded-lg border-2 border-dashed border-brand-cyan/70 bg-white/60 py-4 text-center text-xs font-semibold text-brand-cyan animate-fade">
                    Soltá acá → {col.label}
                  </div>
                )}
                {colNotes.length === 0 && !isOver && (
                  <div className="py-6 text-center text-[11px] text-brand-mist">
                    {draggingId ? "Arrastrá una tarjeta hasta acá" : "Sin tarjetas"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
