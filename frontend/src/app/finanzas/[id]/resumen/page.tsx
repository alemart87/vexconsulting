"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
import { DownloadButton, EmptyState, Money, ShareBar, StatTile, TableWrap, td, tdNum, th, thNum } from "@/components/finanzas/ui";
import { apiFetch, downloadFile } from "@/lib/api";
import { CHART, KIND_LABEL, balanceStatus, gs, gsCompact, int, pct, type FinSummary } from "@/lib/finanzas";
import { CategoryBadge } from "@/components/finanzas/ui";

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
  const [dlError, setDlError] = useState("");
  // Descarga de un segmento (tarjeta): tipo de contrato o concepto de descuento
  const downloadSegment = async (kind: "category" | "concept", value: string, label: string) => {
    setDlError("");
    try {
      const name = `${summary?.period || "sesion"}_${label.replace(/[^\w-]+/g, "-")}.xlsx`;
      await downloadFile(`/api/v1/finanzas/sessions/${params.id}/export/segment?kind=${kind}&value=${encodeURIComponent(value)}`, name);
    } catch (e: any) {
      setDlError(e.message || "No se pudo generar la descarga");
    }
  };

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
  // Anticipos y descuentos por centro: 3 series fijas (anticipos, promocionales, otros = varios + embargos)
  const dedCenters = useMemo(
    () =>
      (summary?.deductions?.by_cost_center ?? []).slice(0, 15).map((c) => ({
        name: c.desc.replace(/^V\s*-\s*/i, "").slice(0, 28),
        code: c.code,
        anticipo: c.anticipo,
        promocional: c.descuento_promocional,
        otros: c.descuento_varios + c.embargo,
        total: c.total,
      })),
    [summary]
  );
  const [showAllDed, setShowAllDed] = useState(false);
  // Colaboradores en varios centros: fila expandida (clic) y lista completa
  const [openMulti, setOpenMulti] = useState<Record<string, boolean>>({});
  const [multiCenter, setMultiCenter] = useState<number | null>(null);
  // Primeros 15 + «Ver más» en la lista de centros y en la tabla
  const [showAllMultiCenters, setShowAllMultiCenters] = useState(false);
  const [showAllMulti, setShowAllMulti] = useState(false);
  const multiRows = useMemo(() => {
    const items = summary?.multi_cc?.items ?? [];
    if (multiCenter === null) return items;
    // Filtrado por centro: quienes están compartidos en ese centro, ordenados por lo que cae ahí
    return items
      .filter((m) => m.centers.some((c) => c.code === multiCenter))
      .map((m) => ({ ...m, in_cc: m.centers.find((c) => c.code === multiCenter)! }))
      .sort((a, b) => b.in_cc.cost - a.in_cc.cost);
  }, [summary, multiCenter]);
  const multiMax = useMemo(() => Math.max(1, ...(summary?.multi_cc?.by_cost_center ?? []).map((c) => c.people)), [summary]);

  if (error) return <EmptyState title="Sin resumen" body={error} />;
  if (!summary) return <div className="card p-10 text-center text-brand-slate">Cargando…</div>;

  const t = summary.totals;
  const cat = summary.categories;
  const base = `/finanzas/${params.id}`;
  const warnings = showAllWarnings ? summary.warnings : summary.warnings.slice(0, 6);

  return (
    <div className="space-y-6">
      {dlError && (
        <div className="rounded-md bg-brand-primary-light text-brand-primary-dark text-sm px-3 py-2">⚠ {dlError}</div>
      )}
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
              <div key={k} className="card p-4 relative" style={{ borderTop: `4px solid ${accent}` }}>
                <DownloadButton
                  className="absolute top-3 right-3"
                  title={`Descargar Excel · ${c.label}`}
                  onClick={() => downloadSegment("category", k, c.label)}
                />
                <div className="flex items-baseline justify-between pr-10">
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

      {/* Colaboradores imputados a varios centros de costo */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="label !mb-0">Colaboradores en más de un centro de costo</h2>
          {summary.multi_cc && (
            <Link href={`${base}/colaboradores?multi_cc=true`} className="text-xs text-brand-primary hover:underline">
              Ver los {int(summary.multi_cc.people)} en Colaboradores →
            </Link>
          )}
        </div>
        {!summary.multi_cc ? (
          <div className="card p-5 mt-2 text-sm text-brand-slate">
            Esta sesión se ejecutó con una versión anterior: volvé a presionar «Ejecutar VeXFinanzas» para ver esta sección.
          </div>
        ) : (
          <>
            <p className="text-xs text-brand-slate mt-1 mb-2">
              Una persona puede estar imputada a varios centros en el mismo mes. Su costo se reparte por línea entre esos
              centros y <b>nunca se cuenta dos veces</b> en los totales de la sesión.
            </p>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-4">
              <StatTile label="Colaboradores compartidos" value={int(summary.multi_cc.people)} hint={`de ${int(t.collaborators)} (${pct(t.collaborators ? summary.multi_cc.people / t.collaborators : 0)})`} />
              <StatTile label="Gasto que se reparte" value={gsCompact(summary.multi_cc.cost)} full={gs(summary.multi_cc.cost)} hint={`${pct(t.cost ? summary.multi_cc.cost / t.cost : 0)} del gasto total`} />
              <StatTile label="Centros con compartidos" value={int(summary.multi_cc.by_cost_center.length)} hint={`de ${int(t.cost_centers)} centros`} />
              <StatTile
                label="Centros por persona"
                value={`hasta ${int(summary.multi_cc.max_centers)}`}
                hint={Object.entries(summary.multi_cc.by_count)
                  .sort((a, b) => Number(a[0]) - Number(b[0]))
                  .map(([n, k]) => `${k} en ${n}`)
                  .join(" · ")}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[2fr_3fr] items-start">
              {/* Lista COMPLETA de centros: clic = filtrar la tabla de la derecha */}
              <div className="card">
                <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
                  <h3 className="label !mb-0">Centros con colaboradores compartidos</h3>
                  <span className="text-[11px] text-brand-slate">clic en un centro para filtrar</span>
                </div>
                <div className="divide-y divide-brand-border">
                  <button
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm hover:bg-brand-bg-soft ${multiCenter === null ? "bg-brand-primary-light" : ""}`}
                    onClick={() => setMultiCenter(null)}
                  >
                    <span className="flex-1 font-semibold text-brand-ink">Todos los centros</span>
                    <span className="text-xs text-brand-slate">{int(summary.multi_cc.people)} personas</span>
                  </button>
                  {(showAllMultiCenters ? summary.multi_cc.by_cost_center : summary.multi_cc.by_cost_center.slice(0, 15)).map((c) => {
                    const active = multiCenter === c.code;
                    return (
                      <button
                        key={c.code}
                        className={`w-full grid grid-cols-[minmax(0,1fr)_110px_96px] items-center gap-3 px-4 py-2 text-left text-sm hover:bg-brand-bg-soft ${active ? "bg-brand-primary-light" : ""}`}
                        onClick={() => setMultiCenter(active ? null : c.code)}
                        title={`${c.desc} (${c.code}) · ${int(c.people)} compartidos · reciben ${gs(c.cost)}`}
                      >
                        <span className="min-w-0">
                          <span className={`block truncate ${active ? "font-semibold text-brand-primary-dark" : "text-brand-ink"}`}>{c.desc}</span>
                          <span className="block text-[11px] text-brand-slate">{c.code}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="h-2 flex-1 bg-brand-bg rounded overflow-hidden" aria-hidden>
                            <span className="block h-full rounded" style={{ width: `${(c.people / multiMax) * 100}%`, background: CHART.single }} />
                          </span>
                          <span className="w-6 text-right tabular-nums font-semibold text-brand-ink">{int(c.people)}</span>
                        </span>
                        <span className="text-right text-xs tabular-nums text-brand-slate" title="Gasto de los compartidos que cae en este centro">{gsCompact(c.cost)}</span>
                      </button>
                    );
                  })}
                </div>
                {summary.multi_cc.by_cost_center.length > 15 && (
                  <button className="w-full text-xs text-brand-primary py-2 hover:underline border-t border-brand-border" onClick={() => setShowAllMultiCenters((v) => !v)}>
                    {showAllMultiCenters ? "Ver menos" : `Ver los ${summary.multi_cc.by_cost_center.length} centros`}
                  </button>
                )}
              </div>

              {/* Tabla: filtrada por el centro elegido */}
              <div className="card">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
                  <h3 className="label !mb-0">
                    {multiCenter === null
                      ? `Colaboradores compartidos · ${int(multiRows.length)}`
                      : `${int(multiRows.length)} compartidos en ${summary.multi_cc.by_cost_center.find((c) => c.code === multiCenter)?.desc ?? multiCenter}`}
                  </h3>
                  {multiCenter !== null && (
                    <span className="flex items-center gap-2 text-xs">
                      <Link href={`${base}/centros/${multiCenter}`} className="text-brand-primary hover:underline">Ver el centro →</Link>
                      <button className="btn-ghost text-xs" onClick={() => setMultiCenter(null)}>✕ Quitar filtro</button>
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr>
                        <th className={th}>Colaborador · clic para ver el reparto</th>
                        <th className={th}>Puesto</th>
                        <th className={thNum}>Centros</th>
                        {multiCenter !== null && <th className={thNum}>En este centro</th>}
                        <th className={thNum}>Gasto total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(showAllMulti ? multiRows : multiRows.slice(0, 15)).map((m) => {
                        const open = !!openMulti[m.funcod];
                        const inCc = (m as { in_cc?: { cost: number; share: number } }).in_cc;
                        const cols = multiCenter !== null ? 5 : 4;
                        return (
                          <Fragment key={m.funcod}>
                            <tr
                              className="hover:bg-brand-bg-soft cursor-pointer"
                              onClick={() => setOpenMulti((o) => ({ ...o, [m.funcod]: !open }))}
                            >
                              <td className={td}>
                                <span className="text-brand-slate text-xs mr-1">{open ? "▾" : "▸"}</span>
                                <span className="font-semibold text-brand-ink">{m.name}</span>
                                <div className="text-[11px] text-brand-slate pl-4 flex items-center gap-2">
                                  Funcod {m.funcod} <CategoryBadge category={m.category} egreso={m.is_egreso} />
                                </div>
                              </td>
                              <td className={td}>{m.position ?? "—"}</td>
                              <td className={`${tdNum} font-semibold`}>{int(m.cc_count)}</td>
                              {inCc && (
                                <td className={tdNum}>
                                  <Money n={inCc.cost} />
                                  <div className="text-[11px] text-brand-slate">{pct(inCc.share, 0)} de su costo</div>
                                </td>
                              )}
                              <td className={tdNum}><Money n={m.total_cost} /></td>
                            </tr>
                            {open && (
                              <tr>
                                <td colSpan={cols} className="px-3 pb-3 pt-0 border-t-0 bg-brand-bg-soft">
                                  <div className="rounded-md border border-brand-border bg-white divide-y divide-brand-border">
                                    {m.centers.map((c) => (
                                      <div key={c.code} className={`flex items-center gap-3 px-3 py-1.5 text-xs ${c.code === multiCenter ? "bg-brand-primary-light" : ""}`}>
                                        <button
                                          className="flex-1 text-left text-brand-ink hover:text-brand-primary"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setMultiCenter(c.code);
                                          }}
                                          title="Filtrar por este centro"
                                        >
                                          {c.desc} <span className="text-brand-slate">({c.code})</span>
                                        </button>
                                        <span className="w-24"><ShareBar share={c.share} /></span>
                                        <span className="w-14 text-right text-brand-slate">{pct(c.share, 0)}</span>
                                        <span className="w-32 text-right tabular-nums font-semibold"><Money n={c.cost} /></span>
                                      </div>
                                    ))}
                                    <div className="flex items-center justify-between px-3 py-1.5 text-xs text-brand-slate">
                                      <span>Neto a pagar {gs(m.net_pay)}</span>
                                      <Link href={`${base}/colaboradores/${m.funcod}`} className="text-brand-primary hover:underline">Ver ficha completa →</Link>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {multiRows.length > 15 && (
                  <button className="w-full text-xs text-brand-primary py-2 hover:underline border-t border-brand-border" onClick={() => setShowAllMulti((v) => !v)}>
                    {showAllMulti ? "Ver menos" : `Ver los ${int(multiRows.length)} colaboradores`}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Anticipos y descuentos al personal */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="label !mb-0">Anticipos y descuentos al personal (no salariales)</h2>
          {summary.deductions && (
            <span className="text-[11px] text-brand-slate">
              Retenidos del neto a pagar · {int(summary.deductions.people)} colaboradores · {pct(summary.deductions.share_of_net_pay)} del neto total
            </span>
          )}
        </div>
        {!summary.deductions ? (
          <div className="card p-5 mt-2 text-sm text-brand-slate">
            Esta sesión se ejecutó con una versión anterior: volvé a presionar «Ejecutar VeXFinanzas» para ver anticipos y descuentos.
          </div>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mt-2">
              {summary.deductions.by_concept.map((d) => (
                <StatTile
                  key={d.concept}
                  label={d.label}
                  value={gsCompact(d.amount)}
                  full={gs(d.amount)}
                  hint={`${int(d.people)} colaboradores · prom. ${gsCompact(d.avg)} · máx. ${gsCompact(d.max)}`}
                  accent={d.concept === "anticipo" ? CHART.mensualero : d.concept === "descuento_promocional" ? CHART.jornalero : CHART.third}
                  onDownload={() => downloadSegment("concept", d.concept, d.label)}
                  downloadTitle={`Descargar Excel · ${d.label}`}
                />
              ))}
              <StatTile
                label="Total descontado"
                value={gsCompact(summary.deductions.total)}
                full={gs(summary.deductions.total)}
                hint={`${pct(summary.deductions.share_of_net_pay)} del neto a pagar · ${summary.deductions.by_file.map((f) => `${f.label} ${gsCompact(f.amount)}`).join(" · ")}`}
                onDownload={() => downloadSegment("concept", "deducciones", "Anticipos y descuentos")}
                downloadTitle="Descargar Excel · todos los anticipos y descuentos"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2 mt-4">
              <div className="card p-5">
                <h3 className="label">Anticipos y descuentos por centro de costo · top 15</h3>
                <div style={{ height: Math.max(300, dedCenters.length * 24 + 40) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dedCenters} layout="vertical" margin={{ left: 4, right: 48, top: 8, bottom: 4 }} barCategoryGap={4}>
                      <CartesianGrid horizontal={false} stroke={CHART.grid} />
                      <XAxis type="number" tickFormatter={(v) => gsCompact(v).replace("Gs. ", "")} tick={axisStyle} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={170} tick={axisStyle} axisLine={false} tickLine={false} />
                      <Tooltip
                        {...tooltipStyle()}
                        formatter={(v: any, n: any) => [gs(Number(v)), n === "anticipo" ? "Anticipos" : n === "promocional" ? "Desc. promocionales" : "Desc. varios + embargos"]}
                        labelFormatter={(l: any, p: any) => `${l}${p?.[0]?.payload?.code ? ` (${p[0].payload.code})` : ""} · total ${gs(p?.[0]?.payload?.total ?? 0)}`}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === "anticipo" ? "Anticipos" : v === "promocional" ? "Desc. promocionales" : "Desc. varios + embargos")} />
                      <Bar dataKey="anticipo" stackId="d" fill={CHART.mensualero} isAnimationActive={false} stroke="#fff" strokeWidth={1} />
                      <Bar dataKey="promocional" stackId="d" fill={CHART.jornalero} isAnimationActive={false} stroke="#fff" strokeWidth={1} />
                      <Bar dataKey="otros" stackId="d" fill={CHART.third} radius={[0, 4, 4, 0]} isAnimationActive={false} stroke="#fff" strokeWidth={1} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr>
                      <th className={th}>Centro de costo</th>
                      <th className={thNum} title="Colaboradores con algún descuento / total del centro">Con desc.</th>
                      <th className={thNum}>Anticipos</th>
                      <th className={thNum}>Promoc.</th>
                      <th className={thNum}>Varios + emb.</th>
                      <th className={thNum}>Total</th>
                      <th className={thNum}>% del neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllDed ? summary.deductions.by_cost_center : summary.deductions.by_cost_center.slice(0, 15)).map((c) => (
                      <tr key={c.code} className="hover:bg-brand-bg-soft">
                        <td className={td}>
                          <Link href={`${base}/centros/${c.code}`} className="text-brand-ink hover:text-brand-primary">{c.desc}</Link>
                          <div className="text-[11px] text-brand-slate">{c.code}</div>
                        </td>
                        <td className={tdNum}>{int(c.deduction_people)} / {int(c.people)}</td>
                        <td className={tdNum}>{c.anticipo ? <Money n={c.anticipo} compact /> : <span className="text-brand-mist">—</span>}</td>
                        <td className={tdNum}>{c.descuento_promocional ? <Money n={c.descuento_promocional} compact /> : <span className="text-brand-mist">—</span>}</td>
                        <td className={tdNum}>{c.descuento_varios + c.embargo ? <Money n={c.descuento_varios + c.embargo} compact /> : <span className="text-brand-mist">—</span>}</td>
                        <td className={`${tdNum} font-semibold`}><Money n={c.total} compact /></td>
                        <td className={tdNum}>{pct(c.share_of_net_pay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {summary.deductions.by_cost_center.length > 15 && (
                  <button className="w-full text-xs text-brand-primary py-2 hover:underline" onClick={() => setShowAllDed((v) => !v)}>
                    {showAllDed ? "Ver menos" : `Ver los ${summary.deductions.by_cost_center.length} centros con descuentos`}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
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
