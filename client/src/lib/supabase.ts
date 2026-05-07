import { createClient } from "@supabase/supabase-js";

// Vite injects VITE_-prefixed env vars at build time. They are public-safe;
// the anon key is gated by Supabase Row Level Security and JWT validation
// happens server-side too.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Throwing here would crash the whole bundle. Instead we fail soft so the
  // login page can render an actionable error message.
  console.error("VITE_SUPABASE_URL eller VITE_SUPABASE_ANON_KEY mangler — auth virker ikke før disse er satt.");
}

export const supabase = createClient(url ?? "https://invalid.invalid", anonKey ?? "invalid", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // handles OAuth + email-verification redirects
  },
});

export const supabaseConfigured = Boolean(url && anonKey);
