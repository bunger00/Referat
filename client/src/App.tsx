import { useEffect, useState } from "react";
import { Switch, Route } from "wouter";
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

  return (
    <AppShell>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/mote" component={MeetingPage} />
        <Route path="/m/:id" component={MeetingPage} />
        <Route path="/historikk" component={HistoryPage} />
        <Route path="/kunnskapsbase" component={KnowledgePage} />
        <Route path="/innstillinger" component={SettingsPage} />
        <Route path="/login" component={HomePage} />
        <Route component={NotFound} />
      </Switch>
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
