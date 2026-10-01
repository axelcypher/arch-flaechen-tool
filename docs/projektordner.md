# Projektordner

Das Tool **Projektordner** (`apps/ordner`, eigene App mit eigenem Installer) legt für ein neues Projekt den
Ordnerbaum, die Vorlagen und die Stammdaten nach einheitlichem Schema an und prüft vorhandene Projektordner
gegen dieses Schema.

Grundsatz: Es wird **nur neu angelegt**. Vorhandene Ordner und Dateien bleiben unverändert – nichts wird
überschrieben, verschoben, umbenannt oder gelöscht. Vor dem Anlegen zeigt der Trockenlauf, was passiert.

## Neues Projekt

Links die Stammdaten, rechts der Trockenlauf.

- **Stammdaten:** Projektnummer, Kurzname, Bezeichnung, Adresse des Bauvorhabens, Grundstück, Bauherr mit
  Kontakten, beauftragte Leistungsphasen, Bearbeitung, Beteiligte (Rolle, Name, Kontakt).
- **Stammordner:** der Ordner, in dem alle Projektordner liegen (Server, Cloud-Ordner oder lokal). Er wird
  einmal gewählt und bleibt eingestellt.
- **Projektnummer:** Das Tool schlägt die nächste freie Nummer vor – die höchste laufende Nummer unter den
  Ordnern des Stammordners (im laufenden Jahr, wenn das Schema ein Jahr enthält) plus eins. Es ist ein
  Vorschlag: Das Feld bleibt frei, und wer die Nummern im Büro vergibt, entscheidet.
- **Trockenlauf:** der vollständige Plan als Baum – jeder Ordner und jede Datei mit Herkunft (Struktur,
  Vorlage, Stammdaten, leere Flächenberechnung) und dem Vermerk „neu“ oder „vorhanden“. Was es schon gibt,
  bleibt unverändert; ein zweiter Lauf ergänzt nur, was fehlt (z. B. nach dem Beauftragen weiterer
  Leistungsphasen).
- **Projektordner anlegen:** führt den Plan aus und meldet, was angelegt wurde, was schon da war und was
  fehlgeschlagen ist. Ein Fehler in einem Schritt hält die übrigen nicht auf.

Angelegt werden

1. die **Ordner** der Struktur – an Leistungsphasen gebundene nur, wenn eine davon beauftragt ist (ohne
   Angabe von Leistungsphasen alle),
2. die **Vorlagen** aus dem Vorlagenordner, mit ersetzten Platzhaltern,
3. **`projekt.json`** mit den Stammdaten im Projektordner – die zentrale Quelle für Nummer, Bauherr und
   Leistungsphasen,
4. eine **leere Flächenrechner-Datei** (`.oap`) mit den Projektdaten. Flächenrechner, GRZ-Nachweis und
   Kostenermittlung öffnen sie; Projektcode, Adresse, Grundstück und Bauherr sind schon eingetragen.

## Struktur

Ordnerbaum und Namensschemata gehören dem Büro, nicht dem Tool. Die Struktur lässt sich als JSON-Datei
speichern, weitergeben und laden; die eingebaute Vorgabe ist neutral (nach Dokumentart: Projekt, Grundlagen,
Pläne, Berechnungen, Schriftverkehr, Protokolle, Genehmigung, Ausschreibung, Bauleitung, Fotos).

| Einstellung | Vorgabe | Platzhalter |
|---|---|---|
| Projektnummer | `{jahr}-{nr:3}` → 2026-014 | `{jahr}`, `{jj}`, `{nr}` bzw. `{nr:3}` (führende Nullen) |
| Name des Projektordners | `{nummer} {kurzname}` | `{nummer}`, `{kurzname}`, `{jahr}` |
| Dateinamenschema für Pläne | `{nummer}_{plannummer}_{index}_{titel}` | dazu `{datum}` |
| Leere Flächenrechner-Datei | `03 Berechnungen/Flächen/{nummer} {kurzname}.oap` | leer = keine |

Die **Ordnerliste** ist ein Text mit einer Zeile je Ordner, Unterordner mit `/`. Zusätze nach `|`:

```
02 Pläne/Entwurf | Dateischema
02 Pläne/Ausführung | LPh 5 | Dateischema
07 Ausschreibung | LPh 6-7
```

- `LPh 5`, `LPh 6-7`, `LPh 4, 8` – der Ordner entsteht nur, wenn eine dieser Leistungsphasen beauftragt ist.
- `Dateischema` – Dateien in diesem Ordner werden im Prüfmodus gegen das Dateinamenschema geprüft.

Unzulässige Zeichen in Namen (`\ / : * ? " < > |`) werden entfernt.

## Vorlagen

Vorlagen liegen in einem eigenen **Vorlagenordner**, nicht im Tool. Er ist aufgebaut wie ein Projektordner:
Jede Datei wird an denselben Ort im Projekt kopiert. Eine `LIESMICH.txt` im Stamm, Systemdateien und
Sperrdateien von Office werden nicht kopiert; Vorlagen in Ordnern nicht beauftragter Leistungsphasen bleiben weg.

