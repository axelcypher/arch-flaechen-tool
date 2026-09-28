# Excel-Vorlagen

Der Excel-Export (Schaltfläche **Excel**) erzeugt entweder das Standardlayout oder füllt eine eigene
Vorlage. Eine Vorlage ist eine normale `.xlsx`-Datei – mit Logo, Kopf, Schriften, Rahmen, Zahlenformaten
und eigenen Formeln – in die Platzhalter geschrieben werden. Sie wird in der Anwendung hinterlegt und bei
jedem Export wiederverwendet. **Muster-Vorlage herunterladen** liefert eine Beispieldatei mit den Blättern
Wohnflächen, BGF, BRI (Rechenweg), Räume und einer Platzhalter-Übersicht.

## Grundprinzip

| Schreibweise | Wirkung |
|---|---|
| `{{projekt.name}}`, `{{projekt.code}}`, `{{datum}}`, `{{summe.bgf}}` | Einzelwert |
| `{{geschoss:EG.bri}}`, `{{wohnung:WE 01.wofl}}` | Wert eines bestimmten Geschosses / einer Wohnung |
| `{{raum.name}}` in einer Zeile | **Zeile** wird je Raum wiederholt (ebenso `geschoss`, `wohnung`, `nutzung`, `bri`) |
| `{{#geschoss}}` … `{{/geschoss}}` | **Zeilenblock** wird je Geschoss wiederholt; Blöcke lassen sich verschachteln |
| `{{raum[wofl].name}}` | Wiederholung mit **Filter** |
| `{{geschoss.name\|einmal}}` | Wert nur in der **ersten** Zeile einer Wiederholung |

Steht in einer Zelle nur ein Platzhalter, wird der Wert als **Zahl** eingetragen – das Zahlenformat der
Vorlagenzelle (z. B. `#.##0,00 "m²"`) bleibt erhalten und Excel rechnet damit weiter. Unbekannte
Platzhalter bleiben sichtbar stehen, damit Tippfehler auffallen.

## Blöcke

Ein Block beginnt mit `{{#geschoss}}` und endet mit `{{/geschoss}}`. Die Markierung kann

- **allein in einer Zeile** stehen – diese Steuerzeile erscheint nicht in der Ausgabe, oder
- **in der ersten bzw. letzten Zeile des Blocks** vor/hinter anderem Inhalt, z. B. `{{#geschoss}}{{geschoss.name|einmal}}`.

Innerhalb eines Geschossblocks laufen `{{raum.…}}`- und `{{bri.…}}`-Zeilen nur über die Räume bzw.
Teilkörper **dieses** Geschosses. Geschosse, für die eine Wiederholungszeile im Block keinen Datensatz
liefert (z. B. ein Kellergeschoss ohne Wohnfläche im Abschnitt „Wohnflächen“), **entfallen**.

Weitere Blockarten: `{{#wohnung}}` (Räume je Wohnung), `{{#nutzung}}` (Räume je Nutzungsgruppe),
`{{#raum}}` (mehrzeilige Angaben je Raum).

### Beispiel: Wohnflächen mit Haupt- und Nebenflächen

| | A | B | C | D |
|---|---|---|---|---|
| 10 | Wohnflächen (Hauptnutzfläche) | | WoFl | WoFl Summe |
| 11 | `{{#geschoss}}` | | | |
| 12 | `{{geschoss.name\|einmal}}` | `{{raum[wofl].name}}` | `{{raum[wofl].wofl_roh}}` | |
| 13 | | | | `=SUMME(C12:C12)` |
| 14 | | | | |
| 15 | `{{/geschoss}}` | | | |
| 16 | Brutto-Wohnflächen gesamt | | | `=SUMME(D13:D13)` |
| 17 | Abzug 3% Ausbau, Putz etc. | | | `=-RUNDEN(D16*0,03;2)` |
| 18 | Netto-Wohnflächen gesamt | | | `=D16+D17` |
| 20 | Neben-Nutzflächen | | | |
| 21 | `{{#geschoss}}{{geschoss.name\|einmal}}` | `{{raum[nebenflaeche].name}}` | `{{raum[nebenflaeche].flaeche_roh}}` | |
| 22 | | | | `=SUMME(C21:C21)` |
| 23 | `{{/geschoss}}` | | | |
| 24 | Brutto-Nebenflächen gesamt | | | `=SUMME(D22:D22)` |

