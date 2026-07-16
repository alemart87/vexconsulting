"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { ProjectContext, ProjectInfo } from "@/components/ProjectContext";
import { apiFetch } from "@/lib/api";

// El chat del agente (con react-markdown) solo se descarga al abrir el dock
const CoworkAgent = dynamic(() => import("@/components/CoworkAgent"), { ssr: false });

// Iconos corporativos de línea (estilo Lucide, MIT): trazo fino monocromo
// que hereda el color del texto — el lenguaje visual de los productos pro.
const NAV_ICONS: Record<string, React.ReactNode> = {
  resumen: (
    <>
      <path d="M3 3v18h18" />
      <path d="M8 17v-3" />
      <path d="M13 17V7" />
      <path d="M18 17v-6" />
    </>
  ),
  documento: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>
  ),
  preview: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  fuentes: (
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  ),
  notas: (
    <>
      <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11l5-5V5a2 2 0 0 0-2-2Z" />
      <path d="M15 21v-4a2 2 0 0 1 2-2h4" />
    </>
  ),
  gantt: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18" />
      <path d="M7 13h5" />
      <path d="M10 17h7" />
    </>
  ),
  chat: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
  meet: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 9h18" />
      <path d="m9 15.5 2 2 4-4" />
    </>
  ),
  flows: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4" />
      <path d="m15.4 6.5-6.8 4" />
    </>
  ),
  agente: (
    <path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3Z" />
  ),
  knowhub: (
    <>
      <path d="M3 18v-4a9 9 0 0 1 18 0v4" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </>
  ),
  evaluacion: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  metricas: (
    <>
      <path d="M22 7l-8.5 8.5-5-5L2 17" />
      <path d="M16 7h6v6" />
    </>
  ),
  equipo: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  auditoria: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
};

