import { modellRoofParams, outlineVolume } from './calc';
import type { Point } from './geometry';
import { polygonArea } from './geometry';
import type { OutlineShape, Project, Storey } from './model';
import type { Dach } from './roof';
import { autoFirstrichtung, DACH_TYPEN, isFrameRect, kreisabschnitt, roofFrame, roofStats } from './roof';
import { meshRoofStats } from './roofMesh';

/**
 * Rechenweg des Brutto-Rauminhalts: jeder BGF-Umriss wird in Teilkörper zerlegt, deren Volumen
 * sich als  Anzahl × Grundfläche × Höhe × Faktor  schreiben lässt (Grundfläche bei Rechtecken
 * zusätzlich als Länge × Breite). Die Summe der Teilkörper ist exakt der berechnete BRI.
 *
 * Bei rechteckigen Umrissen werden die klassischen Formeln verwendet (Quader, Keil, Dreiecksprisma,
 * Walmenden, Kreisabschnitt …). Wo keine geschlossene Formel passt (unregelmäßige Grundrisse,
 * Dach aus IFC-Modell), lautet der Teilkörper „Grundfläche × mittlere Höhe“.
 */

export interface BriSchritt {
  geschossId: string;
  geschoss: string;
  umrissId: string;
  umriss: string;
  umschliessung: 'R' | 'S';
  /** laufende Nummer innerhalb des Geschosses */
  nr: number;
  bezeichnung: string;
  /** Anzahl gleicher Teilkörper; negativ bei Abzügen */
  anzahl: number;
  laenge?: number;
  breite?: number;
  /** Grundfläche eines Teilkörpers (= Länge × Breite, falls angegeben) */
  flaeche: number;
  hoehe: number;
  /** Formfaktor: 1 Quader, ½ Keil/Prisma, ⅓ Pyramide, ⅙ Tetraeder … */
  faktor: number;
  /** anzahl × flaeche × hoehe × faktor */
  volumen: number;
  /** lesbare Formel, z. B. „12,00 × 10,00 × 3,00“ */
  formel: string;
  /** Teil des Dachkörpers (über der Traufe) statt Grundkörper */
  dach?: boolean;
}

type Teil = Omit<BriSchritt, 'geschossId' | 'geschoss' | 'umrissId' | 'umriss' | 'umschliessung' | 'nr' | 'volumen' | 'formel'>;

const f2 = (v: number) => v.toFixed(2).replace('.', ',');
const f3 = (v: number) => v.toFixed(3).replace('.', ',');
const rad = (d: number) => (d * Math.PI) / 180;

function faktorText(f: number): string {
  const known: [number, string][] = [
    [1, ''],
    [0.5, ' × ½'],
    [1 / 3, ' × ⅓'],
    [1 / 6, ' × ⅙'],
  ];
  for (const [v, t] of known) if (Math.abs(f - v) < 1e-12) return t;
  return ` × ${f.toFixed(4).replace('.', ',')}`;
}

function formel(t: Teil): string {
  const n = t.anzahl === 1 ? '' : t.anzahl === -1 ? '− ' : `${t.anzahl < 0 ? '− ' : ''}${Math.abs(t.anzahl)} × `;
  const base = t.laenge !== undefined && t.breite !== undefined ? `${f2(t.laenge)} × ${f2(t.breite)}` : `${f2(t.flaeche)} m²`;
  return `${n}${base} × ${f3(t.hoehe)}${faktorText(t.faktor)}`;
}

