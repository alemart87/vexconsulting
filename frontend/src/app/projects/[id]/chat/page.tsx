"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, getUser } from "@/lib/api";

interface Channel {
  id: string;
  kind: string;
  name: string;
  dm_user_id?: string | null;
  last_message?: string;
  last_at?: string;
  unread_count?: number;
  last_read_at?: string | null;
}
interface Attachment {
  name: string;
  url: string;
  mime: string;
  size: number;
}
interface Msg {
  id: string;
  user_id: string;
  user_name: string;
  user_photo_url?: string | null;
  content: string;
  deleted?: boolean;
  mentions?: { users?: { id: string; name: string }[]; notes?: { id: string; title: string }[] };
  parent_id?: string | null;
  reactions?: Record<string, string[]>;
  attachments?: Attachment[] | null;
  pinned_at?: string | null;
  pinned_by?: string | null;
  edited_at?: string | null;
  reply_count?: number;
  created_at: string;
}
interface SearchHit {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_kind: string;
  user_name: string;
  content: string;
  created_at: string;
}
interface Mentionable {
  users: { id: string; name: string }[];
  notes: { id: string; title: string; status: string }[];
}

const EMOJI_ONLY = /^[\p{Extended_Pictographic}‍️\s]{1,8}$/u;
const MENTION_RE = /(@[\wÁÉÍÓÚáéíóúÑñ📝][^\s,.;:!?]*(?:\s[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúÑñ]*)?)/g;
const QUICK_REACTIONS = ["👍", "✅", "❤️", "😂", "👀", "🔥"];

const minutesBetween = (a?: string, b?: string) =>
  a && b ? Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000 : Infinity;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });

/** Huella de la lista para no re-renderizar (ni re-scrollear) si nada cambió. */
const fingerprint = (list: Msg[]) =>
  list
    .map(
      (m) =>
        `${m.id}|${m.edited_at || ""}|${m.deleted ? "d" : ""}|${m.reply_count || 0}|${m.pinned_at || ""}|${JSON.stringify(m.reactions || {})}`
    )
    .join(";");

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const fileIcon = (mime: string, name: string) => {
  const n = name.toLowerCase();
  if (mime.includes("pdf") || n.endsWith(".pdf")) return "📕";
  if (/\.(xlsx?|csv)$/.test(n)) return "📊";
  if (/\.(docx?|txt|md)$/.test(n)) return "📄";
  if (/\.(pptx?)$/.test(n)) return "📽️";
  if (n.endsWith(".zip")) return "🗜️";
  return "📎";
};

