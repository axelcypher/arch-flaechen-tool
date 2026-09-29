# Flächenrechner (arch-flaechen-tool)

Visuell gestützte Flächenberechnung für Gebäude. Grundrisse werden direkt gezeichnet oder auf einem
kalibrierten Planbild nachgezeichnet; die Anwendung ermittelt daraus:

| Kennwert | Grundlage | Ermittlung |
|---|---|---|
| **BGF** – Brutto-Grundfläche | DIN 277 | Σ BGF-Umrisse je Geschoss, getrennt nach Raumumschließung **R** (Regelfall) und **S** (Sonderfall) |
| **BRI** – Brutto-Rauminhalt | DIN 277 | Σ Umrissfläche × Geschosshöhe bzw. Volumen vom Fußboden bis zur Dachhaut (Dachform oder Dach aus IFC) |
| **NRF** – Netto-Raumfläche | DIN 277 | Σ Räume = NUF 1–7 + TF 8 + VF 9 |
| **KGF** – Konstruktions-Grundfläche | DIN 277 | BGF − NRF (rechnerisch) |
| **WoFl** – Wohnfläche | WoFlV § 4 | Σ Raumfläche × Anrechnungsfaktor, gruppiert nach Wohnung |

Anrechnungsfaktoren WoFlV: lichte Höhe ≥ 2 m → 100 %, 1–2 m → 50 %, < 1 m → 0 %, unbeheizte
Wintergärten/Schwimmbäder → 50 %, Balkone/Loggien/Dachgärten/Terrassen → i. d. R. 25 % (Projektstandard
einstellbar, max. 50 %) sowie ein individueller Faktor.

## Funktionen

- **IFC-Import** (Archicad, Revit, …): Geschosse, Zonen → Räume (inkl. Putzabzug und WoFlV-Faktor aus den
  Raumhöhen), BGF-Umrisse aus den Bauteilen und Dachhaut für den BRI – siehe [docs/archicad-ifc.md](docs/archicad-ifc.md)
- **Dachformen** je BGF-Umriss für den BRI: Flach-, Pult-, Sattel-, Walm-, Krüppelwalm-, Zelt-, Mansard-,
  Mansardwalm-, Tonnen- und Sheddach mit Traufhöhe, Neigungen und Firstrichtung (exakte Volumenberechnung)
- **Gauben** (Schlepp-, Flachdach-, Satteldachgaube) mit den üblichen Formeln, z. B.
  B × T² × (tan α − tan β) / 2 – in BRI, Rechenweg, Excel-Vorlage und 3D-Ansicht
- **Dachform- und Gaubenerkennung aus IFC**: Dachform, Neigung, Traufhöhe und Gauben werden aus der
  Dachhaut abgeleitet und nur übernommen, wenn sie den Rauminhalt des Modells treffen – siehe
  [docs/dach-und-gauben.md](docs/dach-und-gauben.md)
- **3D-Ansicht** der Rauminhalte (Geschosse auseinanderziehbar, Vergleich mit dem IFC-Modell)
- Zeichnen von **Polygonen** und **Rechtecken** als BGF-Umriss oder Raum
- **Raum erkennen per Klick** (Werkzeug „Erkennen“): Klick in einen umschlossenen Bereich eines DXF-/PDF-/Bildplans
  oder zwischen bereits gezeichneten Flächen erzeugt die Fläche automatisch
  - Türöffnungen bis zum eingestellten **Lückenschluss** (Standard 1,10 m) werden bündig mit der Wandflucht geschlossen
  - DXF: Kanten werden exakt auf die Plangeometrie eingepasst; Bögen (Türaufschläge) können ignoriert werden
  - PDF/Bild: dünne Linien (Türaufschläge, Möbel) werden ignoriert, solange der Raum geschlossen bleibt;
    Kanten werden auf dem Originalbild subpixelgenau an die Wandkante geschoben
- **Hintergrundpläne**: **PDF** (Seite wählbar, direkte Maßstabseingabe 1:M), **DXF** (Layer ein-/ausblenden,
  Einheit aus `$INSUNITS`, Blöcke, Bemaßungen, Texte) sowie **PNG/JPG**; Kalibrierung über eine bekannte Strecke
