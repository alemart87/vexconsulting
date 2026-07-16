"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CurrentUserInfo, ROLE_LABELS, clearSession, getToken, getUser } from "@/lib/api";
import Brand from "./Brand";
import GuidedTour, { TourStep } from "./GuidedTour";
import NotificationBell from "./NotificationBell";

/** Visita guiada GENERAL de la plataforma (elementos del AppShell y dashboard;
 *  los pasos cuyo elemento no esté en la página actual se saltan solos). */
const TOUR_APP: TourStep[] = [
  {
    title: "Bienvenido a VEX Consulting",
    body: "La plataforma de investigación de mercado de Voicenter: documento maestro versionado, agentes de IA con fuentes verificables y trabajo en equipo con método científico. Este recorrido dura un minuto.",
  },
  {
    target: '[data-tour="nav-proyectos"]',
    title: "Proyectos",
    body: "Tu espacio de trabajo. Cada proyecto tiene su documento maestro, fuentes con IA, KnowHub (audio y mapa mental), chat de equipo, Gantt, evaluación y métricas.",
  },
  {
    target: '[data-tour="nuevo-proyecto"]',
    title: "Creá un proyecto",
    body: "Elegí una plantilla metodológica: investigación de mercado BPO, consultoría a clientes (con preguntas guía) o estudio general. Cada una siembra el documento, el Gantt y las tareas iniciales.",
  },
  {
    target: '[data-tour="nav-metodo"]',
    title: "Método y fuentes",
    body: "Nuestro modelo investigativo documentado: el circuito de búsqueda de los agentes, la jerarquía de fuentes con sus logos y las compuertas de validación. Visible para todos — ideal para mostrar a clientes.",
  },
  {
    target: '[data-tour="nav-costos"]',
    title: "Costos IA",
    body: "Cuánto se gasta en inteligencia artificial: por modelo, por uso (investigador, edición APA, KnowHub…), por usuario y por proyecto. Todo trackeado, sin sorpresas.",
  },
  {
    target: '[data-tour="campana"]',
    title: "Notificaciones",
    body: "Mensajes del chat, menciones con @, notas nuevas y artefactos de KnowHub llegan acá — y cada aviso te lleva al lugar exacto. Se marcan leídos al abrirlos.",
  },
  {
    title: "Las secciones del proyecto",
    body: "Al entrar a un proyecto vas a ver sus pestañas de secciones arriba (Resumen, Documento, KnowHub…). Tocá el botón ? de arriba estando DENTRO de un proyecto y te las recorremos una por una.",
  },
];

/** Guía del navbar del proyecto: recorre pestaña por pestaña.
 *  Se dispara con el botón ? estando dentro de un proyecto (y sola, la
 *  primera vez que se entra a uno). Los tabs sin permiso se saltan. */