/** Teilkörper eines Umrisses (ohne Vorzeichen für Abzugsflächen) */
export function outlineTeile(s: OutlineShape, storey: Storey, project: Project): Teil[] {
  const pts = s.points;
  const A = polygonArea(pts);
  const h = s.hoehe ?? storey.hoehe;
  const d = s.dach;

  if (!d) return [grundkoerper('Quader', pts, A, h, autoFirstrichtung(pts))];

  if (d.typ === 'modell') {
    if (!project.dachModell) return [grundkoerper('Quader', pts, A, h, autoFirstrichtung(pts))];
    const r = modellRoofParams(project, storey, s);
    const v = meshRoofStats(project.dachModell, pts, r.floorZ, h, r.cap).volumen;
    return [{ bezeichnung: 'Körper bis Dachhaut (IFC-Modell), Grundfläche × mittlere Höhe', anzahl: 1, flaeche: A, hoehe: v / A, faktor: 1, dach: true }];
  }

  const fr = roofFrame(d, pts);
  const rect = isFrameRect(fr, A);
  const teile: Teil[] = [];
  if (d.traufhoehe > 0) teile.push(grundkoerper('Grundkörper bis Traufe', pts, A, d.traufhoehe, fr.angle, rect ? fr : undefined));
  if (d.typ === 'flach') return teile;

  const dachLabel = DACH_TYPEN.find((t) => t.id === d.typ)?.label ?? 'Dach';
  const formula = rect ? rechteckDach(d, fr.u1 - fr.u0, fr.v1 - fr.v0, dachLabel) : null;
  if (formula) teile.push(...formula.filter((t) => Math.abs(t.flaeche * t.hoehe * t.faktor) > 1e-12).map((t) => ({ ...t, dach: true })));
  else {
    const dv = roofStats(d, pts).dachvolumen;
    teile.push({ bezeichnung: `${dachLabel}: Dachkörper über Traufe, Grundfläche × mittlere Höhe`, anzahl: 1, flaeche: A, hoehe: dv / A, faktor: 1, dach: true });
  }
  return teile;
}

function grundkoerper(label: string, pts: Point[], A: number, h: number, angle: number, frame?: { u0: number; u1: number; v0: number; v1: number }): Teil {
  const fr = frame ?? roofFrame({ typ: 'flach', traufhoehe: 0, neigung: 0, firstrichtung: angle }, pts);
  if (isFrameRect({ angle, ...fr }, A)) {
    const L = fr.u1 - fr.u0;
    const B = fr.v1 - fr.v0;
    return { bezeichnung: label, anzahl: 1, laenge: L, breite: B, flaeche: L * B, hoehe: h, faktor: 1 };
  }
  return { bezeichnung: label, anzahl: 1, flaeche: A, hoehe: h, faktor: 1 };
}

/** Klassische Formeln für Dachkörper über einem Rechteck L (Firstrichtung) × B; null = keine geschlossene Formel */
function rechteckDach(d: Dach, L: number, B: number, label: string): Teil[] | null {
  const t = Math.tan(rad(Math.min(Math.max(d.neigung, 0), 89)));
  const tw = Math.tan(rad(Math.min(Math.max(d.neigungWalm ?? d.neigung, 0), 89)));
  const box = (bez: string, anzahl: number, l: number, b: number, hh: number, faktor: number): Teil => ({ bezeichnung: bez, anzahl, laenge: l, breite: b, flaeche: l * b, hoehe: hh, faktor });

  switch (d.typ) {
    case 'pult':
      return [box(`${label}: Keil`, 1, L, B, B * t, 0.5)];
    case 'sattel':
      return [box(`${label}: Dreiecksprisma`, 1, L, B, (B / 2) * t, 0.5)];
    case 'walm':
    case 'zelt': {
      const hh = (B / 2) * t;
      const w = d.typ === 'zelt' ? t : tw;
      const a = w > 1e-12 ? hh / w : Infinity;
      if (2 * a > L + 1e-9) return null;
      return [box(`${label}: Mittelteil (Dreiecksprisma)`, 1, L - 2 * a, B, hh, 0.5), box(`${label}: Walmende`, 2, a, B, hh, 1 / 3)];
    }
    case 'kruppelwalm': {
      const H = (B / 2) * t;
      const hk = Math.min(Math.max(d.krueppelHoehe ?? 1, 0), H);
      const bk = t > 1e-12 ? (2 * hk) / t : 0;
      const ak = tw > 1e-12 ? hk / tw : Infinity;
      if (2 * ak > L + 1e-9) return null;
      return [box(`${label}: Satteldach (Dreiecksprisma)`, 1, L, B, H, 0.5), box(`${label}: Abzug Krüppelwalm`, -2, ak, bk, hk, 1 / 6)];
    }
    case 'mansard': {
      const t1 = Math.tan(rad(Math.min(Math.max(d.neigungUnten ?? 70, 0), 89)));
      const hm = Math.max(0, d.hoeheUnten ?? 2.5);
      const dm = t1 > 1e-12 ? hm / t1 : 0;
      const Bo = B - 2 * dm;
      // oberer Teil muss flacher sein als der untere, sonst gilt die allgemeine Form
      if (Bo < 0 || t > t1) return null;
      return [
        box(`${label}: unten, Quader`, 1, L, Bo, hm, 1),
        box(`${label}: unten, Seitenkeile`, 2, L, dm, hm, 0.5),
        box(`${label}: oben, Dreiecksprisma`, 1, L, Bo, (Bo / 2) * t, 0.5),
      ];
    }
    case 'tonne': {
      const f = Math.max(1e-6, d.stich ?? 1.5);
      return [box(`${label}: Kreisabschnitt`, 1, L, B, f, kreisabschnitt(B, f) / (B * f))];
    }
    case 'shed': {
      const n = Math.max(1, Math.round(d.shedAnzahl ?? 3));
      return [box(`${label}: Keile`, n, L, B / n, Math.max(0, d.shedHoehe ?? 1.5), 0.5)];
    }
    default:
      return null;
  }
}

