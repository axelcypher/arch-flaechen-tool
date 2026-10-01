# Excel-Vorlagen

Der Excel-Export (Schaltfläche **Excel**) erzeugt entweder das Standardlayout oder füllt eine eigene
Vorlage. Eine Vorlage ist eine normale `.xlsx`-Datei – mit Logo, Kopf, Schriften, Rahmen, Zahlenformaten
und eigenen Formeln – in die Platzhalter geschrieben werden. Sie wird im Projekt gespeichert (und im
Projektarchiv `.oap`/`.akhp` mitgenommen) und zusätzlich in der Anwendung als Standard für weitere Projekte
hinterlegt. **Muster-Vorlage herunterladen** liefert eine Beispieldatei mit den Blättern Wohnflächen, BGF,
BRI (Normalgeschosse/Dachgeschoss), BRI Teilkörper, Räume und einer Platzhalter-Übersicht.

## Grundprinzip

| Schreibweise | Wirkung |
|---|---|
| `{{projekt.name}}`, `{{projekt.code}}`, `{{datum}}`, `{{summe.bgf}}` | Einzelwert |
| `{{geschoss:EG.bri}}`, `{{wohnung:WE 01.wofl}}` | Wert eines bestimmten Geschosses / einer Wohnung |
| `{{raum.name}}` in einer Zeile | **Zeile** wird je Raum wiederholt (ebenso `geschoss`, `wohnung`, `nutzung`, `bri`, `koerper`) |
| `{{#geschoss}}` … `{{/geschoss}}` | **Zeilenblock** wird je Geschoss wiederholt; Blöcke lassen sich verschachteln |
| `{{raum[wofl].name}}` | Wiederholung mit **Filter** |
| `{{geschoss.name\|einmal}}` | Wert nur in der **ersten** Zeile einer Wiederholung |

Platzhalter für Einzelwerte funktionieren auch in **Kopf-/Fußzeilen** (Seite einrichten) und in
**Textfeldern/Formen**.

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
`{{#raum}}` (mehrzeilige Angaben je Raum), `{{#koerper}}` (mehrzeilige Angaben je BRI-Körper).

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

## BRI: Normalgeschosse und Dachgeschoss

Normalgeschosse und Dachgeschosse werden unterschiedlich gerechnet: im Normalgeschoss
**Geschosshöhe × BGF**, im Dachgeschoss je Dachkörper mit eigener Formel (Walmdach, Satteldach …).
Dafür gibt es die Sammlung `koerper` – je BGF-Umriss ein **Grundkörper** (Quader bis Geschoss- bzw.
Traufhöhe), bei geneigtem Dach ein **Dachkörper** als Ganzes und je **Gaube** ein eigener Körper
(α = Hauptdachneigung, β/γ = Gaubendachneigung, T = waagerechte Tiefe bis zum Anschluss ans Hauptdach,
h = Wandhöhe über der Dachfläche) – sowie die Filter `[normal]`, `[dg]`, `[dach]`, `[gaube]`.
Herleitung der Formeln: [Dachform und Gauben](dach-und-gauben.md).

Ein Geschoss gilt automatisch als Dachgeschoss, sobald einer seiner BGF-Umrisse eine geneigte Dachform
trägt – ein „Dach aus Modell“ zählt dafür nicht (es steht oft auch über Vordächern oder Anbauten unterer
Geschosse). Ein Körper „bis zur Dachhaut aus dem Modell“ erscheint als Grundkörper mit mittlerer Höhe,
also im Normalgeschoss-Block als Höhe × BGF.
In den Geschosseigenschaften lässt sich das unter **Geschossart** festlegen (automatisch / Normalgeschoss /
Dachgeschoss). Der Filter wirkt auf `geschoss`, `raum`, `bri` und `koerper`.

