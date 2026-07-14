"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { apiFetch, formatDate, getUser } from "@/lib/api";

interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  owner_name?: string;
  my_permission?: string;
  member_count?: number;
  word_count?: number;
  updated_at: string;
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const user = typeof window !== "undefined" ? getUser() : null;
  const isLider =
    user?.role === "consultor_lider" ||
    user?.role === "consultor_lider_2" ||
    user?.role === "superadmin";

  useEffect(() => {
    apiFetch<Project[]>("/api/v1/projects")
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl uppercase text-brand-ink">Proyectos</h1>
          <p className="text-sm text-brand-slate">
            {user?.role === "superadmin"
              ? "Todos los proyectos de la plataforma."
              : "Proyectos en los que participás."}
          </p>
        </div>
        {isLider && (
          <Link href="/projects/new" className="btn-primary" data-tour="nuevo-proyecto">
            + Nuevo proyecto
          </Link>
        )}
      </div>

      {loading ? (
        <div className="card p-10 text-center text-brand-slate">Cargando…</div>
      ) : projects.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-brand-slate mb-4">Todavía no hay proyectos.</p>
          {isLider && (
            <Link href="/projects/new" className="btn-primary">
              Crear el primero
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="card p-5 hover:shadow-elevated transition-shadow animate-pop"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">
                  {p.name}
                </h2>
                <span className={p.status === "publicado" ? "badge-success" : "badge-neutral"}>
                  {p.status}
                </span>
              </div>
              {p.description && (
                <p className="text-sm text-brand-slate line-clamp-2 mb-3">{p.description}</p>
              )}
              <div className="flex items-center gap-4 text-xs text-brand-slate">
                <span>{p.member_count ?? 0} miembros</span>
                <span>{(p.word_count ?? 0).toLocaleString("es-PY")} palabras</span>
              </div>
              <div className="mt-2 text-[11px] text-brand-mist">
                Actualizado {formatDate(p.updated_at)}
                {p.owner_name ? ` · Líder: ${p.owner_name}` : ""}
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