const TOUR_PROJECT: TourStep[] = [
  {
    title: "Las secciones del proyecto",
    body: "Cada proyecto se trabaja desde estas pestañas, organizadas en tres zonas: Trabajo, Vex Cowork y Control. Con «⌃ Ocultar» las plegás para trabajar a pantalla completa. Te mostramos qué hay en cada sección — 40 segundos.",
  },
  {
    target: '[data-tour="tab-resumen"]',
    title: "Resumen",
    body: "El estado del informe de un vistazo: palabras, páginas, citas y versiones. Desde acá se publica el proyecto y se exporta a Word o PDF con portada e índice.",
  },
  {
    target: '[data-tour="tab-document"]',
    title: "Documento",
    body: "El corazón del proyecto: el informe maestro versionado, con el investigador IA al lado (citas verificables, @fuentes, adjuntos y voz) y la Edición final APA antes de publicar.",
  },
  {
    target: '[data-tour="tab-preview"]',
    title: "Vista previa",
    body: "El documento como lo ve un lector, limpio y listo para imprimir o presentar.",
  },
  {
    target: '[data-tour="tab-sources"]',
    title: "Fuentes",
    body: "La base de conocimiento: PDF, Excel, Word, links, imágenes y audios. La IA los indexa y los cita por página u hoja en cada investigación.",
  },
  {
    target: '[data-tour="tab-notes"]',
    title: "Notas",
    body: "Hipótesis, hallazgos y tareas en tablero kanban. Se pueden mencionar con @ desde el chat y asignar a miembros (con notificación).",
  },
  {
    target: '[data-tour="tab-gantt"]',
    title: "Gantt",
    body: "El cronograma por fases metodológicas, con avance por tarea y generación asistida por IA.",
  },
  {
    target: '[data-tour="tab-chat"]',
    title: "Chat equipo",
    body: "Temas y mensajes directos del proyecto, con menciones @ a miembros, notas y reuniones. Los mensajes nuevos avisan por la campana.",
  },
  {
    target: '[data-tour="tab-meet"]',
    title: "Vex Meet",
    body: "Actas de reuniones del equipo: se mencionan personas (les llega la campana), fuentes y notas, y después la reunión se cita con @ desde el chat.",
  },
  {
    target: '[data-tour="tab-flows"]',
    title: "Flows",
    body: "Flujogramas de procesos y decisiones: dibujalos a mano o pedile a la IA que los genere desde una instrucción, exportalos a PNG o insertalos en el documento.",
  },
  {
    target: '[data-tour="tab-agent"]',
    title: "Agente Cowork",
    body: "El compañero IA del equipo: tiene el documento leído y conversa en hilos compartidos. Con @ sumás a un colega al hilo y también lo tenés como panel lateral en todo el proyecto.",
  },
  {
    target: '[data-tour="tab-knowhub"]',
    title: "KnowHub",
    body: "Entendé el proyecto en minutos: resumen de audio estilo podcast, mapa mental interactivo, briefing y FAQ — generados por IA y compartidos con el equipo.",
  },
  {
    target: '[data-tour="tab-evaluations"]',
    title: "Evaluación",
    body: "El evaluador independiente califica el informe contra la rúbrica de método científico (7 criterios) y verifica que las fuentes respalden lo afirmado.",
  },
  {
    target: '[data-tour="tab-metrics"]',
    title: "Métricas",
    body: "Aporte por consultor: ediciones, palabras, fuentes subidas y actividad en el tiempo.",
  },
  {
    target: '[data-tour="tab-members"]',
    title: "Equipo",
    body: "Quiénes participan y con qué permiso: lectura, escritura o edición total.",
  },
  {
    target: '[data-tour="tab-audit"]',
    title: "Auditoría",
    body: "Cada acción del proyecto registrada: quién, qué y cuándo — trazabilidad total.",
  },
  {
    title: "Listo",
    body: "Dentro del Documento tenés además el botón «? Guía» con el recorrido del editor y el investigador. Esta guía la repetís cuando quieras con el botón ? de arriba.",
  },
];

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));
  return (
    <Link href={href} className={active ? "nav-link-active" : "nav-link"}>
      {label}
    </Link>
  );
}

