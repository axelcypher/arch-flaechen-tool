# Flächenrechner (arch-flaechen-tool)

Visuell gestützte Flächenberechnung für Gebäude. Grundrisse werden direkt gezeichnet oder auf einem
kalibrierten Planbild nachgezeichnet; die Anwendung ermittelt daraus:

| Kennwert | Grundlage | Ermittlung |
|---|---|---|
| **BGF** – Brutto-Grundfläche | DIN 277 | Σ BGF-Umrisse je Geschoss, getrennt nach Raumumschließung **R** (Regelfall) und **S** (Sonderfall) |
| **BRI** – Brutto-Rauminhalt | DIN 277 | Σ Umrissfläche × Geschosshöhe (oder abweichende Höhe je Umriss) |
| **NRF** – Netto-Raumfläche | DIN 277 | Σ Räume = NUF 1–7 + TF 8 + VF 9 |
| **KGF** – Konstruktions-Grundfläche | DIN 277 | BGF − NRF (rechnerisch) |
| **WoFl** – Wohnfläche | WoFlV § 4 | Σ Raumfläche × Anrechnungsfaktor, gruppiert nach Wohnung |

Anrechnungsfaktoren WoFlV: lichte Höhe ≥ 2 m → 100 %, 1–2 m → 50 %, < 1 m → 0 %, unbeheizte
Wintergärten/Schwimmbäder → 50 %, Balkone/Loggien/Dachgärten/Terrassen → i. d. R. 25 % (Projektstandard
einstellbar, max. 50 %) sowie ein individueller Faktor.

## Funktionen

- Zeichnen von **Polygonen** und **Rechtecken** als BGF-Umriss oder Raum
- **Fang** auf Raster, Eckpunkte und Kanten (auch des darunterliegenden Geschosses), **Shift** = orthogonal, **Alt** = Fang aus
- **Numerische Eingabe** beim Zeichnen: Länge tippen + Enter (in Mausrichtung), `dx;dy` relativ, Rechteck `4,5x3,2`
- Eckpunkte ziehen, auf Kantenmitte ziehen = Punkt einfügen, Rechtsklick = Punkt löschen, Koordinaten-Tabelle
- **Abzugsflächen** (Innenhof, Schacht, Treppenloch, Schornstein …)
- Mehrere **Geschosse**, Geschoss duplizieren (Regelgeschosse), darunterliegendes Geschoss einblenden
- **Hintergrundplan** (PNG/JPG) laden und über eine bekannte Strecke **kalibrieren**
- Messen-Werkzeug, Maßketten der ausgewählten Fläche, Maßstabsleiste
- Live-Auswertung je Geschoss und gesamt, **Flächenaufstellung** zum Drucken/PDF, **CSV-Export** (Excel, Dezimalkomma)
- Rückgängig/Wiederholen, automatische Zwischenspeicherung, Projektdateien `*.flaeche.json`

### Tastenkürzel

| Taste | Funktion |
|---|---|
| `V` / `P` / `R` / `M` | Auswählen / Polygon / Rechteck / Messen |
| `B` / `N` | neue Flächen als BGF-Umriss / Raum zeichnen |
| `Enter` | Polygon schließen bzw. Zahleneingabe übernehmen |
| `Backspace` | letzten Punkt bzw. letzte Ziffer entfernen |
| `Esc` | Abbrechen / Auswahl aufheben |
| `Entf` | ausgewählte Fläche löschen |
| `F` | alles zeigen |
| `Strg+Z` / `Strg+Y` | Rückgängig / Wiederholen |
| Mausrad / mittlere Maustaste / `Leertaste`+Ziehen | Zoomen / Verschieben |

## Architektur

```
src/
  core/        reine Fachlogik (TypeScript, ohne UI/Plattform) – Geometrie, DIN 277, WoFlV, Export, Dateiformat
  store/       Anwendungszustand (zustand) inkl. Undo/Redo und Autosave
  components/  React-Oberfläche (SVG-Zeichenfläche, Seitenleisten, Bericht)
  platform/    einzige plattformabhängige Stelle: Speichern/Öffnen (Tauri-Dialog bzw. Browser-Download)
src-tauri/     Tauri-v2-Hülle (Rust): Fenster + nativer Speichern-Dialog
```

Die gesamte Berechnung läuft im Frontend. Tauri liefert nur Fenster und nativen Dateidialog; ohne Tauri
fällt `src/platform/files.ts` automatisch auf Browser-Mechanismen zurück. Damit ist der Web-Build
(`npm run build` → `dist/`) ohne Änderungen als statische Webanwendung einsetzbar.

## Entwicklung

Voraussetzungen: Node.js ≥ 20; für die Desktop-App zusätzlich Rust (stable) und unter Windows
die WebView2-Runtime (in Windows 10/11 enthalten) sowie die MSVC-Build-Tools.

```bash
npm install
npm run dev          # Web-Version unter http://localhost:1420
npm test             # Unit-Tests der Rechenlogik (vitest)
npm run build        # statischer Web-Build nach dist/

npm run tauri:dev    # Desktop-App im Entwicklungsmodus
npm run tauri:build  # Windows-Installer (NSIS .exe und .msi) unter src-tauri/target/release/bundle/
```

Der Workflow **Windows-Build** (GitHub Actions, manuell startbar oder bei Tags `v*`) erzeugt die
Installer als Build-Artefakt.

## Hinweise zur Normanwendung

- Die Unterscheidung R/S erfolgt je Fläche manuell (Eigenschaften rechts).
- KGF wird rechnerisch als BGF − NRF ermittelt; sie ist nur aussagekräftig, wenn alle Räume erfasst sind.
- Für Dachschrägen die Raumteile mit unterschiedlicher lichter Höhe als getrennte Flächen zeichnen
  (z. B. „Kind 1 (≥ 2 m)“ und „Kind 1 (1–2 m)“) und derselben Wohnung zuordnen.
- Abzüge nach § 3 Abs. 3 WoFlV (Schornsteine, Pfeiler > 0,1 m², Treppen mit mehr als drei Steigungen …)
  als Abzugsfläche mit derselben WoFlV-Kategorie erfassen.
- Die Ergebnisse ersetzen keine fachliche Prüfung.

## Lizenz

MIT – siehe [LICENSE](LICENSE).
