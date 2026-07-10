"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

interface Notif {
  id: string;
  kind: "chat" | "mencion" | "nota";
  title: string;
  body?: string | null;
  link?: string | null;
  count: number;
  actor_name?: string | null;
  created_at: string;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

const KIND_ICON: Record<string, string> = { chat: "💬", mencion: "@", nota: "📌" };

/** Campana de notificaciones: mensajes de chat, menciones y notas nuevas.
 *  Solo muestra las NO leídas; al abrirlas se marcan leídas y desaparecen. */
export default function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: Notif[]; unread: number }>("/api/v1/notifications");
      setItems(res.items);
      setUnread(res.unread);
    } catch {
      /* sin sesión o backend caído: la campana queda vacía */
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 20_000);
    return () => clearInterval(interval);
  }, [load]);

  // Cerrar el panel al hacer click afuera
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const openItem = (n: Notif) => {
    setItems((list) => list.filter((x) => x.id !== n.id));
    setUnread((u) => Math.max(0, u - 1));
    setOpen(false);
    apiFetch(`/api/v1/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
    if (!n.link) return;
    // Ya en la misma página (ej. otro canal del mismo chat): recarga completa
    // para que se abra el canal/nota exactos del query string.
    const [path] = n.link.split("?");
    if (window.location.pathname === path) window.location.href = n.link;
    else router.push(n.link);
  };

  const readAll = () => {
    setItems([]);
    setUnread(0);
    apiFetch("/api/v1/notifications/read-all", { method: "POST" }).catch(() => {});
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        className="relative h-9 w-9 rounded-full border border-brand-border bg-white flex items-center justify-center text-base hover:border-brand-primary transition-colors"
        title="Notificaciones"
        aria-label="Notificaciones"
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-primary text-white text-[10px] font-bold flex items-center justify-center animate-pop">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[380px] max-w-[90vw] card shadow-elevated z-50 overflow-hidden animate-fade">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-brand-border bg-brand-bg-soft">
            <span className="font-display uppercase text-sm text-brand-ink tracking-wide">
              Notificaciones
            </span>
            {items.length > 0 && (
              <button className="text-xs text-brand-cyan hover:underline" onClick={readAll}>
                Marcar todas como leídas
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-brand-slate">
                Sin notificaciones pendientes ✓
              </div>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className="w-full text-left px-4 py-3 border-b border-brand-border last:border-0 hover:bg-brand-bg transition-colors flex gap-3"
              >
                <span
                  className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ${
                    n.kind === "mencion"
                      ? "bg-brand-purple/10 text-brand-purple"
                      : n.kind === "nota"
                        ? "bg-brand-orange/10 text-brand-orange"
                        : "bg-brand-cyan/10 text-brand-cyan"
                  }`}
                >
                  {KIND_ICON[n.kind] ?? "•"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-brand-ink leading-snug">
                    {n.title}
                    {n.count > 1 && (
                      <span className="ml-1.5 badge-primary !text-[10px] !px-1.5">
                        ×{n.count}
                      </span>
                    )}
                  </span>
                  {n.body && (
                    <span className="block text-xs text-brand-slate truncate mt-0.5">
                      {n.body}
                    </span>
                  )}
                  <span className="block text-[10px] uppercase tracking-wider2 text-brand-slate/70 mt-1">
                    {timeAgo(n.created_at)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
