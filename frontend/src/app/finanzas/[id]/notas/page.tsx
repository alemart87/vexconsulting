"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmptyState } from "@/components/finanzas/ui";
import { apiFetch, formatDate, getUser } from "@/lib/api";
import type { FinNote } from "@/lib/finanzas";

const REF_LABEL: Record<string, string> = {
  general: "General",
  cuenta: "Cuenta",
  centro: "Centro de costo",
  colaborador: "Colaborador",
};

function refHref(base: string, n: FinNote): string | null {
  if (!n.ref_type || !n.ref_id) return null;
  if (n.ref_type === "cuenta") return `${base}/cuentas/${n.ref_id}`;
  if (n.ref_type === "centro") return `${base}/centros/${n.ref_id}`;
  if (n.ref_type === "colaborador") return `${base}/colaboradores/${n.ref_id}`;
  return null;
}

function NotesInner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const me = typeof window !== "undefined" ? getUser() : null;
  const [notes, setNotes] = useState<FinNote[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  // Formulario (alta o edición)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [refType, setRefType] = useState("general");
  const [refId, setRefId] = useState("");
  const [refLabel, setRefLabel] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    apiFetch<FinNote[]>(`/api/v1/finanzas/sessions/${params.id}/notes`)
      .then(setNotes)
      .catch((e) => setError(e.message));
  };
  useEffect(load, [params.id]);

  // Llegada desde una cuenta / centro / colaborador: precargar la referencia
  useEffect(() => {
    const t = search.get("ref_type");
    if (t) {
      setRefType(t);
      setRefId(search.get("ref_id") ?? "");
      setRefLabel(search.get("ref_label") ?? "");
      setShowForm(true);
    }
  }, [search]);

  const reset = () => {
    setEditingId(null);
    setTitle("");
    setBody("");
    setRefType("general");
    setRefId("");
    setRefLabel("");
    setShowForm(false);
  };

  const startEdit = (n: FinNote) => {
    setEditingId(n.id);
    setTitle(n.title);
    setBody(n.body_md ?? "");
    setRefType(n.ref_type ?? "general");
    setRefId(n.ref_id ?? "");
    setRefLabel(n.ref_label ?? "");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const payload = {
      title: title.trim(),
      body_md: body,
      ref_type: refType,
      ref_id: refType === "general" ? null : refId || null,
      ref_label: refType === "general" ? null : refLabel || null,
    };
    try {
      if (editingId) {
        await apiFetch(`/api/v1/finanzas/sessions/${params.id}/notes/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await apiFetch(`/api/v1/finanzas/sessions/${params.id}/notes`, { method: "POST", body: JSON.stringify(payload) });
      }
      reset();
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (n: FinNote) => {
    if (!confirm(`¿Eliminar la nota «${n.title}»?`)) return;
    try {
      await apiFetch(`/api/v1/finanzas/sessions/${params.id}/notes/${n.id}`, { method: "DELETE" });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const base = `/finanzas/${params.id}`;
  const visible = (notes ?? []).filter((n) => !filter || (n.ref_type ?? "general") === filter);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1">
            {["", "general", "cuenta", "centro", "colaborador"].map((f) => (
              <button
                key={f}
                className={filter === f ? "badge-primary" : "badge-neutral hover:bg-brand-border"}
                onClick={() => setFilter(f)}
              >
                {f ? REF_LABEL[f] : "Todas"}
              </button>
            ))}
          </div>
          {!showForm && (
            <button className="btn-primary !py-2 text-xs" onClick={() => setShowForm(true)}>+ Nueva nota</button>
          )}
        </div>

        {error && <div className="rounded-md bg-brand-primary-light text-brand-primary-dark text-sm px-3 py-2 mb-3">{error}</div>}

        {notes === null ? (
          <div className="card p-10 text-center text-brand-slate">Cargando…</div>
        ) : visible.length === 0 ? (
          <EmptyState
            title="Sin notas"
            body="Registrá observaciones, decisiones y pendientes sobre este análisis. Podés vincular cada nota a una cuenta, un centro de costo o un colaborador."
            action={!showForm && <button className="btn-primary" onClick={() => setShowForm(true)}>Escribir la primera</button>}
          />
        ) : (
          <div className="space-y-3">
            {visible.map((n) => {
              const href = refHref(base, n);
              return (
                <article key={n.id} className="card p-5 animate-pop">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-brand-ink leading-tight">{n.title}</h3>
                      <div className="text-[11px] text-brand-slate mt-0.5">
                        {n.created_by_name}
                        {" · "}
                        {formatDate(n.created_at)}
                        {n.updated_at !== n.created_at && ` · editada ${formatDate(n.updated_at)}${n.updated_by_name ? ` por ${n.updated_by_name}` : ""}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {n.ref_type && n.ref_type !== "general" && (
                        href ? (
                          <Link href={href} className="badge-cyan hover:opacity-80" title="Ir al elemento vinculado">
                            {REF_LABEL[n.ref_type]}: {n.ref_label || n.ref_id}
                          </Link>
                        ) : (
                          <span className="badge-cyan">{REF_LABEL[n.ref_type]}: {n.ref_label || n.ref_id}</span>
                        )
                      )}
                      <button className="btn-ghost text-xs" onClick={() => startEdit(n)}>Editar</button>
                      <button className="btn-ghost text-xs text-brand-primary" onClick={() => remove(n)}>Eliminar</button>
                    </div>
                  </div>
                  {n.body_md && (
                    <div className="prose-vex text-sm mt-3 max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{n.body_md}</ReactMarkdown>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      <aside>
        {showForm ? (
          <form onSubmit={save} className="card p-5 space-y-3 sticky top-20 animate-pop">
            <div className="label">{editingId ? "Editar nota" : "Nueva nota"}</div>
            <input className="input" placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} autoFocus />
            <textarea
              className="input min-h-[180px] font-mono text-xs"
              placeholder="Detalle (admite Markdown: listas, **negrita**, tablas…)"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={20000}
            />
            <div>
              <label className="label">Vinculada a</label>
              <select className="input" value={refType} onChange={(e) => setRefType(e.target.value)}>
                <option value="general">General (toda la sesión)</option>
                <option value="cuenta">Una cuenta</option>
                <option value="centro">Un centro de costo</option>
                <option value="colaborador">Un colaborador</option>
              </select>
            </div>
            {refType !== "general" && (
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <input className="input" placeholder={refType === "colaborador" ? "Funcod" : "Código"} value={refId} onChange={(e) => setRefId(e.target.value)} maxLength={40} />
                <input className="input" placeholder="Nombre / descripción" value={refLabel} onChange={(e) => setRefLabel(e.target.value)} maxLength={255} />
              </div>
            )}
            <div className="flex gap-2">
              <button className="btn-primary flex-1" disabled={busy || !title.trim()}>{busy ? "Guardando…" : editingId ? "Guardar cambios" : "Guardar nota"}</button>
              <button type="button" className="btn-ghost text-xs" onClick={reset}>Cancelar</button>
            </div>
            <p className="text-[11px] text-brand-slate">
              Las notas quedan en la base de datos y en la auditoría, con autor y fecha.
              {me?.role === "superadmin" ? " Como superadmin ves todas." : ""}
            </p>
          </form>
        ) : (
          <div className="card p-5 text-xs text-brand-slate leading-relaxed">
            <div className="label">Para qué sirven</div>
            Registrá hallazgos del cruce (un centro con dos nombres, un asiento que no
            cuadra), decisiones gerenciales y pendientes para el próximo mes. Desde la
            ficha de cualquier cuenta, centro o colaborador podés crear una nota ya
            vinculada.
          </div>
        )}
      </aside>
    </div>
  );
}

export default function NotesPage() {
  // useSearchParams exige un límite de Suspense en Next 14 (prerender estático)
  return (
    <Suspense fallback={<div className="card p-10 text-center text-brand-slate">Cargando…</div>}>
      <NotesInner />
    </Suspense>
  );
}
