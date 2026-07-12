"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { ProjectContext, ProjectInfo } from "@/components/ProjectContext";
import { apiFetch } from "@/lib/api";

// El navbar se organiza en zonas con lógica de flujo de trabajo:
// producir el informe → colaborar alrededor de él → controlar calidad y equipo.
const GROUPS = [
  {
    label: "Trabajo",
    accent: "#E6332A",
    tabs: [
      { href: "", label: "Resumen" },
      { href: "/document", label: "Documento" },
      { href: "/preview", label: "Vista previa" },
      { href: "/sources", label: "Fuentes" },
      { href: "/notes", label: "Notas" },
      { href: "/gantt", label: "Gantt" },
    ],
  },
  {
    label: "Colaboración",
    accent: "#00B2BF",
    tabs: [
      { href: "/chat", label: "Chat equipo" },
      { href: "/agent", label: "Agente IA" },
      { href: "/knowhub", label: "KnowHub" },
    ],
  },
  {
    label: "Control",
    accent: "#F39200",
    tabs: [
      { href: "/evaluations", label: "Evaluación" },
      { href: "/metrics", label: "Métricas" },
      { href: "/members", label: "Equipo" },
      { href: "/audit", label: "Auditoría" },
    ],
  },
];

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState("");

  const reload = () => {
    apiFetch<ProjectInfo>(`/api/v1/projects/${params.id}`)
      .then(setProject)
      .catch((e) => setError(e.message));
  };

  useEffect(reload, [params.id]);

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

  return (
    <AppShell fluid>
      {error ? (
        <div className="card p-8 text-center text-brand-primary-dark">{error}</div>
      ) : (
        <ProjectContext.Provider value={{ project, reload }}>
          <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="font-display text-xl sm:text-2xl uppercase text-brand-ink leading-none truncate">
                {project?.name ?? "…"}
              </h1>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <span
                  className={
                    project?.status === "publicado" ? "badge-success" : "badge-neutral"
                  }
                >
                  {project?.status ?? ""}
                </span>
                {project?.my_permission && (
                  <span className="badge-cyan">permiso: {project.my_permission}</span>
                )}
              </div>
            </div>
          </div>

          {/* Navegación del proyecto — sticky bajo el header; mobile: dropdown; desktop: pills */}
          <div className="sticky top-16 z-30 -mx-4 px-4 pt-1 pb-3 mb-4 bg-brand-bg/95 backdrop-blur-sm border-b border-brand-border/60">
            {/* Mobile: selector claro y legible */}
            <div className="md:hidden">
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
                    <optgroup key={g.label} label={`Zona de ${g.label.toLowerCase()}`}>
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

            {/* Desktop: barra de pills (identidad Voicenter) */}
            <nav className="hidden md:flex rounded-xl glass-ink px-2 py-1 overflow-x-auto scrollbar-thin items-stretch">
              {visibleGroups.map((g, gi) => (
                <div
                  key={g.label}
                  className={`flex flex-col justify-center px-1.5 ${
                    gi > 0 ? "border-l border-white/15 ml-1.5" : ""
                  }`}
                >
                  <span className="px-2 pt-0.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] leading-none select-none">
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ background: g.accent, boxShadow: `0 0 6px ${g.accent}` }}
                    />
                    <span style={{ color: g.accent, filter: "brightness(1.6) saturate(0.7)" }}>
                      {g.label}
                    </span>
                  </span>
                  <div className="flex gap-1 pt-0.5 pb-0.5">
                    {g.tabs.map((t) => (
                      <Link
                        key={t.href}
                        href={`${base}${t.href}`}
                        data-tour={`tab-${t.href.replace("/", "") || "resumen"}`}
                        className={`whitespace-nowrap px-3 py-1 rounded-md text-xs font-semibold uppercase tracking-wider2 transition-colors ${
                          isActive(t.href)
                            ? "pill-liquid text-white"
                            : "text-white/70 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        {t.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </div>

          {children}
        </ProjectContext.Provider>
      )}
    </AppShell>
  );
}