function NavIcon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} shrink-0`}
      aria-hidden
    >
      {NAV_ICONS[name]}
    </svg>
  );
}

// La navegación se organiza en zonas con lógica de flujo de trabajo:
// producir el informe → colaborar alrededor de él → controlar calidad y equipo.
// En desktop es una barra LATERAL (escala en vertical: sumar secciones nunca
// vuelve a generar scroll horizontal); en mobile/tablet, un selector.
const GROUPS = [
  {
    label: "Trabajo",
    accent: "#E6332A",
    tabs: [
      { href: "", label: "Resumen", icon: "resumen" },
      { href: "/document", label: "Documento", icon: "documento" },
      { href: "/preview", label: "Vista previa", icon: "preview" },
      { href: "/sources", label: "Fuentes", icon: "fuentes" },
      { href: "/notes", label: "Notas", icon: "notas" },
      { href: "/gantt", label: "Gantt", icon: "gantt" },
    ],
  },
  {
    label: "Vex Cowork",
    accent: "#00B2BF",
    tabs: [
      { href: "/chat", label: "Chat equipo", icon: "chat" },
      { href: "/meet", label: "Vex Meet", icon: "meet" },
      { href: "/flows", label: "Flows", icon: "flows" },
      { href: "/agent", label: "Agente Cowork", icon: "agente" },
      { href: "/knowhub", label: "KnowHub", icon: "knowhub" },
    ],
  },
  {
    label: "Control",
    accent: "#F39200",
    tabs: [
      { href: "/evaluations", label: "Evaluación", icon: "evaluacion" },
      { href: "/metrics", label: "Métricas", icon: "metricas" },
      { href: "/members", label: "Equipo", icon: "equipo" },
      { href: "/audit", label: "Auditoría", icon: "auditoria" },
    ],
  },
];

const NAV_KEY = "vex_topnav_v1";
const DOCK_KEY = "vex_agent_dock_v1";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState("");
  // Pestañas del proyecto ocultas = contenido a pantalla completa. Persiste.
  const [navHidden, setNavHidden] = useState(false);
  // Dock del Agente Cowork: panel lateral derecho plegable (patrón copilot).
  const [dockOpen, setDockOpen] = useState(false);
  // Proyectos que se vincularon a ESTE (ej.: materiales de un plan de curso)
  const [linkedChildren, setLinkedChildren] = useState<{ id: string; name: string }[]>([]);

  const reload = () => {
    apiFetch<ProjectInfo>(`/api/v1/projects/${params.id}`)
      .then(setProject)
      .catch((e) => setError(e.message));
  };

  useEffect(reload, [params.id]);

  useEffect(() => {
    setNavHidden(localStorage.getItem(NAV_KEY) === "1");
    setDockOpen(localStorage.getItem(DOCK_KEY) === "1");
  }, []);

  const toggleNav = () => {
    setNavHidden((v) => {
      localStorage.setItem(NAV_KEY, v ? "0" : "1");
      return !v;
    });
  };

  // Si arranca la visita guiada con las pestañas ocultas, se muestran solas
  // (la guía las recorre una por una).
  useEffect(() => {
    const show = () => {
      setNavHidden(false);
      localStorage.setItem(NAV_KEY, "0");
    };
    window.addEventListener("vex:tour-project", show);
    return () => window.removeEventListener("vex:tour-project", show);
  }, []);

  const toggleDock = () => {
    setDockOpen((v) => {
      localStorage.setItem(DOCK_KEY, v ? "0" : "1");
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
  // El dock del agente sobra en /agent (sería el chat duplicado) y en el
  // Documento (ahí ya viven el Investigador y el Chat del proyecto — dos
  // paneles IA a la vez molestan visualmente).
  const onAgentPage =
    !!pathname &&
    (pathname.startsWith(`${base}/agent`) || pathname.startsWith(`${base}/document`));
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
          {/* ===== UNA sola navegación, ARRIBA (patrón GitHub): identidad del
               proyecto + pestañas en una tarjeta bajo el header global.
               «Ocultar» pliega las pestañas para dar toda la pantalla al
               contenido. Sin scroll horizontal jamás: si no entran, las
               pestañas bajan de línea (wrap). ===== */}
          <div className="card px-4 pt-2.5 pb-0 mb-5">
            <div className="flex items-center justify-between gap-3 pb-2.5 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                <h1
                  className="font-display text-lg sm:text-xl uppercase text-brand-ink leading-none truncate max-w-[46vw]"
                  title={project?.name ?? ""}
                >
                  {project?.name ?? "…"}
                </h1>
                <div className="flex items-center gap-1.5 flex-wrap">{statusBadges}</div>
              </div>
              <button
                onClick={toggleNav}
                className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-brand-border px-3 py-1 text-[11px] font-semibold text-brand-slate hover:border-brand-ink hover:text-brand-ink transition-colors shrink-0"
                title={
                  navHidden
                    ? "Mostrar las secciones del proyecto"
                    : "Ocultar las secciones para trabajar a pantalla completa"
                }
              >
                {navHidden ? `⌄ Secciones · ${currentTab?.label ?? ""}` : "⌃ Ocultar"}
              </button>
            </div>

            {!navHidden && (
              /* Tres bloques de zona, cada uno con su rótulo ARRIBA y sus
                 pestañas debajo — nada mezclado en una línea: estructura
                 clara, alineada y con aire. Si no entran, el bloque entero
                 baja de línea manteniendo la alineación. */
              <nav className="hidden md:flex items-start gap-x-5 gap-y-3 flex-wrap border-t border-brand-border/70 py-2.5">
                {visibleGroups.map((g) => (
                  <div key={g.label} className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1.5 pl-1 select-none">
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ background: g.accent }}
                      />
                      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-brand-slate leading-none">
                        {g.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {g.tabs.map((t) => (
                        <Link
                          key={t.href}
                          href={`${base}${t.href}`}
                          data-tour={`tab-${t.href.replace("/", "") || "resumen"}`}
                          className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap transition-colors ${
                            isActive(t.href)
                              ? "bg-brand-primary text-white shadow-soft"
                              : "text-brand-graphite hover:bg-brand-bg hover:text-brand-ink"
                          }`}
                        >
                          <NavIcon name={t.icon} className="h-3.5 w-3.5" />
                          {t.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </nav>
            )}

            {/* Mobile: selector compacto (siempre visible) */}
            <div className="md:hidden pb-2.5">
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

          <div className="lg:flex lg:items-start lg:gap-5">
            <div className="flex-1 min-w-0">{children}</div>

            {/* ===== Dock del Agente Cowork (lg+): panel derecho plegable.
                 Patrón copilot: el agente al lado del trabajo — se conversa
                 sobre el documento mientras se mira el Gantt o un flow. ===== */}
            {!onAgentPage && dockOpen && (
              <aside className="hidden lg:flex flex-col shrink-0 sticky top-20 self-start h-[calc(100vh-5.5rem)] w-[400px] xl:w-[440px]">
                <div className="card shadow-elevated flex flex-col h-full min-h-0 overflow-hidden">
                  <CoworkAgent dock onClose={toggleDock} />
                </div>
              </aside>
            )}
          </div>

          {/* Pestaña flotante para abrir el dock (solo desktop, plegado) */}
          {!onAgentPage && !dockOpen && (
            <button
              onClick={toggleDock}
              title="Abrir el Agente Cowork — conversá sobre el documento sin salir de esta sección"
              className="hidden lg:flex fixed right-0 top-1/2 -translate-y-1/2 z-30 flex-col items-center gap-2 rounded-l-2xl bg-white border border-r-0 border-brand-border shadow-elevated px-2 py-3.5 hover:pr-3.5 transition-all group"
            >
              <span className="relative h-8 w-8 rounded-full" aria-hidden>
                <span className="absolute inset-0 rounded-full" style={{ background: "#E6332A" }} />
                <span className="absolute inset-[2.5px] rounded-full bg-white shadow-soft flex items-center justify-center">
                  <span className="font-black text-[14px] select-none" style={{ color: "#E6332A" }}>
                    V
                  </span>
                </span>
              </span>
              <span
                className="text-[9px] font-bold uppercase tracking-[0.18em] text-brand-slate group-hover:text-brand-ink"
                style={{ writingMode: "vertical-rl" }}
              >
                Agente
              </span>
            </button>
          )}
        </ProjectContext.Provider>
      )}
    </AppShell>
  );
}
