"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setSession } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiFetch<any>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setSession(data.access_token, data.refresh_token, {
        id: data.user_id,
        email: data.user_email,
        role: data.user_role,
        full_name: data.user_name,
        photo_url: data.user_photo_url,
      });
      router.push(data.user_role === "visualizador" ? "/view" : "/dashboard");
    } catch (err: any) {
      setError(err.message || "Error de autenticación");
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

          <p className="mt-8 text-center text-xs text-brand-slate">
            © {new Date().getFullYear()} Voicenter S.A.
          </p>
        </div>
      </div>
    </div>
  );
}
