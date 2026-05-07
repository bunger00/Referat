import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Lock, Mail, Sparkles } from "lucide-react";
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
        <div className="w-full max-w-md rounded-2xl border border-card-border bg-card p-8 shadow-lg">
          <h1 className="font-display text-2xl font-semibold tracking-tightish">
            Auth er ikke konfigurert
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Miljøvariablene <code className="font-mono text-xs">VITE_SUPABASE_URL</code> og{" "}
            <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> mangler. Sett dem i deploy-miljøet og bygg på nytt.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-2 bg-background">
      {/* Venstre: branding-kolonne (kun desktop) */}
      <aside className="hidden lg:flex flex-col justify-between bg-primary text-primary-foreground p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]" aria-hidden>
          <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-accent blur-3xl" />
          <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-suggestion blur-3xl" />
        </div>
        <div className="relative inline-flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary-foreground/12 backdrop-blur">
            <Sparkles className="h-6 w-6" strokeWidth={2.25} />
          </span>
          <span className="font-display text-2xl font-semibold tracking-display">Referat</span>
        </div>
        <div className="relative space-y-6 max-w-md">
          <h2 className="font-display text-4xl font-semibold tracking-display leading-[1.1]">
            Møter som skriver seg selv.
          </h2>
          <p className="text-primary-foreground/80 text-lg leading-relaxed">
            Sanntids-transkripsjon på norsk, AI-spørsmål når du trenger dem,
            og automatisk fangst av aksjoner og beslutninger. Du leder møtet —
            vi ordner papirarbeidet.
          </p>
          <ul className="space-y-2 text-primary-foreground/80 text-sm">
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Norsk-først, fra første minutt
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> AI som lærer din møtestil
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Ferdig referat før du forlater rommet
            </li>
          </ul>
        </div>
        <p className="relative text-xs text-primary-foreground/50">© Referat</p>
      </aside>

      {/* Høyre: form */}
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden inline-flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" strokeWidth={2.25} />
            </span>
            <span className="font-display text-2xl font-semibold tracking-display leading-none">Referat</span>
          </div>

          <div className="space-y-2">
            <h1 className="font-display text-3xl font-semibold tracking-display leading-tight">
              Velkommen tilbake.
            </h1>
            <p className="text-muted-foreground">Logg inn for å fortsette.</p>
          </div>

          <div className="space-y-2.5">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full justify-center gap-2.5 h-11"
              disabled={oauthLoading !== null}
              onClick={() => handleOAuth("google")}
              data-testid="button-login-google"
            >
              {oauthLoading === "google" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GoogleLogo />
              )}
              Fortsett med Google
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full justify-center gap-2.5 h-11"
              disabled={oauthLoading !== null}
              onClick={() => handleOAuth("azure")}
              data-testid="button-login-microsoft"
            >
              {oauthLoading === "azure" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MicrosoftLogo />
              )}
              Fortsett med Microsoft
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center">
              <span className="bg-background px-3 text-xs text-muted-foreground uppercase tracking-wider">eller med e-post</span>
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
                className="pl-10 h-11"
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
                className="pl-10 h-11"
                autoComplete="current-password"
                data-testid="input-password"
              />
            </div>
            <Button type="submit" size="lg" className="w-full h-11" disabled={isLoading} data-testid="button-login">
              {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Logger inn…</> : "Logg inn"}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            Har du ikke konto?{" "}
            <button type="button" onClick={onSwitchToSignup} className="text-primary font-medium hover:underline" data-testid="link-signup">
              Registrer deg
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#F35325" d="M1 1h10v10H1z"/>
      <path fill="#81BC06" d="M13 1h10v10H13z"/>
      <path fill="#05A6F0" d="M1 13h10v10H1z"/>
      <path fill="#FFBA08" d="M13 13h10v10H13z"/>
    </svg>
  );
}
