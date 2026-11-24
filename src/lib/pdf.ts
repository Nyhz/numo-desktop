import type { jsPDF } from "jspdf";
import logo from "../assets/logo.png";
import { eur, eurSigned, pct, pctSigned } from "./format.ts";

// Informe de posiciones en PDF: una hoja A4 clara, pensada para imprimir o
// enviar, con las cifras clave, el reparto, lo que pesa y lo que gana cada
// posición, y la tabla completa. Se dibuja a mano (rectángulos, líneas y texto):
// los gráficos de la pantalla son HTML y no se pueden llevar tal cual a un PDF.
// La librería se carga solo al pedir el informe.

export type PdfPosition = {
  name: string;
  /** Tipo, ISIN o símbolo: la línea pequeña bajo el nombre. */
  detail: string;
  accounts: string;
  units: string;
  price: string;
  valueEur: number;
  costEur: number;
  unrealizedEur: number;
  unrealizedPct: number | null;
  weight: number;
};
export type PdfReport = {
  /** Fecha del informe, ya escrita («24 nov 2026»). */
  date: string;
  /** Qué cuentas incluye. */
  scope: string;
  total: number;
  invested: number;
  cashTotal: number;
  cost: number;
  positions: PdfPosition[];
  /** Reparto por tipo de activo (y efectivo), de mayor a menor. */
  kinds: Array<{ label: string; value: number }>;
  cash: Array<{ name: string; balance: string; eur: number }>;
  /** Fondo de emergencia, si lo hay: va aparte, no es cartera. */
  reserve: number | null;
};

type Rgb = [number, number, number];
const INK: Rgb = [23, 23, 26];
const SOFT: Rgb = [75, 75, 82];
const MUTE: Rgb = [128, 128, 136];
const LINE: Rgb = [226, 226, 229];
const WASH: Rgb = [246, 246, 247];
const GOLD: Rgb = [196, 146, 52];
const UP: Rgb = [28, 135, 92];
const DOWN: Rgb = [196, 62, 52];
/** Un color por tramo del reparto; a partir del sexto, gris. */
const SERIES: Rgb[] = [GOLD, [88, 118, 196], [72, 160, 168], [150, 110, 190], [206, 122, 96], [124, 150, 92]];

const [W, H, M] = [595.28, 841.89, 40];

/** Los formatos de número usan espacios duros, que las fuentes del PDF no traen. */
const clean = (text: string) => text.replace(/[  ]/g, " ").replace(/−/g, "-");

