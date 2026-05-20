import { Link, useLocation } from "wouter";
import {
  Home,
  Mic,
  History,
  BookOpen,
  Settings,
  LogOut,
  Sparkles,
  Gauge,
  Lightbulb,
  Brain,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Home;
  match: (path: string) => boolean;
};

const NAV: NavItem[] = [
  { href: "/", label: "Hjem", icon: Home, match: (p) => p === "/" },
  { href: "/mote", label: "Møte", icon: Mic, match: (p) => p.startsWith("/mote") || p.startsWith("/m/") },
  { href: "/erfaring", label: "Erfaringsmøter", icon: Lightbulb, match: (p) => p.startsWith("/erfaring") },
  { href: "/intervju", label: "Intervjutrening", icon: Gauge, match: (p) => p.startsWith("/intervju") },
  { href: "/hjernen", label: "Hjernen", icon: Brain, match: (p) => p.startsWith("/hjernen") },
  { href: "/historikk", label: "Historikk", icon: History, match: (p) => p.startsWith("/historikk") },
  { href: "/kunnskapsbase", label: "Kunnskapsbase", icon: BookOpen, match: (p) => p.startsWith("/kunnskapsbase") },
  { href: "/innstillinger", label: "Innstillinger", icon: Settings, match: (p) => p.startsWith("/innstillinger") },
];

export function Sidebar() {
  const [location] = useLocation();
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
    });
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <aside
      className="hidden md:flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground sticky top-0 h-screen"
      aria-label="Hovednavigasjon"
    >
      <div className="px-6 pt-7 pb-6">
        <Link href="/">
          <a className="inline-flex items-center gap-2.5 group" aria-label="Til hjem">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-5 w-5" strokeWidth={2.25} />
            </span>
            <span className="font-display text-2xl font-semibold tracking-display leading-none">
              Referat
            </span>
          </a>
        </Link>
        <p className="text-xs text-muted-foreground mt-2 leading-snug">
          Møter som skriver seg selv
        </p>
      </div>

      <nav className="flex-1 px-3 space-y-0.5">
        {NAV.map((item) => {
          const active = item.match(location);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <a
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  "hover-elevate",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:text-sidebar-foreground"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
                <span>{item.label}</span>
              </a>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border px-3 py-4">
        <div className="px-3 py-2 mb-1">
          <div className="text-xs text-muted-foreground truncate">{email || "Innlogget"}</div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:text-sidebar-foreground hover-elevate"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={2} />
          <span>Logg ut</span>
        </button>
      </div>
    </aside>
  );
}
