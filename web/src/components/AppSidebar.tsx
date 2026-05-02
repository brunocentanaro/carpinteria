"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calculator,
  Hammer,
  ListTree,
  MessageSquare,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

const NAV: NavItem[] = [
  { href: "/", icon: Calculator, label: "Cotizador clásico" },
  { href: "/chat", icon: MessageSquare, label: "Chat" },
  { href: "/lista-precios", icon: ListTree, label: "Lista de precios" },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-14 bg-card border-r flex flex-col items-center py-3 gap-1">
      <Link
        href="/"
        className="h-10 w-10 rounded flex items-center justify-center bg-primary text-primary-foreground mb-2"
        title="La Casa del Carpintero"
      >
        <Hammer className="h-5 w-5" />
      </Link>
      <nav className="flex flex-col gap-1 flex-1">
        {NAV.map((item) => {
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
      <button
        type="button"
        title="Configuración (próximamente)"
        className="h-10 w-10 rounded flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Settings className="h-5 w-5" />
      </button>
    </aside>
  );
}
