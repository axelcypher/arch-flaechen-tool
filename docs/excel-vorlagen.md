# Excel-Vorlagen

Der Excel-Export (Schaltfläche **Excel**) erzeugt entweder das Standardlayout oder füllt eine eigene
Vorlage. Eine Vorlage ist eine normale `.xlsx`-Datei mit Platzhaltern. Die Vorlage wird in der
Anwendung hinterlegt und bei jedem Export wiederverwendet. Über **Muster-Vorlage herunterladen**
erhält man eine Beispieldatei mit allen Platzhalterarten und einem Hilfeblatt.

## Platzhalter

Platzhalter stehen in doppelten geschweiften Klammern in einer Zelle:

| Art | Beispiel | Wirkung |
|---|---|---|
| Einzelwert | `{{projekt.name}}`, `{{datum}}`, `{{summe.bgf}}` | wird überall im Blatt ersetzt |
| Wert eines Geschosses | `{{geschoss:EG.bri}}` | Geschoss über seinen Namen |
| Wert einer Wohnung | `{{wohnung:WE 01.wofl}}` | Wohnung über ihren Namen |
| Wiederholungszeile | `{{raum.name}}`, `{{geschoss.bgf}}`, `{{wohnung.wofl}}`, `{{nutzung.flaeche}}` | die **ganze Zeile** wird je Raum/Geschoss/Wohnung/Nutzungsgruppe wiederholt |

Steht in einer Zelle nur ein Platzhalter, wird der Wert als **Zahl** eingetragen – das Zahlenformat der
Vorlagenzelle (z. B. `#.##0,00`) bleibt erhalten und Excel kann damit rechnen. Text mit mehreren
Platzhaltern (z. B. `Projekt {{projekt.name}}, Stand {{datum}}`) wird als Text zusammengesetzt.
Unbekannte Platzhalter bleiben sichtbar stehen, damit Tippfehler auffallen.

## Formeln

Formeln der Vorlage bleiben erhalten und werden beim Einfügen der Wiederholungszeilen angepasst:

- Bereiche, die in der Vorlagenzeile enden, werden erweitert: `=SUMME(E5:E5)` → `=SUMME(E5:E24)`
- Bezüge unterhalb rutschen mit nach unten
- relative Bezüge in der Vorlagenzeile selbst werden je Zeile fortgeschrieben (`=D5/B5` → `=D6/B6` …)

## Verfügbare Werte

**Einzelwerte:** `projekt.name`, `projekt.adresse`, `projekt.bearbeiter`, `datum`

**Kennwerte** – als `summe.X` (Projekt), `geschoss.X` (Wiederholungszeile) oder `geschoss:NAME.X`:
`bgf`, `bgf_r`, `bgf_s`, `bri`, `bri_r`, `bri_s`, `nuf`, `nuf1` … `nuf7`, `tf`, `vf`, `nrf`, `nrf_r`, `nrf_s`,
`kgf`, `wofl`, `anzahl_raeume`; nur bei Geschossen zusätzlich `name`, `hoehe`, `nr`

**Räume** (`raum.X`): `nr`, `geschoss`, `nummer`, `name`, `nutzung`, `nutzung_text`, `umschliessung`,
`flaeche`, `wofl_kategorie`, `wofl_faktor`, `wofl`, `wohnung`, `abzug`, `bemerkung`

**Wohnungen** (`wohnung.X` bzw. `wohnung:NAME.X`): `nr`, `name`, `anzahl_raeume`, `grundflaeche`, `wofl`

**Nutzungsgruppen** (`nutzung.X`): `gruppe`, `bezeichnung`, `flaeche`

Flächen werden auf zwei Nachkommastellen gerundet übergeben, damit Summen in Excel mit der
Flächenaufstellung übereinstimmen.

## Einschränkungen

- Nur `.xlsx` (kein `.xls`/`.xlsm`)
- Pro Zeile eine Wiederholungsart; verbundene Zellen innerhalb einer Wiederholungszeile werden nicht vervielfältigt
- Bezüge aus *anderen* Blättern auf ein Blatt mit Wiederholungszeilen werden nicht angepasst –
  dafür besser die `summe.*`-Platzhalter verwenden
