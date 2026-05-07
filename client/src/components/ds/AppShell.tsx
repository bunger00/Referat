import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";

type Props = {
  children: ReactNode;
};

/**
 * Vertikal flex-layout som låser app-shell til viewport-høyde.
 * Children styrer egen overflow / scroll.
 */
export function AppShell({ children }: Props) {
  return (
    <div className="h-[100dvh] bg-background text-foreground flex flex-col md:flex-row overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav />
        <main className="flex-1 min-h-0 min-w-0 flex flex-col">{children}</main>
      </div>
    </div>
  );
}
