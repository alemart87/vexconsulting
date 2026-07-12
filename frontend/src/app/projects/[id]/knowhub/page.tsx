"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, formatDate } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

/** Iconos de línea corporativos (sin emojis): stroke en currentColor. */
function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "audio":
      return (
        <svg {...common}>
          <path d="M4 14v-1a8 8 0 0 1 16 0v1" />
          <rect x="3" y="14" width="4" height="6" rx="1.5" />
          <rect x="17" y="14" width="4" height="6" rx="1.5" />
        </svg>
      );
    case "mindmap":
      return (
        <svg {...common}>
          <circle cx="12" cy="5" r="2.2" />
          <circle cx="5" cy="18" r="2.2" />
          <circle cx="19" cy="18" r="2.2" />
          <path d="M12 7.5v3m0 0-5.3 5.3M12 10.5l5.3 5.3" />
        </svg>
      );
    case "briefing":
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case "faq":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.4 9.4a2.6 2.6 0 1 1 3.7 2.4c-.8.4-1.1.9-1.1 1.8" />
          <path d="M12 16.8v.2" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "slides":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M12 17v4M8 21h8M9 9.5l3 2-3 2v-4Z" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" />
        </svg>
      );
    default:
      return null;
  }
}

interface Item {
  id: string;
  kind: "audio" | "mindmap" | "briefing" | "faq" | "slides";
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

function useMarkmap(
  md: string | null | undefined,
  interactive: boolean,
  onNodeClick?: (node: any) => void
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<any>(null);
  const mdRef = useRef(md);
  mdRef.current = md;
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;

  /** Estabiliza medición y encuadre (rect en 0 → renderData → fit). */
  const stabilize = (rounds = 10) => {
    let ticks = 0;
    const interval = window.setInterval(() => {
      ticks += 1;
      try {
        const mm = mmRef.current;
        if (mm && svgRef.current?.isConnected) {
          const rect = mm.state?.rect;
          if (!rect || rect.x2 - rect.x1 < 1) mm.renderData?.();
          mm.fit();
        }
      } catch {
        /* desmontando: ignorar */
      }
      if (ticks >= rounds) window.clearInterval(interval);
    }, 200);
    return interval;
  };

  useEffect(() => {
    if (!md) return;
    let destroyed = false;
    const timers: number[] = [];
    let ro: ResizeObserver | null = null;
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
      // Estabilización de montaje: medición y encuadre pueden correr antes
      // de que el layout tenga tamaño (rect en 0 → nodos apilados) y los
      // fit() sobre un SVG desmontado revientan d3-zoom — stabilize() cubre
      // ambos con guards.
      timers.push(stabilize(10));
      ro = new ResizeObserver(() => {
        try {
          if (svgRef.current?.isConnected) mmRef.current?.fit();
        } catch {
          /* desmontando */
        }
      });
      if (svgRef.current.parentElement) ro.observe(svgRef.current.parentElement);

      // UX: clic en el TEXTO del nodo abre su panel de detalle; el CÍRCULO
      // expande/colapsa (comportamiento nativo de markmap).
      if (interactive) {
        svgRef.current.addEventListener("click", (e) => {
          const target = e.target as Element;
          if (target.tagName === "circle") return; // toggle nativo
          const g = target.closest("g.markmap-node") as any;
          const data = g?.__data__?.data ?? g?.__data__;
          if (!data) return;
          onNodeClickRef.current?.(data);
        });
      }
    })();
    return () => {
      destroyed = true;
      timers.forEach((t) => {
        clearTimeout(t);
        clearInterval(t);
      });
      ro?.disconnect();
      try {
        mmRef.current?.destroy?.();
      } catch {
        /* ya desmontado */
      }
      mmRef.current = null;
    };
  }, [md, interactive]);

  /** Profundidad visible: re-transforma y setData con initialExpandLevel;
   *  la estabilización re-mide (renderData) y encuadra. */
  const applyLevel = async (level: number) => {
    const mm = mmRef.current;
    if (!mm || !mdRef.current) return;
    try {
      const { Transformer } = await import("markmap-lib");
      const { root } = new Transformer().transform(mdRef.current);
      await mm.setData(root, { initialExpandLevel: level });
    } catch {
      return;
    }
    stabilize(8);
  };

  return { svgRef, mmRef, applyLevel };
}

