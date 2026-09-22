"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AccountTypeBadge, EmptyState, FilterBar, Money, ShareBar, TableWrap, td, tdNum, th, thNum } from "@/components/finanzas/ui";
import { apiFetch } from "@/lib/api";
import { int, pct, type FinAccount } from "@/lib/finanzas";

const TYPE_ORDER: Record<string, number> = { gasto: 0, pasivo: 1, activo: 2, otro: 3 };
const TYPE_TITLE: Record<string, string> = {
  gasto: "Cuentas de gasto (debe)",
  pasivo: "Pasivos a pagar (haber)",
  activo: "Descuentos al personal (haber)",
  otro: "Otras cuentas",
};

export default function AccountsPage() {
  const params = useParams<{ id: string }>();
  const [accounts, setAccounts] = useState<FinAccount[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");

  useEffect(() => {
    apiFetch<FinAccount[]>(`/api/v1/finanzas/sessions/${params.id}/accounts`)
      .then(setAccounts)
      .catch((e) => setError(e.message));
  }, [params.id]);

  const groups = useMemo(() => {
    const list = (accounts ?? []).filter((a) => {
      if (type && a.type !== type) return false;
      if (q) {
        const s = q.toLowerCase();
        return a.desc.toLowerCase().includes(s) || String(a.code).includes(s) || (a.position ?? "").toLowerCase().includes(s);
      }
      return true;
    });
    const map = new Map<string, FinAccount[]>();
    for (const a of list) map.set(a.type, [...(map.get(a.type) ?? []), a]);
    return [...map.entries()].sort((x, y) => (TYPE_ORDER[x[0]] ?? 9) - (TYPE_ORDER[y[0]] ?? 9));
  }, [accounts, q, type]);

  if (error) return <EmptyState title="Sin cuentas" body={error} />;
  if (!accounts) return <div className="card p-10 text-center text-brand-slate">Cargando…</div>;

  const totalGasto = accounts.filter((a) => a.type === "gasto").reduce((s, a) => s + a.net, 0);

  return (
    <div>
      <FilterBar>
        <div className="flex-1 min-w-[220px]">
          <label className="label">Buscar cuenta</label>
          <input className="input" placeholder="Código, descripción o puesto…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="label">Tipo</label>
          <select className="input !w-auto" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Todas</option>
            <option value="gasto">Gasto</option>
            <option value="pasivo">Pasivo</option>
            <option value="activo">Descuento al personal</option>
          </select>
        </div>
        <div className="text-xs text-brand-slate pb-2.5">
          {accounts.length} cuentas · hacé clic en una para ver todos sus movimientos
        </div>
      </FilterBar>

      {groups.map(([kind, list]) => {
        const sum = list.reduce((s, a) => s + a.net, 0);
        return (
          <section key={kind} className="mb-6">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="font-display text-lg uppercase text-brand-ink">{TYPE_TITLE[kind] ?? kind}</h2>
              <div className="text-xs text-brand-slate">
                {list.length} cuentas · total <b className="text-brand-ink"><Money n={sum} /></b>
              </div>
            </div>
            <TableWrap>
              <thead>
                <tr>
                  <th className={th}>Cuenta</th>
                  <th className={th}>Concepto</th>
                  <th className={th}>Puesto / área</th>
                  <th className={thNum}>Líneas</th>
                  <th className={thNum}>Colab.</th>
                  <th className={thNum}>Centros</th>
                  <th className={thNum}>Neto</th>
                  {kind === "gasto" && <th className={`${th} w-36`}>Particip.</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.code} className="hover:bg-brand-bg-soft cursor-pointer">
                    <td className={td}>
                      <Link href={`/finanzas/${params.id}/cuentas/${a.code}`} className="block">
                        <div className="font-semibold text-brand-ink">{a.desc.replace(/^VOI\s*-\s*/i, "")}</div>
                        <div className="text-[11px] text-brand-slate">
                          {a.code} · <AccountTypeBadge type={a.type} />
                        </div>
                      </Link>
                    </td>
                    <td className={td}>{a.concept_label}</td>
                    <td className={td}>
                      {a.position ?? "—"}
                      {a.area !== "-" && <div className="text-[11px] text-brand-slate capitalize">{a.area}</div>}
                    </td>
                    <td className={tdNum}>{int(a.rows)}</td>
                    <td className={tdNum}>{int(a.people)}</td>
                    <td className={tdNum}>{int(a.cost_centers)}</td>
                    <td className={tdNum}>
                      <Link href={`/finanzas/${params.id}/cuentas/${a.code}`} className="font-semibold text-brand-ink">
                        <Money n={a.net} />
                      </Link>
                    </td>
                    {kind === "gasto" && (
                      <td className={`${td} align-middle`}>
                        <div className="text-[11px] text-brand-slate mb-1">{pct(totalGasto ? a.net / totalGasto : 0)}</div>
                        <ShareBar share={totalGasto ? a.net / totalGasto : 0} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </section>
        );
      })}
      {groups.length === 0 && <EmptyState title="Sin resultados" body="Ninguna cuenta coincide con el filtro." />}
    </div>
  );
}
