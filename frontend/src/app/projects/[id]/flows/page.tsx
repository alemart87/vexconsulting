"use client";

/** Vex Flows (zona Vex Cowork): canvas de flujogramas estilo Lucidchart.
 *
 *  React Flow (MIT) + dagre para el ordenamiento automático (capas sin
 *  cruces). Formas de marca pulidas, conectores discretos que aparecen al
 *  pasar el mouse, modo ampliado, diálogos propios (nada de prompts del
 *  navegador) y generación con IA con feedback visual del agente.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { toPng } from "html-to-image";
import { apiFetch, formatDate } from "@/lib/api";

interface FlowSummary {
  id: string;
  name: string;
  nodes_count: number;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  updated_at: string;
}

/* ---------- Ordenamiento automático (dagre: capas sin cruces) ---------- */

const NODE_FALLBACK_SIZE: Record<string, [number, number]> = {
  inicio: [150, 42], fin: [150, 42], proceso: [180, 52],
  decision: [116, 116], dato: [170, 50], nota: [200, 64],
};

function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 70, edgesep: 30 });
  for (const n of nodes) {
    const [fw, fh] = NODE_FALLBACK_SIZE[n.type || "proceso"] || [180, 52];
    g.setNode(n.id, {
      width: (n as any).measured?.width ?? fw,
      height: (n as any).measured?.height ?? fh,
    });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    if (!p) return n;
    const [fw, fh] = NODE_FALLBACK_SIZE[n.type || "proceso"] || [180, 52];
    const w = (n as any).measured?.width ?? fw;
    const h = (n as any).measured?.height ?? fh;
    return { ...n, position: { x: p.x - w / 2, y: p.y - h / 2 } };
  });
}

/* ---------- Formas de marca (conectores discretos, aparecen al hover) ---------- */

const HANDLE_CLS =
  "!h-2.5 !w-2.5 !bg-white !border-2 !border-brand-cyan !opacity-0 " +
  "group-hover/node:!opacity-100 transition-opacity duration-150";

const handles = (
  <>
    <Handle type="target" position={Position.Top} id="t" className={HANDLE_CLS} />
    <Handle type="target" position={Position.Left} id="l" className={HANDLE_CLS} />
    <Handle type="source" position={Position.Bottom} id="b" className={HANDLE_CLS} />
    <Handle type="source" position={Position.Right} id="r" className={HANDLE_CLS} />
  </>
);

function ProcesoNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`group/node px-4 py-3 rounded-lg bg-white text-[12.5px] font-semibold text-brand-ink min-w-[150px] max-w-[240px] text-center leading-snug transition-shadow ${
        selected ? "ring-2 ring-brand-cyan shadow-elevated" : "shadow-soft"
      }`}
      style={{ border: "1.5px solid #2A2F3A" }}
    >
      {String(data.label || "Proceso")}
      {handles}
    </div>
  );
}

function DecisionNode({ data, selected }: NodeProps) {
  // Caja CUADRADA con el rombo inscripto (inset 16%): los vértices del rombo
  // coinciden con los puntos medios de los bordes → los conectores quedan
  // exactamente en las puntas del rombo.
  return (
    <div className="group/node relative h-[116px] w-[116px]">
      <div
        className={`absolute bg-white transition-shadow ${
          selected ? "ring-2 ring-brand-cyan shadow-elevated" : "shadow-soft"
        }`}
        style={{
          inset: 17, transform: "rotate(45deg)", borderRadius: 10,
          border: "1.5px solid #F39200",
        }}
      />
      <div className="absolute inset-3 flex items-center justify-center px-2 text-center text-[10.5px] font-bold text-brand-ink leading-tight">
        {String(data.label || "¿Decisión?")}
      </div>
      {handles}
    </div>
  );
}