/** Ancestros de un nodo (por state.path) para el breadcrumb del detalle. */
function findAncestors(root: any, target: any): any[] {
  const path: any[] = [];
  const walk = (node: any, trail: any[]): boolean => {
    const here = [...trail, node];
    if (node === target || (node.state?.id && node.state.id === target.state?.id)) {
      path.push(...here);
      return true;
    }
    return (node.children || []).some((c: any) => walk(c, here));
  };
  walk(root, []);
  return path;
}

function nodeText(node: any): string {
  const div = document.createElement("div");
  div.innerHTML = String(node?.content ?? "");
  return div.textContent || "";
}

/* ================= Mapa mental: pantalla completa ================= */

function MindmapViewer({ md, title, onClose }: { md: string; title: string; onClose: () => void }) {
  const [detail, setDetail] = useState<{ node: any; trail: any[]; color: string } | null>(null);
  const [activeLevel, setActiveLevel] = useState(-1);
  const { svgRef, mmRef, applyLevel } = useMarkmap(md, true, (node) => {
    const root = mmRef.current?.state?.data;
    const trail = root ? findAncestors(root, node) : [node];
    const branchId = trail[1]?.state?.path?.split(".")[1] ?? trail[1]?.state?.id ?? 0;
    const color = BRAND_PALETTE[(parseInt(String(branchId), 10) || 0) % BRAND_PALETTE.length];
    setDetail({ node, trail, color });
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (detail) setDetail(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, detail]);

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
          <Icon name="mindmap" className="h-5 w-5 text-brand-purple shrink-0" />
          <span className="font-display uppercase text-brand-ink truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* Profundidad visible del mapa */}
          <div className="flex rounded-md border border-brand-border overflow-hidden">
            {[
              { v: 2, label: "Ramas" },
              { v: 3, label: "Detalle" },
              { v: -1, label: "Todo" },
            ].map(({ v, label }) => (
              <button
                key={v}
                className={`px-3 h-9 text-xs font-semibold transition-colors ${
                  activeLevel === v
                    ? "bg-brand-purple text-white"
                    : "bg-white text-brand-graphite hover:bg-brand-bg"
                }`}
                title={v === -1 ? "Expandir todo el mapa" : "Limitar la profundidad visible"}
                onClick={() => {
                  setActiveLevel(v);
                  applyLevel(v);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="w-px h-6 bg-brand-border mx-0.5" />
          <Tool label="－" title="Alejar" onClick={() => mmRef.current?.rescale(0.75)} />
          <Tool label="＋" title="Acercar" onClick={() => mmRef.current?.rescale(1.3)} />
          <Tool label="⤢ Ajustar" title="Ajustar el mapa a la pantalla" onClick={() => mmRef.current?.fit()} />
          <span className="w-px h-6 bg-brand-border mx-0.5" />
          <button className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1.5" onClick={downloadSvg}>
            <Icon name="download" className="h-3.5 w-3.5" /> SVG
          </button>
          <button className="btn-ghost !py-1.5 text-xs" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 markmap-host relative overflow-hidden">
        <svg ref={svgRef} className="w-full h-full" />

        {/* Panel de detalle del tema (slide-over) */}
        <div
          className={`absolute top-0 right-0 h-full w-[400px] max-w-[92vw] bg-white shadow-elevated border-l border-brand-border flex flex-col transition-transform duration-300 ease-out ${
            detail ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {detail && (
            <>
              <div
                className="px-5 py-4 text-white shrink-0"
                style={{ background: detail.color }}
              >
                {/* Ruta de la rama */}
                <div className="text-[10px] uppercase tracking-wider2 text-white/75 leading-relaxed">
                  {detail.trail
                    .slice(0, -1)
                    .map((n) => nodeText(n))
                    .join("  ›  ") || "Tema central"}
                </div>
                <div className="font-display text-xl uppercase leading-tight mt-1">
                  {nodeText(detail.node)}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {detail.node.children?.length ? (
                  <>
                    <div className="label mb-3">
                      Contenido de esta rama ({detail.node.children.length})
                    </div>
                    <ul className="space-y-2.5">
                      {detail.node.children.map((child: any, i: number) => (
                        <li key={i} className="animate-fade" style={{ animationDelay: `${i * 40}ms` }}>
                          <div className="flex items-start gap-2.5">
                            <span
                              className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ background: detail.color }}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-brand-ink leading-snug">
                                {nodeText(child)}
                              </div>
                              {child.children?.length > 0 && (
                                <ul className="mt-1.5 space-y-1 border-l-2 pl-3" style={{ borderColor: `${detail.color}44` }}>
                                  {child.children.map((gc: any, j: number) => (
                                    <li key={j} className="text-[13px] text-brand-graphite leading-snug">
                                      {nodeText(gc)}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-brand-slate leading-relaxed">
                    Este es un dato puntual del mapa — no tiene sub-puntos. El contexto
                    completo está en su rama:{" "}
                    <b className="text-brand-ink">{nodeText(detail.trail[1] ?? detail.node)}</b>.
                  </p>
                )}
              </div>
              <div className="p-4 border-t border-brand-border flex gap-2 shrink-0">
                {detail.node.children?.length > 0 && (
                  <button
                    className="btn-secondary !py-1.5 text-xs flex-1"
                    onClick={() => {
                      try {
                        mmRef.current?.toggleNode?.(detail.node);
                      } catch {
                        /* sin efecto */
                      }
                    }}
                  >
                    ⊕ Expandir/colapsar en el mapa
                  </button>
                )}
                <button
                  className="btn-ghost !py-1.5 text-xs flex-1"
                  onClick={() => setDetail(null)}
                >
                  Cerrar detalle
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="px-4 py-2 text-[11px] text-brand-slate border-t border-brand-border shrink-0 bg-brand-bg-soft">
        <b>Cómo se usa:</b> clic en el <b>texto</b> de un tema para ver su detalle · clic en el{" "}
        <b>círculo</b> para expandir/colapsar la rama · «Ramas / Detalle / Todo» controla
        la profundidad · rueda para zoom · arrastrá para moverte · «Ajustar» recompone
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
    return <div className="text-xs text-brand-orange py-3">{error} — probá «Descargar MP3».</div>;
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

  const generate = async (kind: Item["kind"], body?: Record<string, unknown>) => {
    setError("");
    try {
      const item = await apiFetch<Item>(`/api/v1/projects/${params.id}/knowhub/${kind}`, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      setItems((prev) => [item, ...prev]);
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Presentación: estilo elegido antes de generar
  const SLIDE_STYLES = [
    { key: "resumen", label: "Resumen ejecutivo", desc: "8-10 slides, solo lo esencial" },
    { key: "explicativa", label: "Explicativa", desc: "didáctica, para quien no conoce el proyecto" },
    { key: "corporativa", label: "Corporativa", desc: "para cliente o directorio" },
    { key: "personalizada", label: "Personalizada", desc: "vos definís el enfoque" },
  ] as const;
  const [slideStyle, setSlideStyle] = useState<string>("corporativa");
  const [slideInstruction, setSlideInstruction] = useState("");

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
  const slides = latest("slides");
  const slidesUrl = slides ? `/api/v1/projects/${params.id}/knowhub/${slides.id}/slides` : "";

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
              <div className="h-14 w-14 shrink-0 rounded-2xl bg-gradient-to-br from-brand-primary to-brand-orange flex items-center justify-center text-white">
                <Icon name="audio" className="h-7 w-7" />
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
            <GenerateBtn kind="audio" label={audio ? "Regenerar" : "Generar audio"} />
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
                      Descargar MP3
                    </a>
                    <button
                      className="text-xs text-white/80 hover:text-white underline underline-offset-2"
                      onClick={() => setScriptOpen((v) => !v)}
                    >
                      {scriptOpen ? "Ocultar guion" : "Ver guion"}
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

      {/* ===== Presentación (slides HTML con export a PDF) ===== */}
      <div className="card p-6 border-t-4" style={{ borderTopColor: "#0F1116" }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="font-display text-lg uppercase text-brand-ink flex items-center gap-2">
              <Icon name="slides" className="h-5 w-5 text-brand-primary" /> Presentación
            </div>
            <p className="text-xs text-brand-slate mt-0.5 max-w-2xl">
              Slides profesionales generadas del informe: navegación por teclado,
              animaciones y marca Voicenter. Se exporta como HTML autocontenido o a PDF
              (una slide por página).
            </p>
          </div>
          {canWrite && (
            <button
              className="btn-primary !py-1.5 text-xs whitespace-nowrap"
              disabled={
                slides?.status === "running" ||
                (slideStyle === "personalizada" && slideInstruction.trim().length < 12)
              }
              onClick={() =>
                generate("slides", {
                  style: slideStyle,
                  instruction: slideStyle === "personalizada" ? slideInstruction.trim() : undefined,
                })
              }
            >
              {slides ? "Regenerar" : "Generar presentación"}
            </button>
          )}
        </div>

        {/* Instrucción: 3 enfoques predefinidos + personalizada */}
        {canWrite && (
          <div className="mt-3">
            <div className="flex gap-1.5 flex-wrap">
              {SLIDE_STYLES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  title={s.desc}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    slideStyle === s.key
                      ? "bg-brand-ink text-white border-brand-ink"
                      : "bg-white text-brand-slate border-brand-border hover:border-brand-ink hover:text-brand-ink"
                  }`}
                  onClick={() => setSlideStyle(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {slideStyle === "personalizada" && (
              <textarea
                className="input mt-2 min-h-[64px] text-sm"
                placeholder="Describí el enfoque: audiencia, qué destacar, cuántas slides… Ej.: «Para el comité de riesgos: enfocate en la exposición cambiaria 2026, máximo 8 slides»."
                value={slideInstruction}
                onChange={(e) => setSlideInstruction(e.target.value)}
              />
            )}
          </div>
        )}

        <div className="mt-4">
          {slides?.status === "running" && (
            <Running text="Armando el contenido y componiendo las slides…" />
          )}
          {slides?.status === "failed" && <Failed it={slides} kind="slides" />}
          {slides?.status === "done" && (
            <>
              {/* Vista previa en vivo (la presentación real, embebida) */}
              <div className="rounded-xl overflow-hidden border border-brand-border shadow-soft bg-brand-ink">
                <iframe
                  title="Vista previa de la presentación"
                  src={slidesUrl}
                  className="w-full h-[420px] border-0"
                />
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3 flex-wrap">
                <Meta it={slides} />
                <div className="flex gap-3 text-xs">
                  <a
                    className="text-brand-cyan font-semibold hover:underline"
                    href={slidesUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir a pantalla completa
                  </a>
                  <a
                    className="text-brand-cyan font-semibold hover:underline"
                    href={`${slidesUrl}#print`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Exportar PDF
                  </a>
                  <a
                    className="text-brand-cyan font-semibold hover:underline"
                    href={`${slidesUrl}?dl=1`}
                  >
                    Descargar HTML
                  </a>
                </div>
              </div>
            </>
          )}
          {!slides && (
            <div className="rounded-xl border-2 border-dashed border-brand-border py-10 text-center text-sm text-brand-slate">
              Elegí el enfoque y generá la primera presentación del proyecto.
            </div>
          )}
        </div>
      </div>

      {/* ===== Mapa mental (ancho) + Briefing / FAQ ===== */}
      <div className="grid gap-4 xl:grid-cols-5">
        {/* Mapa mental con vista previa en vivo */}
        <div className="xl:col-span-3 card p-6 border-t-4" style={{ borderTopColor: "#662483" }}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="font-display text-lg uppercase text-brand-ink flex items-center gap-2">
                <Icon name="mindmap" className="h-5 w-5 text-brand-purple" /> Mapa mental
              </div>
              <p className="text-xs text-brand-slate mt-0.5">
                La estructura completa del proyecto: hipótesis, evidencia y conclusiones
                con sus cifras. Clic para explorarlo con zoom y ramas colapsables.
              </p>
            </div>
            <GenerateBtn kind="mindmap" label={mindmap ? "Regenerar" : "Generar"} />
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
              kind: "briefing" as const, icon: "briefing", color: "#00B2BF",
              title: "Briefing ejecutivo",
              desc: "Una página para entender el proyecto en 3 minutos.",
              item: briefing,
            },
            {
              kind: "faq" as const, icon: "faq", color: "#F39200",
              title: "Preguntas frecuentes",
              desc: "Lo que preguntaría un miembro nuevo del equipo.",
              item: faq,
            },
          ].map(({ kind, icon, color, title, desc, item }) => (
            <div key={kind} className="card p-6 border-t-4" style={{ borderTopColor: color }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display text-lg uppercase text-brand-ink flex items-center gap-2">
                    <span style={{ color }}>
                      <Icon name={icon} className="h-5 w-5" />
                    </span>
                    {title}
                  </div>
                  <p className="text-xs text-brand-slate mt-0.5">{desc}</p>
                </div>
                <GenerateBtn kind={kind} label={item ? "Regenerar" : "Generar"} />
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
                        Copiar
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
