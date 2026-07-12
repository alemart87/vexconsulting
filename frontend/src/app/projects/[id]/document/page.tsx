"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AgentChat, { Proposal } from "@/components/agent/AgentChat";
import GuidedTour, { TourStep } from "@/components/GuidedTour";
import MarkdownEditor, { EditorHandle } from "@/components/editor/MarkdownEditor";
import { apiFetch, formatDate, getUser, parseApiDate } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Doc {
  id: string;
  current_version_id: string | null;
  content_md: string;
  word_count: number;
  lock_user_id: string | null;
  lock_user_name: string | null;
  lock_expires_at: string | null;
  final_edit_status?: "running" | "done" | "failed" | null;
  final_edit_detail?: any;
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

function engineBadge(engine?: string): { label: string; cls: string } {
  if (engine === "vex" || engine === "perplexity")
    return { label: "VEX Consulting IA", cls: "badge-primary" };
  if (engine === "analista") return { label: "Analista (gráficos)", cls: "badge-cyan" };
  return { label: "IA tradicional", cls: "badge-neutral" };
}

/* ===== Visitas guiadas ===== */
const TOUR_INTRO: TourStep[] = [
  {
    target: '[data-tour="editor"]',
    title: "El documento maestro",
    body: "Acá se escribe el informe. Cada guardado crea una versión con autor y diferencias: nada se pierde y todo se puede comparar o restaurar.",
  },
  {
    target: '[data-tour="panel-ia"]',
    title: "VEX Consulting IA",
    body: "Tu investigador experto: consulta las fuentes del proyecto y la web con citas verificables, y recuerda todo el hilo. Cada resultado se inserta en el informe con un clic.",
  },
  {
    target: '[data-tour="composer"]',
    title: "Pedí lo que necesites",
    body: "Escribí qué investigar. Usá @ para basar la investigación en una fuente específica, 📎 para adjuntar imagen o audio y 🎙 para dictar una nota de voz.",
  },
  {
    target: '[data-tour="rigor"]',
    title: "Elegí el nivel de rigor",
    body: "Estándar = rigor de consultora (jerarquía de fuentes y triangulación). Académico = prioriza papers revisados por pares, con autores y metodología.",
  },
  {
    target: '[data-tour="edicion-final"]',
    title: "Edición final APA",
    body: "Cuando el contenido esté cerrado, este botón corrige estilo y ortografía, convierte las citas a APA 7, numera tablas y figuras y arma las Referencias — en una versión nueva que revisás antes de publicar.",
  },
  {
    target: '[data-tour="guardar"]',
    title: "Guardá tu trabajo",
    body: "Crea una versión nueva (también con Ctrl+S). El resumen del cambio es opcional pero ayuda al equipo a seguir la historia del informe.",
  },
  {
    title: "Publicar y exportar",
    body: "Desde la pestaña Resumen publicás la versión aprobada (lo único que ven los visualizadores) y exportás Word o PDF con portada, índice y numeración de páginas. Podés rever esta guía cuando quieras con el botón «? Guía».",
  },
];

const TOUR_APA: TourStep[] = [
  {
    target: '[data-tour="apa-banner"]',
    title: "La edición APA terminó",
    body: "Se creó una versión NUEVA con citas autor-año, tablas y figuras numeradas y la lista de Referencias en APA 7. Tu texto original quedó intacto en el historial.",
  },
  {
    target: '[data-tour="apa-cargar"]',
    title: "Paso 1 · Cargala en el editor",
    body: "Este botón trae la versión editada al editor para que la leas completa.",
  },
  {
    target: '[data-tour="apa-historial"]',
    title: "Paso 2 · Revisá los cambios",
    body: "El historial compara línea por línea qué corrigió la edición. Si algo no te convence, restaurás la versión anterior o ajustás a mano.",
  },
  {
    title: "Paso 3 · Publicá y exportá",
    body: "Cuando estés conforme: pestaña Resumen → «Publicar proyecto». El Word y el PDF salen con portada e índice con números de página reales (Word lo actualiza al abrir el archivo).",
  },
];

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

  // ---- UX pro del editor: stats en vivo, guardado visible, outline, enfoque ----
  const [liveStats, setLiveStats] = useState<{ words: number; chars: number } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [, setNowTick] = useState(0); // refresca el «guardado hace X»
  const [focusMode, setFocusMode] = useState(false);
  const [outline, setOutline] = useState<{ text: string; level: number }[]>([]);
  const [activeHeading, setActiveHeading] = useState(-1);
  const headingElsRef = useRef<HTMLElement[]>([]);

  const recomputeOutline = useCallback(() => {
    const root = document.querySelector('[data-tour="editor"] .tiptap');
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3"));
    headingElsRef.current = els;
    setOutline(
      els.map((el) => ({
        text: el.textContent || "…",
        level: Number(el.tagName.slice(1)),
      }))
    );
  }, []);

  const handleStats = useCallback(
    (stats: { words: number; chars: number }) => {
      setLiveStats(stats);
      requestAnimationFrame(recomputeOutline);
    },
    [recomputeOutline]
  );

  // Scroll-spy: resalta en el índice la sección visible
  useEffect(() => {
    const onScroll = () => {
      const els = headingElsRef.current;
      let active = -1;
      for (let i = 0; i < els.length; i++) {
        if (els[i].getBoundingClientRect().top < 170) active = i;
        else break;
      }
      setActiveHeading(active);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const jumpToHeading = (i: number) => {
    const el = headingElsRef.current[i];
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 165;
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  // «Guardado hace X min» se refresca solo
  useEffect(() => {
    if (!lastSavedAt) return;
    const t = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [lastSavedAt]);

  // Nunca perder trabajo: aviso del navegador si hay cambios sin guardar
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Esc sale del modo enfoque
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode]);

  // ---- Edición final APA (job de fondo previo a publicar) ----
  const [editorKey, setEditorKey] = useState(0); // remonta el editor al cargar la edición
  const [finalDismissed, setFinalDismissed] = useState(false);

  // ---- Visita guiada (bienvenida y post-edición APA) ----
  const [tourSteps, setTourSteps] = useState<TourStep[] | null>(null);
  const tourDoneKeyRef = useRef<string | null>(null);
  const startTour = (steps: TourStep[], doneKey?: string) => {
    tourDoneKeyRef.current = doneKey ?? null;
    setTourSteps(steps);
  };
  const closeTour = () => {
    if (tourDoneKeyRef.current) localStorage.setItem(tourDoneKeyRef.current, "1");
    setTourSteps(null);
  };

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
    id?: string;
    role: "user" | "assistant";
    content: string;
    citations?: { url: string; title: string }[];
    engine?: string;
    status?: "running" | "done" | "failed";
  }
  const [convId, setConvId] = useState<string | null>(null);
  const [convList, setConvList] = useState<{ id: string; title: string; updated_at: string }[]>([]);
  const [thread, setThread] = useState<ResearchTurn[]>([]);
  const [rigor, setRigor] = useState<"estandar" | "academico">("estandar");
  const [reader, setReader] = useState<ResearchTurn | null>(null); // modo lectura amplio
  const [panelError, setPanelError] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);

  // ---- @fuentes: citar fuentes específicas (restringen la base interna) ----
  const [projectSources, setProjectSources] = useState<{ id: string; title: string }[]>([]);
  const [focusSources, setFocusSources] = useState<{ id: string; title: string }[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  // ---- Multimodal: adjuntos (imagen/voz) del investigador ----
  const [attachments, setAttachments] = useState<{ source_id: string; title: string }[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [recording, setRecording] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);

  const uploadAttachment = async (file: File) => {
    setAttaching(true);
    setPanelError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch<any>(`/api/v1/projects/${params.id}/agent/attach`, {
        method: "POST",
        body: form,
      });
      setAttachments((a) => [...a, { source_id: res.source_id, title: res.title }]);
    } catch (e: any) {
      setPanelError(`Adjunto: ${e.message}`);
    } finally {
      setAttaching(false);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recordChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(recordChunksRef.current, { type: "audio/webm" });
        if (blob.size > 2000) {
          uploadAttachment(new File([blob], `nota-voz-${Date.now()}.webm`, { type: "audio/webm" }));
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setPanelError("No se pudo acceder al micrófono (revisá permisos del navegador).");
    }
  };

  const watchIdsRef = useRef<Set<string>>(new Set()); // investigaciones lanzadas por mí, pendientes de abrir en lectura

  const loadThread = useCallback(async (conversationId: string) => {
    setConvId(conversationId);
    setPanelError("");
    const msgs = await apiFetch<any[]>(`/api/v1/agent/conversations/${conversationId}/messages`);
    const turns: ResearchTurn[] = msgs.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.role === "assistant" ? cleanMd(m.content) : m.content,
      citations: m.tool_calls?.citations,
      engine: m.tool_calls?.engine,
      status:
        m.role === "assistant"
          ? (m.tool_calls?.status ?? (m.content ? "done" : "running"))
          : undefined,
    }));
    setThread(turns);
    // Si una investigación que lancé terminó, abrirla en modo lectura
    for (const t of turns) {
      if (t.id && watchIdsRef.current.has(t.id) && t.status && t.status !== "running") {
        watchIdsRef.current.delete(t.id);
        if (t.status === "done") setReader(t);
      }
    }
    return turns;
  }, []);

  // Polling mientras haya investigaciones corriendo (el trabajo vive en el
  // servidor: se puede navegar y volver, el hilo se actualiza solo)
  const hasRunning = thread.some((t) => t.status === "running");
  useEffect(() => {
    if (!convId || !hasRunning) return;
    const interval = setInterval(() => {
      loadThread(convId).catch(() => {});
    }, 3500);
    return () => clearInterval(interval);
  }, [convId, hasRunning, loadThread]);

  const loadConvList = useCallback(async (): Promise<any[]> => {
    const convs = await apiFetch<any[]>(
      `/api/v1/projects/${params.id}/agent/conversations?agent_type=investigacion`
    );
    setConvList(convs);
    return convs;
  }, [params.id]);

  useEffect(() => {
    apiFetch<any>("/api/v1/agent/capabilities").then(setCapabilities).catch(() => {});
    // Fuentes listas del proyecto, para citarlas con @ en el investigador
    apiFetch<any[]>(`/api/v1/projects/${params.id}/sources`)
      .then((list) =>
        setProjectSources(
          list.filter((s) => s.status === "ready").map((s) => ({ id: s.id, title: s.title }))
        )
      )
      .catch(() => {});
    // Cargar TODOS los hilos de investigación y retomar el más reciente
    loadConvList()
      .then((convs) => {
        if (convs.length) loadThread(convs[0].id);
      })
      .catch(() => {});
  }, [params.id, loadConvList, loadThread]);

  useEffect(() => {
    // Scrollear SOLO el contenedor del hilo, nunca la ventana: scrollIntoView
    // arrastra a todos los ancestros con scroll (incluido el body) y provocaba
    // el salto automático de toda la página en desktop y mobile.
    const box = threadScrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
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
        setLastSavedAt(Date.now());
      } catch (e: any) {
        if (e.status === 409) setConflict(true);
        else setStatus(`Error: ${e.message}`);
      } finally {
        setSaving(false);
      }
    },
    [doc, params.id, summary]
  );

  // ---- Edición final APA ----
  const finalEditing = doc?.final_edit_status === "running";

  const runFinalEdit = async () => {
    if (!doc || finalEditing) return;
    setStatus("");
    setFinalDismissed(false);
    try {
      const updated = await apiFetch<Doc>(
        `/api/v1/projects/${params.id}/document/final-edit`,
        { method: "POST" }
      );
      setDoc(updated);
    } catch (e: any) {
      setStatus(`Edición final: ${e.message}`);
    }
  };

  // Polling mientras la edición final corre (el trabajo vive en el servidor)
  useEffect(() => {
    if (!finalEditing) return;
    const interval = setInterval(async () => {
      try {
        const d = await apiFetch<Doc>(`/api/v1/projects/${params.id}/document`);
        if (d.final_edit_status !== "running") {
          setDoc(d);
          if (d.final_edit_status === "done") {
            if (!dirty) setEditorKey((k) => k + 1); // carga el contenido editado
            // Guía de «qué hacer ahora» al terminar la edición APA
            setTimeout(() => startTour(TOUR_APA), 700);
          }
        }
      } catch {
        /* reintenta en el próximo tick */
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [finalEditing, params.id, dirty]);

  // Visita guiada de bienvenida: la primera vez que se abre el documento
  // (después de la guía general de la app, para no encimarse)
  useEffect(() => {
    if (!doc || !editable) return;
    // Después de la guía del proyecto (navbar), para no encimarse
    if (!localStorage.getItem("vex_tour_project_v1")) return;
    if (localStorage.getItem("vex_tour_doc_v1")) return;
    const timer = setTimeout(() => startTour(TOUR_INTRO, "vex_tour_doc_v1"), 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, editable]);

  const loadFinalEdition = async () => {
    const d = await apiFetch<Doc>(`/api/v1/projects/${params.id}/document`);
    setDoc(d);
    setEditorKey((k) => k + 1);
    setDirty(false);
  };

  // El aviso de resultado se muestra solo si la edición terminó hace <24 h.
  const finalDetail = doc?.final_edit_detail;
  const finalRecent =
    doc?.final_edit_status === "failed" ||
    (finalDetail?.finished_at &&
      Date.now() - new Date(finalDetail.finished_at).getTime() < 24 * 3600 * 1000);

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
    setThread((t) => [...t, { role: "user", content: query }]);
    setAiQuery("");
    try {
      const res = await apiFetch<any>(`/api/v1/projects/${params.id}/agent/research`, {
        method: "POST",
        body: JSON.stringify({
          query,
          context_text: info?.context || undefined,
          engine: "vex",
          rigor,
          conversation_id: convId || undefined,
          attachment_source_ids: attachments.length
            ? attachments.map((a) => a.source_id)
            : undefined,
          focus_source_ids: focusSources.length
            ? focusSources.map((f) => f.id)
            : undefined,
        }),
      });
      setAttachments([]);
      const isNewConversation = !convId;
      setConvId(res.conversation_id);
      // La investigación quedó registrada y corre en el servidor: el hilo
      // muestra el estado y el polling trae el resultado (aunque navegues).
      watchIdsRef.current.add(res.message_id);
      setThread((t) => [
        ...t,
        { id: res.message_id, role: "assistant", content: "", engine: "vex", status: "running" },
      ]);
      if (isNewConversation) loadConvList().catch(() => {});
    } catch (e: any) {
      setThread((t) => t.slice(0, -1));
      setAiQuery(query); // devolver el texto para reintentar
      setPanelError(e.message || "No se pudo iniciar la investigación");
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
      {finalEditing && (
        <div className="rounded-md bg-brand-purple/5 border border-brand-purple/30 px-4 py-2.5 text-sm text-brand-graphite animate-fade">
          <span className="inline-block animate-pulse">🪄</span>{" "}
          <b>Edición final APA en curso</b> — se corrige el estilo, se normalizan las
          citas, se numeran tablas y figuras y se arma la lista de Referencias. El
          resultado se guarda como versión nueva; podés seguir navegando.
        </div>
      )}
      {!finalEditing && doc.final_edit_status === "done" && finalRecent && !finalDismissed && (
        <div
          data-tour="apa-banner"
          className="rounded-md bg-emerald-50 border border-emerald-300 px-4 py-3 text-sm animate-pop"
        >
          ✅ <b>Edición final APA lista</b> — versión {finalDetail?.version_number}:{" "}
          {finalDetail?.referencias ?? 0} referencias, {finalDetail?.tablas_numeradas ?? 0}{" "}
          tablas y {finalDetail?.figuras_numeradas ?? 0} figuras numeradas. Revisá el
          resultado y recién después publicá.
          <div className="mt-2 flex gap-2 flex-wrap">
            <button
              data-tour="apa-cargar"
              className="btn-primary text-xs px-3 py-1.5"
              onClick={loadFinalEdition}
            >
              Cargar en el editor
            </button>
            <Link
              data-tour="apa-historial"
              href={`/projects/${params.id}/document/versions`}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              Ver cambios en el historial
            </Link>
            <button
              className="btn-ghost text-xs px-3 py-1.5"
              onClick={() => startTour(TOUR_APA)}
            >
              ¿Qué hago ahora?
            </button>
            <button
              className="btn-ghost text-xs px-3 py-1.5"
              onClick={() => setFinalDismissed(true)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
      {!finalEditing && doc.final_edit_status === "failed" && !finalDismissed && (
        <div className="rounded-md bg-brand-primary-light border border-brand-primary/30 px-4 py-2.5 text-sm animate-fade">
          ⚠ <b>La edición final falló:</b> {finalDetail?.error || "error desconocido"}.
          <button
            className="btn-ghost text-xs px-2 py-1 ml-2"
            onClick={() => setFinalDismissed(true)}
          >
            Cerrar
          </button>
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
        <div className="text-xs text-brand-slate flex items-center gap-2 flex-wrap">
          {/* Estado de guardado en vivo */}
          {editable && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                saving
                  ? "border-brand-cyan/50 text-brand-cyan"
                  : dirty
                    ? "border-brand-orange/60 text-brand-orange"
                    : "border-emerald-300 text-emerald-700"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  saving
                    ? "bg-brand-cyan animate-pulse"
                    : dirty
                      ? "bg-brand-orange animate-pulse"
                      : "bg-emerald-500"
                }`}
              />
              {saving
                ? "Guardando…"
                : dirty
                  ? "Cambios sin guardar"
                  : lastSavedAt
                    ? `Guardado ${
                        Date.now() - lastSavedAt < 60_000
                          ? "recién"
                          : `hace ${Math.round((Date.now() - lastSavedAt) / 60_000)} min`
                      }`
                    : "Todo guardado"}
            </span>
          )}
          <span>
            {(liveStats?.words ?? doc.word_count).toLocaleString("es-PY")} palabras ·{" "}
            {Math.max(1, Math.round((liveStats?.words ?? doc.word_count) / 200))} min de
            lectura ·{" "}
            <Link
              href={`/projects/${params.id}/document/versions`}
              data-tour="historial"
              className="text-brand-cyan underline"
            >
              historial
            </Link>
          </span>
          <button
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
              focusMode
                ? "border-brand-purple bg-brand-purple text-white"
                : "border-brand-border text-brand-slate hover:border-brand-purple hover:text-brand-purple"
            }`}
            onClick={() => setFocusMode((v) => !v)}
            title={
              focusMode
                ? "Salir del modo enfoque (Esc)"
                : "Modo enfoque: oculta el panel y centra el documento para escribir"
            }
          >
            {focusMode ? "✕ Enfoque" : "⛶ Enfoque"}
          </button>
          <button
            className="rounded-full border border-brand-border px-2 py-0.5 text-[11px] font-semibold text-brand-slate hover:border-brand-primary hover:text-brand-primary transition-colors"
            onClick={() => startTour(TOUR_INTRO)}
            title="Recorré las funciones del documento paso a paso"
          >
            ? Guía
          </button>
        </div>
        {editable && (
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <button
              data-tour="edicion-final"
              className="btn-editorial !py-1.5 text-xs whitespace-nowrap order-1"
              onClick={runFinalEdit}
              disabled={finalEditing || dirty}
              title={
                dirty
                  ? "Guardá los cambios antes de lanzar la edición final"
                  : "Corrige estilo y ortografía, normaliza citas APA 7, numera tablas y figuras y arma las Referencias. Crea una versión nueva revisable."
              }
            >
              {finalEditing ? (
                <>
                  <span className="animate-pulse">✦</span> Editando…
                </>
              ) : (
                <>✦ Edición final APA</>
              )}
            </button>
            <input
              className="input flex-1 min-w-[140px] sm:!w-64 sm:flex-none !py-1.5 text-xs order-3 sm:order-2"
              placeholder="Resumen del cambio (opcional)"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            <button
              data-tour="guardar"
              className="btn-primary !py-1.5 whitespace-nowrap order-2 sm:order-3"
              onClick={() => save()}
              disabled={saving || !dirty}
            >
              {saving ? "Guardando…" : dirty ? "Guardar versión" : "Sin cambios"}
            </button>
          </div>
        )}
      </div>
      {status && <div className="text-xs text-emerald-700">{status}</div>}

      {/* ==== Índice + Editor + Panel de agentes ==== */}
      <div
        className={`grid gap-4 ${
          focusMode
            ? "xl:grid-cols-[210px_minmax(0,1fr)]"
            : "xl:grid-cols-[210px_minmax(0,1fr)_minmax(0,36%)]"
        }`}
      >
        {/* Índice del documento (navegación tipo Google Docs) */}
        <aside className="hidden xl:block xl:sticky xl:top-36 h-fit">
          <div className="card p-3 max-h-[70vh] overflow-y-auto scrollbar-thin">
            <div className="label !mb-2">Índice</div>
            {outline.length === 0 ? (
              <p className="text-[11px] text-brand-mist leading-relaxed">
                Los títulos (H1–H3) del documento aparecen acá para navegarlo.
              </p>
            ) : (
              outline.map((h, i) => (
                <button
                  key={`${i}-${h.text.slice(0, 20)}`}
                  onClick={() => jumpToHeading(i)}
                  className={`block w-full text-left text-[12px] leading-snug py-1 pr-1 truncate transition-colors border-l-2 ${
                    activeHeading === i
                      ? "border-brand-primary text-brand-primary font-bold bg-brand-primary-light/40"
                      : "border-transparent text-brand-slate hover:text-brand-ink hover:border-brand-border"
                  }`}
                  style={{ paddingLeft: 8 + (h.level - 1) * 11 }}
                  title={h.text}
                >
                  {h.text}
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="min-w-0" data-tour="editor">
          <div className={focusMode ? "max-w-4xl mx-auto" : ""}>
            <MarkdownEditor
              key={`editor-${editorKey}`}
              projectId={params.id}
              initialMarkdown={doc.content_md}
              editable={editable}
              onDirty={setDirty}
              onStats={handleStats}
              zen={focusMode}
              editorRef={editorRef}
            />
          </div>
        </div>

        {!focusMode && (
        <aside
          className="xl:sticky xl:top-20 h-fit space-y-3"
          data-tour="panel-ia"
        >
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
                {/* Selector de hilos: todos los hilos quedan guardados */}
                {convList.length > 0 && (
                  <div className="flex items-center gap-2">
                    <select
                      className="input !py-1.5 text-xs flex-1"
                      value={convId ?? ""}
                      onChange={(e) => {
                        if (e.target.value) loadThread(e.target.value).catch(() => {});
                      }}
                    >
                      {!convId && <option value="">— hilo nuevo —</option>}
                      {convList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title || "Investigación"} ·{" "}
                          {parseApiDate(c.updated_at).toLocaleDateString("es-PY", {
                            day: "2-digit",
                            month: "2-digit",
                          })}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn-secondary !px-2.5 !py-1.5 text-xs whitespace-nowrap"
                      onClick={newThread}
                      title="Los hilos anteriores quedan guardados en este selector"
                    >
                      🆕 Nuevo
                    </button>
                  </div>
                )}

                {/* Hilo de investigación con memoria */}
                <div ref={threadScrollRef} className="max-h-[58vh] overflow-y-auto space-y-2.5 pr-1">
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
                      <div key={t.id ?? i} className="rounded-lg bg-brand-bg p-3 animate-pop">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className={engineBadge(t.engine).cls}>
                            {engineBadge(t.engine).label}
                          </span>
                          {t.status === "failed" && <span className="badge-primary">falló</span>}
                          {t.citations && t.citations.length > 0 && (
                            <span className="text-[10px] text-brand-slate">
                              {t.citations.length} fuentes
                            </span>
                          )}
                        </div>
                        {t.status === "running" ? (
                          <div className="py-2 space-y-1.5">
                            <div className="shimmer-text text-sm font-semibold">
                              Investigando en el servidor… podés navegar por la app y volver:
                              el resultado queda guardado en este hilo.
                            </div>
                            <div className="shimmer-bar h-2 rounded" />
                            <div className="shimmer-bar h-2 rounded w-4/5" />
                          </div>
                        ) : (
                          <>
                            <div className="prose-vex !text-[13.5px] !leading-relaxed max-h-80 overflow-y-auto pr-1.5 [&_h1]:!text-base [&_h2]:!text-base [&_h3]:!text-sm">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {splitSources(t.content)}
                              </ReactMarkdown>
                            </div>
                            {t.status !== "failed" && (
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
                            )}
                          </>
                        )}
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
                    {focusSources.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap items-center">
                        <span className="text-[10px] uppercase tracking-wider2 text-brand-purple font-bold">
                          Solo estas fuentes:
                        </span>
                        {focusSources.map((f) => (
                          <span
                            key={f.id}
                            className="inline-flex items-center gap-1 rounded-full bg-brand-purple/10 text-brand-purple text-[11px] font-semibold px-2.5 py-1"
                          >
                            📚 {f.title.slice(0, 36)}
                            <button
                              className="hover:text-brand-primary"
                              onClick={() =>
                                setFocusSources((prev) => prev.filter((x) => x.id !== f.id))
                              }
                              title="Quitar la restricción"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {(attachments.length > 0 || attaching || recording) && (
                      <div className="flex gap-1.5 flex-wrap items-center">
                        {attachments.map((a) => (
                          <span key={a.source_id} className="badge-cyan !normal-case flex items-center gap-1">
                            {a.title.slice(0, 32)}
                            <button
                              className="hover:text-brand-primary"
                              onClick={() =>
                                setAttachments((prev) => prev.filter((x) => x.source_id !== a.source_id))
                              }
                              title="Quitar de esta consulta (queda guardado en Fuentes)"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                        {attaching && (
                          <span className="shimmer-text text-[11px] font-semibold">
                            Procesando adjunto con IA…
                          </span>
                        )}
                        {recording && (
                          <span className="text-[11px] font-semibold text-brand-primary animate-pulse">
                            ● Grabando… tocá 🎙 para terminar
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2 items-end" data-tour="composer">
                      <button
                        className="h-11 w-11 shrink-0 rounded-md border border-brand-border bg-white text-xl leading-none flex items-center justify-center transition-colors hover:border-brand-primary hover:text-brand-primary disabled:opacity-40"
                        title="Adjuntar imagen o audio: se analiza con IA y queda guardado como fuente"
                        disabled={aiLoading || attaching}
                        onClick={() => attachInputRef.current?.click()}
                      >
                        📎
                      </button>
                      <button
                        className={`h-11 w-11 shrink-0 rounded-md border text-xl leading-none flex items-center justify-center transition-colors disabled:opacity-40 ${
                          recording
                            ? "bg-brand-primary border-brand-primary text-white animate-pulse"
                            : "border-brand-border bg-white hover:border-brand-primary hover:text-brand-primary"
                        }`}
                        title="Nota de voz: grabá tu consulta o datos, se transcribe y se guarda como fuente"
                        disabled={aiLoading || attaching}
                        onClick={toggleRecording}
                      >
                        🎙
                      </button>
                      <input
                        ref={attachInputRef}
                        type="file"
                        className="hidden"
                        accept="image/*,audio/*,.mp3,.m4a,.wav,.webm,.ogg"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadAttachment(f);
                          e.currentTarget.value = "";
                        }}
                      />
                      <div className="relative flex-1">
                        {mentionQuery !== null && (
                          <div className="absolute bottom-full mb-1 left-0 right-0 card shadow-elevated p-1 z-30 max-h-52 overflow-y-auto animate-pop">
                            <div className="px-2 py-1 text-[10px] uppercase tracking-wider2 text-brand-slate">
                              Citar fuente (restringe la investigación interna)
                            </div>
                            {projectSources
                              .filter(
                                (s) =>
                                  !focusSources.some((f) => f.id === s.id) &&
                                  s.title.toLowerCase().includes(mentionQuery.toLowerCase())
                              )
                              .slice(0, 6)
                              .map((s) => (
                                <button
                                  key={s.id}
                                  className="w-full text-left px-2 py-1.5 rounded text-xs text-brand-graphite hover:bg-brand-bg flex items-center gap-1.5"
                                  onClick={() => {
                                    setFocusSources((prev) => [...prev, s]);
                                    setAiQuery((q) => q.replace(/@[^@]*$/, "").trimEnd() + " ");
                                    setMentionQuery(null);
                                  }}
                                >
                                  📚 <span className="truncate">{s.title}</span>
                                </button>
                              ))}
                            {projectSources.filter(
                              (s) =>
                                !focusSources.some((f) => f.id === s.id) &&
                                s.title.toLowerCase().includes(mentionQuery.toLowerCase())
                            ).length === 0 && (
                              <div className="px-2 py-1.5 text-xs text-brand-slate">
                                Sin fuentes que coincidan
                              </div>
                            )}
                          </div>
                        )}
                        <textarea
                          className="input !py-2 text-[13px] resize-none w-full"
                          rows={2}
                          placeholder={
                            thread.length
                              ? "Continuá: «profundizá en Paraguay», «creame un gráfico…», «verificá esa cifra»… Usá @ para citar una fuente"
                              : "¿Qué investigamos? Usá @ para citar una fuente específica del proyecto"
                          }
                          value={aiQuery}
                          onChange={(e) => {
                            const value = e.target.value;
                            setAiQuery(value);
                            const m = value.match(/(?:^|\s)@([^@\n]*)$/);
                            setMentionQuery(m ? m[1] : null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setMentionQuery(null);
                            if (e.key === "Enter" && !e.shiftKey && mentionQuery === null) {
                              e.preventDefault();
                              requestResearch();
                            }
                          }}
                          disabled={aiLoading}
                        />
                      </div>
                      <button
                        className="btn-primary !py-2.5"
                        disabled={aiLoading || !aiQuery.trim()}
                        onClick={requestResearch}
                      >
                        {aiLoading ? "…" : "Investigar"}
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-brand-slate">
                      <label
                        data-tour="rigor"
                        className="flex items-center gap-1.5"
                        title="Académico: prioriza publicaciones revisadas por pares (papers, estudios) vía Perplexity search_mode=academic"
                      >
                        Rigor:
                        <select
                          className="bg-transparent font-semibold text-brand-ink focus:outline-none cursor-pointer"
                          value={rigor}
                          onChange={(e) => setRigor(e.target.value as any)}
                        >
                          <option value="estandar">Estándar</option>
                          <option value="academico">🎓 Académico</option>
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
                <div className="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-3 border-b border-brand-border">
                  <span className={engineBadge(reader.engine).cls}>
                    {engineBadge(reader.engine).label}
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
                        ⤵ <span className="hidden sm:inline">Insertar en el documento</span>
                        <span className="sm:hidden">Insertar</span>
                      </button>
                    )}
                    <button className="btn-ghost !py-1.5 text-xs" onClick={() => setReader(null)}>
                      ✕ <span className="hidden sm:inline">Cerrar</span>
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-5 sm:py-6">
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
        )}
      </div>

      {/* Visita guiada (bienvenida / post-edición APA) */}
      {tourSteps && <GuidedTour steps={tourSteps} onClose={closeTour} />}
    </div>
  );
}
