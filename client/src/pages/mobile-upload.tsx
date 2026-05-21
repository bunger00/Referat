import { useState, useEffect, useRef } from "react";
import { useRoute } from "wouter";
import { Camera, Upload, Loader2, CheckCircle2, X } from "lucide-react";

type SessionInfo = { sessionTitle: string | null; expiresAt: string };

/**
 * Mobil-vennlig opplasting via engangs-token. Tilgjengelig på `/m/:token`
 * uten innlogging — tokenet selv er authoritet.
 *
 * Tre måter å laste opp på:
 * 1. Ta bilde (native iOS/Android-kamera via capture-attributt)
 * 2. Velg fra galleri
 * 3. Last opp dokument (PDF/etc)
 *
 * Hver fil lastes opp som vedlegg på sesjonen via /api/upload-via-token/:token.
 * Tokenet inneholder sessionId + userId — vi trenger ingen Authorization-header.
 */
export default function MobileUploadPage() {
  const [, params] = useRoute<{ token: string }>("/u/:token");
  const token = params?.token ?? "";
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const resp = await fetch(`/api/upload-via-token/${token}/info`);
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          setError(e.error || `Feil: ${resp.status}`);
          return;
        }
        const data = (await resp.json()) as SessionInfo;
        setInfo(data);
      } catch (err: any) {
        setError(err.message || "Kunne ikke laste informasjon om sesjonen.");
      }
    })();
  }, [token]);

  const upload = async (file: File) => {
    setUploadingFile(file.name);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch(`/api/upload-via-token/${token}`, {
        method: "POST",
        body: formData,
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || `Feil: ${resp.status}`);
      }
      setUploadedFiles((prev) => [...prev, file.name]);
    } catch (err: any) {
      setError(err.message || "Opplasting feilet");
    } finally {
      setUploadingFile(null);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <p className="text-sm text-destructive">Ugyldig link.</p>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background text-center">
        <X className="h-10 w-10 text-destructive mb-3" />
        <p className="text-sm font-medium mb-1">Kunne ikke åpne</p>
        <p className="text-xs text-muted-foreground max-w-xs">{error}</p>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const expires = new Date(info.expiresAt);
  const minutesLeft = Math.max(0, Math.round((expires.getTime() - Date.now()) / 60000));

  return (
    <div className="min-h-screen bg-background p-5 max-w-md mx-auto">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Last opp til
        </div>
        <h1 className="text-xl font-semibold">{info.sessionTitle || "Erfaringsmøte"}</h1>
        <div className="text-xs text-muted-foreground mt-1">
          Link gyldig i ~{minutesLeft} min
        </div>
      </div>

      <div className="space-y-3">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*,.heic,.heif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        <input
          ref={docRef}
          type="file"
          accept=".pdf,.docx,.xlsx,.xls,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />

        <button
          onClick={() => cameraRef.current?.click()}
          disabled={!!uploadingFile}
          className="w-full flex items-center gap-3 p-4 rounded-xl bg-primary text-primary-foreground font-medium text-base shadow-sm active:opacity-90 disabled:opacity-50"
        >
          <Camera className="h-5 w-5" />
          Ta bilde
        </button>
        <button
          onClick={() => galleryRef.current?.click()}
          disabled={!!uploadingFile}
          className="w-full flex items-center gap-3 p-4 rounded-xl bg-card border text-foreground font-medium text-base active:opacity-90 disabled:opacity-50"
        >
          <Upload className="h-5 w-5" />
          Velg bilde fra galleri
        </button>
        <button
          onClick={() => docRef.current?.click()}
          disabled={!!uploadingFile}
          className="w-full flex items-center gap-3 p-4 rounded-xl bg-card border text-foreground font-medium text-base active:opacity-90 disabled:opacity-50"
        >
          <Upload className="h-5 w-5" />
          Last opp dokument
        </button>
      </div>

      {uploadingFile && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground p-3 rounded-lg bg-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Laster opp {uploadingFile}…
        </div>
      )}

      {error && info && (
        <div className="mt-4 text-sm text-destructive p-3 rounded-lg bg-destructive/10 border border-destructive/30">
          {error}
        </div>
      )}

      {uploadedFiles.length > 0 && (
        <div className="mt-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Lastet opp ({uploadedFiles.length})
          </div>
          <ul className="space-y-1.5">
            {uploadedFiles.map((name, idx) => (
              <li key={idx} className="flex items-center gap-2 text-sm text-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <span className="truncate">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
