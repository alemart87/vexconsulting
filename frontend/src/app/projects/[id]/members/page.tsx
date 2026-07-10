"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ROLE_LABELS, apiFetch } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Member {
  id: string;
  user_id: string;
  permission: string;
  user_name?: string;
  user_email?: string;
  user_role?: string;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

export default function MembersPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selUser, setSelUser] = useState("");
  const [selPerm, setSelPerm] = useState("write");
  const [error, setError] = useState("");
  const isAdmin = project?.my_permission === "admin";

  const load = () =>
    apiFetch<Member[]>(`/api/v1/projects/${params.id}/members`).then(setMembers);

  useEffect(() => {
    load();
    if (isAdmin)
      apiFetch<UserRow[]>("/api/v1/users").then(setUsers).catch(() => {});
  }, [params.id, isAdmin]);

  const available = users.filter(
    (u) => u.is_active && !members.some((m) => m.user_id === u.id)
  );

  const add = async () => {
    if (!selUser) return;
    setError("");
    try {
      const isViewer = users.find((u) => u.id === selUser)?.role === "visualizador";
      await apiFetch(`/api/v1/projects/${params.id}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: selUser, permission: isViewer ? "read" : selPerm }),
      });
      setSelUser("");
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const changePerm = async (m: Member, permission: string) => {
    try {
      await apiFetch(`/api/v1/projects/${params.id}/members/${m.id}`, {
        method: "PATCH",
        body: JSON.stringify({ permission }),
      });
      load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const remove = async (m: Member) => {
    if (!confirm(`¿Quitar a ${m.user_name} del proyecto?`)) return;
    await apiFetch(`/api/v1/projects/${params.id}/members/${m.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="max-w-3xl space-y-4">
      {isAdmin && (
        <div className="card p-5">
          <h2 className="label mb-3">Agregar miembro</h2>
          <div className="flex gap-2 flex-wrap">
            <select className="input !w-auto flex-1" value={selUser} onChange={(e) => setSelUser(e.target.value)}>
              <option value="">Seleccionar usuario…</option>
              {available.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({ROLE_LABELS[u.role] ?? u.role})
                </option>
              ))}
            </select>
            <select className="input !w-40" value={selPerm} onChange={(e) => setSelPerm(e.target.value)}>
              <option value="read">Lectura</option>
              <option value="write">Escritura</option>
              <option value="admin">Edición total</option>
            </select>
            <button className="btn-primary" onClick={add} disabled={!selUser}>
              Agregar
            </button>
          </div>
          {error && <p className="text-xs text-brand-primary-dark mt-2">{error}</p>}
        </div>
      )}

      <div className="card divide-y divide-brand-border">
        <div className="px-5 py-3 flex text-xs font-semibold uppercase tracking-wider2 text-brand-slate">
          <span className="flex-1">Miembro</span>
          <span className="w-36">Permiso</span>
          {isAdmin && <span className="w-16" />}
        </div>
        {members.map((m) => (
          <div key={m.id} className="px-5 py-3 flex items-center">
            <div className="flex-1">
              <div className="text-sm font-semibold text-brand-ink">{m.user_name}</div>
              <div className="text-xs text-brand-slate">
                {m.user_email} · {ROLE_LABELS[m.user_role ?? ""] ?? m.user_role}
              </div>
            </div>
            <div className="w-36">
              {isAdmin && m.user_role !== "visualizador" ? (
                <select
                  className="input !py-1 text-xs"
                  value={m.permission}
                  onChange={(e) => changePerm(m, e.target.value)}
                >
                  <option value="read">Lectura</option>
                  <option value="write">Escritura</option>
                  <option value="admin">Edición total</option>
                </select>
              ) : (
                <span className="badge-neutral">{m.permission}</span>
              )}
            </div>
            {isAdmin && (
              <button className="btn-ghost text-xs w-16" onClick={() => remove(m)}>
                Quitar
              </button>
            )}
          </div>
        ))}
        {members.length === 0 && (
          <div className="p-8 text-center text-sm text-brand-slate">
            El proyecto todavía no tiene miembros asignados.
          </div>
        )}
      </div>
    </div>
  );
}
