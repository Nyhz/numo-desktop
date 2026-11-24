// El logo de Numo App: la «N» de un solo trazo dentro de un círculo. Es la misma
// marca en el menú, en el icono de la app y en la pantalla de carga, donde el
// trazo se dibuja una y otra vez. Va en el color del texto, sin acento: la marca
// es neutra y el acento lo elige cada uno.

const N = "M11.5 22.5V9.5L20.5 22.5V9.5";

export function Logo({ size = 36, flow = false, className = "" }: { size?: number; flow?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden>
      <circle cx="16" cy="16" r="16" fill="var(--raised)" />
      {/* pathLength=1 deja animar el trazo de 0 a 1 sin medirlo. */}
      <path d={N} pathLength={1} fill="none" stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={flow ? "logo-flow" : undefined} />
    </svg>
  );
}
