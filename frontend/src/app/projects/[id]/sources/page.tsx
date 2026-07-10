"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, formatDate, getToken } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Source {
  id: string;
  kind: string;
  title: string;
  url?: string;
  status: string;
  last_error?: string;
  chunk_count: number;
  page_count?: number;
  size_bytes?: number;
  uploaded_by_name?: string;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "badge-neutral",
  processing: "badge-cyan",
  ready: "badge-success",
  failed: "badge-primary",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "en cola",
  processing: "procesando",
  ready: "indexada",
  failed: "falló",
};

export default function SourcesPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const [sources, setSources] = useState<Source[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const canWrite = project?.my_permission === "write" || project?.my_permission === "admin";

  const load = useCallback(() => {
    apiFetch<Source[]>(`/api/v1/projects/${params.id}/sources`).then(setSources).catch(() => {});
  }, [params.id]);

  useEffect(() => {
    load();
    const hasActive = () => sources.some((s) => s.status === "pending" || s.status === "processing");
    const interval = setInterval(() => load(), 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const upload = async (files: FileList | File[]) => {
    setError("");
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      try {
        await apiFetch(`/api/v1/projects/${params.id}/sources`, { method: "POST", body: form });
      } catch (e: any) {
        setError(`${file.name}: ${e.message}`);
      }
    }
    load();
  };

  const addLink = async () => {
    if (!linkUrl.trim()) return;
    setError("");
    try {
      await apiFetch(`/api/v1/projects/${params.id}/sources/link`, {
        method: "POST",
        body: JSON.stringify({ url: linkUrl.trim() }),
      });
      setLinkUrl("");
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await apiFetch<any>(`/api/v1/projects/${params.id}/search`, {
        method: "POST",
        body: JSON.stringify({ query, k: 8 }),
      });
      setResults(res.results);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  };

  const remove = async (s: Source) => {
    if (!confirm(`¿Eliminar la fuente «${s.title}» y su índice?`)) return;
    await apiFetch(`/api/v1/projects/${params.id}/sources/${s.id}`, { method: "DELETE" });
    load();
  };

  const retry = async (s: Source) => {
    await apiFetch(`/api/v1/projects/${params.id}/sources/${s.id}/retry`, { method: "POST" });
    load();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        {canWrite && (
          <>
            <div
              className={`card p-8 text-center border-2 border-dashed transition-colors cursor-pointer ${
                dragOver ? "border-brand-primary bg-brand-primary-light/30" : "border-brand-border"
              }`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                upload(e.dataTransfer.files);
              }}
            >
              <div className="text-3xl mb-2">📄</div>
              <p className="text-sm font-semibold text-brand-ink">
                Arrastrá archivos o hacé clic para subir
              </p>
              <p className="text-xs text-brand-slate mt-1">
                PDF (con OCR para escaneados), Word, Excel, CSV, texto e imágenes — la IA
                extrae el texto y los datos automáticamente
              </p>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.docx,.xlsx,.xlsm,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif"
                onChange={(e) => {
                  if (e.target.files?.length) upload(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
            </div>

            <div className="card p-4 flex gap-2">
              <input
                className="input flex-1"
                placeholder="https://… (agregar link como fuente)"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addLink()}
              />
              <button className="btn-secondary" onClick={addLink}>
                Agregar link
              </button>
            </div>
          </>
        )}
        {error && (
          <div className="rounded-md bg-brand-primary-light text-brand-primary-dark text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="card divide-y divide-brand-border">
          {sources.map((s) => (
            <div key={s.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{s.kind === "link" ? "🔗" : "📄"}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-brand-ink truncate">{s.title}</div>
                  <div className="text-xs text-brand-slate">
                    {STATUS_LABEL[s.status]} · {s.chunk_count} fragmentos
                    {s.page_count ? ` · ${s.page_count} págs.` : ""}
                    {s.uploaded_by_name ? ` · ${s.uploaded_by_name}` : ""} ·{" "}
                    {formatDate(s.created_at)}
                  </div>
                  {s.last_error && (
                    <div className="text-xs text-brand-primary-dark mt-0.5">{s.last_error}</div>
                  )}
                </div>
                <span className={STATUS_BADGE[s.status] ?? "badge-neutral"}>
                  {STATUS_LABEL[s.status] ?? s.status}
                </span>
                {canWrite && (
                  <div className="flex gap-1">
                    {s.status === "failed" && (
                      <button className="btn-ghost text-xs" onClick={() => retry(s)}>
                        Reintentar
                      </button>
                    )}
                    <button className="btn-ghost text-xs" onClick={() => remove(s)}>
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {sources.length === 0 && (
            <div className="p-8 text-center text-sm text-brand-slate">
              Todavía no hay fuentes. Subí los documentos de la investigación.
            </div>
          )}
        </div>
      </div>

      {/* Búsqueda RAG manual */}
      <div className="card p-4 h-fit sticky top-20">
        <h2 className="label mb-2">Buscar en las fuentes (RAG)</h2>
        <div className="flex gap-2 mb-3">
          <input
            className="input flex-1"
            placeholder="¿Qué querés encontrar en las fuentes?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <button className="btn-primary" onClick={search} disabled={searching}>
            {searching ? "…" : "Buscar"}
          </button>
        </div>
        {results && (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {results.length === 0 && (
              <p className="text-sm text-brand-slate">Sin resultados para esa consulta.</p>
            )}
            {results.map((r) => (
              <div key={r.chunk_id} className="rounded-md border border-brand-border p-3">
                <div className="text-xs font-semibold text-brand-cyan mb-1">{r.citation}</div>
                <p className="text-xs text-brand-graphite whitespace-pre-wrap line-clamp-6">
                  {r.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
