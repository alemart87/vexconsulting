"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
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

  return (
    <AppShell>
      {error ? (
        <div className="card p-8 text-center text-brand-primary-dark">{error}</div>
      ) : (
        <ProjectContext.Provider value={{ project, reload }}>
          <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="font-display text-2xl uppercase text-brand-ink leading-none">
                {project?.name ?? "…"}
              </h1>
              <div className="mt-1 flex items-center gap-2">
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

          {/* Barra contextual del proyecto (identidad Voicenter) */}
          <nav className="rounded-lg bg-brand-ink px-2 py-1.5 mb-6 flex gap-1 overflow-x-auto">
            {visibleTabs.map((t) => {
              const href = `${base}${t.href}`;
              const active =
                t.href === "" ? pathname === base : pathname?.startsWith(href);
              return (
                <Link
                  key={t.href}
                  href={href}
                  className={`whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider2 transition-colors ${
                    active
                      ? "bg-brand-primary text-white"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>

          {children}
        </ProjectContext.Provider>
      )}
    </AppShell>
  );
}
