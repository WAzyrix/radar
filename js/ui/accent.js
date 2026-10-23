// =========================================================
// Couleur d'accent de la page.
// AniList donne la couleur dominante de chaque affiche (ex: "#e49335").
// Elle peut être trop sombre ou trop terne : on la convertit en HSL
// et on borne saturation et luminosité pour qu'elle reste lisible sur fond sombre.
// =========================================================

export function appliquerAccent(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const saturation = Math.min(Math.max(s * 100, 45), 85);
  const luminosite = Math.min(Math.max(l * 100, 58), 72);
  document.documentElement.style.setProperty('--accent', `hsl(${Math.round(h)} ${Math.round(saturation)}% ${Math.round(luminosite)}%)`);
}
