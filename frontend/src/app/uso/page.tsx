"use client";

import AppShell from "@/components/AppShell";

/* ============ Guía de uso colaborativo de la plataforma ============
   Página estática para TODOS los roles: cómo funciona la zona de Trabajo
   (documento, guardado, agentes, inserción), la de Colaboración (chat,
   KnowHub, notificaciones) y la de Control. Sin emojis: acentos de marca. */

const ZONES = [
  { id: "trabajo", label: "Trabajo", accent: "#E6332A" },
  { id: "agentes", label: "Agentes de IA", accent: "#E6332A" },
  { id: "colaboracion", label: "Colaboración", accent: "#00B2BF" },
  { id: "knowhub", label: "KnowHub", accent: "#00B2BF" },
  { id: "control", label: "Control", accent: "#F39200" },
  { id: "publicar", label: "Publicar y exportar", accent: "#662483" },
];

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full mr-2 align-middle"
      style={{ background: color }}
    />
  );
}

function Section({
  id, accent, kicker, title, children,
}: {
  id: string;
  accent: string;
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-center gap-2 mb-1">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
        <span
          className="text-xs font-bold uppercase tracking-wider2"
          style={{ color: accent }}
        >
          {kicker}
        </span>
      </div>
      <h2 className="font-display text-2xl uppercase text-brand-ink mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Card({
  title, accent = "#E6332A", children,
}: {
  title: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5 border-l-4" style={{ borderLeftColor: accent }}>
      <h3 className="font-semibold text-brand-ink mb-2">{title}</h3>
      <div className="text-sm text-brand-graphite leading-relaxed space-y-2">{children}</div>
    </div>
  );
}

