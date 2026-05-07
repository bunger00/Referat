import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu, Home, Mic, History, BookOpen, Settings, LogOut, Sparkles, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

const NAV = [
  { href: "/", label: "Hjem", icon: Home },
  { href: "/mote", label: "Møte", icon: Mic },
  { href: "/intervju", label: "Intervjutrening", icon: Gauge },
  { href: "/historikk", label: "Historikk", icon: History },
  { href: "/kunnskapsbase", label: "Kunnskapsbase", icon: BookOpen },
  { href: "/innstillinger", label: "Innstillinger", icon: Settings },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();

  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  return (
    <header className="md:hidden sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-border bg-background/85 backdrop-blur px-4 py-3">
      <Link href="/">
        <a className="inline-flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <span className="font-display text-lg font-semibold tracking-display">Referat</span>
        </a>
      </Link>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Åpne meny">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0 bg-sidebar text-sidebar-foreground">
          <div className="px-6 pt-7 pb-6">
            <div className="inline-flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Sparkles className="h-5 w-5" strokeWidth={2.25} />
              </span>
              <span className="font-display text-2xl font-semibold tracking-display leading-none">
                Referat
              </span>
            </div>
          </div>
          <nav className="px-3 space-y-0.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <a
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover-elevate",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80"
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                    <span>{item.label}</span>
                  </a>
                </Link>
              );
            })}
            <button
              onClick={async () => {
                setOpen(false);
                await supabase.auth.signOut();
              }}
              className="w-full mt-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground/80 hover-elevate"
            >
              <LogOut className="h-[18px] w-[18px]" strokeWidth={2} />
              <span>Logg ut</span>
            </button>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
