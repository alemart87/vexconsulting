"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Brand from "@/components/Brand";
import { getToken, getUser } from "@/lib/api";

/* ============================================================
 * Datos de la página (fuentes reales del sistema)
 * ============================================================ */

const NIVELES = [
  { nivel: 1, color: "#E6332A", titulo: "Estadística oficial y reguladores", ej: "Bancos centrales, institutos de estadística, superintendencias, organismos públicos" },
  { nivel: 2, color: "#662483", titulo: "Organismos internacionales", ej: "Banco Mundial, OCDE, OIT, UNESCO, BID, FMI" },
  { nivel: 3, color: "#00B2BF", titulo: "Balances auditados y filings", ej: "Estados financieros, documentos regulatorios, memorias anuales de empresas" },
  { nivel: 4, color: "#F39200", titulo: "Consultoras y asociaciones reconocidas", ej: "McKinsey, Gartner, Deloitte, Everest, ContactBabel, cámaras de industria" },
  { nivel: 5, color: "#5B6275", titulo: "Prensa especializada", ej: "Medios económicos y sectoriales con reputación verificable" },
];

/** Fuentes por grupo, con dominio para el logo (favicon en runtime). */
const FUENTES: { grupo: string; nivel: string; color: string; items: { name: string; domain: string }[] }[] = [
  {
    grupo: "Estadística oficial y reguladores",
    nivel: "Nivel 1",
    color: "#E6332A",
    items: [
      { name: "Banco Central del Paraguay", domain: "bcp.gov.py" },
      { name: "INE Paraguay", domain: "ine.gov.py" },
      { name: "DNIT", domain: "dnit.gov.py" },
      { name: "CNV Paraguay", domain: "cnv.gov.py" },
      { name: "Eurostat", domain: "ec.europa.eu" },
      { name: "Reserva Federal (EE. UU.)", domain: "federalreserve.gov" },
      { name: "BLS (EE. UU.)", domain: "bls.gov" },
    ],
  },
  {
    grupo: "Organismos internacionales",
    nivel: "Nivel 2",
    color: "#662483",
    items: [
      { name: "Banco Mundial", domain: "worldbank.org" },
      { name: "FMI", domain: "imf.org" },
      { name: "OCDE", domain: "oecd.org" },
      { name: "OIT", domain: "ilo.org" },
      { name: "UNESCO", domain: "unesco.org" },
      { name: "BID", domain: "iadb.org" },
      { name: "CEPAL", domain: "cepal.org" },
    ],
  },
  {
    grupo: "Balances auditados y filings",
    nivel: "Nivel 3",
    color: "#00B2BF",
    items: [
      { name: "SEC · EDGAR", domain: "sec.gov" },
      { name: "Memorias anuales de empresas", domain: "annualreports.com" },
    ],
  },
  {
    grupo: "Consultoras y firmas de investigación",
    nivel: "Nivel 4",
    color: "#F39200",
    items: [
      { name: "McKinsey & Company", domain: "mckinsey.com" },
      { name: "Deloitte", domain: "deloitte.com" },
      { name: "PwC", domain: "pwc.com" },
      { name: "EY", domain: "ey.com" },
      { name: "KPMG", domain: "kpmg.com" },
      { name: "Gartner", domain: "gartner.com" },
      { name: "Forrester", domain: "forrester.com" },
      { name: "Everest Group", domain: "everestgrp.com" },
      { name: "ISG", domain: "isg-one.com" },
      { name: "ContactBabel", domain: "contactbabel.com" },
      { name: "Frost & Sullivan", domain: "frost.com" },
      { name: "Nasscom", domain: "nasscom.in" },
    ],
  },
  {
    grupo: "Publicaciones académicas (modo Académico)",
    nivel: "Revisadas por pares",
    color: "#0F1116",
    items: [
      { name: "Springer", domain: "springer.com" },
      { name: "ScienceDirect · Elsevier", domain: "sciencedirect.com" },
      { name: "JSTOR", domain: "jstor.org" },
      { name: "NBER", domain: "nber.org" },
      { name: "SSRN", domain: "ssrn.com" },
      { name: "SciELO", domain: "scielo.org" },
    ],
  },
];