function Steps({ items }: { items: [string, string][] }) {
  return (
    <ol className="space-y-2">
      {items.map(([t, d], i) => (
        <li key={i} className="flex gap-3">
          <span className="h-6 w-6 shrink-0 rounded-full bg-brand-ink text-white text-xs font-bold flex items-center justify-center mt-0.5">
            {i + 1}
          </span>
          <span>
            <b className="text-brand-ink">{t}.</b> {d}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function UsoPage() {
  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        {/* Hero */}
        <div className="rounded-2xl bg-brand-ink text-white p-8 md:p-10 mb-8">
          <div className="text-[11px] uppercase tracking-[0.25em] text-white/60 mb-2">
            VEX Consulting · Guía para todo el equipo
          </div>
          <h1 className="font-display text-3xl md:text-4xl uppercase leading-tight">
            Uso colaborativo de la plataforma
          </h1>
          <p className="text-white/75 mt-3 max-w-3xl text-sm leading-relaxed">
            Cómo se trabaja el documento maestro, cómo se usan los agentes de IA, cómo
            colabora el equipo en el chat y el KnowHub, y cómo se controla la calidad.
            Cada proyecto se organiza en tres zonas —{" "}
            <b className="text-white">Trabajo</b>, <b className="text-white">Colaboración</b> y{" "}
            <b className="text-white">Control</b> — que vas a encontrar en el navbar del
            proyecto.
          </p>
        </div>

        {/* Anclas */}
        <div className="sticky top-16 z-20 -mx-4 px-4 py-2 bg-brand-bg/95 backdrop-blur-sm border-b border-brand-border/60 mb-8">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-thin">
            {ZONES.map((z) => (
              <a
                key={z.id}
                href={`#${z.id}`}
                className="whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold border border-brand-border bg-white text-brand-slate hover:text-brand-ink hover:border-brand-ink transition-colors"
              >
                <Dot color={z.accent} />
                {z.label}
              </a>
            ))}
          </div>
        </div>

        <div className="space-y-12 pb-16">
          {/* ================= TRABAJO ================= */}
          <Section id="trabajo" accent="#E6332A" kicker="Zona de trabajo" title="El documento maestro">
            <Card title="Un solo documento, todas las versiones">
              <p>
                Cada proyecto tiene <b>un documento maestro</b> que todo el equipo edita.
                Cada vez que guardás se crea una <b>versión numerada</b> con tu nombre,
                el resumen del cambio y la diferencia línea por línea: en{" "}
                <b>historial</b> podés comparar cualquier versión y <b>restaurarla</b> si
                hace falta. Nada se pierde nunca.
              </p>
              <p>
                Mientras alguien edita, el documento queda con un <b>bloqueo suave</b>:
                el resto lo ve en modo lectura con el aviso de quién está escribiendo.
                El bloqueo se libera solo al salir (o a los 90 segundos si se corta la
                conexión).
              </p>
            </Card>
            <Card title="¿Cada cuánto se guarda? — El sistema de autoguardado">
              <Steps
                items={[
                  ["Borrador local, cada 5 segundos", "mientras tenés cambios sin guardar, se copia un borrador en tu navegador. Si se corta la luz o se cierra la pestaña, al volver aparece «Hay un borrador sin guardar» con la opción de recuperarlo."],
                  ["Autoguardado al servidor, a los 45 segundos", "si dejás de escribir 45 segundos con cambios pendientes, se guarda solo como una versión «Autoguardado». El chip de arriba te muestra el estado en vivo: Cambios sin guardar → Guardando… → Guardado hace X (auto)."],
                  ["Guardado manual", "con el botón «Guardar versión» o Ctrl+S, idealmente con un resumen corto del cambio para que el equipo siga la historia."],
                ]}
              />
              <p className="text-xs text-brand-slate">
                Además, si intentás cerrar la pestaña con cambios sin guardar, el
                navegador te avisa antes.
              </p>
            </Card>
            <Card title="Herramientas de escritura">
              <ul className="list-disc pl-5 space-y-1">
                <li><b>Índice lateral</b>: se arma solo con los títulos del documento; click para saltar a una sección y resaltado de dónde estás mientras leés.</li>
                <li><b>Modo Enfoque</b>: oculta el panel de IA y centra el texto para escribir largo (Esc para salir).</li>
                <li><b>Aa (tipografía)</b>: cambiá fuente, tamaño e interlineado <i>solo de tu vista</i> — el export mantiene el estilo corporativo.</li>
                <li><b>Contadores en vivo</b>: palabras, páginas estimadas (~300 palabras/página) y minutos de lectura, mientras escribís.</li>
                <li><b>Fuentes</b>: subí PDF, Word, Excel o links en la pestaña Fuentes; se indexan y los agentes las citan. En el investigador podés acotar una consulta a fuentes específicas con <b>@</b>.</li>
                <li><b>Notas</b>: kanban de hipótesis, hallazgos y tareas — arrastrá las tarjetas entre columnas para cambiarles el estado.</li>
                <li><b>Gantt</b>: tareas con varios responsables, arrastrá la barra para mover fechas o estirá los bordes para cambiar la duración; vista Lista tipo gestor de proyectos; «Generar con IA» propone el cronograma.</li>
              </ul>
            </Card>
          </Section>

          {/* ================= AGENTES ================= */}
          <Section id="agentes" accent="#E6332A" kicker="Zona de trabajo" title="Cómo usar cada agente de IA">
            <Card title="Investigador (panel derecho del documento)">
              <p>
                Es el agente principal: escribile qué investigar y busca en las{" "}
                <b>fuentes del proyecto</b>, la <b>web</b> y <b>Perplexity</b>, siempre
                con citas verificables. Recuerda todo el hilo (seguí escribiendo como en
                un chat), y los hilos quedan guardados en el selector. Extras: rigor{" "}
                <b>Estándar</b> (consultora) o <b>Académico</b> (papers), adjuntar
                imagen o nota de voz, y <b>@fuente</b> para basar la respuesta solo en
                fuentes específicas.
              </p>
            </Card>
            <Card title="Insertar los cambios en el documento — las dos formas">
              <Steps
                items={[
                  ["Insertar en el cursor", "pega el resultado exactamente donde tenés el cursor. Control manual total: vos decidís dónde va y lo editás."],
                  ["Insertar donde corresponde", "el agente EDITOR lee tu documento completo, decide en qué secciones va cada hallazgo, actualiza cifras o títulos que quedaron viejos y lo integra con el estilo del informe. Crea una versión nueva revisable (compará el diff en el historial). Requiere que tus cambios estén guardados."],
                ]}
              />
            </Card>
            <Card title="Ayuda de redacción (botón IA de la barra del editor)">
              <p>
                Para escribir, no investigar: <b>Continuar</b> el texto donde está el
                cursor, <b>Mejorar</b> la redacción, <b>Resumir</b> o ampliar{" "}
                <b>con fuentes</b>. La sugerencia se muestra primero y la insertás si te
                convence.
              </p>
            </Card>
            <Card title="Modo automático (investiga solo e inserta)">
              <p>
                Describís claramente <b>qué investigar y qué insertar</b>, y el agente
                arma el plan, ejecuta cada investigación y guarda todo como versión
                nueva. Mientras corre, el documento queda <b>bloqueado</b> y ves el
                avance con porcentaje, etapa y tiempo estimado; podés navegar o cerrar
                la pestaña (corre en el servidor) y al final te llega la notificación
                con la duración. Se puede cancelar; una misión por proyecto a la vez.
              </p>
            </Card>
            <Card title="Edición final APA (antes de publicar)">
              <p>
                Cuando el contenido está cerrado: corrige estilo y ortografía, convierte
                las citas a <b>APA 7</b> (autor-año), numera tablas y figuras y arma la
                lista de Referencias. El resultado es una versión nueva que revisás en el
                historial antes de publicar.
              </p>
            </Card>
            <p className="text-xs text-brand-slate">
              Todo el gasto de estos agentes queda registrado y el consultor líder lo ve
              desglosado en <b>Costos IA</b> (por uso, por modelo, por usuario y por
              proyecto).
            </p>
          </Section>

          {/* ================= COLABORACIÓN ================= */}
          <Section id="colaboracion" accent="#00B2BF" kicker="Zona de colaboración" title="El chat del equipo">
            <Card title="Temas y directos" accent="#00B2BF">
              <p>
                Cada proyecto tiene canales por <b>tema</b> (el «general» se crea solo;
                creá los que necesites) y <b>directos</b> uno a uno. El punto verde
                muestra quién está en línea, y los canales con mensajes nuevos aparecen
                con contador y el divisor «Nuevos mensajes» donde dejaste de leer.
              </p>
            </Card>
            <Card title="Qué podés hacer en una conversación" accent="#00B2BF">
              <ul className="list-disc pl-5 space-y-1">
                <li><b>Hilos</b>: respondé un mensaje puntual sin ensuciar el canal — el autor recibe el aviso.</li>
                <li><b>Reacciones</b>: pasá el mouse por un mensaje y reaccioná; un click en el chip la quita.</li>
                <li><b>Menciones</b>: <b>@persona</b> le manda notificación directa; <b>@nota</b> enlaza una nota de seguimiento del proyecto.</li>
                <li><b>Adjuntos</b>: imágenes (se ven en el mensaje) y archivos (PDF, Excel, Word…) con descarga.</li>
                <li><b>Fijados</b>: fijá los mensajes importantes; quedan en la barra superior del canal.</li>
                <li><b>Buscar</b>: el buscador de arriba encuentra mensajes en todos tus canales del proyecto.</li>
                <li><b>Editar y borrar</b>: tus propios mensajes (queda la marca «editado»); los admins pueden moderar.</li>
                <li>Markdown: negrita, código y links clickeables.</li>
              </ul>
            </Card>
            <Card title="Notificaciones (la campana)" accent="#00B2BF">
              <p>
                Todo lo que te involucra llega a la campana: menciones, directos, hilos
                respondidos, notas asignadas, evaluaciones e investigaciones terminadas,
                artefactos nuevos del KnowHub. Cada notificación te lleva{" "}
                <b>exactamente</b> al lugar (el canal, la nota, el informe) y desaparece
                al leerla.
              </p>
            </Card>
          </Section>

          {/* ================= KNOWHUB ================= */}
          <Section id="knowhub" accent="#00B2BF" kicker="Zona de colaboración" title="KnowHub: entender el proyecto en minutos">
            <p className="text-sm text-brand-graphite leading-relaxed">
              El KnowHub genera artefactos de comprensión a partir del informe y sus
              fuentes. Todos <b>corren en el servidor</b> (podés navegar mientras),
              quedan <b>versionados</b>, son <b>visibles para todo el equipo</b> y
              avisan por la campana al estar listos.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <Card title="Resumen de audio" accent="#00B2BF">
                <p>
                  Un podcast de 5-8 minutos con dos voces (conductora y analista) que
                  recorre el problema, las hipótesis y los hallazgos con sus cifras.
                  Ideal para ponerse al día camino a una reunión. Se puede{" "}
                  <b>descargar el MP3</b> y <b>ver el guion</b>.
                </p>
              </Card>
              <Card title="Mapa mental" accent="#662483">
                <p>
                  La estructura completa del proyecto para explorar: zoom, ramas
                  colapsables (<b>Ramas / Detalle / Todo</b>), click en el texto de un
                  tema para ver su detalle, y descarga en SVG.
                </p>
              </Card>
              <Card title="Briefing ejecutivo y FAQ" accent="#00B2BF">
                <p>
                  El briefing es <b>una página</b> para entender el proyecto en 3
                  minutos; las FAQ responden lo que preguntaría alguien que recién se
                  suma. Ambos se copian con un click para pegar donde necesites.
                </p>
              </Card>
              <Card title="Presentación" accent="#E6332A">
                <p>
                  Slides profesionales con la marca: elegí el enfoque —{" "}
                  <b>Resumen ejecutivo</b>, <b>Explicativa</b>, <b>Corporativa</b> o{" "}
                  <b>Personalizada</b> (describís audiencia y qué destacar)— y generá.
                  Se presenta a pantalla completa (flechas del teclado), se{" "}
                  <b>exporta a PDF</b> (una slide por página) o se{" "}
                  <b>descarga como HTML</b> para enviar por correo.
                </p>
              </Card>
            </div>
          </Section>

          {/* ================= CONTROL ================= */}
          <Section id="control" accent="#F39200" kicker="Zona de control" title="Calidad, equipo y trazabilidad">
            <Card title="Evaluación (el evaluador experto)" accent="#F39200">
              <p>
                Un click y el agente lee el documento, verifica el respaldo de las
                afirmaciones contra las fuentes y califica con la rúbrica de método
                científico. Ves el progreso en vivo y, al terminar, el informe se abre
                solo: puntaje por criterio, <b>veredicto</b>, fortalezas y debilidades
                con ejemplos textuales y «qué hacer ahora» priorizado.
              </p>
            </Card>
            <Card title="Equipo y permisos" accent="#F39200">
              <ul className="list-disc pl-5 space-y-1">
                <li><b>Lectura</b>: ve todo el proyecto sin editar.</li>
                <li><b>Escritura</b>: edita el documento, usa los agentes, participa del chat.</li>
                <li><b>Admin</b>: además gestiona miembros, ve métricas y auditoría, y modera el chat.</li>
                <li><b>Visualizadores</b>: solo ven la <b>versión publicada</b> del informe (con su propio asistente de consulta) — nunca el borrador ni el trabajo interno.</li>
              </ul>
            </Card>
            <Card title="Métricas y auditoría" accent="#F39200">
              <p>
                <b>Métricas</b> muestra el aporte de cada consultor (ediciones, palabras,
                fuentes, consultas a la IA). <b>Auditoría</b> registra cada acción con
                fecha, autor e IP: quién guardó, quién publicó, quién corrió qué agente.
              </p>
            </Card>
          </Section>

          {/* ================= PUBLICAR ================= */}
          <Section id="publicar" accent="#662483" kicker="Cierre" title="Publicar y exportar">
            <Card title="El flujo de cierre recomendado" accent="#662483">
              <Steps
                items={[
                  ["Evaluá", "corré el evaluador y resolvé el «qué hacer ahora» del informe."],
                  ["Edición final APA", "con el contenido cerrado, dejá las citas, tablas y referencias en norma."],
                  ["Revisá la versión", "compará el diff en el historial; si algo no convence, restaurá o ajustá a mano."],
                  ["Publicá", "desde Resumen → «Publicar proyecto»: congela esa versión, que es lo único visible para visualizadores."],
                  ["Exportá", "Word o PDF con portada, índice con números de página y numeración — listos para el cliente."],
                ]}
              />
            </Card>
            <p className="text-xs text-brand-slate">
              ¿Dudas dentro de una pantalla? El botón <b>?</b> de arriba a la derecha
              inicia la visita guiada de la sección donde estés.
            </p>
          </Section>
        </div>
      </div>
    </AppShell>
  );
}
