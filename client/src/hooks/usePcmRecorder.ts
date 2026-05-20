import { useCallback, useEffect, useRef, useState } from "react";

const TARGET_SAMPLE_RATE = 16000;
const DEFAULT_CHUNK_INTERVAL_MS = 28_000;
const NUM_LEVEL_BARS = 20;

function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outLength = Math.round(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIdx = i * ratio;
    const a = Math.floor(srcIdx);
    const b = Math.min(a + 1, input.length - 1);
    const t = srcIdx - a;
    out[i] = input[a] * (1 - t) + input[b] * t;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export interface UsePcmRecorderOptions {
  /** Called with each WAV-chunk hver `chunkIntervalMs` (default 28s). */
  onChunk: (wavBlob: Blob) => Promise<void> | void;
  /** Intervall mellom chunks. 28000 ms unngår repetisjons-artefakter ved Whisper-treningsgrensen. */
  chunkIntervalMs?: number;
}

export interface UsePcmRecorderResult {
  isRecording: boolean;
  isStarting: boolean;
  error: string | null;
  elapsedSeconds: number;
  audioLevelBars: number[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
  clearError: () => void;
}

/**
 * Live PCM-opptak via AudioContext + ScriptProcessor. Encoder lyden som WAV
 * hvert `chunkIntervalMs`, kaller `onChunk` med hver bit. Brukes både av
 * møte- og erfaringsmøte-sidene.
 *
 * Hvorfor ikke MediaRecorder: tidligere brukte vi `stop()/start()` hvert
 * 28s, som mistet ~50% av lyden gjennom gap mellom recorders + WebM-fragment
 * som starter mid-utterance og forvirrer nb-whisper. AudioContext + script-
 * processor gir kontinuerlig fangst og rene WAV-chunks.
 */
export function usePcmRecorder(opts: UsePcmRecorderOptions): UsePcmRecorderResult {
  const { onChunk, chunkIntervalMs = DEFAULT_CHUNK_INTERVAL_MS } = opts;

  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioLevelBars, setAudioLevelBars] = useState<number[]>(() => Array(NUM_LEVEL_BARS).fill(0));

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioDataRef = useRef<Uint8Array | null>(null);
  const levelAnimFrameRef = useRef<number | null>(null);
  const pcmBufferRef = useRef<Float32Array[]>([]);
  const pcmSampleRateRef = useRef<number>(48_000);
  const chunkIntervalRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  // Holder seneste onChunk slik at hook-konsumenten kan endre closure uten
  // å trigge re-start av opptaket.
  const onChunkRef = useRef(onChunk);
  useEffect(() => {
    onChunkRef.current = onChunk;
  }, [onChunk]);

  const flushPcmBuffer = useCallback((): Blob | null => {
    const frames = pcmBufferRef.current;
    if (frames.length === 0) return null;
    pcmBufferRef.current = [];

    let total = 0;
    for (const f of frames) total += f.length;
    if (total < pcmSampleRateRef.current * 0.5) return null; // <0.5s, hopp over

    const merged = new Float32Array(total);
    let pos = 0;
    for (const f of frames) {
      merged.set(f, pos);
      pos += f.length;
    }
    const downsampled = downsampleTo16k(merged, pcmSampleRateRef.current);
    return encodeWav(downsampled, TARGET_SAMPLE_RATE);
  }, []);

  const teardown = useCallback(() => {
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (levelAnimFrameRef.current) {
      cancelAnimationFrame(levelAnimFrameRef.current);
      levelAnimFrameRef.current = null;
    }
    if (audioProcessorRef.current) {
      try { audioProcessorRef.current.disconnect(); } catch { /* ignore */ }
      audioProcessorRef.current.onaudioprocess = null;
      audioProcessorRef.current = null;
    }
    if (audioSourceRef.current) {
      try { audioSourceRef.current.disconnect(); } catch { /* ignore */ }
      audioSourceRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch { /* ignore */ }
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch { /* ignore */ }
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    pcmBufferRef.current = [];
    audioDataRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (isStarting || isRecording) return;
    try {
      setError(null);
      setIsStarting(true);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const isSecure = window.isSecureContext;
        throw new Error(
          isSecure
            ? "Nettleseren din støtter ikke mikrofonopptak. Prøv Chrome eller Safari."
            : "Mikrofonopptak krever sikker tilkobling (HTTPS). Prøv den publiserte versjonen av appen.",
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      pcmSampleRateRef.current = audioCtx.sampleRate;
      pcmBufferRef.current = [];

      const source = audioCtx.createMediaStreamSource(stream);
      audioSourceRef.current = source;

      // Visualizer
      try {
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.7;
        source.connect(analyser);
        analyserRef.current = analyser;
        audioDataRef.current = new Uint8Array(analyser.frequencyBinCount);

        const animate = () => {
          if (!analyserRef.current || !audioDataRef.current) return;
          analyserRef.current.getByteFrequencyData(audioDataRef.current);
          const data = audioDataRef.current;
          const bars: number[] = [];
          const binCount = data.length;
          for (let i = 0; i < NUM_LEVEL_BARS; i++) {
            const mirroredIdx = i < NUM_LEVEL_BARS / 2 ? i : NUM_LEVEL_BARS - 1 - i;
            const binIdx = Math.floor((mirroredIdx / (NUM_LEVEL_BARS / 2)) * Math.min(binCount - 1, 14));
            const raw = data[binIdx] / 255;
            bars.push(Math.max(raw, 0.03 + Math.random() * 0.06));
          }
          setAudioLevelBars(bars);
          levelAnimFrameRef.current = requestAnimationFrame(animate);
        };
        levelAnimFrameRef.current = requestAnimationFrame(animate);
      } catch {
        // Visualizer er ikke kritisk
      }

      // PCM capture branch
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      audioProcessorRef.current = processor;
      processor.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        pcmBufferRef.current.push(new Float32Array(ch));
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);

      setIsStarting(false);
      setIsRecording(true);
      setElapsedSeconds(0);

      chunkIntervalRef.current = window.setInterval(() => {
        try {
          const wavBlob = flushPcmBuffer();
          if (wavBlob) {
            void Promise.resolve(onChunkRef.current(wavBlob)).catch((err) => {
              console.error("Chunk-callback feilet:", err);
            });
          }
        } catch (err) {
          console.error("Audio chunk-feil:", err);
        }
      }, chunkIntervalMs);

      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      setIsStarting(false);
      const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
      let msg: string;
      if (err?.name === "NotAllowedError" || /denied|dismissed/i.test(err?.message ?? "")) {
        msg = isMac
          ? "Mikrofontilgang er blokkert. Klikk 🔒-ikonet i adresselinjen og tillat mikrofon, eller gå til Systeminnstillinger → Personvern → Mikrofon."
          : "Mikrofontilgang er blokkert. Klikk 🔒-ikonet i adresselinjen og velg «Tillat», deretter last siden på nytt.";
      } else if (err?.name === "NotFoundError") {
        msg = "Ingen mikrofon funnet. Sjekk at en mikrofon er koblet til.";
      } else if (err?.name === "NotReadableError") {
        msg = "Mikrofonen er i bruk av et annet program (f.eks. Zoom eller Teams). Lukk det og prøv igjen.";
      } else {
        msg = err?.message || "Kunne ikke få tilgang til mikrofonen.";
      }
      setError(msg);
      teardown();
    }
  }, [chunkIntervalMs, flushPcmBuffer, isRecording, isStarting, teardown]);

  const stop = useCallback(async () => {
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }
    // Disconnect prosessoren først for å stoppe nye frames, deretter flush halen
    if (audioProcessorRef.current) {
      try { audioProcessorRef.current.disconnect(); } catch { /* ignore */ }
      audioProcessorRef.current.onaudioprocess = null;
      audioProcessorRef.current = null;
    }
    if (audioSourceRef.current) {
      try { audioSourceRef.current.disconnect(); } catch { /* ignore */ }
      audioSourceRef.current = null;
    }

    const tailBlob = flushPcmBuffer();
    if (tailBlob) {
      try {
        await Promise.resolve(onChunkRef.current(tailBlob));
      } catch (err) {
        console.error("Tail-chunk feilet:", err);
      }
    }

    teardown();
    setIsRecording(false);
    setAudioLevelBars(Array(NUM_LEVEL_BARS).fill(0));
  }, [flushPcmBuffer, teardown]);

  const clearError = useCallback(() => setError(null), []);

  // Sikrer at vi rydder opp hvis komponenten unmountes mens opptak pågår.
  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  return {
    isRecording,
    isStarting,
    error,
    elapsedSeconds,
    audioLevelBars,
    start,
    stop,
    clearError,
  };
}