| Dachform (Rechteck L × B, L in Firstrichtung) | `koerper.formel` |
|---|---|
| Pult-, Sattel-, Sheddach | `L × B × H / 2` |
| Walm-/Zeltdach, gleiche Neigung | `B × H × (3 × L − B) / 6` |
| Walmdach, eigene Walmneigung | `B × H × (3 × L − 2 × a) / 6` (a = Walmtiefe) |
| Krüppelwalmdach | `L × B × H / 2 − a × b × h / 3` |
| Mansarddach | `L × (Hu × (B − d) + Bo × Ho / 2)` |
| Tonnendach | `L × A` (A = Kreisabschnitt) |
| unregelmäßiger Grundriss, Mansardwalm, Dach aus IFC | `A × hm` (Grundfläche × mittlere Höhe) |
| Grundkörper | `L × B × H` bzw. `A × H` |
| Schleppgaube | `B × T² × (tan α − tan β) / 2` |
| Flachdachgaube | `B × T² × tan α / 2` |
| Satteldachgaube | `B × (h² + Hg × (h + Hg / 3)) / (2 × tan α)` (Hg = B/2 × tan γ) |

`koerper.parameter` listet die Maße („H: 5,375 m; B: 10,75 m; L: 12,00 m“), `koerper.rechnung` die Formel
mit eingesetzten Werten („10,75 × 5,375 × (3 × 12 − 10,75) / 6“, Maße auf mm genau – nachrechenbar),
`koerper.volumen` das Ergebnis. Die Summe aller Körper ist exakt der BRI. Beispiel (Blatt „BRI“ der
Muster-Vorlage):

| | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| 10 | Brutto-Rauminhalt | | Geschosshöhe | BGF | BRI | BRI Summe |
| 11 | | `{{koerper[normal,grundkoerper].geschoss}}` | `{{koerper[normal,grundkoerper].hoehe}}` | `{{koerper[normal,grundkoerper].flaeche}}` | `=C11*D11` | |
| 12 | | | | | | `=SUMME(E11:E11)` |
| 14 | `{{#geschoss[dg]}}{{geschoss.name}}` | | | | | |
| 15 | | `{{#koerper}}{{koerper.bezeichnung}}` | | | | |
| 16 | | `{{koerper.parameter}}` | | | | |
| 18 | | | | `{{koerper.formel}} =` | | |
| 19 | | | | `{{koerper.rechnung}} =` | `{{koerper.volumen}}` | |
| 21 | `{{/koerper}}` | | | | | |
| 22 | | | | | | `=SUMME(E19:E19)` |
| 23 | `{{/geschoss}}` | | | | | |
| 25 | Brutto-Rauminhalt gesamt | | | | | `=SUMME(F12:F22)` |

Die Zahlenformate `#.##0,00 "m  *"` und `#.##0,00 "m²  ="` erzeugen die Darstellung „2,40 m \*
48,69 m² =“. Gauben erscheinen im Dachgeschossblock automatisch nach dem Dach, z. B. „Schleppgaube /
Hauptdach α: 45°; Gaubendach β: 25°; T: 4,115 m; B: 4,20 m / 4,2 × 4,115² × (tan 45° − tan 25°) / 2 = 18,98 m³“.

## BRI mit Rechenweg (Teilkörper)

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
Text (z. B. `12,00 × 9,00 × 3,151 × ½`). Beispiel (Blatt „BRI Teilkörper“ der Muster-Vorlage):

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
| `dg` / `normal` | Dachgeschosse bzw. Normalgeschosse (Geschossart) |
| `dach` / `gaube` / `grundkoerper` | nur `koerper`: Dachkörper, Gauben bzw. Grundkörper |
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

## GRZ-Nachweis

Der GRZ-Nachweis (`apps/grz`) nutzt dieselbe Vorlagen-Engine mit eigenen Werten. Seine Vorlage wird getrennt
von der des Flächenrechners gespeichert (im Projektarchiv als eigene Datei, im Browser unter eigenem
Schlüssel); ein Projekt kann also beide Vorlagen enthalten. Das Standardlayout ist die Muster-Vorlage
(Blatt „GRZ GFZ“) ohne Hilfeblatt.

