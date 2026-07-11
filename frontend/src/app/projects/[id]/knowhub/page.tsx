"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, formatDate } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Item {
  id: string;
  kind: "audio" | "mindmap" | "briefing" | "faq";
  status: "running" | "done" | "failed";
  title?: string | null;
  content_md?: string | null;
  duration_seconds?: number | null;
  error?: string | null;
  version: number;
  created_by_name?: string | null;
  created_at: string;
  finished_at?: string | null;
  has_audio: boolean;
}

const fmtDur = (s?: number | null) =>
  s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min` : "";

const BRAND_PALETTE = ["#E6332A", "#00B2BF", "#662483", "#F39200", "#2A9D5C", "#B81F18"];

/* ================= Render markmap (compartido) ================= */

function useMarkmap(md: string | null | undefined, interactive: boolean) {
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<any>(null);

  useEffect(() => {
    if (!md) return;
    let destroyed = false;
    (async () => {
      const [{ Transformer }, { Markmap }] = await Promise.all([
        import("markmap-lib"),
        import("markmap-view"),
      ]);
      if (destroyed || !svgRef.current) return;
      svgRef.current.innerHTML = "";
      const { root } = new Transformer().transform(md);
      mmRef.current = Markmap.create(
        svgRef.current,
        {
          autoFit: true,
          duration: 300,
          maxWidth: 280,
          paddingX: 18,
          spacingVertical: 10,
          spacingHorizontal: 100,
          fitRatio: 0.92,
          initialExpandLevel: interactive ? -1 : 3,
          color: (node: any) => {
            try {
              const branch = parseInt(String(node.state?.path || "0").split(".")[1] ?? "0", 10);
              return BRAND_PALETTE[(isNaN(branch) ? 0 : branch) % BRAND_PALETTE.length];
            } catch {
              return BRAND_PALETTE[0];
            }
          },
          pan: interactive,
          zoom: interactive,
        },
        root
      );
      // El contenedor recién toma tamaño después del layout: reajustar el
      // encuadre una vez asentado, y ante cualquier cambio de tamaño.
      const refit = () => mmRef.current?.fit();
      setTimeout(refit, 150);
      setTimeout(refit, 500);
      const ro = new ResizeObserver(refit);
      if (svgRef.current.parentElement) ro.observe(svgRef.current.parentElement);
      (mmRef.current as any).__ro = ro;
    })();
    return () => {
      destroyed = true;
      (mmRef.current as any)?.__ro?.disconnect?.();
      mmRef.current?.destroy?.();
      mmRef.current = null;
    };
  }, [md, interactive]);

  return { svgRef, mmRef };
}

/* ================= Mapa mental: pantalla completa ================= */

function MindmapViewer({ md, title, onClose }: { md: string; title: string; onClose: () => void }) {
  const { svgRef, mmRef } = useMarkmap(md, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const downloadSvg = () => {
    if (!svgRef.current) return;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const blob = new Blob([clone.outerHTML], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mapa-mental.svg";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const Tool = ({ label, title: t, onClick }: { label: string; title: string; onClick: () => void }) => (
    <button
      className="h-9 min-w-9 px-2.5 rounded-md border border-brand-border bg-white text-sm font-bold text-brand-graphite hover:border-brand-primary hover:text-brand-primary transition-colors"
      title={t}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[80] bg-white flex flex-col animate-fade">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 h-14 border-b border-brand-border shrink-0 bg-brand-bg-soft">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xl">🧠</span>
          <span className="font-display uppercase text-brand-ink truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Tool label="－" title="Alejar" onClick={() => mmRef.current?.rescale(0.75)} />
          <Tool label="＋" title="Acercar" onClick={() => mmRef.current?.rescale(1.3)} />
          <Tool label="⤢ Ajustar" title="Ajustar el mapa a la pantalla" onClick={() => mmRef.current?.fit()} />
          <span className="w-px h-6 bg-brand-border mx-1" />
          <button className="btn-secondary !py-1.5 text-xs" onClick={downloadSvg}>
            ⬇ SVG
          </button>
          <button className="btn-ghost !py-1.5 text-xs" onClick={onClose}>
            ✕ Cerrar
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 markmap-host">
        <svg ref={svgRef} className="w-full h-full" />
      </div>
      <div className="px-4 py-2 text-[11px] text-brand-slate border-t border-brand-border shrink-0 bg-brand-bg-soft">
        ● Clic en un círculo para colapsar/expandir esa rama · rueda del mouse para zoom ·
        arrastrá el fondo para moverte · «Ajustar» te devuelve a la vista completa
      </div>
    </div>
  );
}

/* ================= Mapa mental: vista previa embebida ================= */

function MindmapPreview({ md, onOpen }: { md: string; onOpen: () => void }) {
  const { svgRef } = useMarkmap(md, false);
  return (
    <button
      className="relative w-full rounded-xl border border-brand-border bg-white overflow-hidden group text-left"
      onClick={onOpen}
      title="Abrir a pantalla completa"
    >
      <div className="h-[380px] pointer-events-none markmap-host">
        <svg ref={svgRef} className="w-full h-full" />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center py-2.5 bg-gradient-to-t from-white via-white/85 to-transparent">
        <span className="rounded-full bg-brand-purple text-white text-xs font-semibold px-4 py-1.5 shadow-soft group-hover:scale-105 transition-transform">
          ⤢ Explorar a pantalla completa
        </span>
      </div>
    </button>
  );
}

/* ================= Player de audio (carga por blob) ================= */

function AudioPlayer({ src }: { src: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        // Blob en vez de streaming: el proxy de desarrollo no maneja bien los
        // range requests del <audio>; así la carga es determinista en todos lados.
        const resp = await fetch(src);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const total = Number(resp.headers.get("content-length") || 0);
        const reader = resp.body?.getReader();
        if (reader && total) {
          const chunks: Uint8Array[] = [];
          let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (!cancelled) setProgress(Math.round((received / total) * 100));
          }
          url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: "audio/mpeg" }));
        } else {
          url = URL.createObjectURL(await resp.blob());
        }
        if (!cancelled) setBlobUrl(url);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "No se pudo cargar el audio");
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);

  if (error)
    return <div className="text-xs text-brand-orange py-3">⚠ {error} — probá «Descargar MP3».</div>;
  if (!blobUrl)
    return (
      <div className="flex items-center gap-3 py-3">
        <div className="flex-1 h-2 rounded-full bg-white/15 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand-primary to-brand-orange transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[11px] text-white/60 w-24 text-right">
          Cargando {progress}%
        </span>
      </div>
    );
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <audio controls preload="metadata" className="w-full" src={blobUrl} />;
}

/* ================= Página ================= */

export default function KnowHubPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [mindmapOpen, setMindmapOpen] = useState<Item | null>(null);
  const [scriptOpen, setScriptOpen] = useState(false);
  const canWrite =
    project?.my_permission === "write" || project?.my_permission === "admin";

  const load = useCallback(() => {
    apiFetch<Item[]>(`/api/v1/projects/${params.id}/knowhub`)
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [params.id]);

  useEffect(load, [load]);

  const hasRunning = items.some((i) => i.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [hasRunning, load]);

  const latest = (kind: Item["kind"]) => items.find((i) => i.kind === kind);

  const generate = async (kind: Item["kind"]) => {
    setError("");
    try {
      const item = await apiFetch<Item>(`/api/v1/projects/${params.id}/knowhub/${kind}`, {
        method: "POST",
      });
      setItems((prev) => [item, ...prev]);
    } catch (e: any) {
      setError(e.message);
    }
  };

  // El costo se registra pero se consulta en Costos IA — acá solo metadatos de trabajo
  const Meta = ({ it }: { it: Item }) => (
    <div className="text-[11px] text-brand-slate">
      v{it.version} · {it.created_by_name} · {formatDate(it.finished_at || it.created_at)}
    </div>
  );

  const GenerateBtn = ({ kind, label }: { kind: Item["kind"]; label: string }) =>
    canWrite ? (
      <button
        className="btn-primary !py-1.5 text-xs whitespace-nowrap"
        onClick={() => generate(kind)}
        disabled={latest(kind)?.status === "running"}
      >
        {label}
      </button>
    ) : null;

  const Running = ({ text }: { text: string }) => (
    <div className="flex items-center gap-3 py-4">
      <span className="h-2.5 w-2.5 rounded-full bg-brand-primary animate-pulse shrink-0" />
      <div>
        <div className="shimmer-text text-sm font-semibold">{text}</div>
        <div className="text-[11px] text-brand-slate">
          Corre en el servidor: podés navegar y volver — el equipo recibirá el aviso.
        </div>
      </div>
    </div>
  );

  const Failed = ({ it, kind }: { it: Item; kind: Item["kind"] }) => (
    <div className="rounded-md bg-brand-primary-light text-brand-primary-dark text-xs px-3 py-2 flex items-center justify-between gap-2">
      <span>Falló: {it.error?.slice(0, 140)}</span>
      {canWrite && (
        <button className="underline font-semibold shrink-0" onClick={() => generate(kind)}>
          Reintentar
        </button>
      )}
    </div>
  );

  const audio = latest("audio");
  const mindmap = latest("mindmap");
  const briefing = latest("briefing");
  const faq = latest("faq");

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl uppercase text-brand-ink leading-none">
            KnowHub
          </h1>
          <p className="text-sm text-brand-slate mt-1.5 max-w-3xl">
            Entendé el proyecto en minutos: resumen de audio, mapa mental, briefing y
            FAQ generados por IA a partir del informe y sus fuentes — compartidos con
            todo el equipo.
          </p>
        </div>
      </div>
      {error && (
        <div className="rounded-md bg-brand-primary-light text-brand-primary-dark text-sm px-3 py-2 animate-pop">
          {error}
        </div>
      )}

      {/* ===== 🎧 Resumen de audio (protagonista) ===== */}
      <div className="rounded-2xl overflow-hidden shadow-elevated bg-brand-ink text-white">
        <div className="p-6 md:p-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 min-w-0">
              <div className="h-14 w-14 shrink-0 rounded-2xl bg-gradient-to-br from-brand-primary to-brand-orange flex items-center justify-center text-3xl">
                🎧
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider2 text-white/60">
                  Resumen de audio · dos voces · estilo podcast
                </div>
                <div className="font-display text-xl md:text-2xl uppercase leading-tight truncate">
                  {audio?.status === "done" ? audio.title : "El proyecto, contado en 5 minutos"}
                </div>
              </div>
            </div>
            <GenerateBtn kind="audio" label={audio ? "↻ Regenerar" : "✦ Generar audio"} />
          </div>

          <div className="mt-5">
            {!audio && (
              <p className="text-sm text-white/70">
                Una conductora y un analista recorren el problema, las hipótesis y los
                hallazgos con sus cifras — ideal para ponerse al día camino a una reunión.
              </p>
            )}
            {audio?.status === "running" && (
              <Running text="Escribiendo el guion y grabando las voces…" />
            )}
            {audio?.status === "failed" && <Failed it={audio} kind="audio" />}
            {audio?.status === "done" && (
              <>
                <AudioPlayer
                  src={`/api/v1/projects/${params.id}/knowhub/${audio.id}/audio`}
                />
                <div className="mt-2.5 flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-[11px] text-white/60">
                    {fmtDur(audio.duration_seconds)} · v{audio.version} · por{" "}
                    {audio.created_by_name} · {formatDate(audio.finished_at || audio.created_at)}
                  </div>
                  <div className="flex gap-3">
                    <a
                      className="text-xs text-white/80 hover:text-white underline underline-offset-2"
                      href={`/api/v1/projects/${params.id}/knowhub/${audio.id}/audio`}
                      download
                    >
                      ⬇ Descargar MP3
                    </a>
                    <button
                      className="text-xs text-white/80 hover:text-white underline underline-offset-2"
                      onClick={() => setScriptOpen((v) => !v)}
                    >
                      {scriptOpen ? "Ocultar guion" : "📄 Ver guion"}
                    </button>
                  </div>
                </div>
                {scriptOpen && audio.content_md && (
                  <div className="mt-3 rounded-lg bg-white/5 border border-white/10 p-4 max-h-72 overflow-y-auto text-[13px] leading-relaxed [&_strong]:text-brand-orange">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{audio.content_md}</ReactMarkdown>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== 🧠 Mapa mental (ancho) + 📋 Briefing / ❓ FAQ ===== */}
      <div className="grid gap-4 xl:grid-cols-5">
        {/* Mapa mental con vista previa en vivo */}
        <div className="xl:col-span-3 card p-6 border-t-4" style={{ borderTopColor: "#662483" }}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="font-display text-lg uppercase text-brand-ink">
                🧠 Mapa mental
              </div>
              <p className="text-xs text-brand-slate mt-0.5">
                La estructura completa del proyecto: hipótesis, evidencia y conclusiones
                con sus cifras. Clic para explorarlo con zoom y ramas colapsables.
              </p>
            </div>
            <GenerateBtn kind="mindmap" label={mindmap ? "↻ Regenerar" : "✦ Generar"} />
          </div>
          {mindmap?.status === "running" && <Running text="Dibujando el mapa del proyecto…" />}
          {mindmap?.status === "failed" && <Failed it={mindmap} kind="mindmap" />}
          {mindmap?.status === "done" && mindmap.content_md && (
            <>
              <MindmapPreview md={mindmap.content_md} onOpen={() => setMindmapOpen(mindmap)} />
              <div className="mt-2">
                <Meta it={mindmap} />
              </div>
            </>
          )}
          {!mindmap && (
            <div className="rounded-xl border-2 border-dashed border-brand-border py-16 text-center text-sm text-brand-slate">
              Generá el primer mapa mental del proyecto.
            </div>
          )}
        </div>

        {/* Briefing + FAQ apilados */}
        <div className="xl:col-span-2 space-y-4">
          {[
            {
              kind: "briefing" as const, icon: "📋", color: "#00B2BF",
              title: "Briefing ejecutivo",
              desc: "Una página para entender el proyecto en 3 minutos.",
              item: briefing,
            },
            {
              kind: "faq" as const, icon: "❓", color: "#F39200",
              title: "Preguntas frecuentes",
              desc: "Lo que preguntaría un miembro nuevo del equipo.",
              item: faq,
            },
          ].map(({ kind, icon, color, title, desc, item }) => (
            <div key={kind} className="card p-6 border-t-4" style={{ borderTopColor: color }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display text-lg uppercase text-brand-ink">
                    {icon} {title}
                  </div>
                  <p className="text-xs text-brand-slate mt-0.5">{desc}</p>
                </div>
                <GenerateBtn kind={kind} label={item ? "↻ Regenerar" : "✦ Generar"} />
              </div>
              <div className="mt-3">
                {item?.status === "running" && <Running text="Redactando…" />}
                {item?.status === "failed" && <Failed it={item} kind={kind} />}
                {item?.status === "done" && item.content_md && (
                  <>
                    <div className="prose-vex !text-[13px] max-h-72 overflow-y-auto rounded-lg border border-brand-border bg-brand-bg-soft/60 p-4 [&_h3]:!text-sm [&_h2]:!text-base [&_h1]:!text-base">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content_md}</ReactMarkdown>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <Meta it={item} />
                      <button
                        className="text-[11px] text-brand-cyan hover:underline"
                        onClick={() => navigator.clipboard.writeText(item.content_md || "")}
                      >
                        ⧉ Copiar
                      </button>
                    </div>
                  </>
                )}
                {!item && (
                  <div className="rounded-lg border border-dashed border-brand-border py-8 text-center text-xs text-brand-slate">
                    Todavía no se generó.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {mindmapOpen?.content_md && (
        <MindmapViewer
          md={mindmapOpen.content_md}
          title={mindmapOpen.title || "Mapa mental"}
          onClose={() => setMindmapOpen(null)}
        />
      )}
    </div>
  );
}
