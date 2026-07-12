"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

interface Template {
  slug: string;
  label: string;
  desc: string;
  includes: string[];
  agent: string;
  placeholder: string;
}
interface Category {
  key: string;
  label: string;
  hint: string;
  icon: string;
  accent: string;
  templates: Template[];
}

const CATEGORIES: Category[] = [
  {
    key: "investigacion",
    label: "Investigación",
    hint: "Estudios de mercado con método científico",
    icon: "🔬",
    accent: "#E6332A",
    templates: [
      {
        slug: "metodo_cientifico_bpo",
        label: "Investigación de mercado BPO",
        desc: "Método científico completo: problema → hipótesis → fuentes → evidencia → síntesis → conclusiones.",
        includes: ["Documento estructurado", "Gantt · 5 tareas", "Notas semilla"],
        agent: "Consultor experto en BPO",
        placeholder: "Ej.: Estudio de tarifas BPO sector financiero",
      },
      {
        slug: "estudio_mercado_general",
        label: "Estudio de mercado general",
        desc: "La misma estructura metodológica, sin especialización sectorial. Para cualquier industria.",
        includes: ["Documento estructurado", "Gantt · 4 tareas"],
        agent: "Investigador de mercado",
        placeholder: "Ej.: Estudio del mercado asegurador paraguayo",
      },
    ],
  },
  {
    key: "consultoria",
    label: "Consultoría",
    hint: "Encargos para clientes con entregable final",
    icon: "🤝",
    accent: "#662483",
    templates: [
      {
        slug: "consultoria_clientes",
        label: "Consultoría a clientes (BPO)",
        desc: "Ficha del encargo, relevamiento con preguntas guía por dimensión, diagnóstico, benchmarks, modelo económico y recomendaciones accionables.",
        includes: ["Documento estructurado", "Gantt · 7 tareas", "Notas semilla · 5"],
        agent: "Consultor experto en BPO",
        placeholder: "Ej.: Consultoría de atención al cliente — Banco XYZ",
      },
    ],
  },
  {
    key: "capacitacion",
    label: "Capacitación",
    hint: "Cursos y programas de formación de equipos",
    icon: "🎓",
    accent: "#00B2BF",
    templates: [
      {
        slug: "capacitacion_curso",
        label: "Plan de capacitación",
        desc: "El diseño del curso: necesidad del negocio, objetivos de aprendizaje medibles, malla curricular por módulos, evaluación con certificación y medición de impacto (Kirkpatrick).",
        includes: ["Documento estructurado", "Gantt · 8 tareas", "Notas semilla · 5"],
        agent: "Diseñador instruccional",
        placeholder: "Ej.: Onboarding de agentes — campaña cobranzas",
      },
      {
        slug: "capacitacion_contenido",
        label: "Material del curso (contenido)",
        desc: "El curso en sí, módulo por módulo: contenido desarrollado, actividades prácticas, guion del instructor, quices con respuestas y material del participante. Se vincula a su plan, que entra como fuente para que el agente redacte citándolo.",
        includes: ["Documento por módulos", "Gantt · 7 tareas", "Vínculo al plan"],
        agent: "Diseñador instruccional",
        placeholder: "Ej.: Material — Onboarding de agentes cobranzas",
      },
    ],
  },
  {
    key: "libre",
    label: "Desde cero",
    hint: "Sin estructura predefinida",
    icon: "📄",
    accent: "#5B6275",
    templates: [
      {
        slug: "blank",
        label: "Documento en blanco",
        desc: "Empezar de cero: solo el documento maestro vacío, sin Gantt ni notas. Vos definís la estructura.",
        includes: ["Documento vacío"],
        agent: "Consultor experto en BPO",
        placeholder: "Nombre del proyecto…",
      },
    ],
  },
];

