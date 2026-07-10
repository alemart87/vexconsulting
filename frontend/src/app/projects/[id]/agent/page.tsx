"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AgentChat, { Proposal } from "@/components/agent/AgentChat";
import { apiFetch } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

interface Role {
  slug: string;
  label: string;
}

export default function AgentPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleSlug, setRoleSlug] = useState<string>("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [copied, setCopied] = useState("");
  const [chatKey, setChatKey] = useState(0);

  useEffect(() => {
    apiFetch<Role[]>("/api/v1/agent/roles").then(setRoles).catch(() => {});
  }, []);

  useEffect(() => {
    if (project?.agent_role_slug && !roleSlug) setRoleSlug(project.agent_role_slug);
  }, [project, roleSlug]);

  const copyProposal = async (p: Proposal) => {
    await navigator.clipboard.writeText(p.texto_md);
    setCopied(p.id);
    setTimeout(() => setCopied(""), 2000);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center gap-2">
          <span className="label !mb-0">Rol del agente:</span>
          <select
            className="input !w-auto !py-1.5 text-sm"
            value={roleSlug}
            onChange={(e) => {
              setRoleSlug(e.target.value);
              setChatKey((k) => k + 1); // nueva conversación con el rol elegido
              setProposals([]);
            }}
          >
            {roles.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <AgentChat
          key={chatKey}
          projectId={params.id}
          roleSlug={roleSlug || undefined}
          onProposal={(p) => setProposals((prev) => [...prev, p])}
        />
      </div>

      <div className="space-y-3">
        <h2 className="label">Propuestas de texto del agente</h2>
        {proposals.length === 0 ? (
          <div className="card p-5 text-xs text-brand-slate leading-relaxed">
            Cuando le pidas al agente que redacte una sección, sus propuestas aparecen acá
            con el texto en Markdown listo para copiar e insertar en el documento.
          </div>
        ) : (
          proposals.map((p) => (
            <div key={p.id} className="card p-4 animate-pop">
              <div className="text-sm font-semibold text-brand-ink mb-2">✨ {p.titulo}</div>
              <pre className="text-xs bg-brand-bg-soft rounded p-2 max-h-52 overflow-y-auto whitespace-pre-wrap">
                {p.texto_md}
              </pre>
              <button className="btn-secondary w-full mt-2 !py-1.5 text-xs" onClick={() => copyProposal(p)}>
                {copied === p.id ? "✓ Copiado — pegalo en el editor" : "Copiar Markdown"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
