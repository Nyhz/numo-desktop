import logo from "../assets/logo.png";

// El logo de Numo App: una «N» cuyo pie es la curva de una cartera que sube,
// sobre una ficha casi negra. Es la misma imagen en el menú, en la pantalla de
// carga (donde late mientras se actualizan los precios) y en el icono de la app,
// que sale de `src-tauri/icons/source.png`.
//
// La imagen es dorada, como el acento de serie. Con otro acento elegido, dentro
// de la app se tiñe de ese color (ver `.logo` en styles.css): se pasa a grises y
// se multiplica por el acento, recortado con la propia silueta de la ficha.

export function Logo({ size = 36, flow = false, className = "" }: { size?: number; flow?: boolean; className?: string }) {
  const mask = `url(${logo})`;
  return (
    <span className={`logo ${flow ? "logo-flow" : ""} ${className}`} style={{ width: size, height: size }} aria-hidden>
      <img src={logo} width={size} height={size} alt="" draggable={false} />
      <span className="logo-tint" style={{ maskImage: mask, WebkitMaskImage: mask }} />
    </span>
  );
}
