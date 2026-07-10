"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AgentChat, { Proposal } from "@/components/agent/AgentChat";
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

/** Normaliza Markdown guardado: quita fences ``` que envuelven todo y
 * des-indenta (la sangría uniforme se renderiza como bloque de código:
 * monoespaciado, sin links, sin formato). */
function cleanMd(text: string): string {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    const nl = t.indexOf("\n");
    if (nl !== -1 && t.trimEnd().endsWith("```")) {
      t = t.slice(nl + 1).trimEnd();
      if (t.endsWith("```")) t = t.slice(0, -3).trimEnd();
    }
  }
  const lines = t.split("\n");
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length) {
    const indent = Math.min(...nonEmpty.map((l) => l.length - l.trimStart().length));
    if (indent > 0) {
      t = lines.map((l) => (l.trim() ? l.slice(indent) : "")).join("\n");
    }
  }
  return t;
}

const AI_ACTIONS = [
  { label: "▸ Continuar", instruction: "" },
  {
    label: "✍ Mejorar",
    instruction:
      "Reescribí el texto en edición mejorando claridad, precisión y registro institucional sobrio. Mantené todos los datos y citas.",
  },
  {
    label: "≡ Resumir",
    instruction:
      "Resumí el texto en edición en un párrafo ejecutivo, conservando las cifras clave con sus citas.",
  },
  {
    label: "📊 Con fuentes",
    instruction:
      "Ampliá el texto en edición con datos concretos tomados de las fuentes del proyecto, citando cada cifra.",
  },
];

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
  const lockTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Panel de agentes (siempre visible) ----
  const [panelTab, setPanelTab] = useState<"investigador" | "chat">("investigador");
  const [aiQuery, setAiQuery] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLoadingLabel, setAiLoadingLabel] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [capabilities, setCapabilities] = useState<{ openai: boolean; perplexity: boolean }>({
    openai: true,
    perplexity: false,
  });

  // ---- Hilo del investigador (memoria persistente) ----
  interface ResearchTurn {
    role: "user" | "assistant";
    content: string;
    citations?: { url: string; title: string }[];
    engine?: string;
  }
  const [convId, setConvId] = useState<string | null>(null);
  const [thread, setThread] = useState<ResearchTurn[]>([]);
  const [engine, setEngine] = useState<"perplexity" | "openai">("perplexity");
  const [reader, setReader] = useState<ResearchTurn | null>(null); // modo lectura amplio
  const [panelError, setPanelError] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<any>("/api/v1/agent/capabilities").then(setCapabilities).catch(() => {});
    // Retomar el último hilo de investigación del proyecto
    apiFetch<any[]>(`/api/v1/projects/${params.id}/agent/conversations?agent_type=investigacion`)
      .then(async (convs) => {
        if (!convs.length) return;
        const latest = convs[0];
        setConvId(latest.id);
        const msgs = await apiFetch<any[]>(`/api/v1/agent/conversations/${latest.id}/messages`);
        setThread(
          msgs.map((m) => ({
            role: m.role,
            content: m.role === "assistant" ? cleanMd(m.content) : m.content,
            citations: m.tool_calls?.citations,
            engine: m.tool_calls?.engine,
          }))
        );
      })
      .catch(() => {});
  }, [params.id]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread, aiLoading]);

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

  const insertText = (text: string) => {
    editorRef.current?.insertAtCursor(text);
    setDirty(true);
  };

  const requestSuggestion = async (instruction: string) => {
    const info = editorRef.current?.getContextInfo();
    setAiLoading(true);
    setAiLoadingLabel("Redactando con el documento y las fuentes…");
    setAiSuggestion("");
    try {
      const res = await apiFetch<{ suggestion: string }>(
        `/api/v1/projects/${params.id}/agent/suggest`,
        {
          method: "POST",
          body: JSON.stringify({
            context_text: info?.context || doc?.content_md?.slice(0, 2500) || " ",
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

  const requestResearch = async () => {
    const query = aiQuery.trim();
    if (!query || aiLoading) return;
    const info = editorRef.current?.getContextInfo();
    setAiLoading(true);
    setPanelError("");
    setAiLoadingLabel(
      engine === "perplexity"
        ? "VEX Consulting IA investigando… (hasta 1 minuto)"
        : "IA tradicional investigando… (hasta 1 minuto)"
    );
    setThread((t) => [...t, { role: "user", content: query }]);
    setAiQuery("");
    try {
      const res = await apiFetch<any>(`/api/v1/projects/${params.id}/agent/research`, {
        method: "POST",
        body: JSON.stringify({
          query,
          context_text: info?.context || undefined,
          engine,
          conversation_id: convId || undefined,
        }),
      });
      setConvId(res.conversation_id);
      const turn: ResearchTurn = {
        role: "assistant",
        content: cleanMd(res.answer),
        citations: res.citations,
        engine: res.engine,
      };
      setThread((t) => [...t, turn]);
      setReader(turn); // abrir en modo lectura amplio automáticamente
    } catch (e: any) {
      setThread((t) => t.slice(0, -1));
      setAiQuery(query); // devolver el texto para reintentar
      setPanelError(e.message || "No se pudo completar la investigación");
    } finally {
      setAiLoading(false);
    }
  };

  const newThread = () => {
    setConvId(null);
    setThread([]);
    setPanelError("");
  };

  /** Separa el cuerpo de la lista de fuentes (la lista solo se muestra en modo lectura). */
  const splitSources = (md: string) => {
    const idx = md.indexOf("**Fuentes consultadas:**");
    if (idx === -1) return md;
    const body = md.slice(0, idx).trim();
    return body || md;
  };

  if (!doc) return <div className="card p-10 text-center text-brand-slate">Cargando…</div>;

  return (
    <div className="space-y-3">
      {lockedByOther && (
        <div className="rounded-md bg-brand-orange/10 border border-brand-orange/40 px-4 py-2.5 text-sm text-brand-graphite animate-fade">
          ✏️ <b>{doc.lock_user_name}</b> está editando el documento. Se abrió en modo lectura.
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

      {/* ==== Editor + Panel de agentes (siempre visible) ==== */}
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3 min-w-0">
          <MarkdownEditor
            projectId={params.id}
            initialMarkdown={doc.content_md}
            editable={editable}
            onDirty={setDirty}
            editorRef={editorRef}
          />
        </div>

        <aside className="xl:col-span-2 xl:sticky xl:top-20 h-fit space-y-3">
          <div className="card overflow-hidden">
            <div className="flex border-b border-brand-border">
              <button
                className={`flex-1 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider2 transition-colors ${
                  panelTab === "investigador"
                    ? "bg-brand-primary text-white"
                    : "text-brand-slate hover:bg-brand-bg"
                }`}
                onClick={() => setPanelTab("investigador")}
              >
                🔬 Investigador
              </button>
              <button
                className={`flex-1 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider2 transition-colors ${
                  panelTab === "chat"
                    ? "bg-brand-primary text-white"
                    : "text-brand-slate hover:bg-brand-bg"
                }`}
                onClick={() => setPanelTab("chat")}
              >
                💬 Chat del proyecto
              </button>
            </div>

            {panelTab === "investigador" ? (
              <div className="p-3 space-y-2.5">
                {/* Hilo de investigación con memoria */}
                <div className="max-h-[58vh] overflow-y-auto space-y-2.5 pr-1">
                  {thread.length === 0 && !aiLoading && (
                    <p className="text-xs text-brand-slate leading-relaxed py-2">
                      Escribí abajo qué investigar. El investigador recuerda todo el hilo:
                      para continuar o profundizar, simplemente seguí escribiendo — como en
                      un chat. Cada resultado se abre en modo lectura y se puede insertar en
                      el documento con sus fuentes.
                    </p>
                  )}
                  {thread.map((t, i) =>
                    t.role === "user" ? (
                      <div key={i} className="flex justify-end">
                        <div className="max-w-[90%] rounded-lg bg-brand-primary text-white px-3 py-1.5 text-[13px]">
                          {t.content}
                        </div>
                      </div>
                    ) : (
                      <div key={i} className="rounded-lg bg-brand-bg p-3 animate-pop">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className={t.engine === "perplexity" ? "badge-primary" : "badge-neutral"}>
                            {t.engine === "perplexity" ? "VEX Consulting IA" : "IA tradicional"}
                          </span>
                          {t.citations && t.citations.length > 0 && (
                            <span className="text-[10px] text-brand-slate">
                              {t.citations.length} fuentes
                            </span>
                          )}
                        </div>
                        <div className="prose-vex !text-[13.5px] !leading-relaxed max-h-80 overflow-y-auto pr-1.5 [&_h1]:!text-base [&_h2]:!text-base [&_h3]:!text-sm">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {splitSources(t.content)}
                          </ReactMarkdown>
                        </div>
                        <div className="flex gap-1.5 mt-2">
                          <button
                            className="btn-secondary !py-1 text-xs flex-1"
                            onClick={() => setReader(t)}
                          >
                            📖 Leer completo y fuentes
                          </button>
                          {editable && (
                            <button
                              className="btn-primary !py-1 text-xs flex-1"
                              onClick={() => insertText(t.content)}
                            >
                              ⤵ Insertar
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  )}
                  {aiLoading && (
                    <div className="shimmer-text text-sm font-semibold py-1.5">{aiLoadingLabel}</div>
                  )}
                  {panelError && (
                    <div className="rounded-md bg-brand-primary-light text-brand-primary-dark text-xs px-3 py-2 animate-pop">
                      {panelError} — tu consulta quedó en el campo, reintentá.
                    </div>
                  )}
                  <div ref={threadEndRef} />
                </div>

                {editable && (
                  <>
                    <div className="flex gap-1.5 items-end">
                      <textarea
                        className="input !py-2 text-[13px] resize-none flex-1"
                        rows={2}
                        placeholder={
                          thread.length
                            ? "Continuá el hilo: «profundizá en Paraguay», «desagregá por año», «verificá esa cifra»…"
                            : "¿Qué investigamos? Ej.: «migración de voz a canales digitales en BPO, últimos 10 años»"
                        }
                        value={aiQuery}
                        onChange={(e) => setAiQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            requestResearch();
                          }
                        }}
                        disabled={aiLoading}
                      />
                      <button
                        className="btn-primary !py-2.5"
                        disabled={aiLoading || !aiQuery.trim()}
                        onClick={requestResearch}
                      >
                        {aiLoading ? "…" : "Investigar"}
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-brand-slate">
                      <label className="flex items-center gap-1.5">
                        Motor:
                        <select
                          className="bg-transparent font-semibold text-brand-ink focus:outline-none cursor-pointer"
                          value={engine}
                          onChange={(e) => setEngine(e.target.value as any)}
                        >
                          {capabilities.perplexity && (
                            <option value="perplexity">VEX Consulting IA</option>
                          )}
                          <option value="openai">IA tradicional</option>
                        </select>
                      </label>
                      <div className="flex items-center gap-3">
                        <details className="relative">
                          <summary className="cursor-pointer hover:text-brand-ink list-none">
                            ✍ Ayuda de redacción
                          </summary>
                          <div className="absolute bottom-6 right-0 card shadow-elevated p-2 flex flex-col gap-1 w-52 z-20 animate-pop">
                            {AI_ACTIONS.map((a) => (
                              <button
                                key={a.label}
                                className="btn-ghost !justify-start !px-2 !py-1.5 text-xs"
                                disabled={aiLoading}
                                onClick={() => requestSuggestion(a.instruction)}
                              >
                                {a.label}
                              </button>
                            ))}
                          </div>
                        </details>
                        {thread.length > 0 && (
                          <button className="hover:text-brand-ink" onClick={newThread}>
                            🆕 Nuevo hilo
                          </button>
                        )}
                      </div>
                    </div>

                    {aiSuggestion && !aiLoading && (
                      <div className="animate-pop space-y-1.5 rounded-md border border-brand-cyan/40 p-2">
                        <div className="prose-vex !text-[13px] max-h-48 overflow-y-auto p-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiSuggestion}</ReactMarkdown>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            className="btn-primary !py-1 text-xs flex-1"
                            onClick={() => {
                              insertText(aiSuggestion);
                              setAiSuggestion("");
                            }}
                          >
                            ⤵ Insertar en el cursor
                          </button>
                          <button className="btn-ghost text-xs" onClick={() => setAiSuggestion("")}>
                            Descartar
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="p-2">
                <AgentChat
                  projectId={params.id}
                  roleSlug={project?.agent_role_slug}
                  heightClass="h-[58vh]"
                  onProposal={(p) => setProposals((prev) => [...prev, p])}
                />
              </div>
            )}
          </div>

          {reader && (
            <div
              className="fixed inset-0 z-50 bg-brand-ink/60 flex items-start justify-center p-4 md:p-8 animate-fade"
              onClick={() => setReader(null)}
            >
              <div
                className="card w-full max-w-4xl max-h-[90vh] flex flex-col animate-pop"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2 px-6 py-3.5 border-b border-brand-border">
                  <span className={reader.engine === "perplexity" ? "badge-primary" : "badge-neutral"}>
                    {reader.engine === "perplexity" ? "VEX Consulting IA" : "IA tradicional"}
                  </span>
                  {reader.citations && reader.citations.length > 0 && (
                    <span className="text-xs text-brand-slate">
                      {reader.citations.length} fuentes verificables
                    </span>
                  )}
                  <div className="ml-auto flex gap-2">
                    {editable && (
                      <button
                        className="btn-primary !py-1.5 text-xs"
                        onClick={() => {
                          insertText(reader.content);
                          setReader(null);
                        }}
                      >
                        ⤵ Insertar en el documento
                      </button>
                    )}
                    <button className="btn-ghost !py-1.5 text-xs" onClick={() => setReader(null)}>
                      ✕ Cerrar
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-8 py-6">
                  <div className="prose-vex">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{reader.content}</ReactMarkdown>
                  </div>
                  {reader.citations && reader.citations.length > 0 && (
                    <div className="mt-6 rounded-lg border border-brand-border bg-brand-bg-soft p-4">
                      <div className="label mb-2">Fuentes verificables ({reader.citations.length})</div>
                      <ol className="space-y-1 list-decimal pl-5">
                        {reader.citations.map((c, i) => (
                          <li key={i} className="text-sm">
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand-cyan underline underline-offset-2"
                            >
                              {c.title || c.url}
                            </a>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {proposals.length > 0 && (
            <div className="card p-3 space-y-2">
              <div className="label !mb-0">✨ Propuestas del chat</div>
              {proposals.map((p) => (
                <div key={p.id} className="rounded-md border border-brand-border p-2.5 animate-pop">
                  <div className="text-xs font-semibold text-brand-ink mb-1">{p.titulo}</div>
                  <pre className="text-[11px] bg-brand-bg-soft rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap font-sans">
                    {p.texto_md}
                  </pre>
                  {editable && (
                    <button
                      className="btn-secondary w-full mt-1.5 !py-1 text-[11px]"
                      onClick={() => {
                        insertText(p.texto_md);
                        setProposals((prev) => prev.filter((x) => x.id !== p.id));
                      }}
                    >
                      ⤵ Insertar en el cursor
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