/** Adjuntos del mensaje: imágenes inline, resto como chip descargable. */
function AttachmentList({ list, mine }: { list?: Attachment[] | null; mine: boolean }) {
  if (!list?.length) return null;
  return (
    <div className="flex flex-col gap-1.5 mt-1.5">
      {list.map((a, i) =>
        a.mime.startsWith("image/") ? (
          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" title={a.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.url}
              alt={a.name}
              className="max-h-56 max-w-full rounded-lg border border-black/10 shadow-soft"
            />
          </a>
        ) : (
          <a
            key={i}
            href={`${a.url}?dl=${encodeURIComponent(a.name)}`}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
              mine
                ? "bg-white/15 border-white/30 text-white hover:bg-white/25"
                : "bg-brand-bg border-brand-border text-brand-ink hover:border-brand-cyan"
            }`}
          >
            <span className="text-base leading-none">{fileIcon(a.mime, a.name)}</span>
            <span className="truncate max-w-[220px]">{a.name}</span>
            <span className={`shrink-0 font-normal ${mine ? "text-white/70" : "text-brand-mist"}`}>
              {fmtSize(a.size)}
            </span>
          </a>
        )
      )}
    </div>
  );
}

/** Emojis frecuentes para el chat de trabajo (sin dependencias). */
const EMOJIS = [
  "😀", "😄", "😅", "😂", "🙂", "😉", "😍", "🤔", "😎", "🥳",
  "😢", "😮", "😴", "🤯", "🙄", "😬", "🤝", "👍", "👎", "👏",
  "🙌", "💪", "🙏", "👌", "✌️", "🤞", "👀", "🧠", "❤️", "🔥",
  "⭐", "✨", "🎉", "🎯", "🚀", "💡", "📈", "📉", "📊", "📌",
  "📎", "🗂️", "📅", "⏰", "☕", "✅", "❌", "⚠️", "❓", "❗",
  "💬", "📣", "🔍", "🧪", "💰", "🏆", "🤖", "🎧", "🧉", "🇵🇾",
];

/** Markdown de mensajes: links clickeables, negrita, código, listas. Las
 *  menciones @Nombre se convierten a links #mention para pintarlas. */
function MsgMarkdown({ content, mine }: { content: string; mine: boolean }) {
  let processed = content.replace(MENTION_RE, (t) => `[${t}](#mention)`);
  if (!processed.includes("```")) processed = processed.replace(/\n/g, "  \n");
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) =>
          href === "#mention" ? (
            <span className={mine ? "font-semibold underline decoration-white/50" : "text-brand-cyan font-semibold"}>
              {children}
            </span>
          ) : (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline underline-offset-2 break-all font-medium ${
                mine ? "text-white" : "text-brand-cyan"
              }`}
            >
              {children}
            </a>
          ),
        p: ({ children }) => <p className="my-0.5 first:mt-0 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 my-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 my-1">{children}</ol>,
        code: ({ children }) => (
          <code className={`px-1 py-0.5 rounded text-[12px] ${mine ? "bg-white/20" : "bg-brand-bg text-brand-purple"}`}>
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className={`p-2 rounded-md my-1 text-[12px] whitespace-pre-wrap break-words ${mine ? "bg-white/15" : "bg-brand-bg"}`}>
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className={`border-l-2 pl-2 my-1 ${mine ? "border-white/50" : "border-brand-cyan/60"}`}>
            {children}
          </blockquote>
        ),
      }}
    >
      {processed}
    </ReactMarkdown>
  );
}

function Avatar({ name, url, size = 7 }: { name: string; url?: string | null; size?: number }) {
  const cls = size === 7 ? "h-7 w-7 text-[11px]" : "h-8 w-8 text-xs";
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} title={name} className={`${cls} rounded-full object-cover border border-brand-border`} />
  ) : (
    <div title={name} className={`${cls} rounded-full bg-brand-purple text-white flex items-center justify-center font-bold`}>
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Chips de reacciones bajo el mensaje. */
function ReactionChips({
  m, meId, onToggle,
}: { m: Msg; meId?: string; onToggle: (m: Msg, emoji: string) => void }) {
  const entries = Object.entries(m.reactions || {}).filter(([, users]) => users.length);
  if (!entries.length) return null;
  return (
    <div className="flex gap-1 flex-wrap mt-1">
      {entries.map(([emoji, users]) => {
        const iReacted = !!meId && users.includes(meId);
        return (
          <button
            key={emoji}
            onClick={() => onToggle(m, emoji)}
            title={users.length === 1 ? "1 persona" : `${users.length} personas`}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] border transition-all active:scale-90 ${
              iReacted
                ? "bg-brand-cyan/15 border-brand-cyan text-brand-ink font-semibold"
                : "bg-white border-brand-border text-brand-slate hover:border-brand-cyan"
            }`}
          >
            <span className="text-[13px] leading-none">{emoji}</span>
            {users.length}
          </button>
        );
      })}
    </div>
  );
}

/** Toolbar flotante al pasar el mouse: reacciones rápidas, hilo, fijar,
 *  editar y borrar. Superficie liquid-glass sobre los mensajes. */
