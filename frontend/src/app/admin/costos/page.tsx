"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import AppShell from "@/components/AppShell";
import { apiFetch, getUser } from "@/lib/api";

const COLORS = ["#E6332A", "#662483", "#00B2BF", "#F39200", "#0F1116", "#5B6275"];

const usd = (v: number) =>
  `US$ ${Number(v || 0).toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CostosIAPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");

  useEffect(() => {
    const u = getUser();
    if (u && !["superadmin", "consultor_lider"].includes(u.role)) {
      router.replace("/dashboard");
    }
  }, [router]);

  useEffect(() => {
    apiFetch<any>(`/api/v1/admin/ai-costs?days=${days}`)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [days]);

  const provider = data
    ? [
        { name: "OpenAI (GPT-5.6 Terra)", value: data.by_provider.openai },
        { name: "Perplexity (Sonar)", value: data.by_provider.perplexity },
        { name: "Embeddings (indexación)", value: data.by_provider.embeddings },
      ].filter((p) => p.value > 0)
    : [];

  return (
    <AppShell>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="font-display text-3xl uppercase text-brand-ink">Costos de IA</h1>
          <p className="text-sm text-brand-slate">
            Cuánto se gasta, en qué modelos, en qué se usa y quién consume más.
          </p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                days === d ? "bg-brand-primary text-white" : "bg-white border border-brand-border text-brand-graphite hover:border-brand-primary"
              }`}
            >
              {d} días
            </button>
          ))}
        </div>
      </div>

      {error && <div className="card p-4 text-brand-primary-dark text-sm mb-4">{error}</div>}
      {!data && !error && (
        <div className="card p-10 text-center text-brand-slate">Cargando…</div>
      )}

      {data && (
        <div className="space-y-4">
          {/* Totales */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-5">
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">
                Total últimos {data.days} días
              </div>
              <div className="font-display text-3xl text-brand-ink mt-1">{usd(data.total_usd)}</div>
            </div>
            <div className="card p-5 border-t-4" style={{ borderTopColor: "#E6332A" }}>
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">OpenAI · GPT-5.6 Terra</div>
              <div className="font-display text-3xl text-brand-ink mt-1">{usd(data.by_provider.openai)}</div>
            </div>
            <div className="card p-5 border-t-4" style={{ borderTopColor: "#662483" }}>
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Perplexity · Sonar</div>
              <div className="font-display text-3xl text-brand-ink mt-1">{usd(data.by_provider.perplexity)}</div>
            </div>
            <div className="card p-5 border-t-4" style={{ borderTopColor: "#00B2BF" }}>
              <div className="text-[10px] uppercase tracking-wider2 text-brand-slate">Embeddings · indexación</div>
              <div className="font-display text-3xl text-brand-ink mt-1">{usd(data.by_provider.embeddings)}</div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* En qué se usa */}
            <div className="card p-5">
              <div className="label mb-3">En qué se usa</div>
              {data.by_use.length === 0 ? (
                <p className="text-sm text-brand-slate">Sin consumo en el período.</p>
              ) : (
                <>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.by_use}
                          dataKey="usd"
                          nameKey="uso"
                          innerRadius={52}
                          outerRadius={85}
                          paddingAngle={2}
                        >
                          {data.by_use.map((_: any, i: number) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: any) => usd(Number(v))} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 space-y-1">
                    {data.by_use.map((u: any, i: number) => (
                      <div key={u.uso} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-brand-graphite">
                          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                          {u.uso}
                          {u.consultas > 0 && (
                            <span className="text-brand-slate">· {u.consultas} consultas</span>
                          )}
                        </span>
                        <b className="text-brand-ink">{usd(u.usd)}</b>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Quién consume */}
            <div className="card p-5">
              <div className="label mb-3">Quién consume más</div>
              {data.by_user.length === 0 ? (
                <p className="text-sm text-brand-slate">Sin consumo en el período.</p>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.by_user.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 24 }}>
                      <XAxis type="number" tickFormatter={(v) => `$${v}`} fontSize={11} />
                      <YAxis type="category" dataKey="usuario" width={130} fontSize={11} />
                      <Tooltip formatter={(v: any) => usd(Number(v))} />
                      <Bar dataKey="usd" fill="#E6332A" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Por modelo */}
            <div className="card p-5">
              <div className="label mb-3">Por modelo</div>
              {data.by_model.length === 0 ? (
                <p className="text-sm text-brand-slate">
                  El desglose por modelo se registra en cada investigación nueva.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {data.by_model.map((m: any) => (
                      <tr key={m.model} className="border-b border-brand-border last:border-0">
                        <td className="py-2 font-mono text-xs text-brand-graphite">{m.model}</td>
                        <td className="py-2 text-right font-semibold text-brand-ink">{usd(m.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {provider.length > 0 && (
                <p className="text-[11px] text-brand-slate mt-3">
                  Los mensajes históricos sin desglose se asignan a OpenAI.
                </p>
              )}
            </div>

            {/* Por proyecto */}
            <div className="card p-5">
              <div className="label mb-3">Por proyecto</div>
              {data.by_project.length === 0 ? (
                <p className="text-sm text-brand-slate">Sin consumo en el período.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {data.by_project.map((p: any) => (
                      <tr key={p.proyecto} className="border-b border-brand-border last:border-0">
                        <td className="py-2 text-brand-graphite">{p.proyecto}</td>
                        <td className="py-2 text-right font-semibold text-brand-ink">{usd(p.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