/** Teilkörper eines Umrisses; ein Rundungsrest (z. B. numerische Höhenfelder) wird dem letzten Teil zugeschlagen, damit die Summe exakt stimmt */
function umrissTeile(s: OutlineShape, st: Storey, project: Project): Teil[] {
  const teile = outlineTeile(s, st, project);
  const soll = outlineVolume(s, st, project);
  const ist = teile.reduce((a, t) => a + t.anzahl * t.flaeche * t.hoehe * t.faktor, 0);
  if (teile.length && Math.abs(soll - ist) > 1e-9) {
    const last = teile[teile.length - 1];
    const per = last.anzahl * last.flaeche * last.faktor;
    if (Math.abs(per) > 1e-12) last.hoehe += (soll - ist) / per;
  }
  return teile;
}

/** Rechenweg aller Geschosse */
export function briRechenweg(project: Project): BriSchritt[] {
  const out: BriSchritt[] = [];
  for (const st of project.storeys) {
    let nr = 0;
    for (const s of st.shapes) {
      if (s.kind !== 'outline' || s.points.length < 3) continue;
      const teile = umrissTeile(s, st, project);
      const sign = s.subtract ? -1 : 1;
      for (const t of teile) {
        const anzahl = t.anzahl * sign;
        const teil = { ...t, anzahl };
        out.push({
          ...teil,
          geschossId: st.id,
          geschoss: st.name,
          umrissId: s.id,
          umriss: s.subtract ? `${s.name} (Abzug)` : s.name,
          umschliessung: s.umschliessung,
          nr: ++nr,
          volumen: anzahl * t.flaeche * t.hoehe * t.faktor,
          formel: formel(teil),
        });
      }
    }
  }
  return out;
}

/* ---------- Körper mit geschlossener Formel ---------- */

/**
 * Ein Körper des Brutto-Rauminhalts in der Darstellung einer klassischen BRI-Berechnung:
 * Normalgeschosse als  Geschosshöhe × BGF,  Dächer als ganzer Körper mit eigener Formel,
 * z. B. Walmdach  B × H × (3 × L − B) / 6.
 */
export interface BriKoerper {
  geschossId: string;
  geschoss: string;
  umrissId: string;
  umriss: string;
  umschliessung: 'R' | 'S';
  /** laufende Nummer innerhalb des Geschosses */
  nr: number;
  art: 'grundkoerper' | 'dach';
  /** z. B. „Walmdach“, „Grundkörper bis Traufe“ */
  bezeichnung: string;
  /** Maße als Text, z. B. „H: 5,375 m; B: 10,75 m; L: 12,00 m“ */
  parameter: string;
  /** Formel mit Formelzeichen, z. B. „B × H × (3 × L − B) / 6“ */
  formel: string;
  /** Formel mit eingesetzten Werten, z. B. „10,75 × 5,38 × (3 × 12 − 10,75) / 6“ */
  rechnung: string;
  /** Grundfläche (negativ bei Abzugsflächen) */
  flaeche: number;
  /** Grundkörper: Höhe; Dach: Höhe über Traufe (bzw. mittlere Höhe) */
  hoehe: number;
  laenge?: number;
  breite?: number;
  neigung?: number;
  /** Volumen (negativ bei Abzugsflächen); Summe aller Körper = BRI */
  volumen: number;
}

