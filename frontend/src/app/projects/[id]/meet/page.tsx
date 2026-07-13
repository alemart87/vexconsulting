"use client";

/** Vex Meet (zona Vex Cowork): actas de reunión del proyecto.
 *
 *  La memoria del equipo: cada reunión guarda sus notas con menciones a
 *  personas (@), fuentes internas (📎) y notas de seguimiento (📝). Los
 *  mencionados reciben campana, y la reunión se puede citar después en el
 *  chat del equipo con @📅.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, getUser, parseApiDate } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Person {
  id: string;
  name: string;
}
interface MeetingSummary {
  id: string;
  title: string;
  meeting_date: string;
  location?: string | null;
  attendees: Person[];
  excerpt: string;
  words: number;
  created_by: string;
  created_by_name?: string | null;
  updated_at: string;
}
interface Meeting extends MeetingSummary {
  content_md: string;
  mentions: {
    users?: Person[];
    sources?: { id: string; title: string }[];
    notes?: { id: string; title: string }[];
  };
  created_at: string;
}
interface Mentionables {
  users: Person[];
  sources: { id: string; title: string; kind: string }[];
  notes: { id: string; title: string; status: string }[];
}

const MEET_MENTION_RE =
  /(@[\wÁÉÍÓÚáéíóúÑñ📎📝][^\s,.;:!?]*(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúÑñ]*)?)/g;

const TEMPLATE = `## Agenda

-

## Decisiones

-

## Acciones

- [ ] `;

const fmtDate = (iso: string) =>
  parseApiDate(iso).toLocaleDateString("es-PY", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
const fmtTime = (iso: string) =>
  parseApiDate(iso).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });

/** ISO → valor de <input type="datetime-local"> en hora local. */
const toLocalInput = (iso?: string) => {
  const d = iso ? parseApiDate(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function Initials({ name }: { name: string }) {
  return (
    <span
      title={name}
      className="h-6 w-6 rounded-full bg-brand-purple text-white flex items-center justify-center text-[10px] font-bold border-2 border-white -ml-1 first:ml-0"
    >
      {(name || "?")
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()}
    </span>
  );
}

/** Markdown del acta con menciones resaltadas. */
function MeetMarkdown({ content }: { content: string }) {
  const processed = content.replace(MEET_MENTION_RE, (t) => `[${t}](#mention)`);
  return (
    <div className="prose-vex text-[14px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href === "#mention" ? (
              <span className="text-brand-cyan font-semibold">{children}</span>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-cyan underline">
                {children}
              </a>
            ),
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}

export default function MeetPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { project } = useProject();
  const me = getUser();
  const isAdmin = project?.my_permission === "admin";

  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [mentionables, setMentionables] = useState<Mentionables>({ users: [], sources: [], notes: [] });

  // Editor (nueva reunión o edición)
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [dateVal, setDateVal] = useState(toLocalInput());
  const [location, setLocation] = useState("");
  const [content, setContent] = useState("");
  const [attendees, setAttendees] = useState<Person[]>([]);
  const [mentions, setMentions] = useState<Meeting["mentions"]>({ users: [], sources: [], notes: [] });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mentionFilter, setMentionFilter] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(
    async (q = "") => {
      const list = await apiFetch<MeetingSummary[]>(
        `/api/v1/projects/${params.id}/meetings${q ? `?q=${encodeURIComponent(q)}` : ""}`
      );
      setMeetings(list);
      setLoading(false);
      return list;
    },
    [params.id]
  );

  const open = useCallback(
    async (id: string) => {
      try {
        const m = await apiFetch<Meeting>(`/api/v1/projects/${params.id}/meetings/${id}`);
        setSelected(m);
        setEditing(false);
        setConfirmDelete(false);
      } catch {}
    },
    [params.id]
  );

  useEffect(() => {
    load()
      .then((list) => {
        // ?open=... (desde el chat o una notificación): abrir esa reunión
        const wanted = new URLSearchParams(window.location.search).get("open");
        if (wanted && list.some((m) => m.id === wanted)) open(wanted);
        else if (list.length) open(list[0].id);
      })
      .catch(() => setLoading(false));
    apiFetch<Mentionables>(`/api/v1/projects/${params.id}/meetings/mentionables`)
      .then(setMentionables)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  // Búsqueda con debounce
  useEffect(() => {
    const t = setTimeout(() => load(searchQ.trim()).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [searchQ, load]);

  const startNew = () => {
    setEditing(true);
    setEditId(null);
    setTitle("");
    setDateVal(toLocalInput());
    setLocation("");
    setContent(TEMPLATE);
    setAttendees(me ? [{ id: me.id, name: me.full_name }] : []);
    setMentions({ users: [], sources: [], notes: [] });
    setMentionFilter(null);
  };

  const startEdit = (m: Meeting) => {
    setEditing(true);
    setEditId(m.id);
    setTitle(m.title);
    setDateVal(toLocalInput(m.meeting_date));
    setLocation(m.location || "");
    setContent(m.content_md);
    setAttendees(m.attendees || []);
    setMentions(m.mentions || { users: [], sources: [], notes: [] });
    setMentionFilter(null);
  };

  const save = async () => {
    if (title.trim().length < 3 || saving) return;
    setSaving(true);
    try {
      const body = JSON.stringify({
        title: title.trim(),
        meeting_date: new Date(dateVal).toISOString(),
        location: location.trim() || null,
        content_md: content,
        attendees,
        mentions,
      });
      const m = editId
        ? await apiFetch<Meeting>(`/api/v1/projects/${params.id}/meetings/${editId}`, {
            method: "PATCH",
            body,
          })
        : await apiFetch<Meeting>(`/api/v1/projects/${params.id}/meetings`, {
            method: "POST",
            body,
          });
      setEditing(false);
      setSelected(m);
      await load(searchQ.trim());
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    try {
      await apiFetch(`/api/v1/projects/${params.id}/meetings/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      const list = await load(searchQ.trim());
      if (list.length) open(list[0].id);
    } catch (e: any) {
      alert(e.message);
    }
  };

  // ---- Menciones en el editor (@persona, @📎fuente, @📝nota) ----
  const onContentChange = (value: string) => {
    setContent(value);
    const cursor = contentRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const match = before.match(/@([\wÁÉÍÓÚáéíóúÑñ]*)$/);
    setMentionFilter(match ? match[1].toLowerCase() : null);
  };

  const applyMention = (kind: "user" | "source" | "note", item: any) => {
    const label =
      kind === "user" ? `@${item.name}` : kind === "source" ? `@📎${item.title}` : `@📝${item.title}`;
    const ta = contentRef.current;
    const cursor = ta?.selectionStart ?? content.length;
    const before = content.slice(0, cursor).replace(/@[\wÁÉÍÓÚáéíóúÑñ]*$/, `${label} `);
    setContent(before + content.slice(cursor));
    setMentions((prev) => ({
      users:
        kind === "user" && !(prev.users || []).some((u) => u.id === item.id)
          ? [...(prev.users || []), { id: item.id, name: item.name }]
          : prev.users || [],
      sources:
        kind === "source" && !(prev.sources || []).some((s) => s.id === item.id)
          ? [...(prev.sources || []), { id: item.id, title: item.title }]
          : prev.sources || [],
      notes:
        kind === "note" && !(prev.notes || []).some((n) => n.id === item.id)
          ? [...(prev.notes || []), { id: item.id, title: item.title }]
          : prev.notes || [],
    }));
    setMentionFilter(null);
    requestAnimationFrame(() => ta?.focus());
  };

  const toggleAttendee = (p: Person) => {
    setAttendees((prev) =>
      prev.some((a) => a.id === p.id) ? prev.filter((a) => a.id !== p.id) : [...prev, p]
    );
  };

  const fUsers = mentionables.users.filter(
    (u) => mentionFilter !== null && u.name.toLowerCase().includes(mentionFilter)
  );
  const fSources = mentionables.sources.filter(
    (s) => mentionFilter !== null && s.title.toLowerCase().includes(mentionFilter)
  );
  const fNotes = mentionables.notes.filter(
    (n) => mentionFilter !== null && n.title.toLowerCase().includes(mentionFilter)
  );

  const canEdit = (m: Meeting | null) => !!m && (m.created_by === me?.id || isAdmin);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4 items-start">
      {/* ---- Columna izquierda: lista de reuniones ---- */}
      <div className="card overflow-hidden">
        <div className="p-3 border-b border-brand-border space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display uppercase text-brand-ink leading-none">
              📅 Vex Meet
            </h2>
            <button className="btn-primary !py-1.5 !px-3 text-xs" onClick={startNew}>
              + Nueva reunión
            </button>
          </div>
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Buscar en las actas…"
            className="input w-full !py-1.5 text-sm"
          />
        </div>
        <div className="max-h-[68vh] overflow-y-auto scrollbar-thin">
          {loading && <p className="p-4 text-sm text-brand-slate">Cargando…</p>}
          {!loading && meetings.length === 0 && (
            <div className="p-5 text-sm text-brand-slate">
              <p className="font-semibold text-brand-ink mb-1">Todavía no hay reuniones.</p>
              Registrá la primera: las decisiones quedan con memoria, los mencionados
              reciben campana y el acta se puede citar en el chat con <b>@</b>.
            </div>
          )}
          {meetings.map((m) => (
            <button
              key={m.id}
              onClick={() => open(m.id)}
              className={`w-full text-left px-4 py-3 border-b border-brand-border/60 transition-colors ${
                selected?.id === m.id && !editing ? "bg-brand-primary-light/50" : "hover:bg-brand-bg-soft"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-brand-ink truncate">{m.title}</span>
                <span className="text-[10px] text-brand-mist shrink-0 tabular-nums">
                  {fmtDate(m.meeting_date)}
                </span>
              </div>
              <p className="text-xs text-brand-slate truncate mt-0.5">{m.excerpt || "Sin notas aún"}</p>
              <div className="flex items-center justify-between mt-1.5">
                <div className="flex">
                  {(m.attendees || []).slice(0, 5).map((a) => (
                    <Initials key={a.id} name={a.name} />
                  ))}
                  {(m.attendees || []).length > 5 && (
                    <span className="text-[10px] text-brand-mist ml-1">
                      +{(m.attendees || []).length - 5}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-brand-mist">{m.words} palabras</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ---- Columna derecha: detalle o editor ---- */}
      <div className="card p-5 min-h-[50vh]">
        {editing ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="font-display uppercase text-brand-ink">
                {editId ? "Editar reunión" : "Nueva reunión"}
              </h3>
              <div className="flex gap-2">
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => setEditing(false)}>
                  Cancelar
                </button>
                <button
                  className="btn-primary !py-1.5 text-xs"
                  onClick={save}
                  disabled={saving || title.trim().length < 3}
                >
                  {saving ? "Guardando…" : "Guardar reunión"}
                </button>
              </div>
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título — ej.: Kickoff con cliente, Revisión semanal…"
              className="input w-full font-semibold"
              maxLength={200}
            />
            <div className="grid sm:grid-cols-2 gap-2">
              <input
                type="datetime-local"
                value={dateVal}
                onChange={(e) => setDateVal(e.target.value)}
                className="input w-full text-sm"
              />
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Lugar o link de la llamada (opcional)"
                className="input w-full text-sm"
                maxLength={200}
              />
            </div>

            {/* Asistentes */}
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider2 text-brand-slate mb-1">
                Asistentes
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {mentionables.users.map((u) => {
                  const on = attendees.some((a) => a.id === u.id);
                  return (
                    <button
                      key={u.id}
                      onClick={() => toggleAttendee(u)}
                      className={`text-xs px-2.5 py-1 rounded-full border font-semibold transition-colors ${
                        on
                          ? "bg-brand-cyan text-white border-brand-cyan"
                          : "bg-white text-brand-slate border-brand-border hover:border-brand-cyan"
                      }`}
                    >
                      {on ? "✓ " : ""}
                      {u.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notas con menciones */}
            <div className="relative">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] font-bold uppercase tracking-wider2 text-brand-slate">
                  Notas de la reunión
                </div>
                <span className="text-[11px] text-brand-mist">
                  <b>@</b> menciona personas · <b>@</b>📎 cita fuentes · <b>@</b>📝 enlaza notas
                </span>
              </div>
              {mentionFilter !== null && (fUsers.length > 0 || fSources.length > 0 || fNotes.length > 0) && (
                <div className="absolute top-8 left-0 right-0 glass rounded-xl max-h-52 overflow-y-auto animate-pop z-20 shadow-elevated">
                  {fUsers.map((u) => (
                    <button
                      key={u.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-brand-bg"
                      onClick={() => applyMention("user", u)}
                    >
                      👤 {u.name}
                    </button>
                  ))}
                  {fSources.map((s) => (
                    <button
                      key={s.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-brand-bg"
                      onClick={() => applyMention("source", s)}
                    >
                      📎 {s.title}
                      <span className="badge-neutral ml-1">{s.kind === "link" ? "link" : "archivo"}</span>
                    </button>
                  ))}
                  {fNotes.map((n) => (
                    <button
                      key={n.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-brand-bg"
                      onClick={() => applyMention("note", n)}
                    >
                      📝 {n.title} <span className="badge-neutral ml-1">{n.status}</span>
                    </button>
                  ))}
                </div>
              )}
              <textarea
                ref={contentRef}
                value={content}
                onChange={(e) => onContentChange(e.target.value)}
                onKeyUp={(e) => onContentChange((e.target as HTMLTextAreaElement).value)}
                onClick={(e) => onContentChange((e.target as HTMLTextAreaElement).value)}
                rows={16}
                placeholder="Agenda, decisiones, acciones… Escribí @ para mencionar."
                className="input w-full font-mono text-[13px] leading-relaxed"
              />
            </div>
          </div>
        ) : selected ? (
          <div>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="font-display text-xl uppercase text-brand-ink leading-tight">
                  {selected.title}
                </h3>
                <div className="mt-1 text-xs text-brand-slate flex items-center gap-2 flex-wrap">
                  <span className="badge-cyan">
                    📅 {fmtDate(selected.meeting_date)} · {fmtTime(selected.meeting_date)}
                  </span>
                  {selected.location && <span className="badge-neutral">📍 {selected.location}</span>}
                  <span>
                    registrada por <b>{selected.created_by_name || "—"}</b>
                  </span>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  className="btn-ghost !py-1.5 text-xs"
                  title="Abrir el chat con esta reunión ya mencionada"
                  onClick={() =>
                    router.push(
                      `/projects/${params.id}/chat?mention_meeting=${selected.id}&mention_title=${encodeURIComponent(selected.title)}`
                    )
                  }
                >
                  💬 Comentar en el chat
                </button>
                {canEdit(selected) && (
                  <>
                    <button className="btn-ghost !py-1.5 text-xs" onClick={() => startEdit(selected)}>
                      ✏️ Editar
                    </button>
                    <button
                      className={`!py-1.5 text-xs px-3 rounded-md border font-semibold ${
                        confirmDelete
                          ? "bg-brand-primary text-white border-brand-primary"
                          : "border-brand-border text-brand-slate hover:border-brand-primary hover:text-brand-primary"
                      }`}
                      onClick={remove}
                    >
                      {confirmDelete ? "¿Borrar acta?" : "🗑"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Asistentes */}
            {(selected.attendees || []).length > 0 && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider2 text-brand-slate">
                  Asistentes
                </span>
                {(selected.attendees || []).map((a) => (
                  <span
                    key={a.id}
                    className="text-xs px-2 py-0.5 rounded-full bg-brand-bg border border-brand-border text-brand-ink font-medium"
                  >
                    {a.name}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-brand-border pt-4">
              {selected.content_md?.trim() ? (
                <MeetMarkdown content={selected.content_md} />
              ) : (
                <p className="text-sm text-brand-slate">Sin notas registradas.</p>
              )}
            </div>

            {/* Citas: fuentes y notas mencionadas */}
            {((selected.mentions?.sources?.length ?? 0) > 0 ||
              (selected.mentions?.notes?.length ?? 0) > 0) && (
              <div className="mt-4 border-t border-brand-border pt-3">
                <div className="text-[11px] font-bold uppercase tracking-wider2 text-brand-slate mb-1.5">
                  Citado en esta reunión
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {(selected.mentions?.sources || []).map((s) => (
                    <a
                      key={s.id}
                      href={`/projects/${params.id}/sources`}
                      className="text-[11px] px-2 py-1 rounded font-semibold bg-brand-orange/10 text-brand-orange hover:bg-brand-orange hover:text-white transition-colors"
                    >
                      📎 {s.title}
                    </a>
                  ))}
                  {(selected.mentions?.notes || []).map((n) => (
                    <a
                      key={n.id}
                      href={`/projects/${params.id}/notes?note=${n.id}`}
                      className="text-[11px] px-2 py-1 rounded font-semibold bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan hover:text-white transition-colors"
                    >
                      📝 {n.title}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center py-16">
            <div className="text-4xl mb-3">📅</div>
            <p className="font-display uppercase text-brand-ink">La memoria de tu equipo</p>
            <p className="text-sm text-brand-slate mt-1 max-w-md">
              Registrá cada reunión con sus decisiones y acciones. Mencioná personas con{" "}
              <b>@</b>, citá archivos y notas internas, y traé el acta al chat cuando la
              conversación lo necesite.
            </p>
            <button className="btn-primary mt-4" onClick={startNew}>
              + Registrar la primera reunión
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
