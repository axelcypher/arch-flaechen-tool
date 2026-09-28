/**
 * Plattform-Abstraktion für Dateioperationen.
 *
 * Im Tauri-Desktop-Build wird ein nativer Speichern-Dialog über ein Rust-Kommando genutzt,
 * im Browser ein Download. Öffnen funktioniert in beiden Umgebungen über <input type="file">.
 * Alles Plattformspezifische bleibt in dieser Datei – der Rest der App ist reine Web-Technik.
 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface SaveOptions {
  defaultName: string;
  contents: string;
  filterName: string;
  extension: string;
  mime: string;
}

/** Liefert false, wenn der Benutzer abgebrochen hat. */
export async function saveTextFile(o: SaveOptions): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string | null>('save_file', {
      defaultName: o.defaultName,
      contents: o.contents,
      filterName: o.filterName,
      extensions: [o.extension],
    });
    return path != null;
  }
  downloadBlob(new Blob([o.contents], { type: o.mime }), o.defaultName);
  return true;
}

export interface SaveBinaryOptions {
  defaultName: string;
  data: Uint8Array;
  filterName: string;
  extension: string;
  mime: string;
}

/** Speichert Binärdaten (z. B. .xlsx). Liefert false, wenn der Benutzer abgebrochen hat. */
export async function saveBinaryFile(o: SaveBinaryOptions): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string | null>('save_binary_file', {
      defaultName: o.defaultName,
      contentsBase64: bytesToBase64(o.data),
      filterName: o.filterName,
      extensions: [o.extension],
    });
    return path != null;
  }
  downloadBlob(new Blob([o.data as BlobPart], { type: o.mime }), o.defaultName);
  return true;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function openTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  const f = await pickFile(accept);
  if (!f) return null;
  return { name: f.name, text: await f.text() };
}

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
    img.src = dataUrl;
  });
}
