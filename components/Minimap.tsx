'use client';
import { useGame } from '@/lib/client/store';
import { LOCATIONS, OBJECT_DEFS } from '@/lib/world/catalog';

/** A tiny top-down plan of the room you are looking at. Tap it to open the full map. */
export function Minimap() {
  const view = useGame((s) => s.view)!;
  const loc = useGame((s) => s.viewLocation);
  const openPanel = useGame((s) => s.openPanel);
  const L = LOCATIONS[loc];
  if (!L) return null;
  const { minX, maxX, minZ, maxZ } = L.bounds;
  const w = maxX - minX, d = maxZ - minZ;
  const here = view.objects.filter((o) => o.location === loc);
  const catHere = view.cat.location === loc;
  return (
    <button className="minimap" onClick={() => openPanel('map')} aria-label={`Open map. ${L.label}.`}>
      <svg viewBox={`${minX - 0.2} ${minZ - 0.2} ${w + 0.4} ${d + 0.4}`} role="img" aria-hidden>
        <rect x={minX} y={minZ} width={w} height={d} rx="0.35" fill="#FFF7EF" stroke="#EBD9C6" strokeWidth="0.12" />
        {here.map((o) => {
          const def = OBJECT_DEFS[o.type];
          if (!def) return null;
          const q = Math.abs(Math.round(o.rotation / (Math.PI / 2))) % 2 === 1;
          const ow = q ? def.d : def.w, od = q ? def.w : def.d;
          return <rect key={o.id} x={o.x - ow / 2} y={o.z - od / 2} width={ow} height={od} rx="0.12" fill={def.blocks ? '#EBD9C6' : '#B8DDF4'} opacity={def.blocks ? 1 : 0.8} />;
        })}
        {catHere && <circle cx={view.cat.x} cy={view.cat.z} r="0.35" fill="#FF9994" stroke="#fff" strokeWidth="0.1" />}
      </svg>
      <span>{L.label}</span>
    </button>
  );
}