export default function AppShell({
  children,
  fluid = false,
}: {
  children: React.ReactNode;
  /** true = área de trabajo ancha (aprovecha monitores grandes). */
  fluid?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUserInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // Dentro de un proyecto el botón ? recorre SU navbar; fuera, la guía general
  const inProject =
    !!pathname && /^\/projects\/(?!new)[^/]+/.test(pathname);
  const tourSteps = inProject ? TOUR_PROJECT : TOUR_APP;
  const tourKey = inProject ? "vex_tour_project_v1" : "vex_tour_app_v1";

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    const u = getUser();
    setUser(u);
    if (u?.role === "visualizador") router.replace("/view");
  }, [router]);

  // Se activa sola la primera vez: la general al entrar a la app, y la del
  // proyecto SOLO en el Resumen (nunca emboscar con un modal en una página
  // profunda como Flows o el Documento — el ? la abre a mano donde sea).
  const inProjectRoot = !!pathname && /^\/projects\/(?!new)[^/]+$/.test(pathname);
  useEffect(() => {
    if (!user || user.role === "visualizador") return;
    if (inProject && !inProjectRoot) return;
    if (localStorage.getItem(tourKey)) return;
    const timer = setTimeout(() => setTourOpen(true), 900);
    return () => clearTimeout(timer);
  }, [user, tourKey, inProject, inProjectRoot]);

  const closeTour = () => {
    localStorage.setItem(tourKey, "1");
    setTourOpen(false);
  };

  // La guía del proyecto recorre las pestañas: si el usuario las tenía
  // ocultas («⌃ Ocultar»), el layout las muestra al recibir este evento.
  useEffect(() => {
    if (tourOpen && inProject) window.dispatchEvent(new Event("vex:tour-project"));
  }, [tourOpen, inProject]);

  const onLogout = () => {
    clearSession();
    router.push("/login");
  };

  if (!user) return null;

  const isSuperadmin = user.role === "superadmin";
  const isLider =
    user.role === "consultor_lider" || user.role === "consultor_lider_2" || isSuperadmin;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 bg-white border-b border-brand-border shadow-soft">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between gap-3">
          <Brand />
          <nav className="hidden lg:flex items-center gap-1">
            <span data-tour="nav-proyectos">
              <NavLink href="/dashboard" label="Proyectos" />
            </span>
            <span data-tour="nav-metodo">
              <NavLink href="/metodo" label="Método y fuentes" />
            </span>
            <NavLink href="/uso" label="Uso colaborativo" />
            {isLider && <NavLink href="/admin/users" label="Usuarios" />}
            {isLider && (
              <span data-tour="nav-costos">
                <NavLink href="/admin/costos" label="Costos IA" />
              </span>
            )}
            {isSuperadmin && <NavLink href="/admin/audit" label="Auditoría" />}
          </nav>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setTourOpen(true)}
              className="h-9 w-9 rounded-full bg-brand-primary/10 text-brand-primary font-bold text-base border border-brand-primary/30 hover:bg-brand-primary hover:text-white transition-colors flex items-center justify-center shrink-0"
              title="Visita guiada: recorré la plataforma paso a paso"
              aria-label="Visita guiada"
            >
              ?
            </button>
            <span data-tour="campana">
              <NotificationBell />
            </span>
            <div className="hidden lg:block text-right">
              <div className="text-sm font-semibold text-brand-ink leading-tight whitespace-nowrap">
                {user.full_name}
              </div>
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate whitespace-nowrap">
                {ROLE_LABELS[user.role] ?? user.role}
              </div>
            </div>
            <Link
              href="/perfil"
              title="Mi perfil: foto, contraseña y doble autenticación"
              className="shrink-0"
            >
              {user.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.photo_url}
                  alt="Perfil"
                  className="h-9 w-9 rounded-full object-cover border-2 border-brand-border hover:border-brand-primary transition-colors"
                />
              ) : (
                <div className="h-9 w-9 rounded-full bg-brand-primary text-white flex items-center justify-center font-bold text-sm hover:opacity-85">
                  {user.full_name?.slice(0, 1).toUpperCase()}
                </div>
              )}
            </Link>
            <button onClick={onLogout} className="hidden lg:inline-flex btn-ghost text-xs">
              Salir
            </button>
            <button
              className="lg:hidden btn-ghost !px-2 text-xl leading-none"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menú"
            >
              ☰
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="lg:hidden border-t border-brand-border px-4 py-3 flex flex-col gap-1 animate-fade">
            <div className="pb-2 mb-1 border-b border-brand-border">
              <div className="text-sm font-semibold text-brand-ink">{user.full_name}</div>
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">
                {ROLE_LABELS[user.role] ?? user.role}
              </div>
            </div>
            <NavLink href="/dashboard" label="Proyectos" />
            <NavLink href="/metodo" label="Método y fuentes" />
            <NavLink href="/uso" label="Uso colaborativo" />
            {isLider && <NavLink href="/admin/users" label="Usuarios" />}
            {isLider && <NavLink href="/admin/costos" label="Costos IA" />}
            {isSuperadmin && <NavLink href="/admin/audit" label="Auditoría" />}
            <button
              onClick={onLogout}
              className="mt-1 text-left px-3 py-2 text-sm text-brand-primary font-semibold rounded-md hover:bg-brand-primary-light"
            >
              Salir
            </button>
          </nav>
        )}
      </header>

      <main
        className={`flex-1 mx-auto w-full px-4 py-6 ${fluid ? "max-w-[1760px]" : "max-w-7xl"}`}
      >
        {children}
      </main>

      <footer className="border-t border-brand-border bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 text-xs text-brand-slate flex justify-between">
          <span>© {new Date().getFullYear()} Voicenter S.A.</span>
          <span>
            VEX Consulting · Investigación de mercado{" "}
            <span
              className="text-brand-mist font-mono"
              title="Versión desplegada (commit)"
            >
              · v{process.env.NEXT_PUBLIC_BUILD || "dev"}
            </span>
          </span>
        </div>
      </footer>

      {/* Visita guiada (primera vez, o desde el botón ? del header):
          general en la app, del navbar dentro de un proyecto */}
      {tourOpen && <GuidedTour steps={tourSteps} onClose={closeTour} />}
    </div>
  );
}
