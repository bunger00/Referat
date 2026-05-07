import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  score: number; // 0-10
  label: string;
  rationale?: string;
  size?: "md" | "lg";
  className?: string;
};

/**
 * Buet 0–10 speedometer i SVG. Viktige design-detaljer:
 * - Bakgrunns-arc med subtil gradient som viser hele 0-10-spennet (rød→gul→grønn).
 * - Forgrunns-arc som tegnes til nåværende score, med stroke-dasharray-animasjon.
 * - Tall i midten teller fra forrige verdi til ny verdi (cubic-easing).
 * - Score-fargen tones inn med score (rød 0-4, gul 5-7, grønn 8-10).
 * - Pulse på radial glow når verdien endrer seg.
 */
export function Speedometer({ score, label, rationale, size = "md", className }: Props) {
  const dim = size === "lg" ? 200 : 168;
  const stroke = size === "lg" ? 16 : 13;
  const radius = (dim - stroke) / 2;
  const cx = dim / 2;
  const cy = dim / 2;

  // Halvsirkel: -130° til 50° (totalt 180° + 100°/2 = 180+ litt). Bruker -135 til 135.
  const START_ANGLE = -135; // grader fra horisontal
  const END_ANGLE = 135;
  const TOTAL_DEG = END_ANGLE - START_ANGLE; // 270 grader (litt mer enn halvsirkel — gir tydelig "speedometer-look")

  const clampedScore = Math.max(0, Math.min(10, score));
  const targetT = clampedScore / 10;

  // Animer score-tall og arc-fyllingen
  const [animT, setAnimT] = useState(0);
  const [animScore, setAnimScore] = useState(0);
  const [glow, setGlow] = useState(false);
  const lastScoreRef = useRef(0);

  useEffect(() => {
    const fromT = animT;
    const toT = targetT;
    const fromScore = lastScoreRef.current;
    const toScore = clampedScore;
    if (Math.abs(fromT - toT) < 0.001) return;

    const duration = 900; // ms
    const start = performance.now();
    let raf = 0;

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutCubic(t);
      setAnimT(fromT + (toT - fromT) * eased);
      setAnimScore(fromScore + (toScore - fromScore) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else lastScoreRef.current = toScore;
    };
    raf = requestAnimationFrame(tick);

    setGlow(true);
    const glowTimer = window.setTimeout(() => setGlow(false), 700);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(glowTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetT]);

  const polarToCartesian = (angle: number, r: number) => {
    const rad = (angle - 90) * (Math.PI / 180);
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  // Helper: build arc path from angle a1 to a2 (clockwise)
  const arcPath = (a1: number, a2: number, r: number) => {
    const start = polarToCartesian(a1, r);
    const end = polarToCartesian(a2, r);
    const largeArc = a2 - a1 > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  };

  const bgPath = arcPath(START_ANGLE, END_ANGLE, radius);
  const valueAngle = START_ANGLE + TOTAL_DEG * animT;
  const valuePath = arcPath(START_ANGLE, valueAngle, radius);

  // Color shifts with score
  const colorFor = (s: number): string => {
    if (s < 4) return "hsl(var(--destructive))";
    if (s < 5) return "hsl(15 80% 55%)"; // orange-red
    if (s < 7) return "hsl(var(--warning))";
    if (s < 8) return "hsl(80 65% 50%)"; // yellow-green
    return "hsl(var(--success))";
  };

  const valueColor = colorFor(animScore);
  const tickValueColor = colorFor(clampedScore);

  // Tick marks every 1
  const ticks: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = START_ANGLE + (TOTAL_DEG * i) / 10;
    const major = i % 5 === 0;
    const inner = polarToCartesian(a, radius - stroke / 2 - 2);
    const outer = polarToCartesian(a, radius - stroke / 2 + (major ? 6 : 3));
    ticks.push({ x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, major });
  }

  // Needle endpoint
  const needleAngle = valueAngle;
  const needleEnd = polarToCartesian(needleAngle, radius - stroke - 4);
  const needleBack = polarToCartesian(needleAngle + 180, 8);

  const id = `gauge-grad-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div
        className={cn(
          "relative rounded-full transition-shadow duration-500",
          glow && "shadow-[0_0_24px_-2px_currentColor]"
        )}
        style={{ color: tickValueColor, width: dim, height: dim }}
      >
        <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="overflow-visible">
          <defs>
            <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity="0.35" />
              <stop offset="50%" stopColor="hsl(var(--warning))" stopOpacity="0.35" />
              <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity="0.35" />
            </linearGradient>
            <radialGradient id={`${id}-bg`} cx="50%" cy="50%" r="50%">
              <stop offset="60%" stopColor="hsl(var(--card))" stopOpacity="0" />
              <stop offset="100%" stopColor="hsl(var(--card))" stopOpacity="0.6" />
            </radialGradient>
          </defs>

          {/* Background arc — full range */}
          <path
            d={bgPath}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth={stroke}
            strokeLinecap="round"
          />

          {/* Subtle inner shadow ring */}
          <path
            d={bgPath}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={1}
            strokeOpacity={0.35}
          />

          {/* Tick marks */}
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="hsl(var(--muted-foreground))"
              strokeOpacity={t.major ? 0.7 : 0.35}
              strokeWidth={t.major ? 1.5 : 1}
              strokeLinecap="round"
            />
          ))}

          {/* Value arc */}
          <path
            d={valuePath}
            fill="none"
            stroke={valueColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            style={{
              transition: "stroke 600ms ease",
              filter: glow ? `drop-shadow(0 0 6px ${valueColor})` : undefined,
            }}
          />

          {/* Needle */}
          <line
            x1={needleBack.x}
            y1={needleBack.y}
            x2={needleEnd.x}
            y2={needleEnd.y}
            stroke="hsl(var(--foreground))"
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={0.85}
          />
          <circle cx={cx} cy={cy} r={6} fill="hsl(var(--foreground))" />
          <circle cx={cx} cy={cy} r={3} fill="hsl(var(--background))" />

          {/* Center label fade overlay */}
          <circle cx={cx} cy={cy} r={radius - stroke - 8} fill={`url(#${id}-bg)`} />
        </svg>

        {/* Score number, centered */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
          <span
            className="font-display font-semibold tabular-nums leading-none transition-colors duration-500"
            style={{
              color: valueColor,
              fontSize: size === "lg" ? "3rem" : "2.5rem",
              textShadow: glow ? `0 0 20px ${valueColor}55` : "none",
            }}
          >
            {animScore.toFixed(1)}
          </span>
          <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/80 font-medium">
            av 10
          </span>
        </div>
      </div>

      <div className="text-center max-w-[14rem]">
        <p className="font-medium text-sm leading-tight">{label}</p>
        {rationale ? (
          <p className="mt-1 text-xs text-muted-foreground leading-snug line-clamp-3">{rationale}</p>
        ) : null}
      </div>
    </div>
  );
}
