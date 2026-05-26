/** Increase HSL lightness of a hex colour by `amount` (0–1 scale, e.g. 0.10 = +10%). */
export function lightenHex(hex: string, amount: number): string {
  const full =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  const r = parseInt(full.slice(1, 3), 16) / 255;
  const g = parseInt(full.slice(3, 5), 16) / 255;
  const b = parseInt(full.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else                h = ((r - g) / d + 4) / 6;
  }

  const newL = Math.min(1, l + amount);

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let nr: number, ng: number, nb: number;
  if (s === 0) {
    nr = ng = nb = newL;
  } else {
    const q2 = newL < 0.5 ? newL * (1 + s) : newL + s - newL * s;
    const p2 = 2 * newL - q2;
    nr = hue2rgb(p2, q2, h + 1 / 3);
    ng = hue2rgb(p2, q2, h);
    nb = hue2rgb(p2, q2, h - 1 / 3);
  }

  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}
