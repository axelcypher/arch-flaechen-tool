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
- **GRZ/GFZ-Nachweis** als eigene App im selben Repository (`apps/grz`), die dieselbe Projektdatei öffnet –
  siehe [docs/grz-gfz.md](docs/grz-gfz.md)
- **Massen- und Kostenermittlung nach DIN 276** als eigene App (`apps/kosten`): Mengen aus dem Projekt,
  Kennwerte mit Bandbreite, Kennwertkatalog, Kostenstände – siehe [docs/kosten.md](docs/kosten.md)
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

## Aufbau des Repositorys

Ein Repository mit npm-Workspaces, drei Apps und einem gemeinsamen Unterbau:

```
packages/core/       gemeinsamer Unterbau (TypeScript-Quelltext, in den Apps als @core/… eingebunden)
  src/               Geometrie, Projektformat (.oap/.akhp), IFC-Import, Dachformen und Gauben, DIN-277-
                     Berechnung, Lageplan-Flächen
  src/excel/         Excel-Vorlagen-Engine (Platzhalter, Blöcke, Formeln), Vorlagenspeicher
  src/platform/      Speichern/Öffnen (Tauri-Dialog bzw. Download), web-ifc, Protokoll, Farbschema
  src/ui/            Titelleiste, Protokoll-Fenster, Excel-Dialog, Eingabefelder, Grund-Styles (base.css)
  tauri/commands.rs  gemeinsame Tauri-Befehle, per include! in alle Tauri-Hüllen eingebunden
apps/flaechenrechner/  Flächenrechner (dieses Tool): Zeichenfläche, Bericht, Excel, DXF/PDF, 3D
apps/grz/              GRZ/GFZ-Nachweis: Lageplan, Nachweis zum Drucken, Excel – siehe docs/grz-gfz.md
apps/kosten/           Kostenermittlung nach DIN 276: Mengen, Kennwerte, Kostenstände, Druck, Excel – siehe docs/kosten.md
```

Jede App hat ihre eigene Tauri-Hülle (`apps/<app>/src-tauri`), eigenen Installer und eigene Releases.
Alle öffnen dieselbe Projektdatei (`.oap`/`.akhp`): Der Flächenrechner liefert Gebäude, Geschosse und
Flächen, der GRZ-Nachweis pflegt Lageplan und Festsetzungen, die Kostenermittlung Positionen, Kennwerte und
Kostenstände. Was eine App nicht kennt, bewahrt sie beim Speichern.

Die gesamte Berechnung läuft im Frontend. Tauri liefert nur Fenster und nativen Dateidialog; ohne Tauri
fällt `packages/core/src/platform/files.ts` automatisch auf Browser-Mechanismen zurück. Damit ist jeder
Web-Build (`apps/<app>/dist/`) ohne Änderungen als statische Webanwendung einsetzbar.

## Entwicklung

Voraussetzungen: Node.js ≥ 20; für die Desktop-Apps zusätzlich Rust (stable) und unter Windows
die WebView2-Runtime (in Windows 10/11 enthalten) sowie die MSVC-Build-Tools.

```bash
npm install              # alle Workspaces
npm run dev              # Flächenrechner unter http://localhost:1420
npm run dev:grz          # GRZ-Nachweis unter http://localhost:1430
npm run dev:kosten       # Kostenermittlung unter http://localhost:1440
npm test                 # alle Tests (Unterbau und Apps, vitest)
npm run typecheck        # TypeScript für alle Workspaces
npm run build            # Web-Builds aller Apps nach apps/<app>/dist/

npm run tauri:dev        # Flächenrechner als Desktop-App
npm run tauri:dev:grz    # GRZ-Nachweis als Desktop-App
npm run tauri:dev:kosten # Kostenermittlung als Desktop-App
npm run tauri:build -w flaechenrechner   # Windows-Installer unter apps/<app>/src-tauri/target/release/bundle/
```

Der Workflow **Build & Release** (GitHub Actions) baut je App die Windows-Installer und veröffentlicht ein
GitHub-Release (mit Web-Version als ZIP), sobald die Version der App auf `main` erhöht wird:
Flächenrechner als `v<version>`, GRZ-Nachweis als `grz-v<version>`, Kostenermittlung als `kosten-v<version>`.
Die Version steht je App in
`package.json`, `src-tauri/tauri.conf.json` und `src-tauri/Cargo.toml` und muss dort überall gleich sein.
Manuell gestartet wird die gewählte App in ihrer aktuellen Version (neu) gebaut. Die CI prüft zusätzlich
alle Tauri-Hüllen mit `cargo check`.

### Automatische Updates

Die Desktop-Apps suchen kurz nach dem Start und danach alle sechs Stunden nach einer neuen Version. Ist eine
verfügbar, erscheint in der Titelleiste „Update x.y.z“; ein Klick lädt den signierten Installer, installiert
ihn und startet die Anwendung neu. Der Versionsknopf in der Titelleiste sucht auch von Hand. Die Web-Versionen
aktualisieren sich nicht selbst.

- Jede App fragt ihr eigenes Manifest ab: `releases/download/updater/<app>.json` (Release „updater“). Der
  Release-Workflow legt es nach jedem Build aus dem `latest.json` des App-Releases dort ab.
- Die Installer werden mit dem privaten Schlüssel signiert (GitHub-Secrets `TAURI_SIGNING_PRIVATE_KEY` und
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`); der öffentliche Schlüssel steht je App in
  `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). Der Workflow bricht ab, wenn er vom Secret
  `TAURI_UPDATER_PUBKEY` abweicht.
- Für einen lokalen `tauri:build` müssen dieselben beiden Variablen gesetzt sein, sonst scheitert das
  Signieren der Update-Dateien. `tauri:dev` braucht sie nicht.
- Versionen ohne Updater (Flächenrechner bis 0.9.4, GRZ-Nachweis bis 0.2.3, Kostenermittlung 0.1.0) müssen
  einmal von Hand über den Installer aktualisiert werden.

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
