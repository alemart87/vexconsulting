"use client";

/** Agente Cowork (zona Vex Cowork): el compañero de equipo IA del proyecto.
 *
 *  Tiene el documento maestro LEÍDO y conversa de forma natural. Las
 *  conversaciones son COMPARTIDAS: cualquier miembro puede sumarse, y con
 *  @mención se invita a un compañero (campana con link directo) para que
 *  ambos sigan el hilo con el agente.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, getUser, parseApiDate } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Conv {
  id: string;
  title: string;
  participants: string[];
  last_message?: string | null;
  last_role?: string | null;
  pinned_at?: string | null;
  archived_at?: string | null;
  updated_at: string;
}
interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  author_id?: string | null;
  author_name?: string | null;
  author_photo_url?: string | null;
  mentions?: { id: string; name: string }[] | null;
  created_at: string;
}
interface Member {
  id: string;
  name: string;
  photo_url?: string | null;
}

const hhmm = (iso: string) =>
  parseApiDate(iso).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });

/** Avatar del Agente Cowork: V roja Voicenter sobre blanco con un anillo de
 *  marca NÍTIDO — fino y quieto en reposo, girando con los colores Voicenter
 *  mientras piensa (patrón limpio, sin pings borrosos). */
function AgentAvatar({ size = "sm", active = false }: { size?: "sm" | "lg"; active?: boolean }) {
  const box = size === "lg" ? "h-16 w-16 text-2xl" : "h-8 w-8 text-[14px]";
  return (
    <div className={`${box} shrink-0 relative rounded-full`}>
      <span
        className={`absolute inset-0 rounded-full ${active ? "animate-spin" : ""}`}
        style={{
          background: active
            ? "conic-gradient(#E6332A 0 30%, #00B2BF 30% 55%, #F39200 55% 78%, #E6332A 78% 100%)"
            : "#E6332A",
          animationDuration: "1.4s",
        }}
      />
      <span className="absolute inset-[2.5px] rounded-full bg-white shadow-soft flex items-center justify-center">
        <span className="font-black select-none" style={{ color: "#E6332A" }}>
          V
        </span>
      </span>
    </div>
  );
}

/** Menciones @Nombre resaltadas como token (estilo Slack/Teams). */
function MentionText({
  content,
  names,
  mine,
}: {
  content: string;
  names: string[];
  mine: boolean;
}) {
  if (!names.length) return <span className="whitespace-pre-wrap">{content}</span>;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = content.split(new RegExp(`@(${escaped.join("|")})`, "g"));
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span
            key={i}
            className={`rounded px-1 py-px font-semibold ${
              mine ? "bg-white/25 text-white" : "bg-brand-cyan/20 text-brand-ink"
            }`}
          >
            @{p}
          </span>
        ) : (
          p
        )
      )}
    </span>
  );
}

function Avatar({ name, url, agent }: { name?: string | null; url?: string | null; agent?: boolean }) {
  if (agent) return <AgentAvatar />;
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name || ""} title={name || ""}
      className="h-8 w-8 shrink-0 rounded-full object-cover border border-brand-border" />
  ) : (
    <div title={name || ""}
      className="h-8 w-8 shrink-0 rounded-full bg-brand-purple text-white flex items-center justify-center text-xs font-bold">
      {(name || "?").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
    </div>
  );
}

