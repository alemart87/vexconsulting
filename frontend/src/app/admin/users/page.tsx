"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { ROLE_LABELS, apiFetch, formatDate, getUser } from "@/lib/api";

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
}

export default function AdminUsersPage() {
  const me = typeof window !== "undefined" ? getUser() : null;
  const isSuperadmin = me?.role === "superadmin";
  const isLiderTitular = me?.role === "consultor_lider";
  const [users, setUsers] = useState<UserRow[]>([]);
  const [form, setForm] = useState({ email: "", full_name: "", password: "", role: "consultor" });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

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
    await apiFetch(`/api/v1/users/${u.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !u.is_active }),
    });
    load();
  };

  return (
    <AppShell>
      <h1 className="font-display text-3xl uppercase text-brand-ink mb-6">Usuarios</h1>
      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={create} className="card p-5 space-y-3 h-fit">
          <h2 className="label">Crear usuario</h2>
          <input className="input" type="email" placeholder="Email" required
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input" placeholder="Nombre completo" required minLength={2}
            value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <input className="input" type="password" placeholder="Contraseña (mín. 8)" required minLength={8}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="input" value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {isSuperadmin && <option value="consultor_lider">Consultor líder</option>}
            {(isSuperadmin || isLiderTitular) && (
              <option value="consultor_lider_2">Consultor líder 2 (suplente)</option>
            )}
            <option value="consultor">Consultor</option>
            <option value="visualizador">Visualizador (solo lectura de publicados)</option>
          </select>
          {error && <p className="text-xs text-brand-primary-dark">{error}</p>}
          {ok && <p className="text-xs text-emerald-700">{ok}</p>}
          <button className="btn-primary w-full">Crear</button>
          <p className="text-[11px] text-brand-slate leading-relaxed">
            {isSuperadmin
              ? "Como superadmin podés crear todos los roles."
              : isLiderTitular
                ? "Como consultor líder podés crear suplentes (Consultor líder 2), consultores y visualizadores. El suplente tiene tus mismas atribuciones pero depende de vos."
                : "Como consultor líder suplente podés crear consultores y visualizadores."}
          </p>
        </form>

        <div className="lg:col-span-2 card divide-y divide-brand-border">
          <div className="px-5 py-3 flex text-xs font-semibold uppercase tracking-wider2 text-brand-slate">
            <span className="flex-1">Usuario</span>
            <span className="w-32">Rol</span>
            <span className="w-36 hidden sm:block">Último ingreso</span>
            <span className="w-20" />
          </div>
          {users.map((u) => (
            <div key={u.id} className={`px-5 py-3 flex items-center ${u.is_active ? "" : "opacity-50"}`}>
              <div className="flex-1">
                <div className="text-sm font-semibold text-brand-ink">{u.full_name}</div>
                <div className="text-xs text-brand-slate">{u.email}</div>
              </div>
              <div className="w-32">
                <span className="badge-neutral">{ROLE_LABELS[u.role] ?? u.role}</span>
              </div>
              <div className="w-36 text-xs text-brand-slate hidden sm:block">
                {formatDate(u.last_login_at)}
              </div>
              <button className="btn-ghost text-xs w-20" onClick={() => toggleActive(u)}>
                {u.is_active ? "Desactivar" : "Activar"}
              </button>
            </div>
          ))}
          {users.length === 0 && (
            <div className="p-8 text-center text-sm text-brand-slate">Sin usuarios creados.</div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
