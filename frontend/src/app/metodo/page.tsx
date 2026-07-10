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
  { n: "6", titulo: "Edición final APA 7", detalle: "Antes de publicar, un pase editorial automático corrige estilo y ortografía, normaliza las citas al formato autor-año, numera tablas y figuras con sus leyendas y construye la lista de Referencias en APA 7.ª edición. El resultado queda como versión revisable, y el documento se exporta paginado con portada e índice." },
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

        {/* Ciclo de vida: cuándo se edita, cuándo se publica */}
        <section>
          <h2 className="font-display text-2xl md:text-3xl uppercase text-brand-ink">
            Cuándo se edita: el ciclo de vida del informe
          </h2>
          <div className="h-1 w-24 bg-brand-primary rounded-full mt-2 mb-4" />
          <p className="text-[15px] text-brand-graphite mb-6 max-w-3xl leading-relaxed">
            La edición final APA no ocurre mientras se investiga: es la{" "}
            <b className="text-brand-ink">última etapa antes de publicar</b>. Se lanza a
            pedido, desde el botón «Edición final APA» del documento maestro, y nunca
            pisa el trabajo: siempre crea una versión nueva que se revisa antes de dar
            el visto bueno.
          </p>
          <div className="grid gap-3">
            {[
              {
                n: "1",
                titulo: "Redacción e investigación",
                detalle:
                  "Los consultores escriben el documento maestro apoyados por el agente investigador. Cada guardado crea una versión con autor y diferencias.",
                color: "bg-brand-cyan",
              },
              {
                n: "2",
                titulo: "Edición final APA",
                etiqueta: "Antes de publicar · un clic en el documento",
                detalle:
                  "Con el contenido cerrado, un consultor lanza la edición final: corrige ortografía y estilo, convierte las citas al formato autor-año, numera tablas y figuras con sus leyendas y arma la lista de Referencias en APA 7. Corre en segundo plano y el resultado se guarda como una versión NUEVA — el texto original queda intacto en el historial.",
                color: "bg-brand-purple",
                destacado: true,
              },
              {
                n: "3",
                titulo: "Revisión con diff",
                detalle:
                  "En el historial de versiones se comparan línea por línea los cambios de la edición final. Si algo no convence, se restaura la versión anterior o se ajusta a mano.",
                color: "bg-brand-orange",
              },
              {
                n: "4",
                titulo: "Publicación",
                detalle:
                  "El líder publica el proyecto: la versión aprobada queda congelada y es la única que ven los visualizadores.",
                color: "bg-brand-primary",
              },
              {
                n: "5",
                titulo: "Exportación paginada",
                detalle:
                  "El Word y el PDF salen con portada, índice, numeración «Página X de Y» al pie y sangría francesa APA en las Referencias.",
                color: "bg-brand-ink",
              },
            ].map((e) =>
              e.destacado ? (
                <div
                  key={e.n}
                  className="rounded-xl overflow-hidden shadow-elevated flex bg-brand-purple text-white"
                >
                  <div className="w-16 md:w-20 shrink-0 flex items-center justify-center bg-white/15">
                    <span className="font-display text-4xl leading-none">{e.n}</span>
                  </div>
                  <div className="p-5 md:p-6 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="font-display uppercase text-lg tracking-wide leading-none">
                        {e.titulo}
                      </div>
                      <span className="text-[10px] uppercase tracking-wider2 font-semibold bg-white text-brand-purple rounded-full px-2.5 py-1">
                        {e.etiqueta}
                      </span>
                    </div>
                    <p className="text-sm text-white/90 mt-2 leading-relaxed">{e.detalle}</p>
                  </div>
                </div>
              ) : (
                <div key={e.n} className="card overflow-hidden flex">
                  <div
                    className={`w-16 md:w-20 shrink-0 flex items-center justify-center ${e.color} text-white`}
                  >
                    <span className="font-display text-4xl leading-none">{e.n}</span>
                  </div>
                  <div className="p-5 flex-1">
                    <div className="font-display uppercase text-lg tracking-wide text-brand-ink leading-none">
                      {e.titulo}
                    </div>
                    <p className="text-sm text-brand-graphite mt-2 leading-relaxed">
                      {e.detalle}
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
        </section>

        <footer className="text-center text-xs text-brand-slate pb-6">
          VEX Consulting · Plataforma de investigación de mercado · Voicenter S.A.
        </footer>
      </main>
    </div>
  );
}
