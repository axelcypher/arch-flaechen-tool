import type { DetectWindow } from '../core/detect';
import type { RasterBackground } from '../core/model';

/**
 * Liefert für die Raumerkennung eine Hindernismaske aus einem Rasterplan:
 * Pixel dunkler als die Schwelle gelten als Wand/Linie.
 */

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  let p = imageCache.get(dataUrl);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Planbild konnte nicht geladen werden.'));
      img.src = dataUrl;
    });
    imageCache.set(dataUrl, p);
    // nur wenige Bilder im Speicher halten
    if (imageCache.size > 8) imageCache.delete(imageCache.keys().next().value!);
  }
  return p;
}

export function rasterMaskProvider(bg: RasterBackground, img: HTMLImageElement, threshold: number) {
  return (win: DetectWindow): Uint8Array | null => {
    const canvas = document.createElement('canvas');
    canvas.width = win.w;
    canvas.height = win.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, win.w, win.h);
    const k = bg.metersPerPixel / win.res;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(k, 0, 0, k, (bg.x - win.minX) / win.res, (bg.y - win.minY) / win.res);
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, win.w, win.h).data;
    const mask = new Uint8Array(win.w * win.h);
    for (let i = 0, j = 0; j < mask.length; i += 4, j++) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      mask[j] = lum < threshold ? 1 : 0;
    }
    return mask;
  };
}

/**
 * Verschiebt eine erkannte Kante auf die tatsächliche Wandkante im Originalbild (volle Auflösung):
 * entlang mehrerer Querprofile wird der Übergang hell → dunkel (50 %) gesucht, der Median gewinnt.
 */
export function rasterEdgeRefiner(bg: RasterBackground, img: HTMLImageElement) {
  const mpp = bg.metersPerPixel;
  return (a: { x: number; y: number }, b: { x: number; y: number }, n: { x: number; y: number }): number | null => {
    const reach = Math.max(0.05, mpp * 8);
    const minX = Math.min(a.x, b.x) - reach - mpp * 2;
    const minY = Math.min(a.y, b.y) - reach - mpp * 2;
    const maxX = Math.max(a.x, b.x) + reach + mpp * 2;
    const maxY = Math.max(a.y, b.y) + reach + mpp * 2;
    const u0 = Math.max(0, Math.floor((minX - bg.x) / mpp));
    const v0 = Math.max(0, Math.floor((minY - bg.y) / mpp));
    const u1 = Math.min(bg.widthPx, Math.ceil((maxX - bg.x) / mpp));
    const v1 = Math.min(bg.heightPx, Math.ceil((maxY - bg.y) / mpp));
    const cw = u1 - u0;
    const ch = v1 - v0;
    if (cw <= 2 || ch <= 2 || cw * ch > 4_000_000) return null;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, u0, v0, cw, ch, 0, 0, cw, ch);
    const data = ctx.getImageData(0, 0, cw, ch).data;
    const lum = (x: number, y: number) => {
      // bilinear in Bildpixeln
      const fu = (x - bg.x) / mpp - u0 - 0.5;
      const fv = (y - bg.y) / mpp - v0 - 0.5;
      const iu = Math.floor(fu);
      const iv = Math.floor(fv);
      if (iu < 0 || iv < 0 || iu + 1 >= cw || iv + 1 >= ch) return NaN;
      const tu = fu - iu;
      const tv = fv - iv;
      const L = (u: number, v: number) => {
        const i = (v * cw + u) * 4;
        return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      };
      return (L(iu, iv) * (1 - tu) + L(iu + 1, iv) * tu) * (1 - tv) + (L(iu, iv + 1) * (1 - tu) + L(iu + 1, iv + 1) * tu) * tv;
    };
    const step = mpp / 3;
    const shifts: number[] = [];
    const N = 24;
    for (let k = 0; k < N; k++) {
      const t = 0.12 + (0.76 * k) / (N - 1);
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      let prev = lum(px - n.x * reach, py - n.y * reach);
      if (!(prev > 160)) continue; // Profil muss im hellen Raum beginnen
      for (let s = -reach + step; s <= reach; s += step) {
        const cur = lum(px + n.x * s, py + n.y * s);
        if (Number.isNaN(cur)) break;
        if (cur < 128) {
          // Übergang zwischen s-step und s linear interpolieren
          const f = (prev - 128) / Math.max(prev - cur, 1e-6);
          shifts.push(s - step + f * step);
          break;
        }
        prev = cur;
      }
    }
    if (shifts.length < N * 0.4) return null;
    shifts.sort((x, y) => x - y);
    const med = shifts[Math.floor(shifts.length / 2)];
    // nur übernehmen, wenn die Profile übereinstimmen (gerade Wandkante)
    const q1 = shifts[Math.floor(shifts.length * 0.25)];
    const q3 = shifts[Math.floor(shifts.length * 0.75)];
    if (q3 - q1 > Math.max(0.01, mpp * 2)) return null;
    return med;
  };
}