const EXCLUIDOS = [
  { name: "YouTube", domain: "youtube.com" },
  { name: "Instagram", domain: "instagram.com" },
  { name: "TikTok", domain: "tiktok.com" },
  { name: "Facebook", domain: "facebook.com" },
  { name: "X / Twitter", domain: "x.com" },
  { name: "Reddit", domain: "reddit.com" },
  { name: "Pinterest", domain: "pinterest.com" },
  { name: "Quora", domain: "quora.com" },
];

const PASOS = [
  { n: "1", titulo: "Fuentes internas primero", detalle: "Toda consulta empieza por la base de conocimiento del proyecto: documentos, planillas, imágenes y notas de voz indexados. Lo propio antes que lo externo." },
  { n: "2", titulo: "Investigación web dirigida", detalle: "El agente investiga en la web con motor de búsqueda con citas. Si la primera pasada trae fuentes débiles, reformula la búsqueda apuntando a instituciones." },
  { n: "3", titulo: "Triangulación", detalle: "Las cifras clave se contrastan con al menos dos fuentes independientes. Las discrepancias no se ocultan: se reportan con ambas cifras." },
  { n: "4", titulo: "Cita verificable en cada dato", detalle: "Ningún número sin fuente. Las citas web llevan enlace directo; las internas, documento y página. El sistema genera la lista de fuentes automáticamente." },
  { n: "5", titulo: "Síntesis con posición", detalle: "El resultado distingue hecho, estimación y opinión, toma posición en las conclusiones y sustenta con gráficos generados desde los datos verificados." },
  { n: "6", titulo: "Edición final APA 7", detalle: "Antes de publicar, un pase editorial automático corrige estilo y ortografía, normaliza las citas al formato autor-año, numera tablas y figuras con sus leyendas y construye la lista de Referencias en APA 7.ª edición. El resultado queda como versión revisable, y el documento se exporta paginado con portada e índice." },
];

/** Compuertas de validación por las que pasa toda evidencia. */
const VALIDACION = [
  { icon: "🛡", titulo: "Filtro de dominios", detalle: "Las redes sociales y el contenido de entretenimiento se excluyen del motor de búsqueda, en el propio buscador y de nuevo en nuestro servidor." },
  { icon: "🏛", titulo: "Jerarquía etiquetada", detalle: "Cada hallazgo declara el nivel de su fuente (1–5). Si una cifra clave solo aparece en niveles bajos, se dice explícitamente." },
  { icon: "⚖", titulo: "Triangulación", detalle: "Las cifras que sostienen conclusiones se contrastan con al menos dos fuentes independientes. Las discrepancias se reportan." },
  { icon: "🔍", titulo: "Hecho / estimación / opinión", detalle: "El texto distingue qué está medido, qué está proyectado y qué es juicio del analista. Nada se presenta como más sólido de lo que es." },
  { icon: "🔗", titulo: "Cita verificable", detalle: "Todo dato queda enlazado a su origen: URL exacta para fuentes web, documento y página para fuentes internas." },
];

/** Rúbrica REAL del agente evaluador (metodo_cientifico_v1) con puntajes de ejemplo. */
const RUBRICA = [
  { k: "Problema", d: "¿Define el fenómeno, el contexto de negocio y la decisión a informar?", demo: 9 },
  { k: "Hipótesis", d: "¿Hay hipótesis contrastables con variable observable?", demo: 8 },
  { k: "Fuentes y método", d: "¿Fuentes declaradas, jerarquizadas y verificables?", demo: 9 },
  { k: "Evidencia", d: "¿Cada cifra con cita? ¿Triangulación entre fuentes independientes?", demo: 7 },
  { k: "Síntesis", d: "¿Integra hallazgos y reconoce resultados contrarios y vacíos?", demo: 8 },
  { k: "Conclusiones", d: "¿Trazables a la evidencia, accionables, sin sobregeneralizar?", demo: 8 },
  { k: "Redacción", d: "¿Registro profesional sobrio y cifras consistentes?", demo: 9 },
];

