"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch, formatDate } from "@/lib/api";

interface Entry {
  id: string;
  user_email?: string;
  user_role?: string;
  action: string;
  project_id?: string;
  detail?: Record<string, unknown>;
  ip?: string;
  created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  login: "badge-success",
  login_failed: "badge-primary",
  "document.save": "badge-cyan",
  "project.publish": "badge-success",
};

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [action, setAction] = useState("");
  const [email, setEmail] = useState("");
  const [tab, setTab] = useState<"all" | "logins">("all");

  const load = () => {
    const qs = new URLSearchParams();
    if (action) qs.set("action", action);
    if (email) qs.set("user_email", email);
    const url = tab === "logins" ? "/api/v1/admin/logins" : `/api/v1/admin/audit?${qs}`;
    apiFetch<Entry[]>(url).then(setEntries).catch(() => {});
  };

  useEffect(load, [tab]);

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-display text-3xl uppercase text-brand-ink">Auditoría</h1>
        <div className="flex gap-2">
          <button className={tab === "all" ? "nav-link-active" : "nav-link"} onClick={() => setTab("all")}>
            Toda la actividad
          </button>
          <button className={tab === "logins" ? "nav-link-active" : "nav-link"} onClick={() => setTab("logins")}>
            Ingresos
          </button>
        </div>
      </div>

      {tab === "all" && (
        <div className="card p-4 mb-4 flex gap-2 flex-wrap">
          <input className="input !w-56" placeholder="Filtrar por email…" value={email}
            onChange={(e) => setEmail(e.target.value)} />
          <input className="input !w-56" placeholder="Acción exacta (ej. document.save)" value={action}
            onChange={(e) => setAction(e.target.value)} />
          <button className="btn-secondary" onClick={load}>Filtrar</button>
        </div>
      )}

      <div className="card divide-y divide-brand-border">
        {entries.map((e) => (
          <div key={e.id} className="px-5 py-2.5 flex items-center gap-3 text-sm">
            <span className="w-40 text-xs text-brand-mist shrink-0">{formatDate(e.created_at)}</span>
            <span className={`${ACTION_COLORS[e.action] ?? "badge-neutral"} shrink-0`}>{e.action}</span>
            <span className="flex-1 truncate">
              <b className="text-brand-ink">{e.user_email ?? e.user_role ?? "—"}</b>
              {e.detail && (
                <span className="text-brand-slate text-xs"> · {JSON.stringify(e.detail)}</span>
              )}
            </span>
            {e.ip && <span className="text-xs text-brand-mist shrink-0">{e.ip}</span>}
          </div>
        ))}
        {entries.length === 0 && (
          <div className="p-8 text-center text-sm text-brand-slate">Sin eventos.</div>
        )}
      </div>
    </AppShell>
  );
}
