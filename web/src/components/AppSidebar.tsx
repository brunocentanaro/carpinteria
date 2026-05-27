"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calculator,
  Factory,
  Hammer,
  ListTree,
  LogOut,
  MessageSquare,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";
import {
  BRAND_ENVIRONMENTS,
  type BrandEnvironmentId,
} from "@/lib/brand-environments";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

const NAV: NavItem[] = [
  { href: "/", icon: Calculator, label: "Cotizador clasico" },
  { href: "/chat", icon: MessageSquare, label: "Chat" },
  { href: "/lista-precios", icon: ListTree, label: "Lista de precios" },
  { href: "/usuarios", icon: Users, label: "Usuarios" },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { brand, brandId, setBrandId } = useBrandEnvironment();
  const [area, setArea] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setArea(data?.session?.area ?? null);
      })
      .catch(() => {
        if (!cancelled) setArea(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-14 bg-card border-r flex flex-col items-center py-3 gap-1">
      <Link
        href="/"
        className="h-10 w-10 rounded flex items-center justify-center bg-primary text-primary-foreground mb-2"
        title={brand.name}
      >
        {brandId === "pirone" ? (
          <Factory className="h-5 w-5" />
        ) : (
          <Hammer className="h-5 w-5" />
        )}
      </Link>
      <nav className="flex flex-col gap-1 flex-1">
        {NAV.filter((item) => item.href !== "/usuarios" || area === "administracion").map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                "group relative h-10 w-10 rounded flex items-center justify-center transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />
              )}
              <span className="absolute left-full ml-3 px-2 py-1 rounded bg-popover text-popover-foreground text-xs shadow-md border opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col gap-1 border-t pt-2">
        {(["casa", "pirone"] as BrandEnvironmentId[]).map((id) => {
          const selected = brandId === id;
          const env = BRAND_ENVIRONMENTS[id];
          return (
            <button
              key={id}
              type="button"
              title={`${env.name} (${env.tone})`}
              onClick={() => setBrandId(id)}
              className={cn(
                "group relative h-9 w-9 rounded flex items-center justify-center text-xs font-bold transition-colors",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {id === "pirone" ? "P" : "C"}
              <span className="absolute left-full ml-3 px-2 py-1 rounded bg-popover text-popover-foreground text-xs font-normal shadow-md border opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                {env.name}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          title="Cerrar sesion"
          onClick={logout}
          className="group relative h-9 w-9 rounded flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          <span className="absolute left-full ml-3 px-2 py-1 rounded bg-popover text-popover-foreground text-xs shadow-md border opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
            Cerrar sesion
          </span>
        </button>
      </div>
    </aside>
  );
}
