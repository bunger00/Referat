import { useEffect, useState, lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home";
import MeetingPage from "@/pages/meeting";
import InterviewPage from "@/pages/interview";
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/ds";

// Sider som ikke er på kritisk vei lastes lazy. Sparer ~30-40% av initial JS-bundle.
// MeetingPage og InterviewPage holder live opptak — må være eager. HomePage er
// landings-siden — eager. Login/Signup brukes før shell — eager.
const HistoryPage = lazy(() => import("@/pages/history"));
const KnowledgePage = lazy(() => import("@/pages/knowledge"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const ExperiencePage = lazy(() => import("@/pages/experience"));
const BrainPage = lazy(() => import("@/pages/brain"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function AuthenticatedRouter() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [showSignup, setShowSignup] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthenticated(!!data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
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

  // MeetingPage og InterviewPage holder live opptak (MediaStream, AudioContext,
  // intervaller) og MÅ stå mountet over ruteendringer slik at brukeren kan navigere
  // til innstillinger eller historikk midt i et opptak uten å miste pågående
  // sesjon. Andre sider mounter/unmounter normalt via Switch.
  const isMeetingRoute =
    location.startsWith("/mote") || location.startsWith("/m/") || location === "/login";
  const isInterviewRoute = location.startsWith("/intervju");
  const isRecordingRoute = isMeetingRoute || isInterviewRoute;

  return (
    <AppShell>
      <div className={isMeetingRoute ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <MeetingPage />
      </div>
      <div className={isInterviewRoute ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <InterviewPage />
      </div>
      <div className={!isRecordingRoute ? "flex-1 min-h-0 overflow-y-auto" : "hidden"}>
        <Suspense fallback={<PageLoader />}>
          <Switch>
            <Route path="/" component={HomePage} />
            <Route path="/historikk" component={HistoryPage} />
            <Route path="/kunnskapsbase" component={KnowledgePage} />
            <Route path="/innstillinger" component={SettingsPage} />
            <Route path="/erfaring" component={ExperiencePage} />
            <Route path="/erfaring/:id" component={ExperiencePage} />
            <Route path="/hjernen" component={BrainPage} />
            {/* Recording routes are handled by always-mounted pages above. */}
            <Route path="/mote">{null}</Route>
            <Route path="/m/:id">{null}</Route>
            <Route path="/intervju">{null}</Route>
            <Route path="/login">{null}</Route>
            <Route component={NotFound} />
          </Switch>
        </Suspense>
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
