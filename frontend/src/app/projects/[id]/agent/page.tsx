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

interface Conv {
  id: string;
  title: string;
  participants: string[];
  last_message?: string | null;
  last_role?: string | null;
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

/** Avatar del Agente Cowork: monograma V con degradado de marca y anillo
 *  animado — corporativo y vivo (el anillo late más rápido cuando piensa). */
function AgentAvatar({ size = "sm", active = false }: { size?: "sm" | "lg"; active?: boolean }) {
  const box = size === "lg" ? "h-16 w-16 text-2xl" : "h-8 w-8 text-[13px]";
  return (
    <div className={`${box} shrink-0 relative rounded-full flex items-center justify-center`}>
      <span
        className={`absolute inset-0 rounded-full opacity-40 ${active ? "animate-ping" : "animate-pulse"}`}
        style={{
          background: "conic-gradient(from 180deg, #00B2BF, #662483, #E6332A, #00B2BF)",
          animationDuration: active ? "1.2s" : "3s",
        }}
      />
      <span
        className="absolute inset-0 rounded-full shadow-soft"
        style={{ background: "linear-gradient(135deg, #00B2BF 0%, #662483 60%, #0F1116 100%)" }}
      />
      <span className="relative font-black text-white select-none" style={{ fontFamily: "inherit" }}>
        V
      </span>
    </div>
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
  const [convs, setConvs] = useState<Conv[]>([]);
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

  const loadConvs = useCallback(async () => {
    const list = await apiFetch<Conv[]>(`/api/v1/projects/${params.id}/cowork/conversations`);
    setConvs(list);
    return list;
  }, [params.id]);

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
    const iv = setInterval(() => loadConvs().catch(() => {}), 15000);
    return () => clearInterval(iv);
  }, [params.id, loadConvs]);

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
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempId),
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
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={`w-full text-left px-3.5 py-2.5 border-b border-brand-border/60 transition-colors ${
                active === c.id ? "bg-brand-primary-light/50" : "hover:bg-brand-bg-soft"
              }`}
            >
              <div className="text-[13px] font-bold text-brand-ink truncate">{c.title}</div>
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
            </button>
          ))}
        </div>
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
            return (
              <div key={m.id} className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
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
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    )}
                  </div>
                  {(m.mentions?.length ?? 0) > 0 && (
                    <div className={`mt-1 flex gap-1 flex-wrap ${mine ? "justify-end" : ""}`}>
                      {m.mentions!.map((u) => (
                        <span key={u.id}
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-purple/10 text-brand-purple font-semibold">
                          🔔 sumó a {u.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
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
                  className="inline-flex items-center gap-1 rounded-full bg-brand-purple/10 text-brand-purple text-[11px] font-semibold px-2.5 py-1">
                  🔔 {u.name}
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
