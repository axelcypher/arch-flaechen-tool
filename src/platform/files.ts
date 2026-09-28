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
  const blob = new Blob([o.contents], { type: o.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = o.defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function pickFile(accept: string): Promise<File | null> {
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

export async function openImageFile(): Promise<{ name: string; dataUrl: string; width: number; height: number } | null> {
  const f = await pickFile('image/png,image/jpeg,image/webp,image/gif,image/bmp');
  if (!f) return null;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
    img.src = dataUrl;
  });
  return { name: f.name, dataUrl, width, height };
}