„Muster-Vorlagen in einen Ordner schreiben“ (unter **Struktur**) legt einen Ausgangspunkt an – Projektblatt,
Planliste, Besprechungsprotokoll – und stellt den Ordner als Vorlagenordner ein. Die Muster sind zum Ersetzen
durch die eigenen Dateien gedacht.

Platzhalter:

- in **Datei- und Ordnernamen** in einfachen Klammern: `{nummer} Projektblatt.docx`
- im **Inhalt** in doppelten Klammern, mit denselben Namen wie in den Excel-Vorlagen der anderen Werkzeuge:
  `{{projekt.nummer}}`, `{{projekt.kurzname}}`, `{{projekt.name}}`, `{{projekt.adresse}}`,
  `{{grundstueck.flurtext}}`, `{{bauherr.name}}`, `{{bauherr.adresse}}`, `{{bauherr.email}}`,
  `{{projekt.bearbeiter}}`, `{{projekt.leistungsphasen}}`, `{{beteiligte}}`, `{{datum}}`, `{{datum.iso}}` …
  Die vollständige Liste steht im Tool unter **Struktur**.

| Dateiart | Was passiert |
|---|---|
| Text (`.md`, `.txt`, `.csv`, `.json`, `.html`, `.xml` …) | Platzhalter im Text ersetzt |
| Excel (`.xlsx`) | Vorlagen-Engine der anderen Werkzeuge: Einzelwerte, dazu eine Zeile je Beteiligtem (`{{beteiligter.rolle}}`, `{{beteiligter.name}}`, `{{beteiligter.kontakt}}`) bzw. je Leistungsphase (`{{lph.nr}}`, `{{lph.name}}`) – siehe [Excel-Vorlagen](excel-vorlagen.md) |
| Word (`.docx`) | Platzhalter im Text, in Kopf- und Fußzeilen. Ein Platzhalter muss in einem Zug getippt sein – wechselt mittendrin die Formatierung, zerlegt Word ihn, und er wird nicht erkannt |
| alles andere (PDF, DWG, Bilder …) | unverändert kopiert |

Unbekannte Platzhalter bleiben stehen, damit Tippfehler auffallen.

## Ordner prüfen

Ein vorhandener Projektordner wird eingelesen und mit der Struktur verglichen. Gemeldet werden

- `projekt.json`: vorhanden, fehlt oder nicht lesbar; mit Stammdaten gilt deren Auswahl der Leistungsphasen,
- der **Ordnername**, wenn er nicht dem Schema und den Stammdaten entspricht,
- **fehlende Ordner** der Struktur,
- **zusätzliche Ordner** auf Ebenen, die die Struktur vorgibt (Stamm und Ordner mit vorgegebenen Unterordnern),
- **lose Dateien** im Projektordner,
- Dateien in den Planordnern, die nicht dem **Dateinamenschema** folgen (mit der Projektnummer aus den
  Stammdaten),
- **überlange Pfade** (mehr als 200 Zeichen ab dem Projektordner – mit Laufwerk und Stammordner droht die
  Windows-Grenze von 260 Zeichen).

Das Tool meldet nur. Zwei Dinge lassen sich von hier aus tun, beide legen nur neu an: **fehlende Ordner
anlegen** und die **Stammdaten übernehmen**, um unter „Neues Projekt“ fehlende Vorlagen nachzutragen.

## Desktop und Browser

Ordner anlegen und einlesen kann nur die Desktop-App. Die Web-Version liefert den Projektordner als
**ZIP-Datei** zum Entpacken und liest Vorlagen- bzw. Projektordner über den Dateidialog (nur lesend; leere
Ordner erkennt der Browser dabei nicht).

Die Desktop-App greift nur auf Ordner zu, die im Dialog gewählt wurden, und ihre Befehle können ausschließlich
neue Ordner und Dateien anlegen ([apps/ordner/src-tauri/src/lib.rs](../apps/ordner/src-tauri/src/lib.rs)).

## `projekt.json`

```json
{
  "format": "projektordner",
  "version": 1,
  "nummer": "2026-014",
  "kurzname": "EFH Musterweg",
  "bezeichnung": "Neubau eines Einfamilienhauses",
  "adresse": { "strasse": "Musterweg 3", "plz": "48143", "ort": "Münster" },
  "grundstueck": { "gemarkung": "", "flur": "", "flurstueck": "" },
  "bauherr": { "name": "…", "adresse": { "strasse": "", "plz": "", "ort": "" }, "kontakte": [{ "art": "email", "wert": "…" }] },
  "bearbeiter": "TP",
  "leistungsphasen": [1, 2, 3, 4],
  "beteiligte": [{ "rolle": "Tragwerk", "name": "…", "kontakt": "…" }],
  "angelegt": "2026-10-01",
  "struktur": "Standard",
  "dateischema": "{nummer}_{plannummer}_{index}_{titel}"
}
```

## Grenzen

- Kein Archivieren (Projekt abschließen, als ZIP exportieren) und keine Obsidian-Projektnotiz.
- Die Planliste ist eine Vorlage, keine Verwaltung – Revisionen und Verteiler führt das Tool nicht.
- Die Nummernvergabe ist ein Vorschlag aus den vorhandenen Ordnern. Legen zwei Personen gleichzeitig an,
  erkennt das Tool die Kollision erst am vorhandenen Ordner – und überschreibt auch dann nichts.
