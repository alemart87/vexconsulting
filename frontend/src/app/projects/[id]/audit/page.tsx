"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, formatDate } from "@/lib/api";

export default function ProjectAuditPage() {
  const params = useParams<{ id: string }>();
  const [entries, setEntries] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<any[]>(`/api/v1/projects/${params.id}/audit`)
      .then(setEntries)
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (error) return <div className="card p-8 text-center text-brand-primary-dark">{error}</div>;

  return (
    <div className="card divide-y divide-brand-border">
      {entries.map((e) => (
        <div key={e.id} className="px-5 py-2.5 flex items-center gap-3 text-sm">
          <span className="w-40 text-xs text-brand-mist shrink-0">{formatDate(e.created_at)}</span>
          <span className="badge-neutral shrink-0">{e.action}</span>
          <span className="flex-1 truncate">
            <b className="text-brand-ink">{e.user_email ?? "—"}</b>
            {e.detail && (
              <span className="text-brand-slate text-xs"> · {JSON.stringify(e.detail)}</span>
            )}
          </span>
        </div>
      ))}
      {entries.length === 0 && (
        <div className="p-8 text-center text-sm text-brand-slate">Sin eventos registrados.</div>
      )}
    </div>
  );
}
