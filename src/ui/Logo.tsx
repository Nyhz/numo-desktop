import logo from "../assets/logo.png";

// El logo de Numo: una «N» cuyo pie es la curva de una cartera que sube.
// Dentro de la app (menú y pantalla de carga, donde se va llenando mientras se
// actualizan los precios) va la marca sola, sin fondo y con aire alrededor (el
// dibujo ocupa dos tercios del lienzo), para que valga igual en el tema
// claro y en el oscuro. El icono de la app la lleva sobre una ficha casi negra
// y sale de `src-tauri/icons/source.png`.
//
// La imagen es dorada, como el acento de serie. Con otro acento elegido, dentro
// de la app se tiñe de ese color (ver `.logo` en styles.css): se pasa a grises y
// se multiplica por el acento, recortado con la propia silueta de la marca.

export function Logo({ size = 44, className = "" }: { size?: number; className?: string }) {
  const mask = `url(${logo})`;
  return (
    <span className={`logo ${className}`} style={{ width: size, height: size }} aria-hidden>
      <img src={logo} width={size} height={size} alt="" draggable={false} />
      <span className="logo-tint" style={{ maskImage: mask, WebkitMaskImage: mask }} />
    </span>
  );
}