/** Zahl für Rechenwege: höchstens drei Nachkommastellen (Maße auf mm), ohne überflüssige Nullen – so bleibt die Rechnung nachprüfbar */
const zr = (v: number) => (Math.round(v * 1000 + Math.sign(v) * 1e-6) / 1000).toLocaleString('de-DE', { maximumFractionDigits: 3, useGrouping: false });
/** Maß für Parameterangaben, z. B. „5,375 m“ */
const zm = (v: number) => `${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 3, useGrouping: false })} m`;

type Groesse = [name: string, wert: number, einheit?: 'm' | 'm²' | ''];

interface DachFormel {
  formel: string;
  werte: Record<string, number>;
  parameter: Groesse[];
  hoehe: number;
}

function parameterText(p: Groesse[]): string {
  return p.map(([n, v, e = 'm']) => `${n}: ${e === 'm' ? zm(v) : e === 'm²' ? `${zr(v)} m²` : zr(v)}`).join('; ');
}

/** Setzt Werte für die Formelzeichen ein (längere Zeichen zuerst, z. B. „Hu“ vor „H“) */
export function einsetzen(formel: string, werte: Record<string, number>): string {
  const names = Object.keys(werte).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![A-Za-z])(${names.join('|')})(?![A-Za-z])`, 'g');
  return formel.replace(re, (n) => zr(werte[n]));
}

/** Geschlossene Formel für den Dachkörper über einem Rechteck L (Firstrichtung) × B; null = keine */
function dachFormel(d: Dach, L: number, B: number): DachFormel | null {
  const t = Math.tan(rad(Math.min(Math.max(d.neigung, 0), 89)));
  const tw = Math.tan(rad(Math.min(Math.max(d.neigungWalm ?? d.neigung, 0), 89)));
  const prisma = (H: number): DachFormel => ({ formel: 'L × B × H / 2', werte: { L, B, H }, parameter: [['H', H], ['B', B], ['L', L]], hoehe: H });

  switch (d.typ) {
    case 'pult':
      return prisma(B * t);
    case 'sattel':
      return prisma((B / 2) * t);
    case 'walm':
    case 'zelt': {
      const H = (B / 2) * t;
      const w = d.typ === 'zelt' ? t : tw;
      const a = w > 1e-12 ? H / w : Infinity;
      if (2 * a > L + 1e-9) return null;
      // gleiche Neigung aller Dachflächen: Walmtiefe = halbe Breite
      if (Math.abs(2 * a - B) < 1e-6) return { formel: 'B × H × (3 × L − B) / 6', werte: { B, H, L }, parameter: [['H', H], ['B', B], ['L', L]], hoehe: H };
      return { formel: 'B × H × (3 × L − 2 × a) / 6', werte: { B, H, L, a }, parameter: [['H', H], ['B', B], ['L', L], ['a (Walmtiefe)', a]], hoehe: H };
    }
    case 'kruppelwalm': {
      const H = (B / 2) * t;
      const h = Math.min(Math.max(d.krueppelHoehe ?? 1, 0), H);
      const b = t > 1e-12 ? (2 * h) / t : 0;
      const a = tw > 1e-12 ? h / tw : Infinity;
      if (2 * a > L + 1e-9) return null;
      return {
        formel: 'L × B × H / 2 − a × b × h / 3',
        werte: { L, B, H, a, b, h },
        parameter: [['H', H], ['B', B], ['L', L], ['h (Krüppelwalm)', h], ['b', b], ['a', a]],
        hoehe: H,
      };
    }
    case 'mansard': {
      const t1 = Math.tan(rad(Math.min(Math.max(d.neigungUnten ?? 70, 0), 89)));
      const Hu = Math.max(0, d.hoeheUnten ?? 2.5);
      const dm = t1 > 1e-12 ? Hu / t1 : 0;
      const Bo = B - 2 * dm;
      if (Bo < 0 || t > t1) return null;
      const Ho = (Bo / 2) * t;
      return {
        formel: 'L × (Hu × (B − d) + Bo × Ho / 2)',
        werte: { L, Hu, B, d: dm, Bo, Ho },
        parameter: [['Hu', Hu], ['Ho', Ho], ['B', B], ['Bo', Bo], ['d', dm], ['L', L]],
        hoehe: Hu + Ho,
      };
    }
    case 'tonne': {
      const f = Math.max(1e-6, d.stich ?? 1.5);
      const A = kreisabschnitt(B, f);
      return { formel: 'L × A', werte: { L, A }, parameter: [['f (Stich)', f], ['B', B], ['L', L], ['A (Kreisabschnitt)', A, 'm²']], hoehe: f };
    }
    case 'shed': {
      const n = Math.max(1, Math.round(d.shedAnzahl ?? 3));
      const h = Math.max(0, d.shedHoehe ?? 1.5);
      return { formel: 'L × B × h / 2', werte: { L, B, h }, parameter: [['n', n, ''], ['h', h], ['B', B], ['L', L]], hoehe: h };
    }
    default:
      return null;
  }
}

/** Körper aller Geschosse mit geschlossenen Formeln (Summe = BRI) */
export function briKoerper(project: Project): BriKoerper[] {
  const out: BriKoerper[] = [];
  const vol = (t: Teil) => t.anzahl * t.flaeche * t.hoehe * t.faktor;
  for (const st of project.storeys) {
    let nr = 0;
    for (const s of st.shapes) {
      if (s.kind !== 'outline' || s.points.length < 3) continue;
      const teile = umrissTeile(s, st, project);
      const sign = s.subtract ? -1 : 1;
      const minus = s.subtract ? '− ' : '';
      const base = {
        geschossId: st.id,
        geschoss: st.name,
        umrissId: s.id,
        umriss: s.subtract ? `${s.name} (Abzug)` : s.name,
        umschliessung: s.umschliessung,
      };

      for (const t of teile.filter((x) => !x.dach)) {
        const rect = t.laenge !== undefined && t.breite !== undefined;
        const formel = rect ? 'L × B × H' : 'A × H';
        out.push({
          ...base,
          nr: ++nr,
          art: 'grundkoerper',
          bezeichnung: t.bezeichnung,
          parameter: parameterText(rect ? [['H', t.hoehe], ['B', t.breite!], ['L', t.laenge!]] : [['H', t.hoehe], ['A', t.flaeche, 'm²']]),
          formel,
          rechnung: minus + einsetzen(formel, rect ? { L: t.laenge!, B: t.breite!, H: t.hoehe } : { A: t.flaeche, H: t.hoehe }),
          flaeche: sign * t.flaeche,
          hoehe: t.hoehe,
          laenge: t.laenge,
          breite: t.breite,
          volumen: sign * vol(t),
        });
      }

      const dachTeile = teile.filter((x) => x.dach);
      if (!dachTeile.length || !s.dach) continue;
      const V = dachTeile.reduce((a, t) => a + vol(t), 0);
      const A = polygonArea(s.points);
      const d = s.dach;
      const fr = d.typ === 'modell' ? null : roofFrame(d, s.points);
      const L = fr ? fr.u1 - fr.u0 : 0;
      const B = fr ? fr.v1 - fr.v0 : 0;
      const df = fr && isFrameRect(fr, A) ? dachFormel(d, L, B) : null;
      const common = {
        ...base,
        nr: ++nr,
        art: 'dach' as const,
        bezeichnung: d.typ === 'modell' ? 'Körper bis Dachhaut (IFC-Modell)' : (DACH_TYPEN.find((x) => x.id === d.typ)?.label ?? 'Dach'),
        neigung: d.typ === 'modell' ? undefined : d.neigung,
        volumen: sign * V,
      };
      if (df) {
        out.push({
          ...common,
          parameter: parameterText(df.parameter),
          formel: df.formel,
          rechnung: minus + einsetzen(df.formel, df.werte),
          flaeche: sign * L * B,
          hoehe: df.hoehe,
          laenge: L,
          breite: B,
        });
      } else {
        // unregelmäßiger Grundriss oder Dach aus dem Modell: Grundfläche × mittlere Höhe
        const hm = A > 1e-12 ? V / A : 0;
        out.push({
          ...common,
          parameter: parameterText([['A', A, 'm²'], ['hm (mittlere Höhe)', hm]]),
          formel: 'A × hm',
          rechnung: minus + einsetzen('A × hm', { A, hm }),
          flaeche: sign * A,
          hoehe: hm,
        });
      }
    }
  }
  return out;
}
