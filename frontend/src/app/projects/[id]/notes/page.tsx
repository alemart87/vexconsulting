"use client";

import { useCallback, useEffect, useState } from "react";
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
  { status: "pendiente", label: "Pendientes" },
  { status: "en_progreso", label: "En progreso" },
  { status: "resuelta", label: "Resueltas" },
  { status: "descartada", label: "Descartadas" },
];

const KIND_EMOJI: Record<string, string> = {
  nota: "📝",
  hipotesis: "🧪",
  hallazgo: "💡",
  tarea: "✅",
};

export default function NotesPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("nota");
  const canWrite = project?.my_permission === "write" || project?.my_permission === "admin";

  const load = useCallback(() => {
    apiFetch<Note[]>(`/api/v1/projects/${params.id}/notes`).then(setNotes).catch(() => {});
  }, [params.id]);

  useEffect(load, [load]);

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
    await apiFetch(`/api/v1/projects/${params.id}/notes/${note.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    load();
  };

  const remove = async (note: Note) => {
    if (!confirm(`¿Eliminar la nota «${note.title}»?`)) return;
    await apiFetch(`/api/v1/projects/${params.id}/notes/${note.id}`, { method: "DELETE" });
    load();
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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.status} className="space-y-2">
            <div className="label !mb-0 px-1">
              {col.label} ({notes.filter((n) => n.status === col.status).length})
            </div>
            {notes
              .filter((n) => n.status === col.status)
              .map((n) => (
                <div key={n.id} className="card p-3 animate-pop">
                  <div className="flex items-start gap-1.5">
                    <span>{KIND_EMOJI[n.kind] ?? "📝"}</span>
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
                  </div>
                  {canWrite && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {COLUMNS.filter((c) => c.status !== n.status).map((c) => (
                        <button
                          key={c.status}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-brand-bg text-brand-slate hover:bg-brand-primary hover:text-white transition-colors"
                          onClick={() => move(n, c.status)}
                        >
                          → {c.label}
                        </button>
                      ))}
                      <button
                        className="text-[10px] px-1.5 py-0.5 rounded bg-brand-bg text-brand-slate hover:bg-brand-primary-dark hover:text-white ml-auto"
                        onClick={() => remove(n)}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
