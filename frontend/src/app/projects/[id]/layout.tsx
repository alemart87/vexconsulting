"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { ProjectContext, ProjectInfo } from "@/components/ProjectContext";
import { apiFetch } from "@/lib/api";

// La navegación se organiza en zonas con lógica de flujo de trabajo:
// producir el informe → colaborar alrededor de él → controlar calidad y equipo.
// En desktop es una barra LATERAL (escala en vertical: sumar secciones nunca
// vuelve a generar scroll horizontal); en mobile/tablet, un selector.
const GROUPS = [
  {
    label: "Trabajo",
    accent: "#E6332A",
    tabs: [
      { href: "", label: "Resumen", icon: "📊" },
      { href: "/document", label: "Documento", icon: "📄" },
      { href: "/preview", label: "Vista previa", icon: "👁️" },
      { href: "/sources", label: "Fuentes", icon: "🗂️" },
      { href: "/notes", label: "Notas", icon: "🗒️" },
      { href: "/gantt", label: "Gantt", icon: "📅" },
    ],
  },
  {
    label: "Vex Cowork",
    accent: "#00B2BF",
    tabs: [
      { href: "/chat", label: "Chat equipo", icon: "💬" },
      { href: "/meet", label: "Vex Meet", icon: "🤝" },
      { href: "/flows", label: "Flows", icon: "🔀" },
      { href: "/agent", label: "Agente Cowork", icon: "🧠" },
      { href: "/knowhub", label: "KnowHub", icon: "🎧" },
    ],
  },
  {
    label: "Control",
    accent: "#F39200",
    tabs: [
      { href: "/evaluations", label: "Evaluación", icon: "⚖️" },
      { href: "/metrics", label: "Métricas", icon: "📈" },
      { href: "/members", label: "Equipo", icon: "👥" },
      { href: "/audit", label: "Auditoría", icon: "🔍" },
    ],
  },
];