/* ============================================================
 * Componentes visuales
 * ============================================================ */

function LogoChip({ name, domain, muted = false }: { name: string; domain: string; muted?: boolean }) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border bg-white pl-1.5 pr-3 py-1 ${
        muted ? "border-brand-border/70" : "border-brand-border"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt=""
        loading="lazy"
        className={`h-5 w-5 rounded-sm ${muted ? "grayscale opacity-50" : ""}`}
        onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
      />
      <span className={`text-xs font-semibold ${muted ? "text-brand-slate line-through decoration-brand-primary/60" : "text-brand-ink"}`}>
        {name}
      </span>
    </div>
  );
}

function MotorBadge({ domain, label, sub }: { domain: string; label: string; sub: string }) {
  return (
    <div className="inline-flex items-center gap-2.5 rounded-lg bg-white/10 border border-white/25 px-3 py-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt=""
        className="h-5 w-5 rounded-sm bg-white p-0.5"
        onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
      />
      <span className="text-left leading-tight">
        <span className="block text-[11px] font-bold">{label}</span>
        <span className="block text-[10px] text-white/75">{sub}</span>
      </span>
    </div>
  );
}

/* ============================================================
 * Página
 * ============================================================ */

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

      <main className="mx-auto max-w-5xl px-4 py-10 space-y-14">
        {/* ==================== Hero ==================== */}
        <section>
          <h1 className="font-display text-4xl md:text-5xl uppercase text-brand-ink leading-none">
            Método y fuentes
          </h1>
          <p className="mt-4 text-brand-graphite max-w-3xl leading-relaxed">
            Toda investigación producida en VEX Consulting sigue un modelo investigativo
            explícito, inspirado en el método científico y en los estándares de las
            consultoras internacionales. Esta página documenta cómo trabajan nuestros
            agentes: el circuito de búsqueda, las compuertas de validación, el agente
            evaluador independiente y el resultado final que entregamos.
          </p>
        </section>

        {/* ==================== Por qué ==================== */}
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

        {/* ==================== Circuito de búsqueda ==================== */}
        <section>
          <h2 className="font-display text-2xl md:text-3xl uppercase text-brand-ink">
            El circuito de búsqueda
          </h2>
          <div className="h-1 w-24 bg-brand-primary rounded-full mt-2 mb-4" />
          <p className="text-sm text-brand-slate mb-6 max-w-3xl">
            Un agente principal razona sobre el pedido y orquesta herramientas
            especializadas. Nada llega al informe sin pasar por las compuertas de
            validación. Cada turno mantiene memoria del hilo completo.
          </p>

          <div className="card p-6 md:p-8">
            <div className="flex flex-col items-center">
              {/* Entrada */}
              <div className="rounded-lg bg-brand-bg border border-brand-border px-6 py-3 text-center">
                <div className="text-xs uppercase tracking-wider2 text-brand-slate">Consultor</div>
                <div className="font-semibold text-brand-ink text-sm">
                  Consulta · texto, imagen o nota de voz · rigor Estándar o Académico
                </div>
              </div>
              <div className="flow-v" />

              {/* Agente principal */}
              <div className="rounded-xl bg-brand-primary text-white px-8 py-5 text-center shadow-elevated w-full max-w-2xl">
                <div className="text-xs uppercase tracking-wider2 text-white/80">Agente principal · razona y orquesta</div>
                <div className="font-display text-2xl uppercase">VEX Consulting IA</div>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <MotorBadge domain="openai.com" label="OpenAI GPT-5.6 Terra" sub="razonamiento · 1M tokens de contexto" />
                  <MotorBadge domain="perplexity.ai" label="Perplexity Agent API" sub="web_search + lectura de páginas completas" />
                </div>
                <div className="text-[11px] text-white/80 mt-2.5">
                  Memoria de los últimos 30 mensajes del hilo · decide qué herramienta usar y cuántas veces
                </div>
              </div>
              <div className="flow-v" />

              {/* Herramientas */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 w-full">
                {[
                  { t: "Fuentes internas (RAG)", d: "Búsqueda semántica + texto completo sobre los documentos, planillas, imágenes y audios del proyecto, con cita por página u hoja.", c: "#00B2BF" },
                  { t: "Web general", d: "Perplexity Agent: busca con filtro de dominios nativo y puede entrar a leer las páginas completas de los informes que encuentra.", c: "#E6332A" },
                  { t: "Web académica", d: "Modo academic de Perplexity: prioriza papers y journals revisados por pares, con autores, año y metodología.", c: "#662483" },
                  { t: "Análisis y gráficos", d: "Genera visualizaciones con identidad corporativa a partir de los datos ya verificados, con su tabla de datos.", c: "#F39200" },
                ].map((tool) => (
                  <div key={tool.t} className="rounded-lg border border-brand-border p-4 bg-white" style={{ borderTopColor: tool.c, borderTopWidth: 3 }}>
                    <div className="font-semibold text-sm text-brand-ink mb-1">{tool.t}</div>
                    <div className="text-xs text-brand-slate leading-relaxed">{tool.d}</div>
                  </div>
                ))}
              </div>

              {/* Loop de reformulación */}
              <div className="mt-3 rounded-full border border-dashed border-brand-orange/60 bg-brand-orange/5 px-4 py-1.5 text-[11px] text-brand-graphite">
                ↻ ¿Fuentes débiles o insuficientes? El agente <b>reformula la búsqueda</b> apuntando
                a instituciones y vuelve a intentar — tantas veces como haga falta.
              </div>
              <div className="flow-v" />

              {/* Validación */}
              <div className="rounded-lg border-2 border-brand-purple/40 bg-brand-purple/5 px-6 py-3 text-center w-full max-w-2xl">
                <div className="text-xs uppercase tracking-wider2 text-brand-purple font-bold">Compuertas de validación</div>
                <div className="text-xs text-brand-graphite mt-1">
                  Filtro de dominios → jerarquía etiquetada → triangulación → hecho/estimación/opinión → cita verificable
                </div>
              </div>
              <div className="flow-v" />

              {/* Salida */}
              <div className="rounded-lg bg-brand-ink text-white px-6 py-3.5 text-center w-full max-w-2xl">
                <div className="font-semibold text-sm">
                  Respuesta con citas verificables → insertable en el informe con un clic
                </div>
                <div className="text-xs text-white/70 mt-0.5">
                  Cada intercambio queda persistido, auditado y con su costo registrado
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ==================== Dónde buscamos (logos) ==================== */}
        <section>
          <h2 className="font-display text-2xl md:text-3xl uppercase text-brand-ink">
            Dónde buscamos: el mapa de fuentes
          </h2>
          <div className="h-1 w-24 bg-brand-primary rounded-full mt-2 mb-4" />
          <p className="text-sm text-brand-slate mb-6 max-w-3xl">
            El motor de búsqueda no navega a ciegas: prioriza instituciones y firmas con
            reputación verificable, en este orden. Estas son las fuentes típicas de cada
            nivel de la jerarquía.
          </p>
          <div className="space-y-4">
            {FUENTES.map((g) => (
              <div key={g.grupo} className="card p-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <span
                    className="text-[10px] uppercase tracking-wider2 font-bold text-white rounded-full px-2.5 py-1"
                    style={{ background: g.color }}
                  >
                    {g.nivel}
                  </span>
                  <span className="font-semibold text-sm text-brand-ink">{g.grupo}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.items.map((s) => (
                    <LogoChip key={s.domain + s.name} name={s.name} domain={s.domain} />
                  ))}
                </div>
              </div>
            ))}

            {/* Excluidos */}
            <div className="card p-5 border-dashed bg-brand-bg/60">
              <div className="flex items-center gap-2.5 mb-3">
                <span className="text-[10px] uppercase tracking-wider2 font-bold text-white rounded-full px-2.5 py-1 bg-brand-slate">
                  ✕ Excluidos
                </span>
                <span className="font-semibold text-sm text-brand-slate">
                  Filtrados por política de dominios — en el buscador y de nuevo en nuestro servidor
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {EXCLUIDOS.map((s) => (
                  <LogoChip key={s.domain} name={s.name} domain={s.domain} muted />
                ))}
              </div>
              <p className="text-xs text-brand-slate mt-3">
                Los blogs de proveedores solo se admiten como último recurso, marcados
                «fuente de industria, no verificada» y con corroboración obligatoria.
              </p>
            </div>
          </div>
        </section>

        {/* ==================== Jerarquía (escalera) ==================== */}
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
          </div>
        </section>

        {/* ==================== Validación (compuertas) ==================== */}
        <section>
          <h2 className="font-display text-2xl md:text-3xl uppercase text-brand-ink">
            El esquema de validación
          </h2>
          <div className="h-1 w-24 bg-brand-primary rounded-full mt-2 mb-4" />
          <p className="text-sm text-brand-slate mb-6 max-w-3xl">
            Toda evidencia —interna o externa— atraviesa cinco compuertas antes de
            entrar al informe. Si una cifra no pasa una compuerta, no se descarta en
            silencio: se reporta con su limitación.
          </p>
          <div className="flex flex-col md:flex-row md:items-stretch gap-3 md:gap-0">
            {VALIDACION.map((v, i) => (
              <div key={v.titulo} className="contents">
                <div className="card p-4 flex-1 border-t-4 border-t-brand-purple">
                  <div className="text-2xl leading-none mb-2">{v.icon}</div>
                  <div className="font-semibold text-[13px] text-brand-ink leading-tight">
                    {v.titulo}
                  </div>
                  <p className="text-[11px] text-brand-slate leading-relaxed mt-1.5">{v.detalle}</p>
                </div>
                {i < VALIDACION.length - 1 && <div className="flow-h" />}
              </div>
            ))}
          </div>
        </section>

        {/* ==================== Niveles de rigor ==================== */}
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

        {/* ==================== Pasos ==================== */}
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

        {/* ==================== Agente evaluador ==================== */}
        <section>
          <h2 className="font-display text-2xl md:text-3xl uppercase text-brand-ink">
            El agente evaluador: control de calidad independiente
          </h2>
          <div className="h-1 w-24 bg-brand-primary rounded-full mt-2 mb-4" />
          <p className="text-sm text-brand-slate mb-6 max-w-3xl">
            Quien genera no se evalúa a sí mismo. Un agente separado —sin participación
            en la redacción— lee el documento completo contra sus fuentes y lo califica
            con una rúbrica de método científico de siete criterios. El equipo corrige y
            puede re-evaluar tantas veces como necesite antes de publicar.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Circuito del evaluador */}
            <div className="card p-6">
              <div className="label mb-4">El circuito de evaluación</div>
              <div className="flex flex-col items-center">
                <div className="rounded-lg bg-brand-bg border border-brand-border px-5 py-2.5 text-center w-full">
                  <div className="text-xs font-semibold text-brand-ink">Documento maestro (borrador)</div>
                  <div className="text-[10px] text-brand-slate">con sus fuentes cargadas</div>
                </div>
                <div className="flow-v" />
                <div className="rounded-lg bg-brand-purple text-white px-5 py-3 text-center w-full shadow-soft">
                  <div className="text-[10px] uppercase tracking-wider2 text-white/80">Agente evaluador · independiente</div>
                  <div className="font-display uppercase">Rúbrica de 7 criterios</div>
                  <div className="text-[10px] text-white/80 mt-0.5">
                    verifica que las fuentes citadas respalden lo afirmado
                  </div>
                </div>
                <div className="flow-v" />
                <div className="rounded-lg border border-brand-border px-5 py-2.5 text-center w-full">
                  <div className="text-xs font-semibold text-brand-ink">
                    Informe de evaluación: puntaje por criterio + hallazgos con ejemplos
                  </div>
                </div>
                <div className="flow-v" />
                <div className="rounded-lg bg-brand-bg border border-dashed border-brand-orange/60 px-5 py-2.5 text-center w-full">
                  <div className="text-xs text-brand-graphite">
                    ↻ El equipo corrige y <b>re-evalúa</b> hasta alcanzar el estándar
                  </div>
                </div>
                <div className="flow-v" />
                <div className="rounded-lg bg-brand-ink text-white px-5 py-2.5 text-center w-full">
                  <div className="text-xs font-semibold">Publicación de la versión aprobada</div>
                </div>
              </div>
            </div>

            {/* Rúbrica con barras */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="label !mb-0">La rúbrica (ejemplo ilustrativo)</div>
                <div className="text-right">
                  <div className="font-display text-3xl text-brand-ink leading-none">8,3</div>
                  <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">global / 10</div>
                </div>
              </div>
              <div className="space-y-3">
                {RUBRICA.map((c) => (
                  <div key={c.k}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-semibold text-brand-ink">{c.k}</span>
                      <span className="text-xs font-bold text-brand-graphite">{c.demo}/10</span>
                    </div>
                    <div className="text-[10px] text-brand-slate leading-snug mb-1">{c.d}</div>
                    <div className="h-2 rounded-full bg-brand-bg overflow-hidden">
                      <div
                        className="h-full rounded-full score-bar"
                        style={{
                          width: `${c.demo * 10}%`,
                          background: c.demo >= 9 ? "#00B2BF" : c.demo >= 8 ? "#662483" : "#F39200",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Resultado final */}
          <div className="mt-4 card p-6 bg-brand-ink text-white">
            <div className="text-xs uppercase tracking-wider2 text-white/70 mb-3">El resultado final</div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              {[
                { t: "Informe citado en APA 7", d: "Citas autor-año, tablas y figuras numeradas, lista de Referencias verificable." },
                { t: "Evaluación documentada", d: "Puntaje por criterio del evaluador independiente, adjunto al proyecto." },
                { t: "Export profesional", d: "Word y PDF con portada, índice y numeración de páginas." },
                { t: "Trazabilidad completa", d: "Versiones inmutables, auditoría de cada acción y costo de IA registrado." },
              ].map((r) => (
                <div key={r.t}>
                  <div className="font-semibold mb-1">✓ {r.t}</div>
                  <p className="text-white/75 text-xs leading-relaxed">{r.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ==================== Por qué funciona ==================== */}
        <section>
          <h2 className="font-display text-2xl md:text-3xl uppercase text-brand-ink">
            Por qué este sistema funciona para investigación
          </h2>
          <div className="h-1 w-24 bg-brand-primary rounded-full mt-2 mb-6" />
          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                t: "Genera uno, verifica otro",
                d: "El agente investigador y el agente evaluador están separados por diseño: el que redacta nunca se califica a sí mismo. Es el mismo principio de la revisión por pares académica y del control de calidad en consultoría.",
              },
              {
                t: "La jerarquía combate el sesgo de fuente única",
                d: "Exigir triangulación y etiquetar el nivel de cada fuente impide que una sola cifra conveniente —o un blog comercial bien posicionado— sostenga una conclusión de negocio.",
              },
              {
                t: "Reproducible y trazable",
                d: "Cualquier afirmación del informe se puede seguir hasta su fuente, su versión y su autor. Un tercero puede rehacer el camino y llegar al mismo resultado: la definición operativa de rigor.",
              },
              {
                t: "Estándares reconocibles",
                d: "APA 7 para el aparato de citas, método científico para la estructura, registro institucional para la prosa. El informe final se defiende igual ante un directorio, un cliente o un comité académico.",
              },
            ].map((c) => (
              <div key={c.t} className="card p-6 border-l-4 border-l-brand-primary">
                <div className="font-display text-lg uppercase text-brand-ink leading-tight">{c.t}</div>
                <p className="text-sm text-brand-graphite leading-relaxed mt-2">{c.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ==================== Trazabilidad ==================== */}
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

        {/* ==================== Ciclo de vida ==================== */}
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
