import { coatFor } from '@/lib/world/coats';

/** Flat 2D portrait in the cat's own coat colours, for the HUD. */
export function CatFace({ seed, size = 52, asleep = false }: { seed: number; size?: number; asleep?: boolean }) {
  const c = coatFor(seed);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-hidden>
      <circle cx="32" cy="32" r="31" fill="#FFD9D0" />
      <path d="M12 30 L14 8 L28 17 Z" fill={c.base} />
      <path d="M52 30 L50 8 L36 17 Z" fill={c.base} />
      <path d="M16 24 L16.5 14 L24 18.5 Z" fill="#FF9994" opacity=".7" />
      <path d="M48 24 L47.5 14 L40 18.5 Z" fill="#FF9994" opacity=".7" />
      <ellipse cx="32" cy="36" rx="21" ry="19" fill={c.base} />
      <ellipse cx="32" cy="43" rx="10" ry="8" fill={c.accent} />
      {asleep ? (
        <>
          <path d="M20 34 Q24 37 28 34" stroke="#6B5148" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M36 34 Q40 37 44 34" stroke="#6B5148" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="24" cy="34" rx="3" ry="3.6" fill="#6B5148" />
          <ellipse cx="40" cy="34" rx="3" ry="3.6" fill="#6B5148" />
          <circle cx="25" cy="32.8" r="1" fill="#fff" />
          <circle cx="41" cy="32.8" r="1" fill="#fff" />
        </>
      )}
      <path d="M29.5 40 L34.5 40 L32 43 Z" fill="#E8A0A8" />
      <path d="M32 43 Q29 47 26 45 M32 43 Q35 47 38 45" stroke="#6B5148" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
