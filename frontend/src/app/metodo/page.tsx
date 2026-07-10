"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Brand from "@/components/Brand";
import { getToken, getUser } from "@/lib/api";

const NIVELES = [
  { nivel: 1, color: "#E6332A", titulo: "Estadística oficial y reguladores", ej: "Bancos centrales, institutos de estadística, superintendencias, organismos públicos" },
  { nivel: 2, color: "#662483", titulo: "Organismos internacionales", ej: "Banco Mundial, OCDE, OIT, UNESCO, BID, FMI" },
  { nivel: 3, color: "#00B2BF", titulo: "Balances auditados y filings", ej: "Estados financieros, documentos regulatorios, memorias anuales de empresas" },
  { nivel: 4, color: "#F39200", titulo: "Consultoras y asociaciones reconocidas", ej: "McKinsey, Gartner, Deloitte, Everest, ContactBabel, cámaras de industria" },
  { nivel: 5, color: "#5B6275", titulo: "Prensa especializada", ej: "Medios económicos y sectoriales con reputación verificable" },
];

const PASOS = [
  { n: "1", titulo: "Fuentes internas primero", detalle: "Toda consulta empieza por la base de conocimiento del proyecto: documentos, planillas, imágenes y notas de voz indexados. Lo propio antes que lo externo." },
  { n: "2", titulo: "Investigación web dirigida", detalle: "El agente investiga en la web con motor de búsqueda con citas. Si la primera pasada trae fuentes débiles, reformula la búsqueda apuntando a instituciones." },
  { n: "3", titulo: "Triangulación", detalle: "Las cifras clave se contrastan con al menos dos fuentes independientes. Las discrepancias no se ocultan: se reportan con ambas cifras." },
  { n: "4", titulo: "Cita verificable en cada dato", detalle: "Ningún número sin fuente. Las citas web llevan enlace directo; las internas, documento y página. El sistema genera la lista de fuentes automáticamente." },
  { n: "5", titulo: "Síntesis con posición", detalle: "El resultado distingue hecho, estimación y opinión, toma posición en las conclusiones y sustenta con gráficos generados desde los datos verificados." },
];