export default function CoworkAgentPage() {
  const params = useParams<{ id: string }>();
  const me = getUser();
  const { project } = useProject();
  // Moderación de hilos: consultor líder, superadmin o admin del proyecto
  const canModerate =
    me?.role === "superadmin" ||
    me?.role === "consultor_lider" ||
    me?.role === "consultor_lider_2" ||
    project?.my_permission === "admin";
  const [convs, setConvs] = useState<Conv[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [mentionFilter, setMentionFilter] = useState<string | null>(null);
  const [pendingMentions, setPendingMentions] = useState<Member[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;
  const showArchivedRef = useRef(false);
  showArchivedRef.current = showArchived;

  const loadConvs = useCallback(
    async (archived = false) => {
      const list = await apiFetch<Conv[]>(
        `/api/v1/projects/${params.id}/cowork/conversations${archived ? "?archived=1" : ""}`
      );
      setConvs(list);
      apiFetch<{ count: number }>(
        `/api/v1/projects/${params.id}/cowork/conversations/archived-count`
      )
        .then((r) => setArchivedCount(r.count))
        .catch(() => {});
      return list;
    },
    [params.id]
  );

  const moderate = async (c: Conv, action: "pin" | "archive" | "delete") => {
    try {
      if (action === "delete") {
        if (confirmDeleteId !== c.id) {
          setConfirmDeleteId(c.id);
          setTimeout(() => setConfirmDeleteId(null), 4000);
          return;
        }
        setConfirmDeleteId(null);
        await apiFetch(`/api/v1/projects/${params.id}/cowork/conversations/${c.id}`, {
          method: "DELETE",
        });
        if (active === c.id) {
          setActive(null);
          setMessages([]);
        }
      } else {
        await apiFetch(`/api/v1/projects/${params.id}/cowork/conversations/${c.id}/${action}`, {
          method: "POST",
        });
        if (action === "archive" && active === c.id && !showArchived) {
          setActive(null);
          setMessages([]);
        }
      }
      await loadConvs(showArchived);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const loadMessages = useCallback(
    async (cid: string) => {
      const msgs = await apiFetch<Msg[]>(
        `/api/v1/projects/${params.id}/cowork/conversations/${cid}/messages`
      );
      if (activeRef.current === cid) {
        setMessages((prev) => {
          // nunca pisar mensajes optimistas (el server todavía no los tiene)
          if (msgs.length < prev.length) return prev;
          // solo re-render si cambió (evita saltos de scroll)
          if (prev.length === msgs.length && prev[prev.length - 1]?.id === msgs[msgs.length - 1]?.id)
            return prev;
          return msgs;
        });
      }
    },
    [params.id]
  );

  useEffect(() => {
    loadConvs()
      .then((list) => {
        // ?conv=... (desde la campana): abrir esa conversación
        const wanted = new URLSearchParams(window.location.search).get("conv");
        if (wanted && list.some((c) => c.id === wanted)) setActive(wanted);
        else if (list.length) setActive(list[0].id);
      })
      .catch(() => {});
    apiFetch<{ users: Member[] }>(`/api/v1/projects/${params.id}/cowork/mentionables`)
      .then((r) => setMembers(r.users))
      .catch(() => {});
    const iv = setInterval(() => loadConvs(showArchivedRef.current).catch(() => {}), 15000);
    return () => clearInterval(iv);
  }, [params.id, loadConvs]);

  // Cambiar entre activas ↔ archivadas
  useEffect(() => {
    loadConvs(showArchived).catch(() => {});
  }, [showArchived, loadConvs]);

  // Mensajes de la conversación activa + polling (el hilo es compartido:
  // otro compañero puede estar escribiendo con el agente ahora mismo)
  useEffect(() => {
    if (!active) return;
    setMessages([]);
    setError("");
    loadMessages(active).catch(() => {});
    const iv = setInterval(() => loadMessages(active).catch(() => {}), 4000);
    return () => clearInterval(iv);
  }, [active, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, thinking]);

  const newConversation = async () => {
    try {
      const c = await apiFetch<Conv>(`/api/v1/projects/${params.id}/cowork/conversations`, {
        method: "POST",
      });
      setConvs((prev) => [c, ...prev]);
      setActive(c.id);
      setMessages([]);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const onTextChange = (value: string) => {
    setText(value);
    const m = value.match(/@([\wÁÉÍÓÚáéíóúÑñ]*)$/);
    setMentionFilter(m ? m[1].toLowerCase() : null);
  };

  const applyMention = (u: Member) => {
    setText((t) => t.replace(/@[\wÁÉÍÓÚáéíóúÑñ]*$/, `@${u.name} `));
    setPendingMentions((prev) => (prev.some((x) => x.id === u.id) ? prev : [...prev, u]));
    setMentionFilter(null);
  };

  const send = async () => {
    const content = text.trim();
    if (!content || thinking) return;
    // Sin hilo activo: se crea SOLO al enviar el primer mensaje (cero fricción)
    let convId = active;
    if (!convId) {
      try {
        const c = await apiFetch<Conv>(`/api/v1/projects/${params.id}/cowork/conversations`, {
          method: "POST",
        });
        setConvs((prev) => [c, ...prev]);
        setActive(c.id);
        convId = c.id;
      } catch (e: any) {
        setError(e.message || "No se pudo abrir la conversación");
        return;
      }
    }
    setText("");
    setError("");
    const mentions = pendingMentions;
    setPendingMentions([]);
    // Optimista: mi mensaje aparece ya; el agente «piensa» hasta responder
    const tempId = `tmp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId, role: "user", content,
        author_id: me?.id, author_name: me?.full_name,
        mentions: mentions.length ? mentions.map((m) => ({ id: m.id, name: m.name })) : null,
        created_at: new Date().toISOString(),
      },
    ]);
    setThinking(true);
    try {
      const res = await apiFetch<{ user_message: Msg; assistant_message: Msg }>(
        `/api/v1/projects/${params.id}/cowork/conversations/${convId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            content,
            mentions: mentions.length
              ? { users: mentions.map((m) => ({ id: m.id, name: m.name })) }
              : undefined,
          }),
        }
      );
      // Dedupe por id: el polling pudo traer ya el mensaje del usuario desde
      // el server (reemplazando al optimista) — sin esto se veía duplicado.
      setMessages((prev) => [
        ...prev.filter(
          (m) =>
            m.id !== tempId &&
            m.id !== res.user_message.id &&
            m.id !== res.assistant_message.id
        ),
        res.user_message,
        res.assistant_message,
      ]);
      loadConvs().catch(() => {});
    } catch (e: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(content);
      setError(e.message || "El agente no pudo responder — reintentá.");
    } finally {
      setThinking(false);
    }
  };

  const filteredMembers = members.filter(
    (u) => mentionFilter !== null && u.id !== me?.id && u.name.toLowerCase().includes(mentionFilter)
  );
  const activeConv = convs.find((c) => c.id === active);

  return (
    <div className="grid lg:grid-cols-[300px_1fr] gap-4 items-start">
      {/* ---- Conversaciones compartidas del equipo ---- */}
      <div className="card overflow-hidden">
        <div className="p-3 border-b border-brand-border">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display uppercase text-brand-ink leading-none text-sm flex items-center gap-2">
              <AgentAvatar /> Agente Cowork
            </h2>
            <button className="btn-primary !py-1.5 !px-3 text-xs" onClick={newConversation}>
              + Nueva
            </button>
          </div>
          <p className="text-[11px] text-brand-slate mt-1.5 leading-relaxed">
            Conversa sobre el documento — lo tiene leído. Los hilos son{" "}
            <b>de todo el equipo</b>: mencioná con <b>@</b> a un compañero para sumarlo.
          </p>
        </div>
        <div className="max-h-[62vh] overflow-y-auto scrollbar-thin">
          {convs.length === 0 && (
            <p className="p-4 text-xs text-brand-slate">
              Sin conversaciones todavía. Abrí la primera y preguntale por el documento.
            </p>
          )}
          {convs.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => setActive(c.id)}
              onKeyDown={(e) => e.key === "Enter" && setActive(c.id)}
              className={`group w-full text-left px-3.5 py-2.5 border-b border-brand-border/60 transition-colors cursor-pointer ${
                active === c.id ? "bg-brand-primary-light/50" : "hover:bg-brand-bg-soft"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-brand-ink truncate">
                    {c.pinned_at ? "📌 " : ""}
                    {c.title}
                  </div>
                  {c.last_message && (
                    <div className="text-[11px] text-brand-slate truncate mt-0.5">
                      {c.last_role === "assistant" ? "✦ " : ""}
                      {c.last_message}
                    </div>
                  )}
                  {c.participants.length > 0 && (
                    <div className="text-[10px] text-brand-mist truncate mt-0.5">
                      {c.participants.join(" · ")}
                    </div>
                  )}
                </div>
                {canModerate && (
                  <div
                    className="flex gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span
                      role="button"
                      title={c.pinned_at ? "Desfijar" : "Fijar arriba"}
                      className={`h-6 w-6 rounded flex items-center justify-center text-[12px] hover:bg-white ${
                        c.pinned_at ? "text-brand-primary" : "text-brand-slate"
                      }`}
                      onClick={() => moderate(c, "pin")}
                    >
                      📌
                    </span>
                    <span
                      role="button"
                      title={c.archived_at ? "Restaurar" : "Archivar"}
                      className="h-6 w-6 rounded flex items-center justify-center text-[12px] text-brand-slate hover:bg-white"
                      onClick={() => moderate(c, "archive")}
                    >
                      {c.archived_at ? "↩" : "🗄"}
                    </span>
                    <span
                      role="button"
                      title={confirmDeleteId === c.id ? "Confirmá para borrar" : "Borrar hilo"}
                      className={`h-6 rounded flex items-center justify-center text-[11px] px-1 ${
                        confirmDeleteId === c.id
                          ? "bg-brand-primary text-white font-bold"
                          : "w-6 text-brand-slate hover:bg-white"
                      }`}
                      onClick={() => moderate(c, "delete")}
                    >
                      {confirmDeleteId === c.id ? "¿Borrar?" : "🗑"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {(archivedCount > 0 || showArchived) && (
          <button
            className="w-full px-3.5 py-2 text-[11px] font-semibold text-brand-slate hover:text-brand-ink border-t border-brand-border text-left"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "← Volver a las activas" : `🗄 Ver archivadas (${archivedCount})`}
          </button>
        )}
      </div>

      {/* ---- Hilo con el agente ---- */}
      <div className="card overflow-hidden flex flex-col" style={{ height: "74vh" }}>
        <div className="px-4 py-2.5 border-b border-brand-border flex items-center gap-2.5 bg-brand-bg-soft/60">
          <Avatar agent />
          <div className="min-w-0">
            <div className="text-sm font-bold text-brand-ink truncate">
              {activeConv?.title || "Agente Cowork"}
            </div>
            <div className="text-[11px] text-brand-slate">
              Compañero IA del proyecto · conoce el documento maestro
              {activeConv && activeConv.participants.length > 1
                ? ` · con ${activeConv.participants.join(" y ")}`
                : ""}
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin">
          {messages.length === 0 && !thinking && (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="mb-3">
                <AgentAvatar size="lg" />
              </div>
              <p className="font-display uppercase text-brand-ink text-sm">
                Charlemos sobre el documento
              </p>
              <p className="text-xs text-brand-slate mt-1 max-w-sm leading-relaxed">
                Ya lo tengo leído. Preguntame lo que quieras: «resumime la evidencia»,
                «¿qué le falta al capítulo 4?», «explicale a @Ana lo que definimos del
                ICCH»… Con <b>@</b> sumás a un compañero al hilo.
              </p>
              <div className="flex gap-1.5 flex-wrap justify-center mt-3">
                {["¿Qué dice el documento en una frase?", "¿Qué huecos ves?", "Resumí las conclusiones"].map(
                  (s) => (
                    <button key={s}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-brand-border text-brand-slate hover:border-brand-cyan hover:text-brand-cyan transition-colors"
                      onClick={() => setText(s)}>
                      {s}
                    </button>
                  )
                )}
              </div>
            </div>
          )}
          {messages.map((m) => {
            const mine = m.role === "user" && m.author_id === me?.id;
            const isAgent = m.role === "assistant";
            const mentionNames = (m.mentions || []).map((u) => u.name).filter(Boolean);
            return (
              <div key={m.id}>
                <div className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                  <Avatar agent={isAgent} name={m.author_name} url={m.author_photo_url} />
                  <div className={`max-w-[82%] min-w-0 ${mine ? "text-right" : ""}`}>
                    <div className={`text-[10px] font-semibold mb-0.5 ${mine ? "text-brand-mist" : "text-brand-slate"}`}>
                      {isAgent ? "Agente Cowork" : m.author_name || "Consultor"} · {hhmm(m.created_at)}
                    </div>
                    <div
                      className={`inline-block text-left rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed ${
                        isAgent
                          ? "bg-brand-bg-soft border border-brand-border text-brand-graphite rounded-tl-sm"
                          : mine
                            ? "bg-brand-ink text-white rounded-tr-sm"
                            : "bg-brand-cyan/10 border border-brand-cyan/30 text-brand-graphite rounded-tl-sm"
                      }`}
                    >
                      {isAgent ? (
                        <div className="prose-vex !text-[13.5px] [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <MentionText content={m.content} names={mentionNames} mine={mine} />
                      )}
                    </div>
                  </div>
                </div>
                {/* Evento de sistema (estilo Slack): la notificación fue REAL */}
                {mentionNames.length > 0 && (
                  <div className="flex justify-center my-2">
                    <span className="text-[10.5px] text-brand-slate bg-brand-bg-soft border border-brand-border rounded-full px-3 py-1 text-center">
                      🔔 {mine ? "Sumaste" : `${m.author_name || "Alguien"} sumó`} a{" "}
                      <b>{mentionNames.join(" y ")}</b> — le llegó la notificación con el
                      link a este hilo
                    </span>
                  </div>
                )}
              </div>
            );
          })}
          {thinking && (
            <div className="flex gap-2.5">
              <AgentAvatar active />
              <div className="rounded-2xl rounded-tl-sm bg-brand-bg-soft border border-brand-border px-3.5 py-2 text-[13px] text-brand-slate">
                <span className="shimmer-text font-semibold">Leyendo el documento y pensando…</span>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-4 mb-1 rounded-md bg-brand-primary/10 border border-brand-primary/30 px-3 py-1.5 text-xs text-brand-primary-dark">
            {error}
          </div>
        )}

        {/* Composer con @menciones */}
        <div className="border-t border-brand-border p-3 relative">
          {mentionFilter !== null && filteredMembers.length > 0 && (
            <div className="absolute bottom-full left-3 right-3 mb-1 glass rounded-xl max-h-44 overflow-y-auto animate-pop z-10">
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider2 text-brand-slate">
                Sumar al hilo (le llega la campana)
              </div>
              {filteredMembers.map((u) => (
                <button key={u.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-brand-bg flex items-center gap-2"
                  onClick={() => applyMention(u)}>
                  <Avatar name={u.name} url={u.photo_url} /> {u.name}
                </button>
              ))}
            </div>
          )}
          {pendingMentions.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mb-2">
              {pendingMentions.map((u) => (
                <span key={u.id}
                  title="Al enviar, le llega la campana con el link a este hilo"
                  className="inline-flex items-center gap-1 rounded-full bg-brand-purple/10 text-brand-purple text-[11px] font-semibold px-2.5 py-1">
                  🔔 Avisar a {u.name}
                  <button className="hover:text-brand-primary"
                    onClick={() => setPendingMentions((prev) => prev.filter((x) => x.id !== u.id))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              className="input !py-2 text-[13px] resize-none flex-1"
              rows={2}
              placeholder="Preguntale al agente por el documento… Usá @ para sumar a un compañero"
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMentionFilter(null);
                if (e.key === "Enter" && !e.shiftKey && mentionFilter === null) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={thinking}
            />
            <button className="btn-primary !py-2.5" disabled={thinking || !text.trim()}
              onClick={send}>
              {thinking ? "…" : "Enviar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
