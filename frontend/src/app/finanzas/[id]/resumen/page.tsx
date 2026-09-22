"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState, Money, ShareBar, StatTile, TableWrap, td, tdNum, th, thNum } from "@/components/finanzas/ui";
import { apiFetch } from "@/lib/api";
import { CHART, KIND_LABEL, balanceStatus, gs, gsCompact, int, pct, type FinSummary } from "@/lib/finanzas";

const axisStyle = { fontSize: 11, fill: CHART.slate };

function tooltipStyle() {
  return {
    contentStyle: { borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 },
    labelStyle: { color: CHART.ink, fontWeight: 600 },
  };
}

export default function ResumenPage() {
  const params = useParams<{ id: string }>();
  const [summary, setSummary] = useState<FinSummary | null>(null);
  const [error, setError] = useState("");
  const [showAllWarnings, setShowAllWarnings] = useState(false);

  useEffect(() => {
    apiFetch<{ summary: FinSummary }>(`/api/v1/finanzas/sessions/${params.id}/summary`)
      .then((r) => setSummary(r.summary))
      .catch((e) => setError(e.message));
  }, [params.id]);

  const topCenters = useMemo(
    () =>
      (summary?.cost_centers ?? []).slice(0, 15).map((c) => ({
        name: c.desc.replace(/^V\s*-\s*/i, "").slice(0, 28),
        code: c.code,
        cost: c.cost,
        mensualeros: c.mensualeros,
        jornaleros: c.jornaleros,
        share: c.share,
      })),
    [summary]
  );
  const concepts = useMemo(
    () => (summary?.concepts ?? []).filter((c) => c.cost > 0).map((c) => ({ name: c.label, cost: c.cost, share: c.share })),
    [summary]
  );

  if (error) return <EmptyState title="Sin resumen" body={error} />;
  if (!summary) return <div className="card p-10 text-center text-brand-slate">Cargando…</div>;

  const t = summary.totals;
  const cat = summary.categories;
  const base = `/finanzas/${params.id}`;
  const warnings = showAllWarnings ? summary.warnings : summary.warnings.slice(0, 6);

  return (
    <div className="space-y-6">
      {/* KPIs principales */}
      <section>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <StatTile label="Gasto total del mes" value={gsCompact(t.cost)} full={gs(t.cost)} hint="Cuentas de gasto (5xxxxx)" />
          <StatTile label="Colaboradores" value={int(t.collaborators)} hint={`${int(t.multi_cc_people)} en más de un centro`} />
          <StatTile label="Centros de costo" value={int(t.cost_centers)} hint={`${int(t.clients)} clientes/negocios`} />
          <StatTile label="Cuentas contables" value={int(t.accounts)} hint={`${int(t.rows)} líneas de asiento`} />
          <StatTile label="Neto a pagar" value={gsCompact(t.net_pay)} full={gs(t.net_pay)} hint="Sueldos y jornales a pagar" />
          <StatTile label="IPS a pagar" value={gsCompact(t.ips)} full={gs(t.ips)} hint="Aporte patronal + obrero" />
          <StatTile label="Costo promedio" value={gsCompact(t.avg_cost_per_person)} full={gs(t.avg_cost_per_person)} hint="Por colaborador" />
          <StatTile label="Archivos cruzados" value={int(t.files)} hint={summary.files.every((f) => balanceStatus(f.diff).ok) ? (t.balance_diff === 0 ? "Todos cuadran" : `Todos cuadran (redondeo ${int(t.balance_diff)} Gs.)`) : `${summary.files.filter((f) => !balanceStatus(f.diff).ok).length} sin cuadrar`} />
        </div>
      </section>

      {/* Categorías: mensualeros / jornaleros / egresos */}
      <section>
        <h2 className="label">Dotación por tipo de contrato</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(["mensualero", "jornalero", "sin_clasificar", "egresos"] as const).map((k) => {
            const c = cat[k];
            const accent = k === "mensualero" ? CHART.mensualero : k === "jornalero" ? CHART.jornalero : k === "egresos" ? CHART.third : CHART.slate;
            return (
              <div key={k} className="card p-4" style={{ borderTop: `4px solid ${accent}` }}>
                <div className="flex items-baseline justify-between">
                  <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold">{c.label}</div>
                  <div className="text-[11px] text-brand-slate">{pct(c.share)} del gasto</div>
                </div>
                <div className="flex items-end justify-between mt-1">
                  <div className="font-display text-3xl text-brand-ink leading-none">{int(c.people)}</div>
                  <div className="text-right">
                    <div className="font-semibold text-brand-ink tabular-nums" title={gs(c.cost)}>{gsCompact(c.cost)}</div>
                    <div className="text-[11px] text-brand-slate">prom. {gsCompact(c.avg_cost)}</div>
                  </div>
                </div>
                <div className="text-[11px] text-brand-slate mt-2">
                  {k === "mensualero" && "Mandos y soporte: coordinadores, supervisores, calidad, back office, administración."}
                  {k === "jornalero" && "Operadores (cuentas 510019/510020)."}
                  {k === "sin_clasificar" && "Sin cuenta de remuneración en el mes (solo cargas, vacaciones u otros)."}
                  {k === "egresos" && "Aparecen en el asiento de egresos o cobran preaviso/indemnización."}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Gráficos */}
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="card p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="label !mb-0">Gasto por centro de costo · top 15</h2>
            <Link href={`${base}/centros`} className="text-xs text-brand-primary hover:underline">Ver los {int(t.cost_centers)} →</Link>
          </div>
          <div style={{ height: Math.max(320, topCenters.length * 24 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCenters} layout="vertical" margin={{ left: 4, right: 56, top: 8, bottom: 4 }} barCategoryGap={4}>
                <CartesianGrid horizontal={false} stroke={CHART.grid} />
                <XAxis type="number" tickFormatter={(v) => gsCompact(v).replace("Gs. ", "")} tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={170} tick={axisStyle} axisLine={false} tickLine={false} />
                <Tooltip
                  {...tooltipStyle()}
                  formatter={(v: any) => [gs(Number(v)), "Gasto"]}
                  labelFormatter={(l: any, p: any) => `${l}${p?.[0]?.payload?.code ? ` (${p[0].payload.code})` : ""}`}
                />
                <Bar dataKey="cost" fill={CHART.single} radius={[0, 4, 4, 0]} isAnimationActive={false}
                  label={{ position: "right", fontSize: 10, fill: CHART.slate, formatter: (v: any) => pct(topCenters.find((c) => c.cost === v)?.share ?? 0, 0) }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="label">Dotación por centro de costo · top 15</h2>
          <div style={{ height: Math.max(320, topCenters.length * 24 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCenters} layout="vertical" margin={{ left: 4, right: 32, top: 8, bottom: 4 }} barCategoryGap={4}>
                <CartesianGrid horizontal={false} stroke={CHART.grid} />
                <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={170} tick={axisStyle} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle()} formatter={(v: any, n: any) => [int(Number(v)), n === "mensualeros" ? "Mensualeros" : "Jornaleros"]} />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === "mensualeros" ? "Mensualeros" : "Jornaleros")} />
                <Bar dataKey="mensualeros" stackId="a" fill={CHART.mensualero} isAnimationActive={false} stroke="#fff" strokeWidth={1} />
                <Bar dataKey="jornaleros" stackId="a" fill={CHART.jornalero} radius={[0, 4, 4, 0]} isAnimationActive={false} stroke="#fff" strokeWidth={1} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="card p-5">
          <h2 className="label">Composición del gasto por concepto</h2>
          <div style={{ height: Math.max(220, concepts.length * 30 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={concepts} layout="vertical" margin={{ left: 4, right: 64, top: 4, bottom: 4 }} barCategoryGap={6}>
                <CartesianGrid horizontal={false} stroke={CHART.grid} />
                <XAxis type="number" tickFormatter={(v) => gsCompact(v).replace("Gs. ", "")} tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={150} tick={axisStyle} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle()} formatter={(v: any) => [gs(Number(v)), "Gasto"]} />
                <Bar dataKey="cost" fill={CHART.single} radius={[0, 4, 4, 0]} isAnimationActive={false}
                  label={{ position: "right", fontSize: 10, fill: CHART.slate, formatter: (v: any) => pct(concepts.find((c) => c.cost === v)?.share ?? 0, 0) }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {summary.concepts.some((c) => c.cost < 0) && (
            <p className="text-[11px] text-brand-slate mt-2">
              Conceptos con neto negativo (reversiones) no se grafican:{" "}
              {summary.concepts.filter((c) => c.cost < 0).map((c) => `${c.label} ${gs(c.cost)}`).join(", ")}.
            </p>
          )}
        </div>

        <div className="card p-5">
          <h2 className="label">Dotación y gasto por puesto</h2>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Puesto</th>
                <th className={thNum}>Personas</th>
                <th className={thNum}>Gasto</th>
                <th className={thNum}>Promedio</th>
              </tr>
            </thead>
            <tbody>
              {summary.positions.map((p) => (
                <tr key={p.position} className="hover:bg-brand-bg-soft">
                  <td className={td}>{p.position}</td>
                  <td className={tdNum}>{int(p.people)}</td>
                  <td className={tdNum}><Money n={p.cost} compact /></td>
                  <td className={tdNum}><Money n={p.avg_cost} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Clientes */}
      <section className="card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="label !mb-0">Gasto por cliente / negocio</h2>
          <span className="text-[11px] text-brand-slate">Derivado de la descripción del centro de costo</span>
        </div>
        <div className="overflow-x-auto scrollbar-thin mt-3">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr>
                <th className={th}>Cliente</th>
                <th className={thNum}>Centros</th>
                <th className={thNum}>Personas</th>
                <th className={thNum}>Gasto</th>
                <th className={thNum}>Particip.</th>
                <th className={`${th} w-40`} />
              </tr>
            </thead>
            <tbody>
              {summary.clients.map((c) => (
                <tr key={c.client} className="hover:bg-brand-bg-soft">
                  <td className={td}>{c.client}</td>
                  <td className={tdNum}>{int(c.cost_centers)}</td>
                  <td className={tdNum}>{int(c.people)}</td>
                  <td className={tdNum}><Money n={c.cost} /></td>
                  <td className={tdNum}>{pct(c.share)}</td>
                  <td className={`${td} align-middle`}><ShareBar share={c.share} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Archivos y avisos */}
      <section className="grid gap-4 xl:grid-cols-2">
        <div>
          <h2 className="label">Archivos cruzados</h2>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Archivo</th>
                <th className={th}>Tipo</th>
                <th className={thNum}>Asiento</th>
                <th className={th}>Fecha</th>
                <th className={thNum}>Filas</th>
                <th className={thNum}>Colab.</th>
                <th className={thNum}>Debe</th>
                <th className={thNum}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {summary.files.map((f) => (
                <tr key={f.id}>
                  <td className={td}>{f.label}</td>
                  <td className={td}><span className="badge-neutral">{KIND_LABEL[f.kind] ?? f.kind}</span></td>
                  <td className={tdNum}>{f.entry_number ?? "—"}</td>
                  <td className={td}>{f.entry_date ?? "—"}</td>
                  <td className={tdNum}>{int(f.rows)}</td>
                  <td className={tdNum}>{int(f.people)}</td>
                  <td className={tdNum}><Money n={f.debit} compact /></td>
                  <td className={`${td} text-right`}>
                    {(() => {
                      const b = balanceStatus(f.diff);
                      return <span className={`text-xs font-semibold ${b.ok ? "text-emerald-700" : "text-[#8A5200]"}`}>{b.label}</span>;
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
        <div>
          <h2 className="label">Avisos del cruce ({summary.warnings.length})</h2>
          <div className="card divide-y divide-brand-border">
            {summary.warnings.length === 0 && (
              <div className="p-4 text-sm text-emerald-700">✓ Sin avisos: todos los asientos cuadran y los Funcod están limpios.</div>
            )}
            {warnings.map((w, i) => (
              <div key={i} className="px-4 py-2.5 text-xs flex gap-2">
                <span className={w.level === "error" ? "text-brand-primary" : w.level === "warn" ? "text-[#8A5200]" : "text-brand-cyan"}>
                  {w.level === "error" ? "⛔" : w.level === "warn" ? "⚠" : "ℹ"}
                </span>
                <span className="text-brand-graphite">{w.text}</span>
              </div>
            ))}
            {summary.warnings.length > 6 && (
              <button className="w-full text-xs text-brand-primary py-2 hover:underline" onClick={() => setShowAllWarnings((v) => !v)}>
                {showAllWarnings ? "Ver menos" : `Ver los ${summary.warnings.length} avisos`}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