export default function MetodoPage() {
  const router = useRouter();
  const user = typeof window !== "undefined" ? getUser() : null;
  const backHref = user?.role === "visualizador" ? "/view" : "/dashboard";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-white border-b border-brand-border shadow-soft">
        <div className="mx-auto max-w-5xl px-4 h-16 flex items-center justify-between">
          <Brand />
          <Link href={getToken() ? backHref : "/login"} className="btn-secondary !py-1.5 text-xs">
            ← Volver
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 space-y-12">
        {/* Hero */}
        <section>
          <h1 className="font-display text-4xl md:text-5xl uppercase text-brand-ink leading-none">
            Método y fuentes
          </h1>
          <p className="mt-4 text-brand-graphite max-w-3xl leading-relaxed">
            Toda investigación producida en VEX Consulting sigue un modelo investigativo
            explícito, inspirado en el método científico y en los estándares de las
            consultoras internacionales. Esta página documenta cómo estructuramos las
            búsquedas, qué fuentes admitimos y por qué cada afirmación de nuestros
            informes es trazable hasta su origen.
          </p>
        </section>

        {/* Por qué */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="card p-6">
            <h2 className="font-display text-xl uppercase text-brand-ink mb-2">
              Por qué importa en investigación de mercado
            </h2>
            <p className="text-sm text-brand-graphite leading-relaxed">
              Las decisiones de negocio —precios, inversión, estrategia— se defienden
              ante directorios, clientes y reguladores. Un dato sin fuente es una
              opinión; un dato con fuente jerarquizada y triangulada es evidencia. El
              método convierte percepciones («el mercado cambió») en hipótesis
              contrastables con variables observables, y separa lo que sabemos de lo
              que estimamos.
            </p>
          </div>
          <div className="card p-6">
            <h2 className="font-display text-xl uppercase text-brand-ink mb-2">
              Por qué importa en investigación académica
            </h2>
            <p className="text-sm text-brand-graphite leading-relaxed">
              El rigor académico exige evidencia revisada por pares, metodología
              explícita y distinción del nivel de evidencia (causal, correlacional,
              declarativo). Nuestro modo académico prioriza publicaciones científicas
              y reporta autores, año y metodología de cada estudio — el estándar
              necesario para tesis, papers y evaluaciones de política.
            </p>
          </div>
        </section>

        {/* Esquema del modelo */}
        <section>
          <h2 className="font-display text-2xl uppercase text-brand-ink mb-1">
            El modelo investigativo
          </h2>
          <p className="text-sm text-brand-slate mb-6">
            Un agente principal orquesta herramientas especializadas. Cada turno de la
            conversación mantiene memoria del hilo completo.
          </p>

          <div className="card p-6 md:p-8">
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-lg bg-brand-bg border border-brand-border px-6 py-3 text-center">
                <div className="text-xs uppercase tracking-wider2 text-brand-slate">Consultor</div>
                <div className="font-semibold text-brand-ink text-sm">
                  Consulta · texto, imagen o nota de voz
                </div>
              </div>
              <div className="text-brand-mist text-xl leading-none">↓</div>
              <div className="rounded-lg bg-brand-primary text-white px-8 py-4 text-center shadow-elevated">
                <div className="text-xs uppercase tracking-wider2 text-white/80">Agente principal</div>
                <div className="font-display text-xl uppercase">VEX Consulting IA</div>
                <div className="text-xs text-white/85 mt-1">
                  Orquesta las herramientas · memoria de los últimos 30 mensajes del hilo
                </div>
              </div>
              <div className="text-brand-mist text-xl leading-none">↓</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 w-full">
                {[
                  { t: "Fuentes internas", d: "Búsqueda semántica sobre los documentos, planillas, imágenes y audios del proyecto, con cita por página u hoja.", c: "#00B2BF" },
                  { t: "Investigación web", d: "Motor de búsqueda con citas (Perplexity). Modo general para mercado; modo académico para publicaciones revisadas por pares.", c: "#E6332A" },
                  { t: "Documento y notas", d: "Lee el informe en curso y las hipótesis registradas para dar continuidad al trabajo del equipo.", c: "#662483" },
                  { t: "Análisis y gráficos", d: "Genera visualizaciones con identidad corporativa a partir de los datos ya verificados, con su tabla de datos.", c: "#F39200" },
                ].map((tool) => (
                  <div key={tool.t} className="rounded-lg border border-brand-border p-4" style={{ borderTopColor: tool.c, borderTopWidth: 3 }}>
                    <div className="font-semibold text-sm text-brand-ink mb-1">{tool.t}</div>
                    <div className="text-xs text-brand-slate leading-relaxed">{tool.d}</div>
                  </div>
                ))}
              </div>
              <div className="text-brand-mist text-xl leading-none">↓</div>
              <div className="rounded-lg bg-brand-ink text-white px-6 py-3 text-center">
                <div className="font-semibold text-sm">
                  Respuesta con citas verificables → insertable en el informe
                </div>
                <div className="text-xs text-white/70 mt-0.5">
                  Cada intercambio queda persistido, auditado y con costo registrado
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Jerarquía de fuentes */}
        <section>
          <h2 className="font-display text-2xl uppercase text-brand-ink mb-1">
            Jerarquía de fuentes
          </h2>
          <p className="text-sm text-brand-slate mb-6 max-w-3xl">
            No todas las fuentes valen lo mismo. Cada hallazgo clave de nuestros
            informes indica el nivel de la fuente que lo sustenta, y las búsquedas se
            reformulan hasta alcanzar los niveles superiores.
          </p>
          <div className="space-y-2">
            {NIVELES.map((n) => (
              <div key={n.nivel} className="card p-4 flex items-center gap-4" style={{ marginLeft: `${(n.nivel - 1) * 4}%` }}>
                <div
                  className="h-10 w-10 shrink-0 rounded-lg flex items-center justify-center font-display text-xl text-white"
                  style={{ background: n.color }}
                >
                  {n.nivel}
                </div>
                <div>
                  <div className="font-semibold text-sm text-brand-ink">{n.titulo}</div>
                  <div className="text-xs text-brand-slate">{n.ej}</div>
                </div>
              </div>
            ))}
            <div className="card p-4 flex items-center gap-4 border-dashed" style={{ marginLeft: "20%" }}>
              <div className="h-10 w-10 shrink-0 rounded-lg flex items-center justify-center text-xl bg-brand-bg text-brand-mist">
                ✕
              </div>
              <div>
                <div className="font-semibold text-sm text-brand-slate">
                  Excluidos del motor de búsqueda
                </div>
                <div className="text-xs text-brand-slate">
                  YouTube, Instagram, Facebook, TikTok, X, Reddit, Pinterest, Quora —
                  filtrados por política de dominios. Los blogs de proveedores solo se
                  admiten como último recurso, marcados «fuente de industria, no
                  verificada» y con corroboración obligatoria.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Niveles de rigor */}
        <section>
          <h2 className="font-display text-2xl uppercase text-brand-ink mb-6">
            Dos niveles de rigor
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card p-6 border-t-4" style={{ borderTopColor: "#E6332A" }}>
              <h3 className="font-display text-lg uppercase text-brand-ink">Estándar — rigor de consultora</h3>
              <ul className="mt-3 space-y-2 text-sm text-brand-graphite">
                <li>• Jerarquía de fuentes innegociable (niveles 1–4 prioritarios)</li>
                <li>• Triangulación de cifras clave con dos fuentes independientes</li>
                <li>• Nivel de fuente etiquetado en cada hallazgo</li>
                <li>• Discrepancias reportadas con ambas cifras</li>
                <li>• Para datos de mercado, precios, competencia y actualidad</li>
              </ul>
            </div>
            <div className="card p-6 border-t-4" style={{ borderTopColor: "#662483" }}>
              <h3 className="font-display text-lg uppercase text-brand-ink">🎓 Académico</h3>
              <ul className="mt-3 space-y-2 text-sm text-brand-graphite">
                <li>• Prioriza publicaciones revisadas por pares (papers, journals)</li>
                <li>• Reporta autores, institución, año y metodología</li>
                <li>• Distingue el nivel de evidencia (causal, correlacional, declarativa)</li>
                <li>• Separa evidencia académica de fuentes de industria</li>
                <li>• Para hipótesis, marcos teóricos y sustento científico</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Cómo se estructura una búsqueda */}
        <section>
          <h2 className="font-display text-2xl uppercase text-brand-ink mb-6">
            Cómo se estructura cada investigación
          </h2>
          <div className="space-y-3">
            {PASOS.map((p) => (
              <div key={p.n} className="card p-5 flex gap-4">
                <div className="h-9 w-9 shrink-0 rounded-full bg-brand-primary text-white font-display text-lg flex items-center justify-center">
                  {p.n}
                </div>
                <div>
                  <div className="font-semibold text-sm text-brand-ink">{p.titulo}</div>
                  <div className="text-sm text-brand-slate leading-relaxed mt-0.5">{p.detalle}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Trazabilidad */}
        <section className="card p-6 md:p-8 bg-brand-ink text-white">
          <h2 className="font-display text-2xl uppercase mb-3">Trazabilidad total</h2>
          <div className="grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <div className="font-semibold mb-1">Citas y versiones</div>
              <p className="text-white/75 text-xs leading-relaxed">
                Cada cifra enlaza a su fuente. Cada edición del documento maestro crea
                una versión inmutable con autor y diferencias.
              </p>
            </div>
            <div>
              <div className="font-semibold mb-1">Auditoría</div>
              <p className="text-white/75 text-xs leading-relaxed">
                Ingresos, ediciones, investigaciones y exportaciones quedan registrados
                con usuario, fecha e IP.
              </p>
            </div>
            <div>
              <div className="font-semibold mb-1">Evaluación independiente</div>
              <p className="text-white/75 text-xs leading-relaxed">
                Un agente evaluador califica cada proyecto contra una rúbrica de método
                científico de siete criterios, verificando que las fuentes respalden lo
                afirmado.
              </p>
            </div>
          </div>
        </section>

        <footer className="text-center text-xs text-brand-slate pb-6">
          VEX Consulting · Plataforma de investigación de mercado · Voicenter S.A.
        </footer>
      </main>
    </div>
  );
}
