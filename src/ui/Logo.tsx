// El logo de Caudal: un círculo con tres ondas. Es el mismo en el menú, en el
// icono de la app y en la pantalla de carga, donde las ondas fluyen.

const WAVE = "c3-2.4 5.9-2.4 9 0s6 2.4 9 0";
/** Altura de cada onda y su desfase, para que fluyan paralelas sin cruzarse. */
const WAVES: Array<[y: number, delay: number]> = [
  [12.5, 0],
  [17, 0.15],
  [21.5, 0.3],
];

export function Logo({ size = 36, flow = false, className = "" }: { size?: number; flow?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden>
      <defs>
        <clipPath id="logo-clip">
          <circle cx="16" cy="16" r="11" />
        </clipPath>
      </defs>
      <circle cx="16" cy="16" r="16" fill="var(--raised)" />
      <g clipPath="url(#logo-clip)" fill="none" stroke="var(--acc)" strokeWidth="2" strokeLinecap="round">
        {WAVES.map(([y, delay]) => (
          // El mismo trazo repetido: al desplazarlo un periodo (18 unidades) vuelve a encajar.
          <path key={y} d={`M-11 ${y}${WAVE}${WAVE}${WAVE}${WAVE}`} className={flow ? "logo-flow" : undefined} style={flow ? { animationDelay: `${-delay}s` } : undefined} />
        ))}
      </g>
    </svg>
  );
}
