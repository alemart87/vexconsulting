"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Brand from "@/components/Brand";
import { apiFetch, clearSession, formatDate, getToken, getUser } from "@/lib/api";

interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  published_at?: string;
}

export default function ViewerHome() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    apiFetch<Project[]>("/api/v1/projects")
      .then((list) => {
        const published = list.filter((p) => p.status === "publicado");
        if (published.length === 1) router.replace(`/view/${published[0].id}`);
        else setProjects(published);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-brand-border">
        <div className="mx-auto max-w-4xl px-4 h-16 flex items-center justify-between">
          <Brand />
          <button
            className="btn-ghost text-xs"
            onClick={() => {
              clearSession();
              router.push("/login");
            }}
          >
            Salir
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="font-display text-3xl uppercase text-brand-ink mb-6">
          Informes publicados
        </h1>
        {loading ? (
          <div className="card p-10 text-center text-brand-slate">Cargando…</div>
        ) : projects.length === 0 ? (
          <div className="card p-10 text-center text-brand-slate">
            Todavía no tenés informes publicados asignados.
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((p) => (
              <Link key={p.id} href={`/view/${p.id}`} className="card p-5 block hover:shadow-elevated transition-shadow">
                <div className="font-display text-xl uppercase text-brand-ink">{p.name}</div>
                {p.description && <p className="text-sm text-brand-slate mt-1">{p.description}</p>}
                <div className="text-xs text-brand-mist mt-2">
                  Publicado {formatDate(p.published_at)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