const RAIL_KEY = "vex_nav_rail_v1";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState("");
  // Contraído = solo iconos (más lienzo para Documento/Flows). Persiste.
  const [collapsed, setCollapsed] = useState(false);
  // Proyectos que se vincularon a ESTE (ej.: materiales de un plan de curso)
  const [linkedChildren, setLinkedChildren] = useState<{ id: string; name: string }[]>([]);

  const reload = () => {
    apiFetch<ProjectInfo>(`/api/v1/projects/${params.id}`)
      .then(setProject)
      .catch((e) => setError(e.message));
  };

  useEffect(reload, [params.id]);

  useEffect(() => {
    setCollapsed(localStorage.getItem(RAIL_KEY) === "1");
  }, []);

  const toggleRail = () => {
    setCollapsed((v) => {
      localStorage.setItem(RAIL_KEY, v ? "0" : "1");
      return !v;
    });
  };

  useEffect(() => {
    apiFetch<any[]>("/api/v1/projects")
      .then((list) =>
        setLinkedChildren(
          list
            .filter((p) => p.related_project_id === params.id)
            .map((p) => ({ id: p.id, name: p.name }))
        )
      )
      .catch(() => {});
  }, [params.id]);

  const base = `/projects/${params.id}`;
  const isAdmin = project?.my_permission === "admin";
  const visibleGroups = GROUPS.map((g) => ({
    ...g,
    tabs: g.tabs.filter((t) => isAdmin || !["/audit", "/metrics"].includes(t.href)),
  })).filter((g) => g.tabs.length > 0);
  const visibleTabs = visibleGroups.flatMap((g) => g.tabs);
  const isActive = (href: string) =>
    href === "" ? pathname === base : pathname?.startsWith(`${base}${href}`);
  const currentTab = visibleTabs.find((t) => isActive(t.href)) ?? visibleTabs[0];

  const statusBadges = (
    <>
      <span
        className={project?.status === "publicado" ? "badge-success" : "badge-neutral"}
      >
        {project?.status ?? ""}
      </span>
      {project?.my_permission && (
        <span className="badge-cyan">permiso: {project.my_permission}</span>
      )}
      {project?.related_project_id && (
        <Link
          href={`/projects/${project.related_project_id}`}
          className="badge bg-brand-purple/10 text-brand-purple hover:bg-brand-purple hover:text-white transition-colors"
          title="Plan vinculado a este material (cargado como fuente)"
        >
          🔗 plan: {project.related_project_name ?? "proyecto vinculado"}
        </Link>
      )}
      {linkedChildren.map((c) => (
        <Link
          key={c.id}
          href={`/projects/${c.id}`}
          className="badge bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan hover:text-white transition-colors"
          title="Material del curso creado a partir de este plan"
        >
          📚 material: {c.name}
        </Link>
      ))}
    </>
  );

  return (
    <AppShell fluid>
      {error ? (
        <div className="card p-8 text-center text-brand-primary-dark">{error}</div>
      ) : (
        <ProjectContext.Provider value={{ project, reload }}>
          {/* ===== Mobile / tablet (< lg): título compacto + selector ===== */}
          <div className="lg:hidden">
            <div className="mb-2 min-w-0">
              <h1 className="font-display text-xl uppercase text-brand-ink leading-none truncate">
                {project?.name ?? "…"}
              </h1>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">{statusBadges}</div>
            </div>
            <div className="sticky top-16 z-30 -mx-4 px-4 pt-1 pb-3 mb-4 bg-brand-bg/95 backdrop-blur-sm border-b border-brand-border/60">
              <label className="sr-only" htmlFor="project-nav">
                Sección del proyecto
              </label>
              <div className="relative">
                <select
                  id="project-nav"
                  value={currentTab?.href ?? ""}
                  onChange={(e) => router.push(`${base}${e.target.value}`)}
                  style={{ colorScheme: "light" }}
                  className="w-full appearance-none rounded-lg bg-white text-brand-ink font-semibold text-sm border-l-4 border-l-brand-primary border border-brand-border shadow-soft pl-4 pr-10 py-3 focus:outline-none focus:ring-2 focus:ring-brand-primary"
                >
                  {visibleGroups.map((g) => (
                    <optgroup
                      key={g.label}
                      label={g.label === "Vex Cowork" ? g.label : `Zona de ${g.label.toLowerCase()}`}
                    >
                      {g.tabs.map((t) => (
                        <option
                          key={t.href}
                          value={t.href}
                          style={{ background: "#fff", color: "#0F1116" }}
                        >
                          {t.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-brand-primary text-xs">
                  ▼
                </span>
              </div>
            </div>
          </div>

          {/* ===== Desktop (lg+): barra lateral + contenido ===== */}
          <div className="lg:flex lg:items-start lg:gap-5">
            <aside
              className={`hidden lg:flex flex-col shrink-0 sticky top-20 self-start max-h-[calc(100vh-5.5rem)] transition-[width] duration-200 ${
                collapsed ? "w-[66px]" : "w-60"
              }`}
            >
              <div className="rounded-2xl glass-ink flex flex-col min-h-0 overflow-hidden">
                {/* Identidad del proyecto — el título vive acá y libera lo de arriba */}
                {collapsed ? (
                  <div
                    className="mx-auto mt-3 mb-1 h-9 w-9 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center font-display text-white text-lg uppercase select-none"
                    title={project?.name ?? ""}
                  >
                    {(project?.name ?? "·").slice(0, 1)}
                  </div>
                ) : (
                  <div className="px-4 pt-3.5 pb-3 border-b border-white/10">
                    <h1
                      className="font-display text-lg uppercase text-white leading-tight line-clamp-2"
                      title={project?.name ?? ""}
                    >
                      {project?.name ?? "…"}
                    </h1>
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">{statusBadges}</div>
                  </div>
                )}

                <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-2 py-2">
                  {visibleGroups.map((g, gi) => (
                    <div key={g.label} className={gi > 0 ? "mt-3 pt-3 border-t border-white/10" : ""}>
                      <div
                        className={`flex items-center gap-1.5 select-none ${
                          collapsed ? "justify-center pb-1.5" : "px-2 pb-1.5"
                        }`}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ background: g.accent, boxShadow: `0 0 6px ${g.accent}` }}
                        />
                        {!collapsed && (
                          <span
                            className="text-[9px] font-bold uppercase tracking-[0.2em] leading-none"
                            style={{ color: g.accent, filter: "brightness(1.6) saturate(0.7)" }}
                          >
                            {g.label}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {g.tabs.map((t) => (
                          <Link
                            key={t.href}
                            href={`${base}${t.href}`}
                            data-tour={`tab-${t.href.replace("/", "") || "resumen"}`}
                            title={collapsed ? t.label : undefined}
                            className={`flex items-center gap-2.5 rounded-lg text-xs font-semibold uppercase tracking-wider2 transition-colors ${
                              collapsed ? "justify-center px-0 py-2" : "px-2.5 py-1.5"
                            } ${
                              isActive(t.href)
                                ? "pill-liquid text-white"
                                : "text-white/70 hover:text-white hover:bg-white/10"
                            }`}
                          >
                            <span className="text-sm leading-none w-4 text-center shrink-0" aria-hidden>
                              {t.icon}
                            </span>
                            {!collapsed && <span className="truncate">{t.label}</span>}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </nav>

                <button
                  onClick={toggleRail}
                  className="border-t border-white/10 px-2 py-2 text-[10px] font-bold uppercase tracking-wider2 text-white/50 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5"
                  title={collapsed ? "Expandir menú" : "Contraer menú (solo iconos)"}
                >
                  <span aria-hidden>{collapsed ? "»" : "«"}</span>
                  {!collapsed && <span>Contraer</span>}
                </button>
              </div>
            </aside>

            <div className="flex-1 min-w-0">{children}</div>
          </div>
        </ProjectContext.Provider>
      )}
    </AppShell>
  );
}
