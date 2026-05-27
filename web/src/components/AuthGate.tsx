"use client";

import { useEffect, useState } from "react";
import { Factory, Hammer, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRAND_ENVIRONMENTS, type BrandEnvironmentId } from "@/lib/brand-environments";
import { AUTH_AREAS, type AuthArea } from "@/lib/auth";
import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";
import { cn } from "@/lib/utils";

interface AuthSession {
  brandId: BrandEnvironmentId;
  user: string;
  area: AuthArea;
  allAccess?: boolean;
  mustChangePassword?: boolean;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { brandId, brand, setBrandId } = useBrandEnvironment();
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [area, setArea] = useState<AuthArea>("personal");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resetMode, setResetMode] = useState<"login" | "request" | "confirm">("login");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const current = data?.session as AuthSession | undefined;
        if (current) {
          setSession(current);
          if (!current.allAccess) {
            setBrandId(current.brandId);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setBrandId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, area, user, password }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setError(data?.error || "No se pudo ingresar");
        return;
      }
      setSession({
        brandId,
        area,
        user: String(data?.session?.user || user),
        allAccess: !!data?.session?.allAccess,
        mustChangePassword: !!data?.session?.mustChangePassword,
      });
      setUser("");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestReset() {
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, area, username: user }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setError(data?.error || "No se pudo pedir el codigo");
        return;
      }
      setResetMode("confirm");
      if (data?.smtp_configured === false) {
        setMessage("Codigo generado, pero falta configurar SMTP para enviarlo por correo.");
      } else {
        setMessage(`Codigo enviado al correo: ${data?.email_to || "lacasadelcarpinterosa@gmail.com"}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmReset(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          area,
          username: user,
          code: resetCode,
          password: newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setError(data?.error || "No se pudo resetear");
        return;
      }
      setMessage("Contraseña actualizada. Ya podés entrar.");
      setResetMode("login");
      setPassword("");
      setResetCode("");
      setNewPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  async function changeFirstPassword(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setError(data?.error || "No se pudo cambiar la contraseña");
        return;
      }
      setSession((s) => (s ? { ...s, mustChangePassword: false } : s));
      setNewPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen grid place-items-center bg-muted/40">
        <div className="text-sm text-muted-foreground">Verificando acceso...</div>
      </div>
    );
  }

  if (session?.mustChangePassword) {
    return (
      <main className="min-h-screen bg-muted/40 grid place-items-center p-6">
        <form onSubmit={changeFirstPassword} className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm space-y-4">
          <div>
            <div className="text-xs uppercase font-semibold text-primary">
              Primer ingreso
            </div>
            <h1 className="text-lg font-semibold">Cambiar contraseña</h1>
            <p className="text-sm text-muted-foreground">
              Para seguir, definí tu contraseña personal.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="first-password">Nueva contraseña</Label>
            <Input
              id="first-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          {error && <div className="text-sm text-red-700">{error}</div>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Guardando..." : "Guardar y continuar"}
          </Button>
        </form>
      </main>
    );
  }

  if (session) return <>{children}</>;

  return (
    <main className="min-h-screen bg-muted/40 grid place-items-center p-6">
      <section className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="h-11 w-11 rounded bg-primary text-primary-foreground grid place-items-center">
            {brandId === "pirone" ? (
              <Factory className="h-5 w-5" />
            ) : (
              <Hammer className="h-5 w-5" />
            )}
          </div>
          <div>
            <div className="text-xs uppercase font-semibold text-primary">
              Acceso privado
            </div>
            <h1 className="text-lg font-semibold leading-tight">{brand.name}</h1>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-5">
          {(["casa", "pirone"] as BrandEnvironmentId[]).map((id) => {
            const env = BRAND_ENVIRONMENTS[id];
            const selected = brandId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setBrandId(id)}
                className={cn(
                  "rounded border px-3 py-2 text-left text-sm transition-colors",
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:bg-muted",
                )}
              >
                <div className="font-semibold">{env.shortName}</div>
                <div className="text-xs text-muted-foreground">{env.tone}</div>
              </button>
            );
          })}
        </div>

        {resetMode === "confirm" ? (
          <form onSubmit={confirmReset} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-code">Código recibido</Label>
              <Input
                id="reset-code"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">Nueva contraseña</Label>
              <Input
                id="reset-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            {message && <div className="text-sm text-primary">{message}</div>}
            {error && <div className="text-sm text-red-700">{error}</div>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Guardando..." : "Resetear contraseña"}
            </Button>
            <button
              type="button"
              className="w-full text-xs text-muted-foreground underline"
              onClick={() => setResetMode("login")}
            >
              Volver al ingreso
            </button>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="auth-area">Area</Label>
            <select
              id="auth-area"
              value={area}
              onChange={(e) => setArea(e.target.value as AuthArea)}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value={AUTH_AREAS.personal.id}>{AUTH_AREAS.personal.name}</option>
              <option value={AUTH_AREAS.administracion.id}>
                {AUTH_AREAS.administracion.name}
              </option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-user">Usuario</Label>
            <Input
              id="auth-user"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-password">Contraseña</Label>
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <div className="text-sm text-red-700">{error}</div>}
          {message && <div className="text-sm text-primary">{message}</div>}
          <Button type="submit" className="w-full" disabled={submitting}>
            <Lock className="h-4 w-4 mr-1" />
            {submitting ? "Entrando..." : "Entrar"}
          </Button>
          <button
            type="button"
            className="w-full text-xs text-muted-foreground underline"
            onClick={requestReset}
            disabled={!user.trim() || submitting}
          >
            Olvidé mi contraseña
          </button>
        </form>
        )}
      </section>
    </main>
  );
}