Ergebnis: je Geschoss steht der Name einmal links, darunter alle Räume, dann die Zwischensumme.
`=SUMME(C12:C12)` wird je Geschoss auf dessen Raumzeilen erweitert, `=SUMME(D13:D13)` auf alle
Zwischensummen, und die Bezüge darunter (`D16`, `D17`) rutschen mit.

> **Putzabzug:** Übernimmt der Import einen Putzabzug je Raum (z. B. 3 % aus Archicad), enthalten
> `raum.flaeche` und `raum.wofl` diesen bereits. Wird der Abzug – wie oben – in Excel gerechnet,
> `raum.flaeche_roh` bzw. `raum.wofl_roh` verwenden, sonst würde doppelt abgezogen.

## Formeln

Formeln der Vorlage bleiben erhalten und werden auf die erzeugten Zeilen umgeschrieben:

- Bezug auf die **eigene** Zeile (z. B. `=C12*D12` in einer Raumzeile) → jeweils die eigene Ausgabezeile
- Bezug auf eine Zeile im **selben Block** → die Zeile derselben Blockwiederholung
- **Bereich** über Vorlagenzeilen → alle daraus erzeugten Zeilen (innerhalb des Blocks bzw. über alle Blöcke);
  zusammenhängend als `C11:C17`, sonst als Liste `D13,D21,D29` – so zählt eine Gesamtsumme über die
  Zwischensummen nicht versehentlich die Einzelwerte derselben Spalte mit
- Bezüge auf Zeilen **unterhalb** rutschen mit
- Bezug auf eine Zeile, die keine Ausgabe erzeugt hat → `0`

Die Ergebnisse der Formeln werden beim Export mitberechnet und gespeichert, sodass auch Vorschauen
und LibreOffice Werte zeigen (unterstützt: Grundrechenarten, SUMME, RUNDEN, AUFRUNDEN, ABRUNDEN, ABS,
MIN, MAX, MITTELWERT, ANZAHL, WENN). Excel rechnet beim Öffnen ohnehin alles neu.

Bezüge aus *anderen* Blättern auf ein Blatt mit Wiederholungen werden nicht angepasst – dafür die
`summe.*`- oder `geschoss:NAME.*`-Platzhalter verwenden.

## BRI mit Rechenweg

Die Sammlung `bri` enthält den **Rechenweg des Brutto-Rauminhalts**: je BGF-Umriss die Teilkörper mit

`Volumen = anzahl × flaeche × hoehe × faktor` (bei Rechtecken `flaeche = laenge × breite`).

| Umriss | Teilkörper | Anzahl | Faktor |
|---|---|---|---|
| ohne Dach | Quader | 1 | 1 |
| Pultdach | Grundkörper bis Traufe + Keil | 1 | ½ |
| Satteldach | Grundkörper + Dreiecksprisma | 1 | ½ |
| Walm-/Zeltdach | Grundkörper + Mittelteil (Prisma) + Walmenden | 1 / 2 | ½ / ⅓ |
| Krüppelwalm | Grundkörper + Satteldach − Krüppelwalm-Abzug | 1 / −2 | ½ / ⅙ |
| Mansarddach | Grundkörper + unten Quader + Seitenkeile + oben Prisma | 1 / 2 / 1 | 1 / ½ / ½ |
| Tonnendach | Grundkörper + Kreisabschnitt | 1 | Formfaktor ≈ 0,67 |
| Sheddach | Grundkörper + Keile | n | ½ |
| Mansardwalm, unregelmäßige Grundrisse, Dach aus IFC | Grundfläche × mittlere Höhe (exakt berechnet) | 1 | 1 |
| Abzugsflächen | wie oben, negative Anzahl | −1 … | |