function pill(bg: string) {
  return function PillNode({ data, selected }: NodeProps) {
    return (
      <div
        className={`group/node px-5 py-2.5 rounded-full text-white text-[12.5px] font-bold min-w-[130px] max-w-[240px] text-center leading-snug transition-shadow ${
          selected ? "ring-2 ring-brand-ink shadow-elevated" : "shadow-soft"
        }`}
        style={{ background: bg }}
      >
        {String(data.label || "")}
        {handles}
      </div>
    );
  };
}
const InicioNode = pill("#00B2BF");
const FinNode = pill("#E6332A");

function DatoNode({ data, selected }: NodeProps) {
  return (
    <div className="group/node relative min-w-[160px] max-w-[240px]">
      <div
        className={`absolute inset-0 bg-white transition-shadow ${
          selected ? "ring-2 ring-brand-cyan shadow-elevated" : "shadow-soft"
        }`}
        style={{ transform: "skewX(-14deg)", borderRadius: 6, border: "1.5px solid #662483" }}
      />
      <div className="relative px-6 py-3 text-[12.5px] font-semibold text-brand-ink text-center leading-snug">
        {String(data.label || "Datos")}
      </div>
      {handles}
    </div>
  );
}

function NotaNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`group/node px-3.5 py-2.5 text-[11px] text-brand-graphite max-w-[230px] whitespace-pre-wrap leading-snug transition-shadow ${
        selected ? "ring-2 ring-brand-cyan shadow-elevated" : "shadow-soft"
      }`}
      style={{
        background: "#FEF7DF", border: "1px solid #F0DFA8",
        borderRadius: "3px 16px 3px 3px",
      }}
    >
      {String(data.label || "Nota…")}
      {handles}
    </div>
  );
}

const NODE_TYPES = {
  inicio: InicioNode, proceso: ProcesoNode, decision: DecisionNode,
  dato: DatoNode, fin: FinNode, nota: NotaNode,
};

const MINIMAP_COLORS: Record<string, string> = {
  inicio: "#00B2BF", fin: "#E6332A", decision: "#F39200",
  dato: "#662483", nota: "#F0DFA8", proceso: "#9AA0AE",
};

const PALETTE: { type: keyof typeof NODE_TYPES; label: string; icon: string; title: string }[] = [
  { type: "inicio", label: "Inicio", icon: "▶", title: "Inicio del flujo (píldora)" },
  { type: "proceso", label: "Proceso", icon: "▭", title: "Paso o actividad (rectángulo)" },
  { type: "decision", label: "Decisión", icon: "◇", title: "Bifurcación sí/no (rombo)" },
  { type: "dato", label: "Dato", icon: "▱", title: "Entrada/salida de datos (paralelogramo)" },
  { type: "fin", label: "Fin", icon: "⏹", title: "Fin del flujo (píldora)" },
  { type: "nota", label: "Nota", icon: "🗒", title: "Comentario del diagrama" },
];

const DEFAULT_EDGE = {
  type: "smoothstep" as const,
  markerEnd: { type: MarkerType.ArrowClosed, color: "#5B6275", width: 18, height: 18 },
  style: { stroke: "#5B6275", strokeWidth: 1.8 },
  pathOptions: { borderRadius: 16 },
} as any;

/* ---------- Avatar del agente (mismo lenguaje que el Agente Cowork) ---------- */

function AgentAvatar({ size = "sm", active = false }: { size?: "sm" | "lg"; active?: boolean }) {
  const box = size === "lg" ? "h-16 w-16 text-2xl" : "h-8 w-8 text-[14px]";
  return (
    <div className={`${box} shrink-0 relative rounded-full`}>
      <span
        className={`absolute inset-0 rounded-full ${active ? "animate-spin" : ""}`}
        style={{
          background: active
            ? "conic-gradient(#E6332A 0 30%, #00B2BF 30% 55%, #F39200 55% 78%, #E6332A 78% 100%)"
            : "#E6332A",
          animationDuration: "1.4s",
        }}
      />
      <span className="absolute inset-[2.5px] rounded-full bg-white shadow-soft flex items-center justify-center">
        <span className="font-black select-none" style={{ color: "#E6332A" }}>V</span>
      </span>
    </div>
  );
}

