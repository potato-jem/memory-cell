// CellIcon — SVG icon for each cell type.
// Usage: <CellIcon type="neutrophil" size={16} color="#60a5fa" />
// Omit color to inherit currentColor (useful inside colored text containers).

const ICONS = {

  // Neutrophil — multi-lobed nucleus (three overlapping circles)
  neutrophil: ({ size, color }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="9"  cy="8.5" r="5.2" fill={color} />
      <circle cx="15" cy="8.5" r="5.2" fill={color} />
      <circle cx="12" cy="15" r="5.2" fill={color} />
    </svg>
  ),

  // Dendritic (Scout) — central body with 4 radiating processes
  dendritic: ({ size, color }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="3.5" fill={color} />
      <rect x="10.75" y="2"  width="2.5" height="7"  rx="1.25" fill={color} />
      <rect x="10.75" y="15" width="2.5" height="7"  rx="1.25" fill={color} />
      <rect x="2"  y="10.75" width="7"  height="2.5" rx="1.25" fill={color} />
      <rect x="15" y="10.75" width="7"  height="2.5" rx="1.25" fill={color} />
    </svg>
  ),

  // Macrophage — large amoeba/blob with pseudopod protrusion
  macrophage: ({ size, color }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <path
        d="M12 3 C15.5 3 19 6 19.5 9.5 C20.5 10.5 21.5 11 21.5 13 C21.5 14.5 20.5 15 19.5 14.5 C18.5 16.5 16 19 12 19 C7 19 3.5 16 3.5 12 C3.5 7.5 7 3 12 3 Z"
        fill={color}
      />
    </svg>
  ),

  // Responder — shield (defensive, responds to threats)
  responder: ({ size, color }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <path
        d="M12 2 L20 5.5 L20 12 C20 16.8 12 21.5 12 21.5 C12 21.5 4 16.8 4 12 L4 5.5 Z"
        fill={color}
      />
    </svg>
  ),

  // Killer T — upward arrow (targeted, aggressive attacker)
  killer_t: ({ size, color }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <path d="M12 2 L20 20 L12 14.5 L4 20 Z" fill={color} />
    </svg>
  ),

  // B-Cell — circle with inner ring (antibody factory)
  b_cell: ({ size, color }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10"   fill={color} />
      <circle cx="12" cy="12" r="6.5"  fill="rgba(0,0,0,0.35)" />
      <circle cx="12" cy="12" r="2.75" fill={color} />
    </svg>
  ),

  // NK Cell — solid hexagon (natural killer — geometric, no-nonsense)
  nk_cell: ({ size, color }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <path
        d="M18.5 12 L15.25 17.9 L8.75 17.9 L5.5 12 L8.75 6.1 L15.25 6.1 Z"
        fill={color}
      />
    </svg>
  ),
};

export default function CellIcon({ type, size = 16, color = 'currentColor' }) {
  const Icon = ICONS[type];
  if (!Icon) {
    // Fallback: filled circle
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
        <circle cx="12" cy="12" r="8" fill={color} />
      </svg>
    );
  }
  return <Icon size={size} color={color} />;
}