| Schreibweise | Wirkung |
|---|---|
| `{{grz}}`, `{{grz.zulaessig}}`, `{{grz.flaeche}}`, `{{grz.reserve}}`, `{{grz.status}}` | GRZ (vor 1990) bzw. GRZ I; ebenso `grz.ii.*` und `gfz.*` |
| `{{vollgeschosse}}`, `{{vollgeschosse.roemisch}}`, `{{vollgeschosse.namen}}` | Zahl bzw. Namen der Vollgeschosse |
| `{{baunvo.fassung}}`, `{{bauo.fassung}}`, `{{bplan.datum}}` | angewandtes Recht |
| `{{bilanz.gebaeude}}`, `{{bilanz.vollversiegelt}}` … | Flächenbilanz |
| `{{geschoss.name}}`, `{{geschoss.begruendung}}`, `{{geschoss.gf}}` | Zeile je Geschoss; Filter `[vollgeschoss]`, `[!vollgeschoss]` |
| `{{lageplan[eigen].name}}`, `{{lageplan.anrechnung}}` | Zeile je Lageplan-Fläche; Filter `[eigen]`, `[nachbar]`, `[pruefen]`, `[teil]` … |
| `{{raum[gf].name}}` | Räume der Nicht-Vollgeschosse, deren Aufenthaltsräume vor 1990 zur Geschossfläche zählen |
| `{{hinweis.text}}` | Zeile je Hinweis |

Projektangaben (`projekt.*`, `grundstueck.*`, `bauherr.*`, `datum`) sind in allen Apps gleich.

## Kostenermittlung

Die Kostenermittlung (`apps/kosten`) nutzt dieselbe Vorlagen-Engine; ihre Vorlage wird ebenfalls getrennt
gespeichert. Das Standardlayout ist die Muster-Vorlage (Blatt „Kosten“) ohne Hilfeblatt. Beträge sind netto
und auf ganze Euro gerundet.

| Schreibweise | Wirkung |
|---|---|
| `{{gesamt.netto}}`, `{{gesamt.brutto}}`, `{{gesamt.mwst}}`, `{{mwst}}` | Gesamtkosten (Mittel), Umsatzsteuer in € bzw. % |
| `{{gesamt.brutto.von}}`, `{{gesamt.brutto.bis}}` | Bandbreite, ebenso bei `gesamt.netto` |
| `{{kg300}}`, `{{kg300.von}}`, `{{kg330.bis}}`, `{{kg:300.mittel}}` | Summe einer Kostengruppe (1. und 2. Ebene) |
| `{{kennwert.bgf}}`, `{{kennwert.bri}}`, `{{kennwert.nuf}}`, `{{kennwert.wofl}}` | Bauwerkskosten KG 300 + 400 brutto je Einheit (+ `.von`/`.bis`) |
| `{{mengen.bgf}}`, `{{mengen.awf}}` … | Mengen als Einzelwert |
| `{{stufe}}`, `{{stufe.lph}}`, `{{preisstand}}`, `{{katalog}}`, `{{faktor}}` | Grundlagen der Ermittlung |
| `{{kg.kg}}`, `{{kg.name}}`, `{{kg.von}}`, `{{kg.mittel}}`, `{{kg.bis}}` | Zeile je Kostengruppe der 1. Ebene; `kg2.*` für die 2. Ebene |
| `{{#kg}}` … `{{/kg}}` | Block je Kostengruppe; `position`- und `kg2`-Zeilen darin nur für diese Kostengruppe |
| `{{position[aktiv].bezeichnung}}`, `{{position.menge}}`, `{{position.bezug}}`, `{{position.kennwert}}`, `{{position.kosten}}` | Zeile je Position; Filter `[aktiv]`, `[aus]`, `[kg=330]` |
| `{{menge.kurz}}`, `{{menge.wert}}`, `{{menge.ermittlung}}` | Zeile je Menge; Filter `[festgelegt]` |
| `{{stand.datum}}`, `{{stand.stufe}}`, `{{stand.brutto}}` | Zeile je festgehaltenem Kostenstand |
| `{{hinweis.text}}` | Zeile je Hinweis |

## Einschränkungen

- Nur `.xlsx` (kein `.xls`/`.xlsm`)
- Der Bereich oberhalb der ersten Wiederholung (Kopf, Logo) bleibt unverändert. Bilder und Logos der
  Vorlage – auch in Kopf-/Fußzeile und als Blatthintergrund – werden unverändert übernommen, aber im
  wiederholten Bereich nicht vervielfältigt (ebenso bedingte Formatierungen und Datenüberprüfungen)
- Verbundene Zellen werden je Zeile übernommen, mehrzeilige Verbünde im wiederholten Bereich nicht