- **Fang** auf Raster, Eckpunkte und Kanten (auch DXF-Geometrie und darunterliegendes Geschoss), **Shift** = orthogonal, **Alt** = Fang aus
- **Numerische Eingabe** beim Zeichnen: Länge tippen + Enter (in Mausrichtung), `dx;dy` relativ, Rechteck `4,5x3,2`
- Eckpunkte ziehen, auf Kantenmitte ziehen = Punkt einfügen, Rechtsklick = Punkt löschen, Koordinaten-Tabelle
- **Abzugsflächen** (Innenhof, Schacht, Treppenloch, Schornstein …)
- Mehrere **Geschosse**, Geschoss duplizieren (Regelgeschosse), darunterliegendes Geschoss einblenden
- Messen-Werkzeug, Maßketten der ausgewählten Fläche, Maßstabsleiste
- Live-Auswertung je Geschoss und gesamt
- **Flächenaufstellung** zum Drucken/PDF mit **Grundriss je Geschoss** (farbig nach Nutzungsgruppe, beschriftet,
  Maßstabsleiste, Legende, optional mit Hintergrundplan) und Raumliste je Geschoss
- **Excel-Export** (.xlsx) im Standardlayout oder mit **eigener Vorlage** – siehe [docs/excel-vorlagen.md](docs/excel-vorlagen.md)
- **CSV-Export** (Excel, Dezimalkomma)
- **Projektdaten** (Projektcode, Adresse, Grundstück mit Gemarkung/Flur/Flurstück, Bauherr mit beliebig vielen
  E-Mail-Adressen und Telefonnummern) im Dialog; als Platzhalter für Excel-Vorlagen (`{{bauherr.name}}` …)
- Rückgängig/Wiederholen, automatische Zwischenspeicherung (IndexedDB)
- **Projektarchiv** `*.oap` bzw. `*.akhp` (gleiches Format, ZIP): Projekt, Planbilder, Dachmodell sowie die
  Originaldateien der Importe (IFC, DXF, PDF) und die Excel-Vorlage – auf einem anderen Rechner vollständig
  wieder zu öffnen, inkl. IFC-Modell in der 3D-Ansicht. Ältere `*.flaeche.json` lassen sich weiter öffnen.

### Tastenkürzel

| Taste | Funktion |
|---|---|
| `V` / `P` / `R` / `E` / `M` | Auswählen / Polygon / Rechteck / Erkennen / Messen |
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
  core/        reine Fachlogik (TypeScript, ohne UI/Plattform) – Geometrie, DIN 277, WoFlV, Raumerkennung,
               DXF-Import, Excel-Platzhalter, Export, Dateiformat
  store/       Anwendungszustand (zustand) inkl. Undo/Redo und Autosave
  components/  React-Oberfläche (SVG-Zeichenfläche, Seitenleisten, Bericht)
  platform/    Browser-/Plattform-APIs: Speichern/Öffnen (Tauri-Dialog bzw. Download), PDF-Rendering (pdf.js),
               Pixelmasken für die Raumerkennung, Excel (ExcelJS)
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

Der Workflow **Build & Release** (GitHub Actions) baut die Windows-Installer und veröffentlicht ein
GitHub-Release `v<version>` (mit Web-Version als ZIP), sobald die Version auf `main` erhöht wird. Die
Version steht in `package.json`, `src-tauri/tauri.conf.json` und `src-tauri/Cargo.toml` und muss überall
gleich sein. Manuell gestartet wird die aktuelle Version (neu) gebaut.

## Hinweise zur Normanwendung

- Die Unterscheidung R/S erfolgt je Fläche manuell (Eigenschaften rechts).
- KGF wird rechnerisch als BGF − NRF ermittelt; sie ist nur aussagekräftig, wenn alle Räume erfasst sind.
- Für Dachschrägen die Raumteile mit unterschiedlicher lichter Höhe als getrennte Flächen zeichnen
  (z. B. „Kind 1 (≥ 2 m)“ und „Kind 1 (1–2 m)“) und derselben Wohnung zuordnen.
- Abzüge nach § 3 Abs. 3 WoFlV (Schornsteine, Pfeiler > 0,1 m², Treppen mit mehr als drei Steigungen …)
  als Abzugsfläche mit derselben WoFlV-Kategorie erfassen.
- Automatisch erkannte Flächen immer kontrollieren (Maße der Auswahl werden angezeigt). Bei Rasterplänen hängt die
  Genauigkeit von der Planqualität ab; DXF-Pläne liefern exakte Kanten.
- DWG wird nicht direkt unterstützt – bitte als DXF exportieren. Archicad-PLN ist ein geschlossenes Format –
  bitte IFC exportieren.
- Dachformen spannen sich über das umschließende Rechteck in Firstrichtung auf; bei L-/T-Grundrissen mit
  mehreren Firsten den Umriss in Teilflächen mit je eigenem Dach aufteilen.
- Die Ergebnisse ersetzen keine fachliche Prüfung.

## Lizenz

MIT – siehe [LICENSE](LICENSE).
