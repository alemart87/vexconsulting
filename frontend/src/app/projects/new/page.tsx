"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

const TEMPLATES = [
  {
    slug: "metodo_cientifico_bpo",
    label: "Investigación de mercado BPO",
    desc: "Estructura completa con método científico: problema → hipótesis → fuentes → evidencia → síntesis → conclusiones. Incluye Gantt y notas semilla.",
  },
  {
    slug: "estudio_mercado_general",
    label: "Estudio de mercado general",
    desc: "La misma estructura metodológica, sin especialización sectorial.",
  },
  {
    slug: "blank",
    label: "Documento en blanco",
    desc: "Empezar desde cero, sin estructura predefinida.",
  },
];

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("metodo_cientifico_bpo");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const project = await apiFetch<any>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({ name, description, template_slug: template }),
      });
      router.push(`/projects/${project.id}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <h1 className="font-display text-3xl uppercase text-brand-ink mb-6">Nuevo proyecto</h1>
      <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
        <div className="card p-6 space-y-4">
          <div>
            <label className="label">Nombre del proyecto</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej.: Estudio de tarifas BPO sector financiero"
              required
              minLength={3}
            />
          </div>
          <div>
            <label className="label">Descripción (opcional)</label>
            <textarea
              className="input min-h-[80px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Objetivo y alcance de la investigación…"
            />
          </div>
        </div>

        <div>
          <label className="label">Plantilla metodológica</label>
          <div className="grid gap-3 sm:grid-cols-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.slug}
                type="button"
                onClick={() => setTemplate(t.slug)}
                className={`card p-4 text-left transition-all ${
                  template === t.slug
                    ? "border-brand-primary shadow-focus"
                    : "hover:border-brand-mist"
                }`}
              >
                <div className="font-semibold text-sm text-brand-ink mb-1">{t.label}</div>
                <div className="text-xs text-brand-slate leading-relaxed">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-brand-primary-light text-brand-primary-dark text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Creando…" : "Crear proyecto"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => router.back()}>
            Cancelar
          </button>
        </div>
      </form>
    </AppShell>
  );
}
