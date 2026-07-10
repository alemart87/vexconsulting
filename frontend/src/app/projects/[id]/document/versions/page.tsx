"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, formatDate } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Version {
  id: string;
  version_number: number;
  summary?: string;
  author_name: string;
  word_count: number;
  words_added: number;
  words_removed: number;
  created_at: string;
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="text-xs font-mono whitespace-pre-wrap bg-brand-bg-soft rounded-md p-3 max-h-96 overflow-y-auto">
      {diff.split("\n").map((line, i) => {
        const cls = line.startsWith("+")
          ? "diff-line-add"
          : line.startsWith("-")
            ? "diff-line-del"
            : "diff-line-ctx";
        return (
          <span key={i} className={cls}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

export default function VersionsPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    apiFetch<Version[]>(`/api/v1/projects/${params.id}/versions`).then(setVersions);

  useEffect(() => {
    load();
  }, [params.id]);

  const open = async (id: string) => {
    const detail = await apiFetch<any>(`/api/v1/projects/${params.id}/versions/${id}`);
    setSelected(detail);
  };

  const restore = async (id: string, num: number) => {
    if (!confirm(`¿Restaurar la versión ${num}? Se creará una versión nueva con su contenido.`))
      return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/projects/${params.id}/versions/${id}/restore`, {
        method: "POST",
      });
      await load();
      setSelected(null);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const isAdmin = project?.my_permission === "admin";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card divide-y divide-brand-border max-h-[75vh] overflow-y-auto">
        {versions.map((v) => (
          <button
            key={v.id}
            onClick={() => open(v.id)}
            className={`w-full text-left px-4 py-3 hover:bg-brand-bg-soft transition-colors ${
              selected?.id === v.id ? "bg-brand-primary-light/40" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-brand-ink">
                v{v.version_number}
                {v.summary ? ` — ${v.summary}` : ""}
              </span>
              <span className="text-xs text-brand-mist">{formatDate(v.created_at)}</span>
            </div>
            <div className="text-xs text-brand-slate mt-0.5">
              {v.author_name} · {v.word_count.toLocaleString("es-PY")} palabras
              <span className="text-emerald-700"> +{v.words_added}</span>
              <span className="text-red-600"> −{v.words_removed}</span>
            </div>
          </button>
        ))}
        {versions.length === 0 && (
          <div className="p-8 text-center text-sm text-brand-slate">Sin versiones aún.</div>
        )}
      </div>

      <div className="card p-4">
        {!selected ? (
          <p className="text-sm text-brand-slate p-6 text-center">
            Seleccioná una versión para ver el detalle y el diff.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl uppercase text-brand-ink">
                Versión {selected.version_number}
              </h3>
              {isAdmin && (
                <button
                  className="btn-secondary text-xs px-3 py-1.5"
                  disabled={busy}
                  onClick={() => restore(selected.id, selected.version_number)}
                >
                  Restaurar esta versión
                </button>
              )}
            </div>
            <div className="text-xs text-brand-slate">
              {selected.author_name} · {formatDate(selected.created_at)}
            </div>
            {selected.diff_md ? (
              <>
                <div className="label">Cambios respecto de la versión anterior</div>
                <DiffView diff={selected.diff_md} />
              </>
            ) : (
              <p className="text-xs text-brand-slate">Versión inicial (sin diff).</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
