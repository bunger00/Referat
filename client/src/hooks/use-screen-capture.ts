import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Skjermdelings-hook som styrer livssyklusen til en getDisplayMedia-stream
 * og fanger frames som JPEG-base64 ved behov.
 *
 * Brukeren velger selv hva som deles via nettleser-dialogen — vi mottar bare
 * MediaStream'en og henter frames når funksjonen `capture()` kalles.
 *
 * Vi "looper" ikke automatisk — fanging er manuell, så det blir lite støy
 * og null disk-bruk på server (frames sendes kun ved capture).
 */
export function useScreenCapture() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      });
      streamRef.current = stream;

      // Skjult video-element for å trekke frames
      if (!videoRef.current) {
        const v = document.createElement("video");
        v.autoplay = true;
        v.playsInline = true;
        v.muted = true;
        videoRef.current = v;
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});

      // Hvis brukeren stopper deling via nettleserens "Stopp deling"-knapp
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        stop();
      });

      setActive(true);
    } catch (e: any) {
      // NotAllowedError = bruker kansellerte. Det er OK, ikke noe feil.
      if (e?.name === "NotAllowedError") {
        setError(null);
      } else {
        setError(e?.message ?? "Kunne ikke starte skjermdeling");
      }
      setActive(false);
    }
  }, [stop]);

  /**
   * Fang en JPEG av nåværende frame.
   * Returnerer { dataUrl, width, height } eller null hvis ikke aktiv.
   */
  const capture = useCallback(async (): Promise<{ dataUrl: string; width: number; height: number } | null> => {
    const video = videoRef.current;
    if (!active || !video || video.videoWidth === 0) return null;

    // Skaler ned hvis kjempestort — sparer base64-størrelse uten å miste relevant detalj.
    // 1280px @ quality 0.72 gir typisk 200-500KB base64, godt under HTTP/2-frame-grenser
    // og Render-proxy-buffere. 1600px @ 0.85 ga 3-5MB som trigget ERR_HTTP2_PROTOCOL_ERROR.
    const MAX_DIM = 1280;
    const scale = Math.min(1, MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    return { dataUrl, width: w, height: h };
  }, [active]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return { active, error, start, stop, capture };
}
