import { ReactNode } from "react";
import { useLocation } from "wouter";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";

type Props = {
  children: ReactNode;
};

/**
 * Vertikal flex-layout som låser app-shell til viewport-høyde, slik at
 * meeting-siden (som har sin egen indre scroll-håndtering for transkript) får
 * en stabil container. Vanlige sider scroller via `overflow-y-auto` på main.
 */
export function AppShell({ children }: Props) {
  const [location] = useLocation();
  // Møtesiden har egne overflow-håndteringer — la den fylle main uten
  // ekstra scroll. Andre sider scroller fritt.
  const isMeeting = location.startsWith("/mote") || location.startsWith("/m/");

  return (
    <div className="h-[100dvh] bg-background text-foreground flex flex-col md:flex-row overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav />
        <main
          className={
            "flex-1 min-h-0 min-w-0 " +
            (isMeeting ? "flex flex-col overflow-hidden" : "overflow-y-auto")
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