export async function positionsPdf(r: PdfReport): Promise<Uint8Array> {
  const { jsPDF: Pdf } = await import("jspdf");
  const doc = new Pdf({ unit: "pt", format: "a4", compress: true });
  let logoBytes: Uint8Array | null = null;
  try {
    logoBytes = new Uint8Array(await (await fetch(logo)).arrayBuffer());
  } catch {
    logoBytes = null; // sin logo el informe sale igual
  }

  const text = (s: string, x: number, y: number, o: { size?: number; color?: Rgb; bold?: boolean; align?: "left" | "right" | "center"; max?: number } = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size ?? 9);
    doc.setTextColor(...(o.color ?? INK));
    let out = clean(s);
    // Lo que no cabe se corta con puntos suspensivos en vez de pisar la columna de al lado.
    if (o.max && doc.getTextWidth(out) > o.max) {
      while (out.length > 1 && doc.getTextWidth(`${out}…`) > o.max) out = out.slice(0, -1);
      out = `${out.trimEnd()}…`;
    }
    doc.text(out, x, y, { align: o.align ?? "left" });
  };
  const box = (x: number, y: number, w: number, h: number, color: Rgb, radius = 0) => {
    doc.setFillColor(...color);
    if (radius) doc.roundedRect(x, y, w, h, radius, radius, "F");
    else doc.rect(x, y, w, h, "F");
  };
  const rule = (y: number, color: Rgb = LINE) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.6);
    doc.line(M, y, W - M, y);
  };
  const tone = (v: number): Rgb => (Math.abs(v) < 0.005 ? SOFT : v > 0 ? UP : DOWN);

  const header = () => {
    if (logoBytes) doc.addImage(logoBytes, "PNG", M - 6, 26, 34, 34);
    text("Numo", M + (logoBytes ? 30 : 0), 48, { size: 15, bold: true });
    text("Posiciones", W - M, 42, { size: 12, bold: true, align: "right" });
    text(`${r.date} · ${r.scope}`, W - M, 55, { size: 8.5, color: MUTE, align: "right", max: 300 });
    rule(68);
  };
  const footer = (page: number, pages: number) => {
    rule(H - 34);
    text("Generado con Numo. Valores en EUR al cambio del día; no es asesoramiento financiero ni fiscal.", M, H - 22, { size: 7.5, color: MUTE });
    text(`${page} / ${pages}`, W - M, H - 22, { size: 7.5, color: MUTE, align: "right" });
  };

  header();
  let y = 92;

  // ── Cifras clave ──
  const unrealized = r.invested - r.cost;
  const figures: Array<[string, string, string, Rgb]> = [
    ["Valor de la cartera", eur(r.total), `${r.positions.length} ${r.positions.length === 1 ? "posición" : "posiciones"}`, INK],
    ["Invertido", eur(r.invested), r.total > 0 ? `${pct(r.invested / r.total)} del total` : "", INK],
    ["Efectivo", eur(r.cashTotal), r.total > 0 ? `${pct(r.cashTotal / r.total)} sin invertir` : "", INK],
    ["Plusvalía latente", eurSigned(unrealized), r.cost > 0 ? `${pctSigned(unrealized / r.cost)} sobre el coste` : "", tone(unrealized)],
  ];
  const fw = (W - 2 * M - 3 * 10) / 4;
  figures.forEach(([label, value, note, color], i) => {
    const x = M + i * (fw + 10);
    box(x, y, fw, 58, WASH, 6);
    text(label, x + 10, y + 16, { size: 8, color: MUTE });
    text(value, x + 10, y + 34, { size: 13, bold: true, color, max: fw - 20 });
    text(note, x + 10, y + 48, { size: 7.5, color: MUTE, max: fw - 20 });
  });
  y += 58;
  if (r.reserve != null) {
    y += 14;
    // El importe va al final: la fuente estándar del PDF mide mal el «€» y lo que le sigue se le echa encima.
    text(`Aparte, y sin ser cartera aunque cuente para el patrimonio, un fondo de emergencia de ${eur(r.reserve)}`, M, y, { size: 8.5, color: SOFT });
  }
  y += 26;

  // ── Reparto por tipo ──
  text("Reparto por tipo", M, y, { size: 10.5, bold: true });
  y += 10;
  const kindsTotal = r.kinds.reduce((s, k) => s + k.value, 0);
  let x = M;
  r.kinds.forEach((k, i) => {
    const w = kindsTotal > 0 ? ((W - 2 * M) * k.value) / kindsTotal : 0;
    box(x, y, Math.max(0, w - 1.5), 16, SERIES[i] ?? MUTE, 2);
    x += w;
  });
  y += 30;
  const kw = (W - 2 * M) / Math.min(4, Math.max(1, r.kinds.length));
  r.kinds.forEach((k, i) => {
    const kx = M + (i % 4) * kw;
    const ky = y + Math.floor(i / 4) * 26;
    box(kx, ky - 6.5, 7, 7, SERIES[i] ?? MUTE, 1.5);
    text(k.label, kx + 11, ky, { size: 8.5, color: SOFT, max: kw - 20 });
    text(`${kindsTotal > 0 ? pct(k.value / kindsTotal) : "—"} · ${eur(k.value, 0)}`, kx + 11, ky + 11, { size: 8, color: MUTE, max: kw - 20 });
  });
  y += Math.ceil(r.kinds.length / 4) * 26 + 14;

  // ── Peso y rentabilidad de cada posición (las doce mayores) ──
  const top = r.positions.slice(0, 12);
  if (top.length) {
    const cw = (W - 2 * M - 24) / 2;
    const [lx, rx] = [M, M + cw + 24];
    text("Peso en la cartera", lx, y, { size: 10.5, bold: true });
    text("Plusvalía sobre el coste", rx, y, { size: 10.5, bold: true });
    if (r.positions.length > top.length) text(`las ${top.length} mayores de ${r.positions.length}`, W - M, y, { size: 8, color: MUTE, align: "right" });
    y += 16;
    const nameW = 108;
    const maxWeight = Math.max(...top.map((p) => p.weight), 1e-9);
    const rets = top.map((p) => p.unrealizedPct ?? 0);
    const [lo, hi] = [Math.min(0, ...rets), Math.max(0.01, ...rets)];
    // La escala de la rentabilidad es de raíz, para que una posición disparada no aplaste a las demás.
    const root = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
    const barW = cw - nameW - 44;
    const zero = rx + nameW + (barW * -root(lo)) / (root(hi) - root(lo));
    top.forEach((p, i) => {
      const ry = y + i * 15;
      text(p.name, lx, ry + 7, { size: 8, color: SOFT, max: nameW - 6 });
      box(lx + nameW, ry, barW, 8, WASH, 2);
      box(lx + nameW, ry, Math.max(1.5, (barW * p.weight) / maxWeight), 8, GOLD, 2);
      text(pct(p.weight), lx + cw, ry + 7, { size: 8, align: "right" });

      text(p.name, rx, ry + 7, { size: 8, color: SOFT, max: nameW - 6 });
      if (p.unrealizedPct != null) {
        const len = (barW * Math.abs(root(p.unrealizedPct))) / (root(hi) - root(lo));
        box(p.unrealizedPct >= 0 ? zero : zero - len, ry, Math.max(1.5, len), 8, tone(p.unrealizedEur), 2);
        text(pctSigned(p.unrealizedPct), rx + cw, ry + 7, { size: 8, align: "right", color: tone(p.unrealizedEur) });
      } else text("—", rx + cw, ry + 7, { size: 8, align: "right", color: MUTE });
    });
    doc.setDrawColor(...MUTE);
    doc.setLineWidth(0.5);
    doc.line(zero, y - 3, zero, y + top.length * 15 - 4);
    y += top.length * 15 + 16;
  }

  // ── Tabla de posiciones ──
  // Dónde va cada columna: el borde izquierdo de las de texto y el derecho de las de cifras.
  const C = { account: M + 138, units: M + 246, price: M + 310, value: M + 370, cost: M + 426, gain: M + 480 };
  // Columnas: [título, borde derecho o izquierdo, alineación].
  const cols: Array<[string, number, "left" | "right"]> = [
    ["Activo", M, "left"],
    ["Cuenta", C.account, "left"],
    ["Unidades", C.units, "right"],
    ["Precio", C.price, "right"],
    ["Valor", C.value, "right"],
    ["Coste", C.cost, "right"],
    ["Plusvalía", C.gain, "right"],
    ["Peso", W - M, "right"],
  ];
  const tableHead = (again = false) => {
    text(again ? "Posiciones (continuación)" : "Posiciones", M, y, { size: 10.5, bold: true });
    y += 14;
    for (const [title, cx, align] of cols) text(title, cx, y, { size: 7.5, color: MUTE, align });
    y += 6;
    rule(y);
  };
  const room = (need: number) => {
    if (y + need <= H - 46) return;
    doc.addPage();
    header();
    y = 92;
    tableHead(true);
  };
  if (y + 80 > H - 46) {
    doc.addPage();
    header();
    y = 92;
  }
  tableHead();
  r.positions.forEach((p, i) => {
    // La última fila no se separa del total: si no caben los dos, pasan juntos a la página siguiente.
    room(i === r.positions.length - 1 ? 24 + 22 : 24);
    text(p.name, M, y + 11, { size: 8.5, bold: true, max: C.account - M - 8 });
    text(p.detail, M, y + 20, { size: 7, color: MUTE, max: C.account - M - 8 });
    text(p.accounts, C.account, y + 11, { size: 7.8, color: SOFT, max: 62 });
    text(p.units, C.units, y + 11, { size: 7.8, align: "right" });
    text(p.price, C.price, y + 11, { size: 7.8, color: SOFT, align: "right" });
    text(eur(p.valueEur), C.value, y + 11, { size: 7.8, bold: true, align: "right" });
    text(eur(p.costEur), C.cost, y + 11, { size: 7.8, color: SOFT, align: "right" });
    text(eurSigned(p.unrealizedEur), C.gain, y + 11, { size: 7.8, align: "right", color: tone(p.unrealizedEur) });
    if (p.unrealizedPct != null) text(pctSigned(p.unrealizedPct), C.gain, y + 20, { size: 7, align: "right", color: tone(p.unrealizedEur) });
    text(pct(p.weight), W - M, y + 11, { size: 7.8, align: "right" });
    y += 24;
    rule(y, WASH);
  });
  rule(y);
  text("Total", M, y + 12, { size: 8.5, bold: true });
  text(eur(r.invested), C.value, y + 12, { size: 7.8, bold: true, align: "right" });
  text(eur(r.cost), C.cost, y + 12, { size: 7.8, bold: true, align: "right" });
  text(eurSigned(unrealized), C.gain, y + 12, { size: 7.8, bold: true, align: "right", color: tone(unrealized) });
  y += 38;

  // ── Efectivo ──
  if (r.cash.length) {
    if (y + 30 + r.cash.length * 16 > H - 46) {
      doc.addPage();
      header();
      y = 92;
    }
    text("Efectivo", M, y, { size: 10.5, bold: true });
    y += 14;
    text("Cuenta", M, y, { size: 7.5, color: MUTE });
    text("Saldo", C.value, y, { size: 7.5, color: MUTE, align: "right" });
    text("En EUR", W - M, y, { size: 7.5, color: MUTE, align: "right" });
    y += 6;
    rule(y);
    for (const c of r.cash) {
      text(c.name, M, y + 11, { size: 8.5, max: 260 });
      text(c.balance, C.value, y + 11, { size: 8, color: SOFT, align: "right" });
      text(eur(c.eur), W - M, y + 11, { size: 8, bold: true, align: "right" });
      y += 16;
      rule(y, WASH);
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    footer(p, pages);
  }
  return new Uint8Array((doc as jsPDF).output("arraybuffer"));
}