const GEN_PHASES = [
  "Leyendo el documento maestro…",
  "Identificando pasos y decisiones…",
  "Diseñando el flujo…",
  "Conectando nodos y bifurcaciones…",
  "Ordenando el canvas…",
];

/* ---------- Canvas ---------- */

function FlowCanvas({
  projectId,
  flow,
  expanded,
  onToggleExpand,
  onSaved,
}: {
  projectId: string;
  flow: { id: string; name: string; data: any };
  expanded: boolean;
  onToggleExpand: () => void;
  onSaved: () => void;
}) {
  const rf = useReactFlow();
  const [nodes, setNodes] = useState<Node[]>(flow.data?.nodes || []);
  const [edges, setEdges] = useState<Edge[]>(flow.data?.edges || []);
  const [selected, setSelected] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ nodes, edges });
  stateRef.current = { nodes, edges };
  const wrapperRef = useRef<HTMLDivElement>(null);

  const doSave = useCallback(async () => {
    setSaveState("saving");
    try {
      await apiFetch(`/api/v1/projects/${projectId}/flows/${flow.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          data: {
            nodes: stateRef.current.nodes,
            edges: stateRef.current.edges,
            viewport: rf.getViewport(),
          },
        }),
      });
      setSaveState("saved");
      onSaved();
    } catch {
      setSaveState("dirty");
    }
  }, [projectId, flow.id, rf, onSaved]);

  const scheduleSave = useCallback(() => {
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(doSave, 1500);
  }, [doSave]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      if (changes.some((c) => c.type !== "select")) scheduleSave();
    },
    [scheduleSave]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((es) => applyEdgeChanges(changes, es));
      if (changes.some((c) => c.type !== "select")) scheduleSave();
    },
    [scheduleSave]
  );
  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((es) => addEdge({ ...conn, ...DEFAULT_EDGE }, es));
      scheduleSave();
    },
    [scheduleSave]
  );

  const addNode = (type: keyof typeof NODE_TYPES) => {
    const { x, y, zoom } = rf.getViewport();
    const centerX = (wrapperRef.current?.clientWidth || 800) / 2;
    const centerY = (wrapperRef.current?.clientHeight || 500) / 2;
    const pos = { x: (centerX - x) / zoom - 60, y: (centerY - y) / zoom - 30 };
    const defaults: Record<string, string> = {
      inicio: "Inicio", proceso: "Proceso", decision: "¿Decisión?",
      dato: "Datos", fin: "Fin", nota: "Nota…",
    };
    setNodes((ns) => [
      ...ns,
      { id: crypto.randomUUID(), type, position: pos, data: { label: defaults[type] } },
    ]);
    scheduleSave();
  };

  const tidyUp = () => {
    setNodes((ns) => autoLayout(rf.getNodes(), stateRef.current.edges));
    scheduleSave();
    requestAnimationFrame(() => rf.fitView({ padding: 0.15, duration: 300 }));
  };

  const selectedLabel = (() => {
    if (!selected) return "";
    if (selected.kind === "node")
      return String(nodes.find((n) => n.id === selected.id)?.data?.label ?? "");
    return String(edges.find((e) => e.id === selected.id)?.label ?? "");
  })();

  const updateLabel = (value: string) => {
    if (!selected) return;
    if (selected.kind === "node") {
      setNodes((ns) =>
        ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, label: value } } : n))
      );
    } else {
      setEdges((es) => es.map((e) => (e.id === selected.id ? { ...e, label: value } : e)));
    }
    scheduleSave();
  };

  const exportPng = async () => {
    if (!nodes.length) return;
    rf.fitView({ padding: 0.2 });
    await new Promise((r) => setTimeout(r, 250));
    const dataUrl = await toPng(wrapperRef.current!.querySelector<HTMLElement>(".react-flow")!, {
      backgroundColor: "#ffffff",
      filter: (node) =>
        !node.classList?.contains("react-flow__minimap") &&
        !node.classList?.contains("react-flow__controls") &&
        !node.classList?.contains("react-flow__panel"),
    });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${flow.name}.png`;
    a.click();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Barra de herramientas */}
      <div className="flex items-center gap-1.5 flex-wrap px-3 py-2 border-b border-brand-border bg-brand-bg-soft/60">
        {PALETTE.map((p) => (
          <button
            key={p.type}
            title={p.title}
            className="px-2.5 py-1.5 rounded-md border border-brand-border bg-white text-[11px] font-semibold text-brand-graphite hover:border-brand-cyan hover:text-brand-cyan transition-colors"
            onClick={() => addNode(p.type)}
          >
            {p.icon} {p.label}
          </button>
        ))}
        <span className="w-px h-5 bg-brand-border mx-1" />
        <input
          className="input !py-1.5 text-xs flex-1 min-w-[140px] max-w-[260px]"
          placeholder={selected ? "Etiqueta de lo seleccionado…" : "Seleccioná un nodo o flecha para etiquetar"}
          value={selectedLabel}
          disabled={!selected}
          onChange={(e) => updateLabel(e.target.value)}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] text-brand-mist tabular-nums mr-1">
            {saveState === "saving" ? "Guardando…" : saveState === "dirty" ? "Sin guardar" : "✓ Guardado"}
          </span>
          <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={tidyUp}
            title="Reordenar automáticamente el diagrama (capas sin cruces)">
            ⇅ Ordenar
          </button>
          <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={exportPng}
            title="Descargar el diagrama como imagen">
            ⬇ PNG
          </button>
          <button className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={onToggleExpand}
            title={expanded ? "Salir de pantalla completa (Esc)" : "Ampliar a pantalla completa"}>
            {expanded ? "✕ Cerrar" : "⛶ Ampliar"}
          </button>
        </div>
      </div>

      <div ref={wrapperRef} className="flex-1 min-h-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={({ nodes: sn, edges: se }) => {
            if (sn.length) setSelected({ kind: "node", id: sn[0].id });
            else if (se.length) setSelected({ kind: "edge", id: se[0].id });
            else setSelected(null);
          }}
          defaultEdgeOptions={DEFAULT_EDGE}
          defaultViewport={flow.data?.viewport || undefined}
          fitView={!flow.data?.viewport}
          snapToGrid
          snapGrid={[12, 12]}
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#DDE1EA" />
          <Controls position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            className="!bg-white/90 !border !border-brand-border !rounded-lg !h-28 !w-40 hidden sm:block"
            nodeColor={(n) => MINIMAP_COLORS[n.type || "proceso"] || "#9AA0AE"}
            maskColor="rgba(246,247,251,0.7)"
          />
        </ReactFlow>
      </div>
      <div className="px-3 py-1.5 border-t border-brand-border text-[10px] text-brand-mist">
        Pasá el mouse por un nodo para ver sus conectores y arrastrá para unir · seleccioná y
        escribí para etiquetar · Supr borra · «⇅ Ordenar» acomoda todo · guardado automático
      </div>
    </div>
  );
}