function MsgToolbar({
  m, mine, canDelete, confirmDelete, onReact, onThread, onPin, onEdit, onDelete,
}: {
  m: Msg;
  mine: boolean;
  canDelete: boolean;
  confirmDelete: boolean;
  onReact: (m: Msg, emoji: string) => void;
  onThread?: (m: Msg) => void;
  onPin?: (m: Msg) => void;
  onEdit?: (m: Msg) => void;
  onDelete: (m: Msg) => void;
}) {
  return (
    <div
      className={`absolute -top-3.5 ${mine ? "right-2" : "left-2"} hidden group-hover:flex items-center gap-0.5 glass rounded-full px-1 py-0.5 z-10`}
    >
      {QUICK_REACTIONS.map((e) => (
        <button
          key={e}
          className="h-6 w-6 rounded-full hover:bg-white/70 text-[14px] leading-none transition-transform hover:scale-125"
          title={`Reaccionar ${e}`}
          onClick={() => onReact(m, e)}
        >
          {e}
        </button>
      ))}
      {onThread && (
        <button
          className="h-6 px-1.5 rounded-full hover:bg-white/70 text-[12px] leading-none text-brand-slate"
          title="Responder en hilo"
          onClick={() => onThread(m)}
        >
          💬
        </button>
      )}
      {onPin && (
        <button
          className={`h-6 px-1.5 rounded-full hover:bg-white/70 text-[12px] leading-none ${
            m.pinned_at ? "text-brand-primary" : "text-brand-slate"
          }`}
          title={m.pinned_at ? "Desfijar del canal" : "Fijar en el canal"}
          onClick={() => onPin(m)}
        >
          📌
        </button>
      )}
      {mine && onEdit && (
        <button
          className="h-6 px-1.5 rounded-full hover:bg-white/70 text-[12px] leading-none text-brand-slate"
          title="Editar"
          onClick={() => onEdit(m)}
        >
          ✏️
        </button>
      )}
      {canDelete && (
        <button
          className={`h-6 px-1.5 rounded-full text-[11px] leading-none font-semibold ${
            confirmDelete ? "bg-brand-primary text-white" : "hover:bg-white/70 text-brand-slate"
          }`}
          title={confirmDelete ? "Confirmá para borrar" : "Borrar"}
          onClick={() => onDelete(m)}
        >
          {confirmDelete ? "¿Borrar?" : "🗑"}
        </button>
      )}
    </div>
  );
}

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const me = getUser();
  const canModerate = me?.role === "superadmin" || me?.role === "consultor_lider";
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [mentionables, setMentionables] = useState<Mentionable>({ users: [], notes: [] });
  const [mentionFilter, setMentionFilter] = useState<string | null>(null);
  const [pendingMentions, setPendingMentions] = useState<Msg["mentions"]>({ users: [], notes: [] });
  const [newTopic, setNewTopic] = useState("");
  const [showNewDm, setShowNewDm] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // V1: hilos, edición, borrado y no-leídos
  const [thread, setThread] = useState<Msg | null>(null);
  const [threadReplies, setThreadReplies] = useState<Msg[]>([]);
  const [threadText, setThreadText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dividerAt, setDividerAt] = useState<string | null>(null);
  // V2: adjuntos, typing/presencia, pins y búsqueda
  const [pendingFiles, setPendingFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [pins, setPins] = useState<Msg[]>([]);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingSentRef = useRef(0);

  const msgScrollRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef<Channel | null>(null);
  activeRef.current = active;
  const threadRef = useRef<Msg | null>(null);
  threadRef.current = thread;
  const lastReadPostedRef = useRef<string | null>(null);

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setText((t) => t + emoji);
      return;
    }
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const loadChannels = useCallback(async () => {
    const list = await apiFetch<Channel[]>(`/api/v1/projects/${params.id}/chat/channels`);
    // El canal abierto siempre se considera leído en la UI
    const current = activeRef.current;
    setChannels(current ? list.map((c) => (c.id === current.id ? { ...c, unread_count: 0 } : c)) : list);
    return list;
  }, [params.id]);

  const pingTyping = useCallback(() => {
    const ch = activeRef.current;
    if (!ch) return;
    const now = Date.now();
    if (now - typingSentRef.current < 2000) return;
    typingSentRef.current = now;
    apiFetch(`/api/v1/projects/${params.id}/chat/channels/${ch.id}/typing`, {
      method: "POST",
    }).catch(() => {});
  }, [params.id]);

  const loadPins = useCallback(
    async (channelId: string) => {
      try {
        const list = await apiFetch<Msg[]>(
          `/api/v1/projects/${params.id}/chat/channels/${channelId}/pins`
        );
        if (activeRef.current?.id === channelId) setPins(list);
      } catch {}
    },
    [params.id]
  );

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files).slice(0, 5 - pendingFiles.length)) {
        const form = new FormData();
        form.append("file", f);
        const meta = await apiFetch<Attachment>(`/api/v1/projects/${params.id}/chat/upload`, {
          method: "POST",
          body: form,
        });
        setPendingFiles((prev) => (prev.length >= 5 ? prev : [...prev, meta]));
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const markRead = useCallback(
    async (channelId: string) => {
      try {
        await apiFetch(`/api/v1/projects/${params.id}/chat/channels/${channelId}/read`, { method: "POST" });
        setChannels((prev) => prev.map((c) => (c.id === channelId ? { ...c, unread_count: 0 } : c)));
      } catch {}
    },
    [params.id]
  );

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
    // Badges de canales frescos sin recargar
    const interval = setInterval(() => loadChannels().catch(() => {}), 12000);
    return () => clearInterval(interval);
  }, [params.id, loadChannels]);

  // Cargar mensajes al cambiar de canal + polling (lista completa: capta
  // reacciones, ediciones y borrados de otros, no solo mensajes nuevos)
  useEffect(() => {
    if (!active) return;
    setMessages([]);
    setThread(null);
    setEditingId(null);
    setConfirmDeleteId(null);
    setPins([]);
    setPinsOpen(false);
    setTypingNames([]);
    loadPins(active.id);
    nearBottomRef.current = true;
    // Divisor «Nuevos mensajes»: donde quedó la última lectura
    setDividerAt(
      active.unread_count ? active.last_read_at || "1970-01-01T00:00:00+00:00" : null
    );
    lastReadPostedRef.current = null;
    let stopped = false;

    const poll = async () => {
      try {
        const news = await apiFetch<Msg[]>(
          `/api/v1/projects/${params.id}/chat/channels/${active.id}/messages?limit=150`
        );
        if (stopped || activeRef.current?.id !== active.id) return;
        setMessages((prev) => (fingerprint(prev) === fingerprint(news) ? prev : news));
        // Marcar leído cuando llega algo nuevo al canal abierto
        const latest = news.length ? news[news.length - 1].created_at : null;
        if (latest && lastReadPostedRef.current !== latest) {
          lastReadPostedRef.current = latest;
          markRead(active.id);
        }
        // Typing + presencia del proyecto
        const act = await apiFetch<{ typing: string[]; online: string[] }>(
          `/api/v1/projects/${params.id}/chat/channels/${active.id}/activity`
        );
        if (stopped || activeRef.current?.id !== active.id) return;
        setTypingNames(act.typing);
        setOnlineIds(act.online);
      } catch {}
    };
    poll();
    markRead(active.id);
    const interval = setInterval(poll, 4000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [active, params.id, markRead, loadPins]);

  // Polling del hilo abierto
  useEffect(() => {
    if (!thread || !active) return;
    let stopped = false;
    const pollThread = async () => {
      try {
        const data = await apiFetch<{ root: Msg; replies: Msg[] }>(
          `/api/v1/projects/${params.id}/chat/channels/${active.id}/messages/${thread.id}/thread`
        );
        if (stopped || threadRef.current?.id !== thread.id) return;
        setThreadReplies((prev) => (fingerprint(prev) === fingerprint(data.replies) ? prev : data.replies));
        setThread((t) => (t && fingerprint([t]) !== fingerprint([data.root]) ? data.root : t));
      } catch {}
    };
    pollThread();
    const interval = setInterval(pollThread, 4000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, active?.id, params.id]);

  useEffect(() => {
    // Scrollear solo el panel de mensajes, y solo si el usuario está abajo.
    const box = msgScrollRef.current;
    if (box && nearBottomRef.current) box.scrollTop = box.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const box = threadScrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [threadReplies]);

  const onMsgScroll = () => {
    const box = msgScrollRef.current;
    if (box) nearBottomRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  };

  const send = async () => {
    const content = text.trim();
    if ((!content && pendingFiles.length === 0) || !active) return;
    setText("");
    const mentions = pendingMentions;
    const attachments = pendingFiles;
    setPendingMentions({ users: [], notes: [] });
    setPendingFiles([]);
    nearBottomRef.current = true;
    try {
      const msg = await apiFetch<Msg>(
        `/api/v1/projects/${params.id}/chat/channels/${active.id}/messages`,
        { method: "POST", body: JSON.stringify({ content, mentions, attachments }) }
      );
      setMessages((m) => [...m, msg]);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const togglePin = async (m: Msg) => {
    if (!active) return;
    try {
      const res = await apiFetch<{ pinned_at: string | null; pinned_by: string | null }>(
        `/api/v1/projects/${params.id}/chat/channels/${active.id}/messages/${m.id}/pin`,
        { method: "POST" }
      );
      const apply = (list: Msg[]) =>
        list.map((x) => (x.id === m.id ? { ...x, pinned_at: res.pinned_at, pinned_by: res.pinned_by } : x));
      setMessages(apply);
      setThreadReplies(apply);
      loadPins(active.id);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const sendReply = async () => {
    const content = threadText.trim();
    if (!content || !active || !thread) return;
    setThreadText("");
    try {
      const msg = await apiFetch<Msg>(
        `/api/v1/projects/${params.id}/chat/channels/${active.id}/messages`,
        { method: "POST", body: JSON.stringify({ content, parent_id: thread.id }) }
      );
      setThreadReplies((r) => [...r, msg]);
      setMessages((list) =>
        list.map((m) => (m.id === thread.id ? { ...m, reply_count: (m.reply_count || 0) + 1 } : m))
      );
    } catch (e: any) {
      alert(e.message);
    }
  };

  const toggleReaction = async (m: Msg, emoji: string) => {
    if (!active) return;
    try {
      const res = await apiFetch<{ reactions: Record<string, string[]> }>(
        `/api/v1/projects/${params.id}/chat/channels/${active.id}/messages/${m.id}/reactions`,
        { method: "POST", body: JSON.stringify({ emoji }) }
      );
      const apply = (list: Msg[]) => list.map((x) => (x.id === m.id ? { ...x, reactions: res.reactions } : x));
      setMessages(apply);
      setThreadReplies(apply);
      setThread((t) => (t && t.id === m.id ? { ...t, reactions: res.reactions } : t));
    } catch {}
  };

  const startEdit = (m: Msg) => {
    setEditingId(m.id);
    setEditText(m.content);
    setConfirmDeleteId(null);
  };

  const saveEdit = async () => {
    const content = editText.trim();
    if (!content || !active || !editingId) return;
    try {
      const updated = await apiFetch<Msg>(
        `/api/v1/projects/${params.id}/chat/channels/${active.id}/messages/${editingId}`,
        { method: "PATCH", body: JSON.stringify({ content }) }
      );
      const apply = (list: Msg[]) =>
        list.map((x) => (x.id === editingId ? { ...x, content: updated.content, edited_at: updated.edited_at } : x));
      setMessages(apply);
      setThreadReplies(apply);
      setThread((t) => (t && t.id === editingId ? { ...t, content: updated.content, edited_at: updated.edited_at } : t));
      setEditingId(null);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const requestDelete = async (m: Msg) => {
    if (!active) return;
    if (confirmDeleteId !== m.id) {
      setConfirmDeleteId(m.id);
      setTimeout(() => setConfirmDeleteId((v) => (v === m.id ? null : v)), 3000);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await apiFetch(`/api/v1/projects/${params.id}/chat/channels/${active.id}/messages/${m.id}`, {
        method: "DELETE",
      });
      const apply = (list: Msg[]) =>
        list.map((x) => (x.id === m.id ? { ...x, deleted: true, content: "", reactions: {} } : x));
      setMessages(apply);
      setThreadReplies(apply);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const openThread = (m: Msg) => {
    setThread(m);
    setThreadReplies([]);
    setThreadText("");
  };

  const onTextChange = (value: string) => {
    setText(value);
    if (value.trim()) pingTyping();
    const match = value.match(/@([\wÁÉÍÓÚáéíóúÑñ]*)$/);
    setMentionFilter(match ? match[1].toLowerCase() : null);
  };

  // Búsqueda de mensajes con debounce
  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    const t = setTimeout(() => {
      apiFetch<SearchHit[]>(
        `/api/v1/projects/${params.id}/chat/search?q=${encodeURIComponent(q)}`
      )
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, 350);
    return () => clearTimeout(t);
  }, [searchQ, params.id]);

  const openSearchHit = (hit: SearchHit) => {
    const ch = channels.find((c) => c.id === hit.channel_id);
    setSearchQ("");
    setSearchResults(null);
    if (ch) setActive(ch);
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

  const channelButton = (c: Channel, icon: string) => (
    <button
      key={c.id}
      onClick={() => setActive(c)}
      className={`w-full text-left px-4 py-2.5 border-b border-brand-border/60 transition-colors ${
        active?.id === c.id ? "bg-brand-primary-light/50" : "hover:bg-brand-bg-soft"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className={`text-sm text-brand-ink truncate ${
            c.unread_count ? "font-extrabold" : "font-semibold"
          }`}
        >
          {icon} {c.name}
          {c.kind === "dm" && c.dm_user_id && onlineIds.includes(c.dm_user_id) && (
            <span
              title="En línea"
              className="inline-block ml-1.5 h-2 w-2 rounded-full bg-emerald-500 align-middle"
            />
          )}
        </div>
        {!!c.unread_count && (
          <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-primary text-white text-[10px] font-bold flex items-center justify-center">
            {c.unread_count > 99 ? "99+" : c.unread_count}
          </span>
        )}
      </div>
      {c.last_message && (
        <div className={`text-[11px] truncate ${c.unread_count ? "text-brand-ink font-semibold" : "text-brand-slate"}`}>
          {c.last_message}
        </div>
      )}
    </button>
  );

  /** Fila de mensaje del hilo (estilo Slack compacto: avatar + nombre + texto). */
  const threadRow = (m: Msg, isRoot = false) => {
    const mine = m.user_id === me?.id;
    return (
      <div key={m.id} className={`relative group px-3 py-2 hover:bg-brand-bg-soft ${isRoot ? "bg-brand-bg/60" : ""}`}>
        {!m.deleted && (
          <MsgToolbar
            m={m}
            mine={mine}
            canDelete={(mine || canModerate) && !isRoot}
            confirmDelete={confirmDeleteId === m.id}
            onReact={toggleReaction}
            onPin={togglePin}
            onEdit={mine ? startEdit : undefined}
            onDelete={requestDelete}
          />
        )}
        <div className="flex gap-2">
          <div className="shrink-0 pt-0.5">
            <Avatar name={m.user_name} url={m.user_photo_url} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-bold text-brand-ink">{m.user_name}</span>
              <span className="text-[10px] text-brand-mist">{hhmm(m.created_at)}</span>
              {m.edited_at && !m.deleted && <span className="text-[9px] text-brand-mist">(editado)</span>}
            </div>
            {m.deleted ? (
              <div className="text-[13px] italic text-brand-mist">Mensaje eliminado</div>
            ) : editingId === m.id ? (
              <div className="mt-1">
                <textarea
                  className="input !py-1.5 text-sm resize-none"
                  rows={2}
                  value={editText}
                  autoFocus
                  onFocus={(e) => {
                    const n = e.currentTarget.value.length;
                    e.currentTarget.setSelectionRange(n, n);
                  }}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      saveEdit();
                    }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <div className="flex gap-2 mt-1">
                  <button className="btn-primary !px-3 !py-1 text-xs" onClick={saveEdit}>Guardar</button>
                  <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => setEditingId(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="text-[13px] text-brand-graphite break-words">
                <MsgMarkdown content={m.content} mine={false} />
                <AttachmentList list={m.attachments} mine={false} />
              </div>
            )}
            {!m.deleted && <ReactionChips m={m} meId={me?.id} onToggle={toggleReaction} />}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-4 h-[74vh]">
      {/* Canales */}
      <div className="card overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-brand-border">
          <input
            className="input !py-1.5 text-xs"
            placeholder="🔍 Buscar mensajes…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearchQ("")}
          />
        </div>
        {searchResults !== null ? (
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider2 text-brand-slate border-b border-brand-border/60">
              {searchResults.length} resultado{searchResults.length === 1 ? "" : "s"}
            </div>
            {searchResults.map((hit) => (
              <button
                key={hit.id}
                onClick={() => openSearchHit(hit)}
                className="w-full text-left px-4 py-2.5 border-b border-brand-border/60 hover:bg-brand-bg-soft"
              >
                <div className="text-[10px] font-bold text-brand-cyan">
                  {hit.channel_kind === "tema" ? `# ${hit.channel_name}` : `💬 ${hit.channel_name}`}
                  <span className="text-brand-mist font-normal ml-1.5">
                    {new Date(hit.created_at).toLocaleDateString("es-PY", { day: "numeric", month: "short" })}
                  </span>
                </div>
                <div className="text-xs text-brand-ink">
                  <span className="font-semibold">{hit.user_name}:</span>{" "}
                  <span className="text-brand-slate">{hit.content}</span>
                </div>
              </button>
            ))}
            {searchResults.length === 0 && (
              <p className="text-center text-xs text-brand-slate pt-8">Sin coincidencias.</p>
            )}
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2.5 label !mb-0 border-b border-brand-border">Temas</div>
          {channels.filter((c) => c.kind === "tema").map((c) => channelButton(c, "#"))}
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
          {channels.filter((c) => c.kind === "dm").map((c) => channelButton(c, "💬"))}
        </div>
        )}
      </div>

      {/* Conversación */}
      <div className="lg:col-span-3 card flex flex-col overflow-hidden relative">
        <div className="px-4 py-2.5 border-b border-brand-border flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="font-display text-lg uppercase text-brand-ink truncate">
              {active ? (active.kind === "tema" ? `# ${active.name}` : `💬 ${active.name}`) : "…"}
            </div>
            {active?.kind === "dm" && active.dm_user_id && (
              <span
                className={`text-[10px] font-semibold flex items-center gap-1 ${
                  onlineIds.includes(active.dm_user_id) ? "text-emerald-600" : "text-brand-mist"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    onlineIds.includes(active.dm_user_id) ? "bg-emerald-500" : "bg-brand-mist/50"
                  }`}
                />
                {onlineIds.includes(active.dm_user_id) ? "en línea" : "ausente"}
              </span>
            )}
          </div>
          <span className="text-[11px] text-brand-slate hidden sm:block">
            Mencioná con @ · reaccioná y respondé en hilos al pasar el mouse
          </span>
        </div>

        {/* Mensajes fijados del canal */}
        {pins.length > 0 && (
          <div className="relative border-b border-brand-border/60">
            <button
              onClick={() => setPinsOpen((v) => !v)}
              className="w-full text-left px-4 py-1.5 text-[11px] font-semibold text-brand-slate hover:bg-brand-bg-soft flex items-center gap-1.5"
            >
              📌 {pins.length} {pins.length === 1 ? "mensaje fijado" : "mensajes fijados"}
              <span className="text-[8px]">{pinsOpen ? "▲" : "▼"}</span>
            </button>
            {pinsOpen && (
              <div className="absolute top-full left-2 right-2 z-20 glass rounded-xl max-h-64 overflow-y-auto animate-pop">
                {pins.map((p) => (
                  <div key={p.id} className="px-3 py-2 border-b border-white/50 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-brand-ink">
                        {p.user_name}{" "}
                        <span className="text-brand-slate font-normal">{hhmm(p.created_at)}</span>
                        {p.pinned_by && (
                          <span className="text-brand-slate font-normal"> · fijó {p.pinned_by}</span>
                        )}
                      </span>
                      <button
                        className="text-[10px] text-brand-primary font-semibold hover:underline shrink-0"
                        onClick={() => togglePin(p)}
                      >
                        Desfijar
                      </button>
                    </div>
                    <div className="text-[12px] text-brand-graphite truncate">
                      {p.content || (p.attachments?.length ? `📎 ${p.attachments[0].name}` : "")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={msgScrollRef} onScroll={onMsgScroll} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => {
            const mine = m.user_id === me?.id;
            const prev = messages[i - 1];
            const next = messages[i + 1];
            // Agrupación estilo iMessage: mismo remitente dentro de 5 minutos
            const firstOfGroup =
              !prev || prev.user_id !== m.user_id || minutesBetween(prev.created_at, m.created_at) > 5;
            const lastOfGroup =
              !next || next.user_id !== m.user_id || minutesBetween(m.created_at, next.created_at) > 5;
            const showTimeDivider = !prev || minutesBetween(prev.created_at, m.created_at) > 30;
            const emojiOnly = !m.deleted && EMOJI_ONLY.test(m.content.trim());
            // Divisor «Nuevos mensajes»: primer mensaje ajeno posterior a la última lectura
            const showNewDivider =
              !!dividerAt &&
              !mine &&
              new Date(m.created_at) > new Date(dividerAt) &&
              (!prev || new Date(prev.created_at) <= new Date(dividerAt) || prev.user_id === me?.id);

            return (
              <div key={m.id}>
                {showTimeDivider && (
                  <div className="text-center text-[10px] text-brand-mist font-semibold py-1.5">
                    {new Date(m.created_at).toLocaleDateString("es-PY", {
                      day: "numeric", month: "short",
                    })}{" "}
                    {hhmm(m.created_at)}
                  </div>
                )}
                {showNewDivider && (
                  <div className="flex items-center gap-2 py-1.5">
                    <div className="flex-1 h-px bg-brand-primary/40" />
                    <span className="text-[10px] font-bold uppercase tracking-wider2 text-brand-primary">
                      Nuevos mensajes
                    </span>
                    <div className="flex-1 h-px bg-brand-primary/40" />
                  </div>
                )}
                <div
                  className={`relative group flex items-end gap-2 msg-in ${mine ? "justify-end" : ""} ${
                    firstOfGroup ? "mt-2" : "mt-0.5"
                  }`}
                >
                  {!m.deleted && (
                    <MsgToolbar
                      m={m}
                      mine={mine}
                      canDelete={mine || canModerate}
                      confirmDelete={confirmDeleteId === m.id}
                      onReact={toggleReaction}
                      onThread={openThread}
                      onPin={togglePin}
                      onEdit={mine ? startEdit : undefined}
                      onDelete={requestDelete}
                    />
                  )}
                  {/* Avatar del remitente (solo ajenos, en el último del grupo) */}
                  {!mine && (
                    <div className="w-7 shrink-0">
                      {lastOfGroup && <Avatar name={m.user_name} url={m.user_photo_url} />}
                    </div>
                  )}
                  <div className={`max-w-[75%] ${mine ? "items-end" : ""}`}>
                    {!mine && firstOfGroup && (
                      <div className="text-[10px] font-semibold text-brand-slate mb-0.5 ml-1">
                        {m.user_name}
                      </div>
                    )}
                    {m.deleted ? (
                      <div className={`px-3.5 py-2 text-[13px] italic text-brand-mist border border-dashed border-brand-border rounded-2xl ${mine ? "text-right" : ""}`}>
                        Mensaje eliminado
                      </div>
                    ) : editingId === m.id ? (
                      <div className="w-72 max-w-full">
                        <textarea
                          className="input !py-1.5 text-sm resize-none"
                          rows={2}
                          value={editText}
                          autoFocus
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              saveEdit();
                            }
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <div className={`flex gap-2 mt-1 ${mine ? "justify-end" : ""}`}>
                          <button className="btn-primary !px-3 !py-1 text-xs" onClick={saveEdit}>Guardar</button>
                          <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => setEditingId(null)}>Cancelar</button>
                        </div>
                      </div>
                    ) : emojiOnly ? (
                      <div className={`text-4xl leading-tight ${mine ? "text-right" : ""}`}>
                        {m.content.trim()}
                      </div>
                    ) : (
                      <div
                        className={`px-3.5 py-2 text-sm break-words shadow-soft ${
                          mine
                            ? `bg-gradient-to-b from-brand-primary to-brand-primary-dark text-white rounded-2xl ${
                                lastOfGroup ? "rounded-br-[5px]" : ""
                              }`
                            : `bg-white border border-brand-border text-brand-ink rounded-2xl ${
                                lastOfGroup ? "rounded-bl-[5px]" : ""
                              }`
                        }`}
                      >
                        {m.pinned_at && (
                          <div className={`text-[9px] font-semibold mb-0.5 ${mine ? "text-white/80" : "text-brand-primary"}`}>
                            📌 Fijado
                          </div>
                        )}
                        <MsgMarkdown content={m.content} mine={mine} />
                        <AttachmentList list={m.attachments} mine={mine} />
                        {m.mentions?.notes && m.mentions.notes.length > 0 && (
                          <div className="flex gap-1 flex-wrap mt-1.5">
                            {m.mentions.notes.map((n) => (
                              <Link
                                key={n.id}
                                href={`/projects/${params.id}/notes`}
                                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                                  mine ? "bg-white/20 text-white" : "bg-brand-cyan/10 text-brand-cyan"
                                }`}
                              >
                                📝 {n.title}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {!m.deleted && (
                      <div className={mine ? "flex justify-end" : ""}>
                        <ReactionChips m={m} meId={me?.id} onToggle={toggleReaction} />
                      </div>
                    )}
                    {!!m.reply_count && (
                      <button
                        onClick={() => openThread(m)}
                        className={`mt-1 text-[11px] font-semibold text-brand-cyan hover:underline flex items-center gap-1 ${
                          mine ? "ml-auto" : "ml-1"
                        }`}
                      >
                        💬 {m.reply_count} {m.reply_count === 1 ? "respuesta" : "respuestas"}
                      </button>
                    )}
                    {lastOfGroup && (
                      <div
                        className={`text-[9px] text-brand-mist mt-0.5 ${
                          mine ? "text-right mr-1" : "ml-1"
                        }`}
                      >
                        {hhmm(m.created_at)}
                        {m.edited_at && !m.deleted && <span className="ml-1">(editado)</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {messages.length === 0 && (
            <p className="text-center text-sm text-brand-slate pt-16">
              Sin mensajes todavía. Empezá la conversación del equipo.
            </p>
          )}
        </div>

        {/* Typing indicator */}
        <div className="h-5 px-4 flex items-center">
          {typingNames.length > 0 && (
            <span className="text-[11px] text-brand-slate italic animate-fade">
              {typingNames.slice(0, 2).join(" y ")}
              {typingNames.length > 2 ? ` y ${typingNames.length - 2} más` : ""}{" "}
              {typingNames.length === 1 ? "está escribiendo" : "están escribiendo"}
              <span className="inline-flex ml-0.5">
                <span className="animate-bounce [animation-delay:0ms]">.</span>
                <span className="animate-bounce [animation-delay:150ms]">.</span>
                <span className="animate-bounce [animation-delay:300ms]">.</span>
              </span>
            </span>
          )}
        </div>

        {/* Composer con autocompletado de menciones */}
        <div className="border-t border-brand-border p-3 relative">
          {mentionFilter !== null && (filteredUsers.length > 0 || filteredNotes.length > 0) && (
            <div className="absolute bottom-full left-3 right-3 mb-1 glass rounded-xl max-h-48 overflow-y-auto animate-pop z-10">
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
          {emojiOpen && (
            <div className="absolute bottom-full left-3 mb-1 glass rounded-xl p-2 z-20 animate-pop w-72">
              <div className="grid grid-cols-10 gap-0.5">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    className="h-7 w-7 rounded hover:bg-brand-bg text-lg leading-none"
                    onClick={() => {
                      insertEmoji(e);
                      setEmojiOpen(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
          {pendingFiles.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mb-2">
              {pendingFiles.map((f, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-brand-bg border border-brand-border text-[11px] font-semibold text-brand-ink"
                >
                  {fileIcon(f.mime, f.name)} <span className="truncate max-w-[160px]">{f.name}</span>
                  <span className="text-brand-mist font-normal">{fmtSize(f.size)}</span>
                  <button
                    className="text-brand-slate hover:text-brand-primary font-bold"
                    title="Quitar"
                    onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.zip"
              onChange={(e) => uploadFiles(e.target.files)}
            />
            <button
              className="self-end h-10 w-10 shrink-0 rounded-md border border-brand-border bg-white hover:border-brand-primary text-lg leading-none transition-colors disabled:opacity-50"
              title="Adjuntar archivo"
              disabled={uploading || pendingFiles.length >= 5}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "⏳" : "📎"}
            </button>
            <button
              className={`self-end h-10 w-10 shrink-0 rounded-md border text-xl leading-none transition-colors ${
                emojiOpen
                  ? "border-brand-primary bg-brand-primary-light"
                  : "border-brand-border bg-white hover:border-brand-primary"
              }`}
              title="Emojis"
              onClick={() => setEmojiOpen((v) => !v)}
            >
              😊
            </button>
            <textarea
              ref={textareaRef}
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
            <button
              className="btn-primary self-end"
              onClick={send}
              disabled={(!text.trim() && pendingFiles.length === 0) || !active || uploading}
            >
              Enviar
            </button>
          </div>
        </div>

        {/* Panel de hilo (slide-over) */}
        {thread && (
          <div className="absolute inset-y-0 right-0 w-full sm:w-[380px] bg-white border-l border-brand-border shadow-elevated flex flex-col z-30 animate-pop">
            <div className="px-4 py-2.5 border-b border-brand-border flex items-center justify-between bg-brand-bg/60">
              <div>
                <div className="font-display text-base uppercase text-brand-ink">Hilo</div>
                <div className="text-[10px] text-brand-slate">
                  {active?.kind === "tema" ? `# ${active?.name}` : active?.name}
                </div>
              </div>
              <button
                className="h-7 w-7 rounded-md hover:bg-brand-bg text-brand-slate text-sm font-bold"
                title="Cerrar hilo"
                onClick={() => setThread(null)}
              >
                ✕
              </button>
            </div>
            <div ref={threadScrollRef} className="flex-1 overflow-y-auto">
              {threadRow(thread, true)}
              <div className="px-3 py-1.5 flex items-center gap-2">
                <span className="text-[10px] font-semibold text-brand-slate">
                  {threadReplies.length} {threadReplies.length === 1 ? "respuesta" : "respuestas"}
                </span>
                <div className="flex-1 h-px bg-brand-border" />
              </div>
              {threadReplies.map((r) => threadRow(r))}
            </div>
            <div className="border-t border-brand-border p-2.5">
              <div className="flex gap-2">
                <textarea
                  className="input flex-1 !py-1.5 text-sm resize-none"
                  rows={2}
                  placeholder="Responder en el hilo…"
                  value={threadText}
                  onChange={(e) => {
                    setThreadText(e.target.value);
                    if (e.target.value.trim()) pingTyping();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendReply();
                    }
                  }}
                />
                <button
                  className="btn-primary self-end !px-3 !py-1.5 text-xs"
                  onClick={sendReply}
                  disabled={!threadText.trim()}
                >
                  Enviar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
