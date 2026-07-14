"use client";

/** Vex Flows (zona Vex Cowork): canvas de flujogramas estilo Lucidchart.
 *
 *  Construido con React Flow (MIT). Formas clásicas de flujo con identidad
 *  Voicenter: inicio/fin (píldora), proceso (rectángulo), decisión (rombo),
 *  dato (paralelogramo) y nota. Autosave al Postgres del proyecto y export
 *  a PNG para pegar en el documento o compartir.
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

/* ---------- Nodos con identidad de marca ---------- */

const handles = (
  <>
    <Handle type="target" position={Position.Top} id="t" />
    <Handle type="target" position={Position.Left} id="l" />
    <Handle type="source" position={Position.Bottom} id="b" />
    <Handle type="source" position={Position.Right} id="r" />
  </>
);

function ProcesoNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`px-4 py-2.5 rounded-md bg-white border-2 text-[12px] font-semibold text-brand-ink min-w-[120px] text-center shadow-soft ${
        selected ? "border-brand-cyan" : "border-brand-ink/70"
      }`}
    >
      {String(data.label || "Proceso")}
      {handles}
    </div>
  );
}

function DecisionNode({ data, selected }: NodeProps) {
  return (
    <div className="relative h-[92px] w-[130px]">
      <div
        className={`absolute inset-0 bg-white border-2 shadow-soft ${
          selected ? "border-brand-cyan" : "border-brand-orange"
        }`}
        style={{ transform: "rotate(45deg)", borderRadius: 8 }}
      />
      <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] font-bold text-brand-ink leading-tight">
        {String(data.label || "¿Decisión?")}
      </div>
      {handles}
    </div>
  );
}

function InicioNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`px-5 py-2 rounded-full text-white text-[12px] font-bold min-w-[100px] text-center shadow-soft border-2 ${
        selected ? "border-brand-ink" : "border-transparent"
      }`}
      style={{ background: "#00B2BF" }}
    >
      {String(data.label || "Inicio")}
      {handles}
    </div>
  );
}

function FinNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`px-5 py-2 rounded-full text-white text-[12px] font-bold min-w-[100px] text-center shadow-soft border-2 ${
        selected ? "border-brand-ink" : "border-transparent"
      }`}
      style={{ background: "#E6332A" }}
    >
      {String(data.label || "Fin")}
      {handles}
    </div>
  );
}

function DatoNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`px-6 py-2.5 bg-white border-2 text-[12px] font-semibold text-brand-ink min-w-[120px] text-center shadow-soft ${
        selected ? "border-brand-cyan" : "border-brand-purple"
      }`}
      style={{ transform: "skewX(-12deg)", borderRadius: 4 }}
    >
      <span style={{ display: "inline-block", transform: "skewX(12deg)" }}>
        {String(data.label || "Datos")}
      </span>
      {handles}
    </div>
  );
}

function NotaNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`px-3.5 py-2.5 text-[11px] text-brand-graphite max-w-[220px] whitespace-pre-wrap shadow-soft border ${
        selected ? "border-brand-cyan" : "border-amber-300"
      }`}
      style={{ background: "#FEF3C7", borderRadius: "2px 14px 2px 2px" }}
    >
      {String(data.label || "Nota…")}
      {handles}
    </div>
  );
}

const NODE_TYPES = {
  inicio: InicioNode,
  proceso: ProcesoNode,
  decision: DecisionNode,
  dato: DatoNode,
  fin: FinNode,
  nota: NotaNode,
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
  markerEnd: { type: MarkerType.ArrowClosed, color: "#5B6275" },
  style: { stroke: "#5B6275", strokeWidth: 1.6 },
};

/* ---------- Canvas ---------- */

