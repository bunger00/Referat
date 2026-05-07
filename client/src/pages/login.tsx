import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Lock, Mic, Mail } from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabase";

interface LoginPageProps {
  onLoginSuccess: () => void;
  onSwitchToSignup: () => void;
}

export default function LoginPage({ onLoginSuccess, onSwitchToSignup }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "azure" | null>(null);
  const { toast } = useToast();

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast({ title: "Mangler felt", description: "Skriv inn både epost og passord.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      toast({ title: "Innlogget", description: "Velkommen tilbake." });
      onLoginSuccess();
    } catch (error: any) {
      toast({
        title: "Innlogging feilet",
        description: error?.message?.includes("Email not confirmed")
          ? "Du må bekrefte eposten din først. Sjekk innboksen for verifiseringslenke."
          : error?.message || "Feil epost eller passord.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuth = async (provider: "google" | "azure") => {
    setOauthLoading(provider);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
      // On success, browser is redirected to provider — no need to do anything else.
    } catch (error: any) {
      const msg = error?.message || "";
      const notConfigured = /provider is not enabled|Unsupported provider/i.test(msg);
      toast({
        title: notConfigured ? `${provider === "azure" ? "Microsoft" : "Google"} er ikke konfigurert` : "Innlogging feilet",
        description: notConfigured
          ? "Be administrator om å konfigurere OAuth-providern i Supabase Dashboard."
          : msg,
        variant: "destructive",
        duration: 8000,
      });
      setOauthLoading(null);
    }
  };

  if (!supabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Auth er ikke konfigurert</CardTitle>
            <CardDescription>
              Miljøvariablene <code>VITE_SUPABASE_URL</code> og <code>VITE_SUPABASE_ANON_KEY</code> mangler.
              Sett dem i deploy-miljøet og bygg på nytt.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Mic className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Møtetranskribering</CardTitle>
          <CardDescription>Logg inn på din konto</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              disabled={oauthLoading !== null}
              onClick={() => handleOAuth("google")}
              data-testid="button-login-google"
            >
              {oauthLoading === "google" ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="font-bold">G</span>}
              Logg inn med Google
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              disabled={oauthLoading !== null}
              onClick={() => handleOAuth("azure")}
              data-testid="button-login-microsoft"
            >
              {oauthLoading === "azure" ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="font-bold">⊞</span>}
              Logg inn med Microsoft
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">eller med epost</span>
            </div>
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="navn@firma.no"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
                autoComplete="email"
                data-testid="input-email"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="Passord"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10"
                autoComplete="current-password"
                data-testid="input-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-login">
              {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Logger inn…</> : "Logg inn"}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            Har du ikke konto?{" "}
            <button type="button" onClick={onSwitchToSignup} className="text-primary hover:underline" data-testid="link-signup">
              Registrer deg
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
