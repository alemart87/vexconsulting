"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { ProjectContext, ProjectInfo } from "@/components/ProjectContext";
import { apiFetch } from "@/lib/api";

const TABS = [
  { href: "", label: "Resumen" },
  { href: "/document", label: "Documento" },
  { href: "/preview", label: "Vista previa" },
  { href: "/sources", label: "Fuentes" },
  { href: "/notes", label: "Notas" },
  { href: "/chat", label: "Chat equipo" },
  { href: "/gantt", label: "Gantt" },
  { href: "/agent", label: "Agente IA" },
  { href: "/evaluations", label: "Evaluación" },
  { href: "/metrics", label: "Métricas" },
  { href: "/members", label: "Equipo" },
  { href: "/audit", label: "Auditoría" },
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
  const visibleTabs = TABS.filter(
    (t) => isAdmin || !["/audit", "/metrics"].includes(t.href)
  );
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

          {/* Navegación del proyecto — mobile: dropdown; desktop: pills */}
          <div className="mb-5 sm:mb-6">
            {/* Mobile: selector compacto */}
            <div className="md:hidden">
              <label className="sr-only" htmlFor="project-nav">
                Sección del proyecto
              </label>
              <div className="relative">
                <select
                  id="project-nav"
                  value={currentTab?.href ?? ""}
                  onChange={(e) => router.push(`${base}${e.target.value}`)}
                  className="w-full appearance-none rounded-lg bg-brand-ink text-white font-semibold text-sm pl-4 pr-10 py-3 focus:outline-none focus:ring-2 focus:ring-brand-primary"
                >
                  {visibleTabs.map((t) => (
                    <option key={t.href} value={t.href} className="text-brand-ink">
                      {t.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/70 text-xs">
                  ▼
                </span>
              </div>
            </div>

            {/* Desktop: barra de pills (identidad Voicenter) */}
            <nav className="hidden md:flex rounded-lg bg-brand-ink px-2 py-1.5 gap-1 overflow-x-auto scrollbar-thin">
              {visibleTabs.map((t) => (
                <Link
                  key={t.href}
                  href={`${base}${t.href}`}
                  className={`whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider2 transition-colors ${
                    isActive(t.href)
                      ? "bg-brand-primary text-white"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
          </div>

          {children}
        </ProjectContext.Provider>
      )}
    </AppShell>
  );
}
