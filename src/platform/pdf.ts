/**
 * PDF-Pläne werden mit pdf.js in ein Rasterbild umgewandelt. pdf.js wird erst bei Bedarf geladen.
 * Verwendet wird der "legacy"-Build, weil der Standard-Build sehr neue JS-Funktionen voraussetzt,
 * die ältere WebView2-/Chromium-Versionen noch nicht haben.
 * 1 PDF-Punkt = 1/72 Zoll; bei Maßstab 1:M entspricht ein Punkt 0,0254/72 × M Metern.
 */

const METERS_PER_POINT = 0.0254 / 72;
/** längste Bildseite in Pixeln */
export const PDF_MAX_PIXELS = 7000;

export interface PdfDocumentHandle {
  numPages: number;
  pageSize(page: number): Promise<{ widthPt: number; heightPt: number }>;
  render(page: number, maxPixels?: number): Promise<{ dataUrl: string; width: number; height: number; metersPerPixelAt1: number }>;
  destroy(): void;
}

export async function openPdf(data: ArrayBuffer): Promise<PdfDocumentHandle> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;

  return {
    numPages: doc.numPages,
    async pageSize(n) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      return { widthPt: vp.width, heightPt: vp.height };
    },
    async render(n, maxPixels = PDF_MAX_PIXELS) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      // bis zu 300 dpi, aber nicht größer als maxPixels
      const scale = Math.min(300 / 72, maxPixels / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await page.render({ canvas, viewport: vp, background: '#ffffff' }).promise;
      const dataUrl = canvas.toDataURL('image/png');
      const out = { dataUrl, width: canvas.width, height: canvas.height, metersPerPixelAt1: METERS_PER_POINT / scale };
      canvas.width = 0;
      canvas.height = 0;
      return out;
    },
    destroy() {
      void task.destroy();
    },
  };
}
