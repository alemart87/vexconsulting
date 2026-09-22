"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { MODULE_LABELS, ROLE_LABELS, apiFetch, formatDate, getUser } from "@/lib/api";

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  extra_modules?: string[] | null;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
}

const ALL_ROLES = ["consultor_lider", "consultor_lider_2", "consultor", "visualizador", "gerente_operaciones"];
const MODULES = ["consultorias", "finanzas"];

/** Módulos que el rol ya trae de por sí (el permiso especial solo suma los que faltan). */
function roleModules(role: string): string[] {
  if (role === "gerente_operaciones") return ["finanzas"];
  if (role === "visualizador") return [];
  return ["consultorias"];
}

export default function AdminUsersPage() {
  const me = typeof window !== "undefined" ? getUser() : null;
  const isSuperadmin = me?.role === "superadmin";
  const isLiderTitular = me?.role === "consultor_lider";
  const manageable = isSuperadmin
    ? ALL_ROLES
    : isLiderTitular
      ? ["consultor_lider_2", "consultor", "visualizador"]
      : ["consultor", "visualizador"];

  const [users, setUsers] = useState<UserRow[]>([]);
  const [form, setForm] = useState({ email: "", full_name: "", password: "", role: "consultor" });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  // Edición en línea (rol + permisos especiales)
  const [editing, setEditing] = useState<string | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editModules, setEditModules] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = () => {
    apiFetch<UserRow[]>("/api/v1/users").then(setUsers).catch(() => {});
  };
  useEffect(load, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setOk("");
    try {
      await apiFetch("/api/v1/users", { method: "POST", body: JSON.stringify(form) });
      setOk(`Usuario ${form.email} creado.`);
      setForm({ email: "", full_name: "", password: "", role: "consultor" });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleActive = async (u: UserRow) => {
    setError("");
    try {
      await apiFetch(`/api/v1/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const startEdit = (u: UserRow) => {
    setEditing(u.id);
    setEditRole(u.role);
    setEditModules(u.extra_modules ?? []);
    setError("");
    setOk("");
  };

  const saveEdit = async (u: UserRow) => {
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {};
      if (editRole !== u.role) body.role = editRole;
      if (isSuperadmin) {
        // Solo se guardan como especiales los módulos que el rol no trae de por sí
        body.extra_modules = editModules.filter((m) => !roleModules(editRole).includes(m));
      }
      await apiFetch(`/api/v1/users/${u.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setOk(`${u.full_name}: cambios guardados.`);
      setEditing(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const canManage = (u: UserRow) => manageable.includes(u.role) && u.id !== me?.id;

  return (
    <AppShell>
      <h1 className="font-display text-3xl uppercase text-brand-ink mb-1">Usuarios</h1>
      <p className="text-sm text-brand-slate mb-6">
        {isSuperadmin
          ? "Creá usuarios, cambiá roles y otorgá permisos especiales de módulo."
          : "Creá y administrá los usuarios de tu equipo."}
      </p>
      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={create} className="card p-5 space-y-3 h-fit">
          <h2 className="label">Crear usuario</h2>
          <input className="input" type="email" placeholder="Email" required
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input" placeholder="Nombre completo" required minLength={2}
            value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <input className="input" type="password" placeholder="Contraseña (mín. 10, letras y números)" required minLength={10}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="input" value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {isSuperadmin && <option value="consultor_lider">Consultor líder</option>}
            {(isSuperadmin || isLiderTitular) && (
              <option value="consultor_lider_2">Consultor líder 2 (suplente)</option>
            )}
            <option value="consultor">Consultor</option>
            <option value="visualizador">Visualizador (solo lectura de publicados)</option>
            {isSuperadmin && (
              <option value="gerente_operaciones">Gerente de Operaciones (VEXFINANZAS)</option>
            )}
          </select>
          {error && <p className="text-xs text-brand-primary-dark">{error}</p>}
          {ok && <p className="text-xs text-emerald-700">{ok}</p>}
          <button className="btn-primary w-full">Crear</button>
          <p className="text-[11px] text-brand-slate leading-relaxed">
            {isSuperadmin
              ? "Como superadmin podés crear todos los roles, cambiar el rol de cualquier usuario (✎) y otorgar permisos especiales: un Gerente con acceso a VexConsultorías o un Consultor con acceso a VEXFINANZAS. El usuario recibe el cambio en su próximo ingreso o al recargar."
              : isLiderTitular
                ? "Como consultor líder podés crear suplentes (Consultor líder 2), consultores y visualizadores. El suplente tiene tus mismas atribuciones pero depende de vos."
                : "Como consultor líder suplente podés crear consultores y visualizadores."}
          </p>
        </form>

        <div className="lg:col-span-2 card divide-y divide-brand-border">
          <div className="px-5 py-3 flex text-xs font-semibold uppercase tracking-wider2 text-brand-slate">
            <span className="flex-1">Usuario</span>
            <span className="w-44">Rol y permisos</span>
            <span className="w-36 hidden sm:block">Último ingreso</span>
            <span className="w-32" />
          </div>
          {users.map((u) => {
            const isEditing = editing === u.id;
            const extras = u.extra_modules ?? [];
            return (
              <div key={u.id} className={`px-5 py-3 ${u.is_active ? "" : "opacity-50"}`}>
                <div className="flex items-center">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-brand-ink">{u.full_name}</div>
                    <div className="text-xs text-brand-slate">{u.email}</div>
                  </div>
                  <div className="w-44">
                    <span className="badge-neutral">{ROLE_LABELS[u.role] ?? u.role}</span>
                    {extras.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {extras.map((m) => (
                          <span key={m} className="badge-cyan" title="Permiso especial otorgado por el superadmin">
                            + {MODULE_LABELS[m] ?? m}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="w-36 text-xs text-brand-slate hidden sm:block">
                    {formatDate(u.last_login_at)}
                  </div>
                  <div className="w-32 flex items-center justify-end gap-1">
                    {canManage(u) && !isEditing && (
                      <button className="btn-ghost text-xs" onClick={() => startEdit(u)} title="Cambiar rol y permisos">
                        ✎
                      </button>
                    )}
                    {canManage(u) && (
                      <button className="btn-ghost text-xs" onClick={() => toggleActive(u)}>
                        {u.is_active ? "Desactivar" : "Activar"}
                      </button>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-3 rounded-md bg-brand-bg-soft border border-brand-border p-3 grid gap-3 md:grid-cols-[220px_1fr_auto] items-start animate-pop">
                    <div>
                      <label className="label">Rol</label>
                      <select className="input" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                        {manageable.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Permisos especiales de módulo</label>
                      {isSuperadmin ? (
                        <div className="flex flex-wrap gap-3 pt-2">
                          {MODULES.map((m) => {
                            const byRole = roleModules(editRole).includes(m);
                            const checked = byRole || editModules.includes(m);
                            return (
                              <label key={m} className={`inline-flex items-center gap-2 text-sm ${byRole ? "text-brand-mist" : "text-brand-ink"}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={byRole}
                                  onChange={(e) =>
                                    setEditModules((cur) =>
                                      e.target.checked ? [...cur, m] : cur.filter((x) => x !== m)
                                    )
                                  }
                                />
                                {MODULE_LABELS[m]}
                                {byRole && <span className="text-[10px] uppercase tracking-wider2">incluido en el rol</span>}
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-brand-slate pt-2">Solo el superadmin otorga permisos especiales.</p>
                      )}
                    </div>
                    <div className="flex gap-1 md:pt-6">
                      <button className="btn-primary !py-2 text-xs" disabled={saving} onClick={() => saveEdit(u)}>
                        {saving ? "Guardando…" : "Guardar"}
                      </button>
                      <button className="btn-ghost text-xs" onClick={() => setEditing(null)}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {users.length === 0 && (
            <div className="p-8 text-center text-sm text-brand-slate">Sin usuarios creados.</div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