function FlowCanvas({
  projectId,
  flow,
  onSaved,
}: {
  projectId: string;
  flow: { id: string; name: string; data: any };
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
      {
        id: crypto.randomUUID(),
        type,
        position: pos,
        data: { label: defaults[type] },
        selected: false,
      },
    ]);
    scheduleSave();
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
    const el = wrapperRef.current?.querySelector<HTMLElement>(".react-flow__viewport");
    if (!el || !nodes.length) return;
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
          className="input !py-1.5 text-xs flex-1 min-w-[140px] max-w-[280px]"
          placeholder={selected ? "Etiqueta de lo seleccionado…" : "Seleccioná un nodo o flecha para etiquetar"}
          value={selectedLabel}
          disabled={!selected}
          onChange={(e) => updateLabel(e.target.value)}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-brand-mist tabular-nums">
            {saveState === "saving" ? "Guardando…" : saveState === "dirty" ? "Cambios sin guardar" : "✓ Guardado"}
          </span>
          <button className="btn-ghost !py-1.5 text-xs" onClick={exportPng} title="Descargar el diagrama como imagen">
            ⬇ PNG
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
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#C9CEDA" />
          <Controls position="bottom-left" />
          <MiniMap pannable zoomable className="!bg-brand-bg" />
        </ReactFlow>
      </div>
      <div className="px-3 py-1.5 border-t border-brand-border text-[10px] text-brand-mist">
        Arrastrá desde los puntos de un nodo para conectar · seleccioná y escribí para etiquetar ·
        Supr borra lo seleccionado · el guardado es automático
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

  const createFlow = async () => {
    const name = prompt("Nombre del flujo (ej.: Proceso de atención de reclamos)");
    if (!name || name.trim().length < 2) return;
    const f = await apiFetch<any>(`/api/v1/projects/${params.id}/flows`, {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    });
    await load();
    setActive({ id: f.id, name: f.name, data: f.data });
  };

  const renameFlow = async (f: FlowSummary) => {
    const name = prompt("Nuevo nombre del flujo", f.name);
    if (!name || name.trim().length < 2) return;
    await apiFetch(`/api/v1/projects/${params.id}/flows/${f.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: name.trim() }),
    });
    if (active?.id === f.id) setActive((a) => (a ? { ...a, name: name.trim() } : a));
    load();
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
      if (list.length && !active) open(list[0].id).catch(() => {});
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="grid lg:grid-cols-[280px_1fr] gap-4 items-start">
      {/* Lista de flujos */}
      <div className="card overflow-hidden">
        <div className="p-3 border-b border-brand-border">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display uppercase text-brand-ink leading-none text-sm">⛓ Flows</h2>
            <button className="btn-primary !py-1.5 !px-3 text-xs" onClick={createFlow}>
              + Nuevo
            </button>
          </div>
          <p className="text-[11px] text-brand-slate mt-1.5 leading-relaxed">
            Flujogramas del proyecto: procesos, decisiones y flujos de trabajo. Se
            guardan solos y se exportan a PNG.
          </p>
        </div>
        <div className="max-h-[62vh] overflow-y-auto scrollbar-thin">
          {loading && <p className="p-4 text-xs text-brand-slate">Cargando…</p>}
          {!loading && flows.length === 0 && (
            <p className="p-4 text-xs text-brand-slate">
              Sin flujos todavía. Creá el primero y diseñá el proceso en el canvas.
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
                <div
                  className="flex gap-0.5 shrink-0 opacity-60 group-hover:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span role="button" title="Renombrar"
                    className="h-6 w-6 rounded flex items-center justify-center text-[11px] text-brand-slate hover:bg-white"
                    onClick={() => renameFlow(f)}>
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

      {/* Canvas */}
      <div className="card overflow-hidden" style={{ height: "74vh" }}>
        {active ? (
          <ReactFlowProvider key={active.id}>
            <FlowCanvas projectId={params.id} flow={active} onSaved={load} />
          </ReactFlowProvider>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="text-4xl mb-3">⛓</div>
            <p className="font-display uppercase text-brand-ink">Diseñá el flujo</p>
            <p className="text-sm text-brand-slate mt-1 max-w-md">
              Procesos de atención, rutas de escalamiento, flujos de decisión: armalos
              en el canvas con las formas clásicas de flujograma y compartilos con el
              equipo. Todo queda guardado en el proyecto.
            </p>
            <button className="btn-primary mt-4" onClick={createFlow}>
              + Crear el primer flujo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
