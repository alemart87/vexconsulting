"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setSession } from "@/lib/api";

/** Fuentes de referencia que respaldan nuestras investigaciones (logo por dominio). */
const FUENTES_LOGIN = [
  { name: "Deloitte", domain: "deloitte.com" },
  { name: "PwC", domain: "pwc.com" },
  { name: "McKinsey & Company", domain: "mckinsey.com" },
  { name: "Gartner", domain: "gartner.com" },
  { name: "Forrester", domain: "forrester.com" },
  { name: "Everest Group", domain: "everestgrp.com" },
  { name: "Frost & Sullivan", domain: "frost.com" },
  { name: "Nasscom", domain: "nasscom.in" },
  { name: "CEPAL", domain: "cepal.org" },
  { name: "Banco Mundial", domain: "worldbank.org" },
  { name: "FMI", domain: "imf.org" },
  { name: "OCDE", domain: "oecd.org" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Doble factor: el login devuelve un token intermedio y pedimos el código
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const finishLogin = (data: any) => {
    setSession(data.access_token, data.refresh_token, {
      id: data.user_id,
      email: data.user_email,
      role: data.user_role,
      full_name: data.user_name,
      photo_url: data.user_photo_url,
    });
    if (data.must_change_password) {
      window.location.href = "/perfil?pw=obligatorio";
      return;
    }
    router.push(data.user_role === "visualizador" ? "/view" : "/dashboard");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiFetch<any>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (data.requires_2fa) {
        setTempToken(data.temp_token);
        return;
      }
      finishLogin(data);
    } catch (err: any) {
      setError(err.message || "Error de autenticación");
    } finally {
      setLoading(false);
    }
  };

  const onSubmit2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiFetch<any>("/api/v1/auth/2fa", {
        method: "POST",
        body: JSON.stringify({ temp_token: tempToken, code }),
      });
      finishLogin(data);
    } catch (err: any) {
      setError(err.message || "Código incorrecto");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Panel de marca (desktop) */}
      <div
        className="hidden lg:flex flex-col justify-between p-12 text-white relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #B81F18 0%, #E6332A 55%, #F39200 100%)",
        }}
      >
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/5 blur-3xl" />

        <div className="bg-white rounded-lg px-4 py-3 w-fit shadow-elevated">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-voicenter-color.png" alt="Voicenter" className="h-9" />
        </div>

        <div className="relative">
          <h1 className="font-display text-5xl uppercase leading-none">
            VEX
            <br />
            Consulting
          </h1>
          <p className="mt-4 max-w-md text-white/85 text-sm leading-relaxed">
            Plataforma colaborativa de investigación de mercado: documento maestro
            versionado, fuentes con inteligencia artificial y trabajo en equipo con
            método científico.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3 max-w-md">
            {["Proyectos", "Fuentes + IA", "Cowork", "Evaluación"].map((m) => (
              <div key={m} className="rounded-lg bg-white/10 px-4 py-3">
                <div className="h-1 w-8 bg-white/60 rounded mb-2" />
                <div className="text-sm font-semibold">{m}</div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-white/70 relative">Operado por Voicenter S.A.</p>
      </div>

      {/* Formulario */}
      <div className="flex items-center justify-center bg-brand-bg-soft p-6">
        <div className="w-full max-w-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-voicenter-color.png"
            alt="Voicenter"
            className="h-12 mx-auto mb-8 lg:hidden"
          />
          <h2 className="font-display text-3xl uppercase text-brand-ink mb-1">
            Iniciar sesión
          </h2>
          <p className="text-sm text-brand-slate mb-6">
            Accedé a tus proyectos de investigación.
          </p>

          {tempToken ? (
            <form onSubmit={onSubmit2fa} className="space-y-4">
              <div className="rounded-md bg-brand-bg border border-brand-border px-4 py-3 text-sm text-brand-graphite">
                🔐 Tu cuenta tiene <b>doble autenticación</b>: ingresá el código de tu
                app (Google Authenticator o similar).
              </div>
              <input
                className="input text-center text-2xl tracking-[0.4em] font-bold"
                placeholder="000000"
                value={code}
                inputMode="numeric"
                maxLength={8}
                autoFocus
                onChange={(e) => setCode(e.target.value)}
              />
              {error && (
                <div className="rounded-md bg-brand-primary-light text-brand-primary-dark text-sm px-3 py-2 animate-pop">
                  {error}
                </div>
              )}
              <button type="submit" className="btn-primary w-full" disabled={loading || code.length < 6}>
                {loading ? "Verificando…" : "Verificar código"}
              </button>
              <button
                type="button"
                className="btn-ghost w-full text-xs"
                onClick={() => {
                  setTempToken(null);
                  setCode("");
                  setError("");
                }}
              >
                ← Volver
              </button>
            </form>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@empresa.com.py"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Contraseña</label>
                <input
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              {error && (
                <div className="rounded-md bg-brand-primary-light text-brand-primary-dark text-sm px-3 py-2 animate-pop">
                  {error}
                </div>
              )}
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? "Ingresando…" : "Ingresar"}
              </button>
            </form>
          )}

          {/* Fuentes de clase mundial */}
          <div className="mt-10">
            <p className="text-center text-[10px] uppercase tracking-wider2 text-brand-slate mb-3">
              Investigamos con fuentes de clase mundial
            </p>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-2.5">
              {FUENTES_LOGIN.map((f) => (
                <span
                  key={f.domain}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-graphite/80"
                  title={f.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${f.domain}&sz=64`}
                    alt=""
                    loading="lazy"
                    className="h-4 w-4 rounded-sm"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                  />
                  {f.name}
                </span>
              ))}
            </div>
          </div>

          <p className="mt-8 text-center text-xs text-brand-slate">
            © {new Date().getFullYear()} Voicenter S.A.
          </p>
        </div>
      </div>
    </div>
  );
}
