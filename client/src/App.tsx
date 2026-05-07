import { useEffect, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home";
import MeetingPage from "@/pages/meeting";
import HistoryPage from "@/pages/history";
import KnowledgePage from "@/pages/knowledge";
import SettingsPage from "@/pages/settings";
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/ds";

function AuthenticatedRouter() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [showSignup, setShowSignup] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    // Initial session check
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthenticated(!!data.session);
    });

    // Listen for changes — sign-in, sign-out, token refresh, OAuth callback
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      // Drop any cached query results that came from a different (or no) user
      // when auth state flips, so we don't accidentally show stale data.
      queryClient.clear();
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return showSignup
      ? <SignupPage onSwitchToLogin={() => setShowSignup(false)} />
      : <LoginPage onLoginSuccess={() => { /* state flips via onAuthStateChange */ }} onSwitchToSignup={() => setShowSignup(true)} />;
  }

  // MeetingPage holds the live recording (MediaStream, AudioContext, transcript
  // state, intervals) and MUST stay mounted across navigations so the user can
  // browse to settings or history mid-meeting without losing the recording.
  // Hidden via CSS when not on a meeting route. Other pages mount/unmount as
  // normal via the Switch.
  const isMeetingRoute =
    location.startsWith("/mote") || location.startsWith("/m/") || location === "/login";

  return (
    <AppShell>
      <div className={isMeetingRoute ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <MeetingPage />
      </div>
      <div className={!isMeetingRoute ? "flex-1 min-h-0 overflow-y-auto" : "hidden"}>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/historikk" component={HistoryPage} />
          <Route path="/kunnskapsbase" component={KnowledgePage} />
          <Route path="/innstillinger" component={SettingsPage} />
          {/* Meeting routes are handled by the always-mounted MeetingPage above. */}
          <Route path="/mote">{null}</Route>
          <Route path="/m/:id">{null}</Route>
          <Route path="/login">{null}</Route>
          <Route component={NotFound} />
        </Switch>
      </div>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthenticatedRouter />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
