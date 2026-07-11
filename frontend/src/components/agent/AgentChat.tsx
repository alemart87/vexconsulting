"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, getToken } from "@/lib/api";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  tools?: string[];
}

export interface Proposal {
  id: string;
  titulo: string;
  texto_md: string;
}

interface Props {
  projectId: string;
  viewerMode?: boolean;
  roleSlug?: string;
  onProposal?: (p: Proposal) => void;
  heightClass?: string;
}

export default function AgentChat({ projectId, viewerMode, roleSlug, onProposal, heightClass }: Props) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState("");
  const [currentTool, setCurrentTool] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scrollear solo el panel del chat, no la ventana.
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, thinking]);

  const ensureConversation = useCallback(async (): Promise<string> => {
    if (conversationId) return conversationId;
    const conv = await apiFetch<any>(`/api/v1/projects/${projectId}/agent/conversations`, {
      method: "POST",
      body: JSON.stringify({ role_slug: roleSlug || undefined }),
    });
    setConversationId(conv.id);
    return conv.id;
  }, [conversationId, projectId, roleSlug]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setStreaming(true);
    setThinking("");
    setCurrentTool("");

    let assistantText = "";
    let assistantReasoning = "";
    const toolsUsed: string[] = [];

    try {
      const convId = await ensureConversation();
      const res = await fetch(
        `/api/v1/projects/${projectId}/agent/conversations/${convId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ content: text }),
        }
      );
      if (!res.ok || !res.body) throw new Error("No se pudo contactar al agente");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Placeholder del asistente que se va completando
      setMessages((m) => [...m, { role: "assistant", content: "" }]);

      const updateLast = (patch: Partial<ChatMessage>) =>
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
          return copy;
        });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue; // comentarios/heartbeats
          let ev: any;
          try {
            ev = JSON.parse(line.slice(5));
          } catch {
            continue;
          }
          if (ev.type === "token") {
            assistantText += ev.text;
            updateLast({ content: assistantText });
          } else if (ev.type === "reasoning") {
            assistantReasoning += ev.text;
            setThinking(assistantReasoning.slice(-160));
          } else if (ev.type === "tool") {
            toolsUsed.push(ev.name);
            setCurrentTool(ev.name);
            updateLast({ tools: [...toolsUsed] });
          } else if (ev.type === "proposal" && onProposal) {
            onProposal(ev.proposal);
          } else if (ev.type === "error") {
            setError(ev.message);
          } else if (ev.type === "done") {
            updateLast({ content: ev.content || assistantText, tools: [...toolsUsed] });
          }
        }
      }
    } catch (e: any) {
      setError(e.message || "Error de conexión con el agente");
    } finally {
      setStreaming(false);
      setThinking("");
      setCurrentTool("");
    }
  };

  return (
    <div className={`card flex flex-col ${heightClass ?? "h-[72vh]"}`}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-sm text-brand-slate pt-16">
            {viewerMode
              ? "Preguntale al asistente sobre el documento publicado."
              : "Consultá al agente: busca en las fuentes del proyecto, lee el documento, propone texto y registra hallazgos."}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] rounded-lg bg-brand-primary text-white px-4 py-2.5 text-sm"
                  : "max-w-[92%] rounded-lg bg-brand-bg px-4 py-2.5"
              }
            >
              {m.role === "assistant" ? (
                <>
                  {m.tools && m.tools.length > 0 && (
                    <div className="flex gap-1 flex-wrap mb-2">
                      {m.tools.map((t, j) => (
                        <span key={j} className="badge-cyan">
                          🔧 {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="prose-vex text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || "…"}</ReactMarkdown>
                  </div>
                </>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {streaming && (thinking || currentTool) && (
          <div className="text-xs shimmer-text font-semibold">
            {currentTool ? `Usando ${currentTool}…` : `Razonando… ${thinking}`}
          </div>
        )}
        {error && (
          <div className="rounded-md bg-brand-primary-light text-brand-primary-dark text-sm px-3 py-2">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-brand-border p-3 flex gap-2">
        <textarea
          className="input flex-1 !py-2 resize-none"
          rows={2}
          placeholder={viewerMode ? "Preguntá sobre el informe…" : "Preguntá al agente del proyecto…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={streaming}
        />
        <button className="btn-primary self-end" onClick={send} disabled={streaming || !input.trim()}>
          {streaming ? "…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}
