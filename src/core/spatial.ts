/**
 * Einfaches Rasterverzeichnis für Liniensegmente, damit Fang, Raumerkennung und
 * Kantenanpassung auch bei großen DXF-Plänen (zehntausende Segmente) schnell bleiben.
 */
export class SegmentGrid {
  /** flach: [x1, y1, x2, y2, …] */
  readonly segs: Float64Array;
  readonly count: number;
  private readonly cell: number;
  private readonly cells = new Map<string, number[]>();
  /** sehr lange Segmente, die in jeder Abfrage geprüft werden */
  private readonly big: number[] = [];

  constructor(segs: ArrayLike<number>, cellSize?: number) {
    this.segs = Float64Array.from(segs);
    this.count = Math.floor(this.segs.length / 4);
    this.cell = cellSize ?? SegmentGrid.guessCell(this.segs, this.count);
    const s = this.segs;
    const c = this.cell;
    for (let i = 0; i < this.count; i++) {
      const x1 = s[i * 4];
      const y1 = s[i * 4 + 1];
      const x2 = s[i * 4 + 2];
      const y2 = s[i * 4 + 3];
      const ix0 = Math.floor(Math.min(x1, x2) / c);
      const ix1 = Math.floor(Math.max(x1, x2) / c);
      const iy0 = Math.floor(Math.min(y1, y2) / c);
      const iy1 = Math.floor(Math.max(y1, y2) / c);
      if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > 400) {
        this.big.push(i);
        continue;
      }
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iy = iy0; iy <= iy1; iy++) {
          const k = `${ix},${iy}`;
          let arr = this.cells.get(k);
          if (!arr) this.cells.set(k, (arr = []));
          arr.push(i);
        }
      }
    }
  }

  private static guessCell(s: Float64Array, n: number): number {
    if (n === 0) return 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n * 4; i += 2) {
      minX = Math.min(minX, s[i]);
      maxX = Math.max(maxX, s[i]);
      minY = Math.min(minY, s[i + 1]);
      maxY = Math.max(maxY, s[i + 1]);
    }
    const area = Math.max((maxX - minX) * (maxY - minY), 1e-6);
    return Math.max(Math.sqrt(area / n) * 2, 1e-3);
  }

  /** Indizes aller Segmente, deren Hüllrechteck die Abfrage schneiden könnte. */
  query(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const c = this.cell;
    const ix0 = Math.floor(minX / c);
    const ix1 = Math.floor(maxX / c);
    const iy0 = Math.floor(minY / c);
    const iy1 = Math.floor(maxY / c);
    const out = new Set<number>(this.big);
    if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) > this.cells.size) {
      for (const arr of this.cells.values()) for (const i of arr) out.add(i);
    } else {
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iy = iy0; iy <= iy1; iy++) {
          const arr = this.cells.get(`${ix},${iy}`);
          if (arr) for (const i of arr) out.add(i);
        }
      }
    }
    return [...out];
  }

  seg(i: number): [number, number, number, number] {
    const s = this.segs;
    return [s[i * 4], s[i * 4 + 1], s[i * 4 + 2], s[i * 4 + 3]];
  }
}
