"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import MarkdownEditor, { EditorHandle } from "@/components/editor/MarkdownEditor";
import { apiFetch, formatDate, getUser } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Doc {
  id: string;
  current_version_id: string | null;
  content_md: string;
  word_count: number;
  lock_user_id: string | null;
  lock_user_name: string | null;
  lock_expires_at: string | null;
  updated_at: string;
}

export default function DocumentPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const user = getUser();
  const editorRef = useRef<EditorHandle | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState(false);
  const [summary, setSummary] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<string>("");
  const [aiCitations, setAiCitations] = useState<{ url: string; title: string }[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLoadingLabel, setAiLoadingLabel] = useState("");
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [capabilities, setCapabilities] = useState<{ openai: boolean; perplexity: boolean }>({
    openai: true,
    perplexity: false,
  });
  const aiContextRef = useRef<string>("");
  const insertFnRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    apiFetch<any>("/api/v1/agent/capabilities").then(setCapabilities).catch(() => {});
  }, []);

  const AI_ACTIONS = [
    { label: "▸ Continuar el texto", instruction: "" },
    {
      label: "✍ Mejorar la redacción",
      instruction:
        "Reescribí el texto en edición mejorando claridad, precisión y registro institucional sobrio. Mantené todos los datos y citas.",
    },
    {
      label: "≡ Resumir",
      instruction: "Resumí el texto en edición en un párrafo ejecutivo, conservando las cifras clave con sus citas.",
    },
    {
      label: "📊 Expandir con datos de las fuentes",
      instruction:
        "Ampliá el texto en edición con datos concretos tomados de las fuentes del proyecto, citando cada cifra.",
    },
  ];

  const requestSuggestion = async (instruction: string) => {
    setAiLoading(true);
    setAiLoadingLabel("Redactando con las fuentes del proyecto…");
    setAiSuggestion("");
    setAiCitations([]);
    try {
      const res = await apiFetch<{ suggestion: string }>(
        `/api/v1/projects/${params.id}/agent/suggest`,
        {
          method: "POST",
          body: JSON.stringify({
            context_text: aiContextRef.current,
            instruction: instruction || undefined,
          }),
        }
      );
      setAiSuggestion(res.suggestion);
    } catch (e: any) {
      setStatus(`IA: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const requestResearch = async (engine: "openai" | "perplexity") => {
    const query = aiInstruction.trim();
    if (!query) {
      setStatus("IA: escribí qué querés investigar en el campo de texto");
      return;
    }
    setAiLoading(true);
    setAiLoadingLabel(
      engine === "perplexity"
        ? "Investigando con Perplexity (Sonar)…"
        : "Investigando en la web con OpenAI… puede tardar hasta un minuto"
    );
    setAiSuggestion("");
    setAiCitations([]);
    try {
      const res = await apiFetch<any>(`/api/v1/projects/${params.id}/agent/research`, {
        method: "POST",
        body: JSON.stringify({
          query,
          context_text: aiContextRef.current || undefined,
          engine,
        }),
      });
      setAiSuggestion(res.answer);
      setAiCitations(res.citations || []);
    } catch (e: any) {
      setStatus(`Investigación: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };
  const lockTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const canWrite =
    project?.my_permission === "write" || project?.my_permission === "admin";
  const lockedByOther =
    !!doc?.lock_user_id &&
    doc.lock_user_id !== user?.id &&
    !!doc.lock_expires_at &&
    new Date(doc.lock_expires_at) > new Date();
  const editable = canWrite && !lockedByOther;

  useEffect(() => {
    apiFetch<Doc>(`/api/v1/projects/${params.id}/document`).then(setDoc);
  }, [params.id]);

  // Lock blando renovable mientras se edita
  useEffect(() => {
    if (!editable || !doc) return;
    const take = () =>
      apiFetch<Doc>(`/api/v1/projects/${params.id}/document/lock`, { method: "POST" })
        .then(setDoc)
        .catch(() => {});
    take();
    lockTimer.current = setInterval(take, 30_000);
    return () => {
      if (lockTimer.current) clearInterval(lockTimer.current);
      apiFetch(`/api/v1/projects/${params.id}/document/lock`, { method: "DELETE" }).catch(
        () => {}
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, editable, doc?.id]);

  const save = useCallback(
    async (force = false) => {
      if (!doc || !editorRef.current) return;
      setSaving(true);
      setStatus("");
      try {
        const updated = await apiFetch<Doc>(`/api/v1/projects/${params.id}/document`, {
          method: "PUT",
          body: JSON.stringify({
            content_md: editorRef.current.getMarkdown(),
            base_version_id: doc.current_version_id,
            summary: summary || undefined,
            force,
          }),
        });
        setDoc(updated);
        setDirty(false);
        setConflict(false);
        setSummary("");
        setStatus(`Guardado · ${updated.word_count.toLocaleString("es-PY")} palabras`);
      } catch (e: any) {
        if (e.status === 409) setConflict(true);
        else setStatus(`Error: ${e.message}`);
      } finally {
        setSaving(false);
      }
    },
    [doc, params.id, summary]
  );

  // Ctrl+S para guardar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (editable && dirty) save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editable, dirty, save]);

  if (!doc) return <div className="card p-10 text-center text-brand-slate">Cargando…</div>;

  return (
    <div className="space-y-3">
      {lockedByOther && (
        <div className="rounded-md bg-brand-orange/10 border border-brand-orange/40 px-4 py-2.5 text-sm text-brand-graphite animate-fade">
          ✏️ <b>{doc.lock_user_name}</b> está editando el documento en este momento. Se abrió
          en modo lectura.
        </div>
      )}
      {conflict && (
        <div className="rounded-md bg-brand-primary-light border border-brand-primary/30 px-4 py-3 text-sm animate-pop">
          <b>Conflicto de versiones:</b> el documento cambió mientras editabas.
          <div className="mt-2 flex gap-2">
            <Link
              href={`/projects/${params.id}/document/versions`}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              Ver historial
            </Link>
            <button className="btn-danger text-xs px-3 py-1.5" onClick={() => save(true)}>
              Guardar igual (nueva versión)
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-brand-slate">
          {doc.word_count.toLocaleString("es-PY")} palabras · actualizado{" "}
          {formatDate(doc.updated_at)} ·{" "}
          <Link
            href={`/projects/${params.id}/document/versions`}
            className="text-brand-cyan underline"
          >
            historial de versiones
          </Link>
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            <input
              className="input !w-64 !py-1.5 text-xs"
              placeholder="Resumen del cambio (opcional)"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            <button
              className="btn-primary !py-1.5"
              onClick={() => save()}
              disabled={saving || !dirty}
            >
              {saving ? "Guardando…" : dirty ? "Guardar versión" : "Sin cambios"}
            </button>
          </div>
        )}
      </div>
      {status && <div className="text-xs text-emerald-700">{status}</div>}

      {aiPanelOpen && (
        <div className="card p-4 border-brand-cyan/50 animate-pop">
          <div className="flex items-center justify-between mb-2">
            <div className="label !text-brand-cyan !mb-0">✨ Asistente de redacción</div>
            <button
              className="btn-ghost text-xs !px-2 !py-1"
              onClick={() => {
                setAiPanelOpen(false);
                setAiSuggestion("");
              }}
            >
              ✕ Cerrar
            </button>
          </div>

          <div className="flex gap-1.5 flex-wrap mb-2">
            {AI_ACTIONS.map((a) => (
              <button
                key={a.label}
                className="btn-secondary !px-3 !py-1.5 text-xs"
                disabled={aiLoading}
                onClick={() => requestSuggestion(a.instruction)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mb-2">
            <input
              className="input !py-1.5 text-xs flex-1"
              placeholder="Instrucción o consulta: «tarifas BPO nearshore 2026 en LatAm con fuentes»…"
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && aiInstruction.trim()) requestSuggestion(aiInstruction);
              }}
              disabled={aiLoading}
            />
            <button
              className="btn-secondary !py-1.5 text-xs"
              disabled={aiLoading || !aiInstruction.trim()}
              onClick={() => requestSuggestion(aiInstruction)}
              title="Redacta con el documento y las fuentes internas (rápido)"
            >
              ✍ Redactar
            </button>
            <button
              className="btn-primary !py-1.5 text-xs"
              disabled={aiLoading || !aiInstruction.trim()}
              onClick={() => requestResearch("openai")}
              title="Investiga en la web con OpenAI (web_search) + fuentes internas, con citas"
            >
              🌐 Investigar
            </button>
            {capabilities.perplexity && (
              <button
                className="btn-primary !py-1.5 text-xs !bg-brand-purple hover:!bg-brand-ink"
                disabled={aiLoading || !aiInstruction.trim()}
                onClick={() => requestResearch("perplexity")}
                title="Investigación con Perplexity Sonar, con citas"
              >
                🔍 Perplexity
              </button>
            )}
          </div>

          {aiLoading && (
            <div className="shimmer-text text-sm font-semibold py-2">{aiLoadingLabel}</div>
          )}
          {aiSuggestion && !aiLoading && (
            <>
              <pre className="text-sm whitespace-pre-wrap bg-brand-bg-soft rounded p-3 max-h-64 overflow-y-auto font-sans">
                {aiSuggestion}
              </pre>
              {aiCitations.length > 0 && (
                <div className="mt-2 rounded-md border border-brand-border p-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider2 text-brand-slate mb-1">
                    Fuentes web consultadas ({aiCitations.length})
                  </div>
                  <ul className="space-y-0.5 max-h-28 overflow-y-auto">
                    {aiCitations.map((c, i) => (
                      <li key={i} className="text-xs truncate">
                        <a href={c.url} target="_blank" rel="noreferrer" className="text-brand-cyan underline">
                          {c.title || c.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  className="btn-primary !py-1.5 text-xs"
                  onClick={() => {
                    insertFnRef.current?.(aiSuggestion);
                    setAiSuggestion("");
                    setAiCitations([]);
                    setDirty(true);
                  }}
                >
                  ⤵ Insertar donde estaba el cursor
                </button>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setAiSuggestion("");
                    setAiCitations([]);
                  }}
                >
                  Descartar
                </button>
              </div>
            </>
          )}
          {!aiSuggestion && !aiLoading && (
            <p className="text-xs text-brand-slate">
              «✍ Redactar» usa el documento y las fuentes internas. «🌐 Investigar» busca en la
              web en tiempo real (OpenAI web_search) y devuelve texto con citas verificables.
              {capabilities.perplexity
                ? " «🔍 Perplexity» usa Sonar como segundo motor de investigación."
                : " Para habilitar Perplexity como segundo motor, cargá PERPLEXITY_API_KEY en el .env."}{" "}
              Todo se inserta exactamente donde estaba el cursor.
            </p>
          )}
        </div>
      )}

      <MarkdownEditor
        projectId={params.id}
        initialMarkdown={doc.content_md}
        editable={editable}
        onDirty={setDirty}
        editorRef={editorRef}
        onRequestAi={(contextText, insert) => {
          aiContextRef.current = contextText;
          insertFnRef.current = insert;
          setAiPanelOpen(true);
          setAiSuggestion("");
        }}
      />
    </div>
  );
}
