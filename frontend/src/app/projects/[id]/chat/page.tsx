"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, getUser } from "@/lib/api";

interface Channel {
  id: string;
  kind: string;
  name: string;
  last_message?: string;
  last_at?: string;
}
interface Msg {
  id: string;
  user_id: string;
  user_name: string;
  content: string;
  mentions?: { users?: { id: string; name: string }[]; notes?: { id: string; title: string }[] };
  created_at: string;
}
interface Mentionable {
  users: { id: string; name: string }[];
  notes: { id: string; title: string; status: string }[];
}

function renderContent(content: string) {
  // Resalta tokens @Nombre y @📝Nota
  const parts = content.split(/(@[\wÁÉÍÓÚáéíóúÑñ📝][^\s,.;:!?]*(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúÑñ]*)?)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="text-brand-cyan font-semibold">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const me = getUser();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [mentionables, setMentionables] = useState<Mentionable>({ users: [], notes: [] });
  const [mentionFilter, setMentionFilter] = useState<string | null>(null);
  const [pendingMentions, setPendingMentions] = useState<Msg["mentions"]>({ users: [], notes: [] });
  const [newTopic, setNewTopic] = useState("");
  const [showNewDm, setShowNewDm] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgScrollRef = useRef<HTMLDivElement>(null);
  const lastAtRef = useRef<string | null>(null);
  const activeRef = useRef<Channel | null>(null);
  activeRef.current = active;

  const loadChannels = useCallback(async () => {
    const list = await apiFetch<Channel[]>(`/api/v1/projects/${params.id}/chat/channels`);
    setChannels(list);
    return list;
  }, [params.id]);

  useEffect(() => {
    // ?channel=... (desde una notificación): abrir ese canal directamente
    const wanted =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("channel")
        : null;
    loadChannels()
      .then((list) => {
        if (!list.length || activeRef.current) return;
        const target = wanted ? list.find((c) => c.id === wanted) : null;
        setActive(target ?? list[0]);
      })
      .catch(() => {});
    apiFetch<Mentionable>(`/api/v1/projects/${params.id}/chat/mentionables`)
      .then(setMentionables)
      .catch(() => {});
  }, [params.id, loadChannels]);

  // Cargar mensajes al cambiar de canal + polling incremental cada 4s
  useEffect(() => {
    if (!active) return;
    lastAtRef.current = null;
    setMessages([]);
    let stop = false;

    const poll = async () => {
      try {
        const qs = lastAtRef.current ? `?after=${encodeURIComponent(lastAtRef.current)}` : "";
        const news = await apiFetch<Msg[]>(
          `/api/v1/projects/${params.id}/chat/channels/${active.id}/messages${qs}`
        );
        if (stop || activeRef.current?.id !== active.id) return;
        if (news.length) {
          lastAtRef.current = news[news.length - 1].created_at;
          setMessages((m) => [...m, ...news.filter((n) => !m.some((x) => x.id === n.id))]);
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      stop = true;
      clearInterval(interval);
    };
  }, [active, params.id]);

  useEffect(() => {
    // Scrollear solo el panel de mensajes, no la ventana.
    const box = msgScrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages]);

  const send = async () => {
    const content = text.trim();
    if (!content || !active) return;
    setText("");
    const mentions = pendingMentions;
    setPendingMentions({ users: [], notes: [] });
    try {
      const msg = await apiFetch<Msg>(
        `/api/v1/projects/${params.id}/chat/channels/${active.id}/messages`,
        { method: "POST", body: JSON.stringify({ content, mentions }) }
      );
      lastAtRef.current = msg.created_at;
      setMessages((m) => [...m, msg]);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const onTextChange = (value: string) => {
    setText(value);
    const match = value.match(/@([\wÁÉÍÓÚáéíóúÑñ]*)$/);
    setMentionFilter(match ? match[1].toLowerCase() : null);
  };

  const applyMention = (kind: "user" | "note", item: any) => {
    const label = kind === "user" ? `@${item.name}` : `@📝${item.title}`;
    setText((t) => t.replace(/@[\wÁÉÍÓÚáéíóúÑñ]*$/, `${label} `));
    setPendingMentions((prev) => ({
      users: kind === "user" ? [...(prev?.users || []), { id: item.id, name: item.name }] : prev?.users || [],
      notes: kind === "note" ? [...(prev?.notes || []), { id: item.id, title: item.title }] : prev?.notes || [],
    }));
    setMentionFilter(null);
  };

  const createTopic = async () => {
    const name = newTopic.trim();
    if (!name) return;
    setNewTopic("");
    const ch = await apiFetch<Channel>(`/api/v1/projects/${params.id}/chat/channels`, {
      method: "POST",
      body: JSON.stringify({ kind: "tema", name }),
    });
    await loadChannels();
    setActive(ch);
  };

  const openDm = async (userId: string) => {
    setShowNewDm(false);
    const ch = await apiFetch<Channel>(`/api/v1/projects/${params.id}/chat/channels`, {
      method: "POST",
      body: JSON.stringify({ kind: "dm", user_id: userId }),
    });
    await loadChannels();
    setActive(ch);
  };

  const filteredUsers = mentionables.users.filter(
    (u) => mentionFilter !== null && u.name.toLowerCase().includes(mentionFilter) && u.id !== me?.id
  );
  const filteredNotes = mentionables.notes.filter(
    (n) => mentionFilter !== null && n.title.toLowerCase().includes(mentionFilter)
  );

  return (
    <div className="grid gap-4 lg:grid-cols-4 h-[74vh]">
      {/* Canales */}
      <div className="card overflow-hidden flex flex-col">
        <div className="px-4 py-2.5 label !mb-0 border-b border-brand-border">Temas</div>
        <div className="flex-1 overflow-y-auto">
          {channels
            .filter((c) => c.kind === "tema")
            .map((c) => (
              <button
                key={c.id}
                onClick={() => setActive(c)}
                className={`w-full text-left px-4 py-2.5 border-b border-brand-border/60 transition-colors ${
                  active?.id === c.id ? "bg-brand-primary-light/50" : "hover:bg-brand-bg-soft"
                }`}
              >
                <div className="text-sm font-semibold text-brand-ink"># {c.name}</div>
                {c.last_message && (
                  <div className="text-[11px] text-brand-slate truncate">{c.last_message}</div>
                )}
              </button>
            ))}
          <div className="p-2 flex gap-1">
            <input
              className="input !py-1 text-xs"
              placeholder="Nuevo tema…"
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createTopic()}
            />
            <button className="btn-secondary !px-2 !py-1 text-xs" onClick={createTopic}>
              +
            </button>
          </div>

          <div className="px-4 py-2.5 label !mb-0 border-y border-brand-border flex items-center justify-between">
            Directos
            <button className="btn-ghost !px-1.5 !py-0.5 text-xs" onClick={() => setShowNewDm((v) => !v)}>
              +
            </button>
          </div>
          {showNewDm && (
            <div className="p-2 border-b border-brand-border animate-fade">
              {mentionables.users
                .filter((u) => u.id !== me?.id)
                .map((u) => (
                  <button
                    key={u.id}
                    className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-brand-bg"
                    onClick={() => openDm(u.id)}
                  >
                    💬 {u.name}
                  </button>
                ))}
            </div>
          )}
          {channels
            .filter((c) => c.kind === "dm")
            .map((c) => (
              <button
                key={c.id}
                onClick={() => setActive(c)}
                className={`w-full text-left px-4 py-2.5 border-b border-brand-border/60 transition-colors ${
                  active?.id === c.id ? "bg-brand-primary-light/50" : "hover:bg-brand-bg-soft"
                }`}
              >
                <div className="text-sm font-semibold text-brand-ink">💬 {c.name}</div>
                {c.last_message && (
                  <div className="text-[11px] text-brand-slate truncate">{c.last_message}</div>
                )}
              </button>
            ))}
        </div>
      </div>

      {/* Hilo */}
      <div className="lg:col-span-3 card flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-brand-border flex items-center justify-between">
          <div className="font-display text-lg uppercase text-brand-ink">
            {active ? (active.kind === "tema" ? `# ${active.name}` : `💬 ${active.name}`) : "…"}
          </div>
          <span className="text-[11px] text-brand-slate">
            Mencioná con @ a miembros y notas de seguimiento
          </span>
        </div>

        <div ref={msgScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={m.user_id === me?.id ? "flex justify-end" : "flex"}>
              <div
                className={`max-w-[78%] rounded-lg px-3.5 py-2 ${
                  m.user_id === me?.id ? "bg-brand-primary text-white" : "bg-brand-bg"
                }`}
              >
                <div
                  className={`text-[10px] font-semibold mb-0.5 ${
                    m.user_id === me?.id ? "text-white/75" : "text-brand-slate"
                  }`}
                >
                  {m.user_name} ·{" "}
                  {new Date(m.created_at).toLocaleTimeString("es-PY", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                <div className="text-sm whitespace-pre-wrap break-words">
                  {m.user_id === me?.id ? m.content : renderContent(m.content)}
                </div>
                {m.mentions?.notes && m.mentions.notes.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-1.5">
                    {m.mentions.notes.map((n) => (
                      <Link
                        key={n.id}
                        href={`/projects/${params.id}/notes`}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                          m.user_id === me?.id
                            ? "bg-white/20 text-white"
                            : "bg-brand-cyan/10 text-brand-cyan"
                        }`}
                      >
                        📝 {n.title}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {messages.length === 0 && (
            <p className="text-center text-sm text-brand-slate pt-16">
              Sin mensajes todavía. Empezá la conversación del equipo.
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Composer con autocompletado de menciones */}
        <div className="border-t border-brand-border p-3 relative">
          {mentionFilter !== null && (filteredUsers.length > 0 || filteredNotes.length > 0) && (
            <div className="absolute bottom-full left-3 right-3 mb-1 card shadow-elevated max-h-48 overflow-y-auto animate-pop z-10">
              {filteredUsers.map((u) => (
                <button
                  key={u.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-brand-bg"
                  onClick={() => applyMention("user", u)}
                >
                  👤 {u.name}
                </button>
              ))}
              {filteredNotes.map((n) => (
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
          <div className="flex gap-2">
            <textarea
              className="input flex-1 !py-2 resize-none"
              rows={2}
              placeholder={`Mensaje ${active ? (active.kind === "tema" ? `a #${active.name}` : `para ${active.name}`) : ""}… usá @ para mencionar`}
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className="btn-primary self-end" onClick={send} disabled={!text.trim() || !active}>
              Enviar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
