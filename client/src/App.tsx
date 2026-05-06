import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import MeetingPage from "@/pages/meeting";
import LoginPage from "@/pages/login";
import { Loader2 } from "lucide-react";

function AuthenticatedRouter() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  
  const { data, isLoading, refetch } = useQuery<{ isAuthenticated: boolean }>({
    queryKey: ["/api/auth/session"],
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
  
  useEffect(() => {
    if (data) {
      setIsAuthenticated(data.isAuthenticated);
    }
  }, [data]);
  
  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    refetch();
  };
  
  if (isLoading || isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }
  
  return (
    <Switch>
      <Route path="/" component={MeetingPage} />
      <Route component={NotFound} />
    </Switch>
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