Die Summe der Teilkörper entspricht exakt dem berechneten BRI. `bri.formel` enthält den Rechenweg als
Text (z. B. `12,00 × 9,00 × 3,151 × ½`). Beispiel (Blatt „BRI“ der Muster-Vorlage):

| | A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|---|
| 11 | `{{#geschoss}}{{geschoss.name}}` | | | | | | | | |
| 12 | `{{bri.umriss}}` | `{{bri.bezeichnung}}` | `{{bri.anzahl}}` | `{{bri.laenge}}` | `{{bri.breite}}` | `{{bri.flaeche}}` | `{{bri.hoehe}}` | `{{bri.faktor}}` | `=C12*F12*G12*H12` |
| 13 | | Summe `{{geschoss.name}}` | | | | | | | `=SUMME(I12:I12)` |
| 14 | `{{/geschoss}}` | | | | | | | | |
| 15 | Brutto-Rauminhalt gesamt | | | | | | | | `=SUMME(I13:I13)` |

## Filter

| Filter | Bedeutung |
|---|---|
| `wofl` / `wohnflaeche` | Räume mit Wohnflächenanrechnung (WoFlV-Kategorie ≠ „keine“) |
| `nebenflaeche` | Räume ohne Wohnflächenanrechnung |
| `hnf` / `nnf` | NUF 1–6 bzw. NUF 7 |
| `nuf` / `tf` / `vf` | Nutzungsfläche, Technikfläche, Verkehrsfläche |
| `r` / `s` | Raumumschließung Regel- bzw. Sonderfall |
| `abzug` | Abzugsflächen |
| `feld=wert`, `feld!=wert` | beliebiges Feld, z. B. `raum[geschoss=EG]`, `raum[wohnung=WE 01]` |
| `!filter` | Verneinung, z. B. `raum[!abzug]` |

Mehrere Filter mit Komma: `{{raum[wofl,!abzug].name}}`. Filter gelten auch für Blöcke: `{{#geschoss[name!=Spitzboden]}}`.

Ein Filter gilt für die **ganze Zeile**: Steht in einer Zeile `{{raum.nummer}}`, `{{raum.name}}` und
`{{raum[wofl].wofl}}`, werden nur Wohnflächen-Räume ausgegeben. Stehen mehrere verschiedene Filter in
einer Zeile, müssen alle zutreffen.

Ob ein Raum zur Wohnfläche zählt, legt die WoFlV-Kategorie im Raum fest („keine Wohnfläche“ = nicht
angerechnet). Beim IFC-Import mit „als Wohnfläche anrechnen“ werden Keller-, Technik-, Treppen-,
Garagen- und Dachbodenräume sowie Räume in Keller-/Untergeschossen automatisch ausgenommen; in den
Geschosseigenschaften lässt sich das je Geschoss neu zuordnen („automatisch nach Raumname“ / „keine“).

## Verfügbare Werte

Die vollständige Liste steht im Excel-Dialog unter **Platzhalter anzeigen** und im Blatt „Platzhalter“
der Muster-Vorlage.

## Einschränkungen

- Nur `.xlsx` (kein `.xls`/`.xlsm`)
- Der Bereich oberhalb der ersten Wiederholung (Kopf, Logo) bleibt unverändert. Bilder und Logos der
  Vorlage – auch in Kopf-/Fußzeile und als Blatthintergrund – werden unverändert übernommen, aber im
  wiederholten Bereich nicht vervielfältigt (ebenso bedingte Formatierungen und Datenüberprüfungen)
- Verbundene Zellen werden je Zeile übernommen, mehrzeilige Verbünde im wiederholten Bereich nicht