const ALL_TEMPLATES = CATEGORIES.flatMap((c) =>
  c.templates.map((t) => ({ ...t, accent: c.accent, icon: c.icon, category: c.label }))
);

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("metodo_cientifico_bpo");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Vínculo con el plan (para "Material del curso"): el documento del plan
  // se carga como fuente del proyecto nuevo.
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const [relatedId, setRelatedId] = useState("");

  const selected = useMemo(
    () => ALL_TEMPLATES.find((t) => t.slug === template) ?? ALL_TEMPLATES[0],
    [template]
  );
  const needsLink = selected.slug === "capacitacion_contenido";

  useEffect(() => {
    if (!needsLink || plans.length) return;
    apiFetch<any[]>("/api/v1/projects")
      .then((list) =>
        setPlans(
          list
            .filter((p) => p.template_slug === "capacitacion_curso")
            .map((p) => ({ id: p.id, name: p.name }))
        )
      )
      .catch(() => {});
  }, [needsLink, plans.length]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const project = await apiFetch<any>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          template_slug: template,
          related_project_id: needsLink && relatedId ? relatedId : undefined,
        }),
      });
      router.push(`/projects/${project.id}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <h1 className="font-display text-3xl uppercase text-brand-ink">Nuevo proyecto</h1>
        <p className="text-sm text-brand-slate mt-1 mb-6">
          Elegí el tipo de trabajo: cada plantilla trae el documento estructurado, el
          cronograma y el agente experto que corresponden.
        </p>

        <form onSubmit={onSubmit} className="space-y-6">
          {/* Paso 1 — tipo de proyecto */}
          <div>
            <div className="label !mb-3">1 · Tipo de proyecto</div>
            <div className="space-y-5">
              {CATEGORIES.map((cat) => (
                <div key={cat.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="h-6 w-6 rounded-md flex items-center justify-center text-sm"
                      style={{ background: `${cat.accent}18` }}
                    >
                      {cat.icon}
                    </span>
                    <span
                      className="text-xs font-bold uppercase tracking-wider2"
                      style={{ color: cat.accent }}
                    >
                      {cat.label}
                    </span>
                    <span className="text-[11px] text-brand-mist">— {cat.hint}</span>
                    <span className="flex-1 h-px bg-brand-border/70" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {cat.templates.map((t) => {
                      const active = template === t.slug;
                      return (
                        <button
                          key={t.slug}
                          type="button"
                          onClick={() => setTemplate(t.slug)}
                          className={`relative card p-4 text-left transition-all duration-150 flex flex-col ${
                            active
                              ? "shadow-elevated -translate-y-0.5"
                              : "hover:-translate-y-0.5 hover:shadow-elevated"
                          }`}
                          style={
                            active
                              ? { borderColor: cat.accent, boxShadow: `0 0 0 1px ${cat.accent}, 0 10px 24px ${cat.accent}22` }
                              : undefined
                          }
                        >
                          {active && (
                            <span
                              className="absolute top-2.5 right-2.5 h-5 w-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center animate-pop"
                              style={{ background: cat.accent }}
                            >
                              ✓
                            </span>
                          )}
                          <div className="font-semibold text-sm text-brand-ink mb-1 pr-6">
                            {t.label}
                          </div>
                          <div className="text-xs text-brand-slate leading-relaxed flex-1">
                            {t.desc}
                          </div>
                          <div className="flex gap-1 flex-wrap mt-3">
                            {t.includes.map((inc) => (
                              <span
                                key={inc}
                                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                                style={{ background: `${cat.accent}12`, color: cat.accent }}
                              >
                                {inc}
                              </span>
                            ))}
                          </div>
                          <div className="text-[10px] text-brand-mist mt-1.5">
                            🤖 Agente: {t.agent}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Paso 2 — datos */}
          <div>
            <div className="label !mb-3">2 · Datos del proyecto</div>
            <div className="card p-6 space-y-4">
              <div>
                <label className="label">Nombre del proyecto</label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={selected.placeholder}
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
                  placeholder={
                    selected.slug === "capacitacion_curso"
                      ? "Necesidad del negocio, público objetivo y resultado esperado…"
                      : selected.slug === "capacitacion_contenido"
                        ? "Qué módulos cubre este material y para qué edición del curso…"
                        : "Objetivo y alcance de la investigación…"
                  }
                />
              </div>
              {needsLink && (
                <div className="rounded-lg border border-brand-cyan/40 bg-brand-cyan/5 p-3 animate-fade">
                  <label className="label !text-brand-cyan">
                    🔗 Vincular con el plan de capacitación
                  </label>
                  <select
                    className="input"
                    value={relatedId}
                    onChange={(e) => setRelatedId(e.target.value)}
                  >
                    <option value="">— Sin vincular (podés hacerlo después subiendo el plan como fuente) —</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-brand-slate mt-1.5 leading-relaxed">
                    El documento del plan se carga automáticamente como <b>fuente</b> de
                    este proyecto: el Diseñador instruccional redacta cada módulo citando
                    la malla curricular y los objetivos aprobados.
                  </p>
                  {plans.length === 0 && (
                    <p className="text-[11px] text-brand-orange mt-1">
                      No hay planes de capacitación todavía — creá primero un «Plan de
                      capacitación».
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-brand-primary-light text-brand-primary-dark text-sm px-3 py-2">
              {error}
            </div>
          )}

          {/* Resumen de lo elegido + acciones */}
          <div className="card p-4 flex items-center gap-3 flex-wrap">
            <span
              className="h-9 w-9 rounded-lg flex items-center justify-center text-lg shrink-0"
              style={{ background: `${selected.accent}18` }}
            >
              {selected.icon}
            </span>
            <div className="min-w-0 flex-1 text-xs text-brand-slate">
              Vas a crear <b className="text-brand-ink">{selected.label}</b>
              {name.trim() ? (
                <>
                  {" "}
                  — <b className="text-brand-ink">«{name.trim()}»</b>
                </>
              ) : null}
              , con {selected.includes.join(", ").toLowerCase()} y el agente{" "}
              {selected.agent}
              {needsLink && relatedId
                ? ` — vinculado al plan «${plans.find((p) => p.id === relatedId)?.name ?? ""}» (entra como fuente)`
                : ""}
              .
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="submit" className="btn-primary" disabled={loading || !name.trim()}>
                {loading ? "Creando…" : "Crear proyecto"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => router.back()}>
                Cancelar
              </button>
            </div>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
