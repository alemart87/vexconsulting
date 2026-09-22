"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { Money, StatusBadge } from "@/components/finanzas/ui";
import { apiFetch, formatDate, getUser } from "@/lib/api";
import type { FinSession } from "@/lib/finanzas";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function defaultPeriod(): string {
  // Por defecto el mes anterior: lo habitual es analizar la nómina ya cerrada
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function periodName(p: string): string {
  const [y, m] = p.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

export default function FinanzasHome() {
  const user = typeof window !== "undefined" ? getUser() : null;
  const isSuperadmin = user?.role === "superadmin";
  const [sessions, setSessions] = useState<FinSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState(defaultPeriod());
  const [name, setName] = useState(periodName(defaultPeriod()));
  const [nameTouched, setNameTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    apiFetch<FinSession[]>("/api/v1/finanzas/sessions")
      .then(setSessions)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Las sesiones en curso se refrescan solas
  useEffect(() => {
    if (!sessions.some((s) => s.status === "queued" || s.status === "running")) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [sessions]);

  const onPeriod = (v: string) => {
    setPeriod(v);
    if (!nameTouched && /^\d{4}-\d{2}$/.test(v)) setName(periodName(v));
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const s = await apiFetch<FinSession>("/api/v1/finanzas/sessions", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), period: period || null, description: description || null }),
      });
      window.location.href = `/finanzas/${s.id}`;
    } catch (err: any) {
      setError(err.message);
      setCreating(false);
    }
  };

  return (
    <AppShell fluid>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-cyan font-semibold">
            Módulo
          </div>
          <h1 className="font-display text-3xl uppercase text-brand-ink">VEXFINANZAS</h1>
          <p className="text-sm text-brand-slate">
            {isSuperadmin
              ? "Todas las sesiones de análisis de la plataforma."
              : "Tus sesiones de análisis. Cada sesión cruza los asientos de un período."}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)} data-tour="nueva-sesion">
          + Nueva sesión de trabajo
        </button>
      </div>

      {/* Pestañas del módulo (por ahora una sola) */}
      <div className="flex items-center gap-1 border-b border-brand-border mb-5">
        <span className="px-3 py-2 text-sm font-semibold text-brand-ink border-b-2 border-brand-primary -mb-px">
          Análisis de centros de costos
        </span>
      </div>

      {showForm && (
        <form onSubmit={create} className="card p-5 mb-6 grid gap-3 md:grid-cols-[1fr_1fr_2fr_auto] items-end animate-pop">
          <div>
            <label className="label">Mes analizado</label>
            <input
              className="input"
              type="month"
              value={period}
              onChange={(e) => onPeriod(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Nombre del análisis</label>
            <input
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              minLength={2}
              maxLength={200}
              required
              placeholder="Agosto 2026"
            />
          </div>
          <div>
            <label className="label">Descripción (opcional)</label>
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              placeholder="Nómina completa: mensualeros, operaciones, egresos y complementos"
            />
          </div>
          <button className="btn-primary whitespace-nowrap" disabled={creating}>
            {creating ? "Creando…" : "Crear y subir archivos"}
          </button>
          {error && <p className="text-xs text-brand-primary-dark md:col-span-4">{error}</p>}
        </form>
      )}

      {loading ? (
        <div className="card p-10 text-center text-brand-slate">Cargando…</div>
      ) : sessions.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-display text-xl uppercase text-brand-ink">Todavía no hay sesiones</p>
          <p className="text-sm text-brand-slate mt-2 max-w-lg mx-auto">
            Creá una sesión de trabajo, subí los Excel de asientos «A cruzar» del mes
            (mensualeros, operaciones, egresos y complementos) y presioná
            «Ejecutar VeXFinanzas». El sistema cruza los colaboradores por Funcod y arma
            el resumen gerencial.
          </p>
          <button className="btn-primary mt-4" onClick={() => setShowForm(true)}>
            Crear la primera
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/finanzas/${s.id}`}
              className="card p-5 hover:shadow-elevated transition-shadow animate-pop"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">{s.name}</h2>
                <StatusBadge status={s.status} />
              </div>
              <div className="text-xs text-brand-slate mb-3">
                {s.period_label}
                {s.description ? ` · ${s.description}` : ""}
              </div>
              {s.totals ? (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-brand-bg px-2 py-2">
                    <div className="font-display text-lg text-brand-ink leading-none">
                      <Money n={s.totals.cost} compact />
                    </div>
                    <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mt-1">Gasto</div>
                  </div>
                  <div className="rounded-md bg-brand-bg px-2 py-2">
                    <div className="font-display text-lg text-brand-ink leading-none">{s.totals.collaborators}</div>
                    <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mt-1">Colaboradores</div>
                  </div>
                  <div className="rounded-md bg-brand-bg px-2 py-2">
                    <div className="font-display text-lg text-brand-ink leading-none">{s.totals.cost_centers}</div>
                    <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mt-1">Centros</div>
                  </div>
                </div>
              ) : (
                <div className="rounded-md bg-brand-bg px-3 py-2 text-xs text-brand-slate">
                  {s.status === "running" || s.status === "queued"
                    ? `⏳ ${s.stage_note || "Ejecutando…"}`
                    : s.status === "failed"
                      ? `⚠ ${s.last_error || "Falló la ejecución"}`
                      : `${s.file_count} archivo${s.file_count === 1 ? "" : "s"} · pendiente de ejecutar`}
                </div>
              )}
              <div className="mt-3 text-[11px] text-brand-mist flex justify-between">
                <span>
                  {s.file_count} archivos · {s.note_count} notas
                </span>
                <span>
                  {formatDate(s.updated_at)}
                  {isSuperadmin && s.owner_name ? ` · ${s.owner_name}` : ""}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