/* ---------- Página ---------- */

export default function FlowsPage() {
  const params = useParams<{ id: string }>();
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [active, setActive] = useState<{ id: string; name: string; data: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Diálogo propio para nombrar/renombrar (nada de prompts del navegador)
  const [nameDialog, setNameDialog] = useState<{ mode: "create" | "rename"; id?: string; value: string } | null>(null);
  // ✨ Generación con IA
  const [genOpen, setGenOpen] = useState(false);
  const [genText, setGenText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genPhase, setGenPhase] = useState(0);
  const [genNotice, setGenNotice] = useState("");

  const load = useCallback(async () => {
    const list = await apiFetch<FlowSummary[]>(`/api/v1/projects/${params.id}/flows`);
    setFlows(list);
    setLoading(false);
    return list;
  }, [params.id]);

  const open = useCallback(
    async (id: string) => {
      const f = await apiFetch<any>(`/api/v1/projects/${params.id}/flows/${id}`);
      setActive({ id: f.id, name: f.name, data: f.data });
    },
    [params.id]
  );

  useEffect(() => {
    load()
      .then((list) => {
        if (list.length) open(list[0].id).catch(() => {});
      })
      .catch(() => setLoading(false));
  }, [load, open]);

  // Esc sale del modo ampliado
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Fases del feedback de generación (como el agente principal)
  useEffect(() => {
    if (!generating) return;
    setGenPhase(0);
    const iv = setInterval(() => setGenPhase((p) => Math.min(p + 1, GEN_PHASES.length - 1)), 2800);
    return () => clearInterval(iv);
  }, [generating]);

  const submitNameDialog = async () => {
    if (!nameDialog || nameDialog.value.trim().length < 2) return;
    const name = nameDialog.value.trim();
    if (nameDialog.mode === "create") {
      const f = await apiFetch<any>(`/api/v1/projects/${params.id}/flows`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await load();
      setActive({ id: f.id, name: f.name, data: f.data });
    } else if (nameDialog.id) {
      await apiFetch(`/api/v1/projects/${params.id}/flows/${nameDialog.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      if (active?.id === nameDialog.id) setActive((a) => (a ? { ...a, name } : a));
      load();
    }
    setNameDialog(null);
  };

  const generateFlow = async () => {
    const instruction = genText.trim();
    if (instruction.length < 10 || generating) return;
    setGenOpen(false);
    setGenerating(true);
    setGenNotice("");
    try {
      const f = await apiFetch<any>(`/api/v1/projects/${params.id}/flows/generate`, {
        method: "POST",
        body: JSON.stringify({ instruction }),
      });
      // Ordenamiento fino en el cliente (dagre) sobre lo que diseñó el modelo
      const laidOut = autoLayout(f.data.nodes || [], f.data.edges || []);
      const data = { ...f.data, nodes: laidOut };
      apiFetch(`/api/v1/projects/${params.id}/flows/${f.id}`, {
        method: "PATCH",
        body: JSON.stringify({ data }),
      }).catch(() => {});
      setGenText("");
      setGenNotice(
        `✨ «${f.name}» listo (${f.nodes_count} nodos) · USD ${Number(f.cost_usd).toFixed(4)} en Costos IA`
      );
      await load();
      setActive({ id: f.id, name: f.name, data });
    } catch (e: any) {
      setGenNotice(`El diseñador falló: ${e.message}`);
      setGenOpen(true);
    } finally {
      setGenerating(false);
    }
  };

  const deleteFlow = async (f: FlowSummary) => {
    if (confirmDeleteId !== f.id) {
      setConfirmDeleteId(f.id);
      setTimeout(() => setConfirmDeleteId(null), 4000);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await apiFetch(`/api/v1/projects/${params.id}/flows/${f.id}`, { method: "DELETE" });
      if (active?.id === f.id) setActive(null);
      const list = await load();
      if (list.length) open(list[0].id).catch(() => {});
    } catch (e: any) {
      alert(e.message);
    }
  };

  const GEN_EXAMPLES = [
    "Cómo implementar las mejoras propuestas en el documento",
    "Cómo continuar la investigación a partir de los hallazgos",
    "Cómo proponer estos resultados a los clientes",
    "Proceso de escalamiento de reclamos con decisiones",
  ];

  return (
    <div className="grid lg:grid-cols-[280px_1fr] gap-4 items-start">
      {/* ---- Diálogo: nombre del flow (estilo propio) ---- */}
      {nameDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade"
          onClick={(e) => e.target === e.currentTarget && setNameDialog(null)}
        >
          <div className="card w-full max-w-md p-5 animate-pop">
            <h3 className="font-display uppercase text-brand-ink text-lg">
              {nameDialog.mode === "create" ? "⛓ Nuevo flow" : "Renombrar flow"}
            </h3>
            <p className="text-xs text-brand-slate mt-0.5">
              {nameDialog.mode === "create"
                ? "Un nombre claro ayuda al equipo: qué proceso o decisión representa."
                : "El nuevo nombre se aplica para todo el equipo."}
            </p>
            <input
              autoFocus
              className="input w-full mt-3 font-semibold"
              maxLength={200}
              placeholder="Ej.: Proceso de atención de reclamos"
              value={nameDialog.value}
              onChange={(e) => setNameDialog({ ...nameDialog, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNameDialog();
                if (e.key === "Escape") setNameDialog(null);
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost !py-2 text-xs" onClick={() => setNameDialog(null)}>
                Cancelar
              </button>
              <button
                className="btn-primary !py-2 text-xs"
                disabled={nameDialog.value.trim().length < 2}
                onClick={submitNameDialog}
              >
                {nameDialog.mode === "create" ? "Crear flow" : "Guardar nombre"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Diálogo: generar con IA ---- */}
      {genOpen && !generating && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 animate-fade"
          onClick={(e) => e.target === e.currentTarget && setGenOpen(false)}
        >
          <div className="card w-full max-w-lg p-5 animate-pop">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <AgentAvatar />
                <div>
                  <h3 className="font-display uppercase text-brand-ink text-lg">
                    Generar flow con IA
                  </h3>
                  <p className="text-xs text-brand-slate mt-0.5 leading-relaxed">
                    Describí el flujo y el agente lo diseña completo con el documento
                    maestro como contexto.
                  </p>
                </div>
              </div>
              <button className="text-brand-slate hover:text-brand-primary text-lg leading-none"
                onClick={() => setGenOpen(false)}>
                ✕
              </button>
            </div>
            <textarea
              className="input w-full mt-3 text-sm"
              rows={3}
              maxLength={2000}
              placeholder="Ej.: Cómo implementar las mejoras del capítulo 5, con puntos de decisión y responsables…"
              value={genText}
              onChange={(e) => setGenText(e.target.value)}
            />
            <div className="flex gap-1.5 flex-wrap mt-2">
              {GEN_EXAMPLES.map((s) => (
                <button key={s}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-brand-border text-brand-slate hover:border-brand-cyan hover:text-brand-cyan transition-colors"
                  onClick={() => setGenText(s)}>
                  {s}
                </button>
              ))}
            </div>
            {genNotice && <p className="text-xs text-brand-primary-dark mt-2">{genNotice}</p>}
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-[10px] text-brand-mist">
                El consumo queda registrado en Costos IA (categoría «Flows»).
              </span>
              <button className="btn-primary !py-2 text-xs shrink-0"
                disabled={genText.trim().length < 10}
                onClick={generateFlow}>
                ✨ Generar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lista de flujos */}
      <div className="card overflow-hidden">
        <div className="p-3 border-b border-brand-border">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display uppercase text-brand-ink leading-none text-sm">⛓ Flows</h2>
            <div className="flex gap-1.5">
              <button
                className="btn !py-1.5 !px-2.5 text-xs text-white bg-gradient-to-r from-brand-purple to-brand-cyan hover:opacity-90"
                onClick={() => setGenOpen(true)}
                disabled={generating}
                title="El agente diseña el flujograma completo desde una instrucción"
              >
                ✨ Con IA
              </button>
              <button className="btn-primary !py-1.5 !px-3 text-xs" disabled={generating}
                onClick={() => setNameDialog({ mode: "create", value: "" })}>
                + Nuevo
              </button>
            </div>
          </div>
          <p className="text-[11px] text-brand-slate mt-1.5 leading-relaxed">
            Flujogramas del proyecto: procesos, decisiones y flujos de trabajo. Se
            guardan solos y se exportan a PNG.
          </p>
          {genNotice && !genOpen && (
            <p className="text-[11px] text-emerald-700 mt-1.5 leading-relaxed">{genNotice}</p>
          )}
        </div>
        <div className="max-h-[62vh] overflow-y-auto scrollbar-thin">
          {loading && <p className="p-4 text-xs text-brand-slate">Cargando…</p>}
          {!loading && flows.length === 0 && !generating && (
            <p className="p-4 text-xs text-brand-slate">
              Sin flujos todavía. Creá el primero o pedíselo al agente con «✨ Con IA».
            </p>
          )}
          {flows.map((f) => (
            <div
              key={f.id}
              role="button"
              tabIndex={0}
              onClick={() => open(f.id)}
              onKeyDown={(e) => e.key === "Enter" && open(f.id)}
              className={`group px-3.5 py-2.5 border-b border-brand-border/60 cursor-pointer transition-colors ${
                active?.id === f.id ? "bg-brand-primary-light/50" : "hover:bg-brand-bg-soft"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-bold text-brand-ink truncate">{f.name}</span>
                <div className="flex gap-0.5 shrink-0 opacity-60 group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}>
                  <span role="button" title="Renombrar"
                    className="h-6 w-6 rounded flex items-center justify-center text-[11px] text-brand-slate hover:bg-white"
                    onClick={() => setNameDialog({ mode: "rename", id: f.id, value: f.name })}>
                    ✏️
                  </span>
                  <span role="button" title={confirmDeleteId === f.id ? "Confirmá para borrar" : "Borrar"}
                    className={`h-6 rounded flex items-center justify-center text-[11px] px-1 ${
                      confirmDeleteId === f.id
                        ? "bg-brand-primary text-white font-bold"
                        : "w-6 text-brand-slate hover:bg-white"
                    }`}
                    onClick={() => deleteFlow(f)}>
                    {confirmDeleteId === f.id ? "¿Borrar?" : "🗑"}
                  </span>
                </div>
              </div>
              <div className="text-[10px] text-brand-mist mt-0.5">
                {f.nodes_count} nodos · {f.updated_by_name || f.created_by_name} ·{" "}
                {formatDate(f.updated_at)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Canvas (normal o ampliado a pantalla completa) */}
      <div
        className={
          expanded
            ? "fixed inset-2 sm:inset-4 z-40 card overflow-hidden shadow-elevated"
            : "card overflow-hidden"
        }
        style={expanded ? undefined : { height: "74vh" }}
      >
        {generating ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <AgentAvatar size="lg" active />
            <p className="font-display uppercase text-brand-ink mt-4">Diseñando el flujo</p>
            <p className="text-sm text-brand-slate mt-2 shimmer-text font-semibold">
              {GEN_PHASES[genPhase]}
            </p>
            <div className="flex gap-1.5 mt-4">
              {GEN_PHASES.map((_, i) => (
                <span key={i}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i <= genPhase ? "w-6 bg-brand-cyan" : "w-1.5 bg-brand-border"
                  }`} />
              ))}
            </div>
            <p className="text-[11px] text-brand-mist mt-4">
              El agente está leyendo el documento y armando nodos, decisiones y conexiones.
            </p>
          </div>
        ) : active ? (
          <ReactFlowProvider key={active.id}>
            <FlowCanvas
              projectId={params.id}
              flow={active}
              expanded={expanded}
              onToggleExpand={() => setExpanded((v) => !v)}
              onSaved={load}
            />
          </ReactFlowProvider>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center py-16 px-6">
            <div className="text-4xl mb-3">⛓</div>
            <p className="font-display uppercase text-brand-ink">Diseñá el flujo</p>
            <p className="text-sm text-brand-slate mt-1 max-w-md">
              Procesos de atención, rutas de escalamiento, flujos de decisión: armalos en
              el canvas o pedile al agente que diseñe el primero desde una instrucción.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                className="btn !py-2 text-sm text-white bg-gradient-to-r from-brand-purple to-brand-cyan hover:opacity-90"
                onClick={() => setGenOpen(true)}
              >
                ✨ Generar con IA
              </button>
              <button className="btn-primary" onClick={() => setNameDialog({ mode: "create", value: "" })}>
                + Crear a mano
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
