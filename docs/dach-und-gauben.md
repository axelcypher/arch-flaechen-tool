# Dachform und Gauben: Berechnung und Erkennung

Wie der Flächenrechner den Brutto-Rauminhalt (BRI) von Dächern und Gauben berechnet, wie er ihn in
Rechenweg und Excel-Vorlage ausweist und wie er Dachform und Gauben aus einem IFC-Modell ableitet.

## 1. Dachform

### Geometrie

Um den BGF-Umriss wird ein Rechteck in Firstrichtung gelegt: **L** in Firstrichtung, **B** quer dazu.
Die Firstrichtung folgt der längsten Außenkante oder wird im Dach-Editor gedreht.

Jede Dachfläche ist eine Ebene, die an der Traufe (Außenwand) auf **Traufhöhe** beginnt und mit ihrer
Neigung ansteigt. Die Dachhaut ist an jeder Stelle die niedrigste dieser Ebenen (Satteldach: zwei
Ebenen, Walmdach: vier). Das Volumen vom Fußboden bis zur Dachhaut wird Fläche für Fläche exakt
integriert (Polygon-Clipping) – es stimmt deshalb auch für Umrisse, die kein Rechteck sind.

### Ausweisung

Für Rechenweg und Excel-Vorlage (Sammlung `koerper`) wird das Volumen je Umriss aufgeteilt in

- **Grundkörper bis Traufe:** `L × B × H_Traufe` (bzw. `A × H` bei unregelmäßigem Grundriss)
- **Dachkörper über der Traufe** mit geschlossener Formel (α = Dachneigung):

| Dach | Firsthöhe H | Formel |
|---|---|---|
| Pultdach | B × tan α | `L × B × H / 2` |
| Satteldach | B/2 × tan α | `L × B × H / 2` |
| Walm-/Zeltdach, alle Flächen gleich geneigt | B/2 × tan α | `B × H × (3 × L − B) / 6` |
| Walmdach, eigene Walmneigung | B/2 × tan α | `B × H × (3 × L − 2 × a) / 6`, a = H / tan α_Walm (Walmtiefe) |
| Krüppelwalmdach | B/2 × tan α | `L × B × H / 2 − a × b × h / 3` (h, b, a: Höhe, Breite, Tiefe des Krüppelwalms) |
| Mansarddach | Hu + Ho | `L × (Hu × (B − d) + Bo × Ho / 2)` |
| Tonnendach | Stich f | `L × A` (A = Kreisabschnitt über B mit Stich f) |
| Sheddach | Shedhöhe h | `L × B × h / 2` |
| unregelmäßiger Grundriss, Mansardwalm, Dach aus IFC | – | `A × hm` (Grundfläche × mittlere Höhe) |

Beispiel: Walmdach 45° über 12,00 × 10,75 m, H = 5,375 m:
`10,75 × 5,375 × (3 × 12 − 10,75) / 6 = 243,16 m³`.

Die Rechnung (`koerper.rechnung`) zeigt die Maße auf den Millimeter, damit sie nachgerechnet werden kann.
Mit auf 5,38 m gerundeter Höhe käme man auf 243,39 m³.

## 2. Gauben

Eine Gaube steht auf der Dachfläche einer Traufseite. Gezählt wird nur der Raum **über** der
Dachfläche – der Teil darunter steckt bereits im Dachkörper.

| Größe | Bedeutung |
|---|---|
| α | Neigung der Hauptdachfläche (Mansarddach: untere, steile Fläche) |
| B | Breite der Gaube (in Firstrichtung, Außenkante Wangen) |
| T | waagerechte Tiefe von der Vorderwand bis zum Anschluss an das Hauptdach |
| β | Neigung des Gaubendachs (Schleppgaube) |
| γ | Neigung des Gaubendachs (Satteldachgaube) |
| h | Wandhöhe der Vorderwand über der Dachfläche (Satteldachgaube) |

### Schleppgaube

Das Gaubendach mit Neigung β trifft nach der Tiefe T auf das Hauptdach. Die Vorderwand ragt deshalb
`hf = T × (tan α − tan β)` über die Dachfläche. Im Schnitt ist der Körper ein Dreieck (T × hf / 2),
mal Breite B:

```
V = B × T² × (tan α − tan β) / 2
```

Beispiel: `4,2 × 4,115² × (tan 45° − tan 25°) / 2 = 18,98 m³`

### Flachdachgaube

Wie die Schleppgaube mit β = 0:

```
V = B × T² × tan α / 2
```

### Satteldachgaube

Die Vorderansicht besteht aus einem Rechteck B × h und einem Giebeldreieck mit der Höhe
`Hg = B/2 × tan γ`. Jeder Punkt der Vorderansicht in der Höhe y über der Dachfläche reicht waagerecht
`y / tan α` nach hinten, bis er auf die Dachfläche trifft. Aufsummiert über die Vorderansicht:

```
V = B × (h² + Hg × (h + Hg / 3)) / (2 × tan α)
```

Die Tiefe bis zum Anschluss des Firsts ist `T = (h + Hg) / tan α`.

### Einordnung

- Das Gaubenvolumen kommt zum BRI des Umrisses hinzu und erscheint im Rechenweg und in der
  Excel-Vorlage als eigener Körper nach dem Dach (`koerper.art` = „Gaube“, Filter `[gaube]`).
- Die Formeln sind gegen die 3D-Geometrie nachgerechnet und stimmen auf 0,2 %.
- Sie setzen voraus, dass die Gaube ganz auf der Hauptdachfläche steht. Reicht sie in eine Walmfläche
  hinein, liegt das tatsächliche Volumen etwas höher (im Test etwa 1 %) – wie in der Handrechnung üblich.
- Der Dach-Editor warnt, wenn eine Gaube über den First oder seitlich über das Dach hinausragt oder
  das Gaubendach einer Schleppgaube nicht flacher als das Hauptdach ist.

## 3. Erkennung aus einem IFC-Modell

Beim IFC-Import (Option „Dachform und Gauben erkennen“) oder später über die Schaltfläche im
Dach-Editor wird das Dach aus dem Modell in eine Dachform mit Formeln übersetzt. Das geht nur für den
obersten Abschluss eines Umrisses – nicht, wenn darüber ein Geschoss mit BGF liegt oder der BRI des
Geschosses auf die Geschosshöhe begrenzt ist.

1. **Dachhaut abtasten:** Über dem Umriss wird ein Raster gelegt (etwa 5 cm, bei großen Gebäuden
   entsprechend gröber). Für jede Zelle wird die oberste Dachebene des Modells bestimmt; gleiche Ebenen
   werden zusammengefasst.
2. **Hauptdachflächen:** Das sind die Ebenen, die an der Traufe am tiefsten liegen. Eine große Gaube
   kann mehr Fläche haben als der Rest der Dachfläche, liegt an der Traufe aber höher. Daraus folgen
   - die Firstrichtung (an den Wänden ausgerichtet),
   - die Dachform, je nachdem, in welche Richtungen die Flächen fallen (Flach-, Pult-, Sattel-,
     Walm- oder Krüppelwalmdach),
   - Neigung und Walmneigung,
   - die Traufhöhe als Höhe der Dachebene an der Außenwand.
3. **Gauben:** Was mehr als 8 cm über diese Hauptdachflächen hinausragt, ist eine Gaube.
   - **Maße:** Breite, seitliche Lage und Abstand zur Traufe werden an den Gaubenwänden gemessen,
     damit der Dachüberstand der Gaube nicht mitzählt. Ohne Wände (z. B. bei einer älteren Projektdatei
     ohne gespeicherte IFC-Datei) werden die Maße aus dem Gaubendach genommen und die Gaube ist mit
     „Maße aus dem Gaubendach“ gekennzeichnet.
   - **Art:** eine Fläche in Gefällerichtung → Schleppgaube (β), bei β ≈ 0 Flachdachgaube;
     zwei Flächen quer dazu → Satteldachgaube (γ, Wandhöhe).
   - **Tiefe:** aus der Höhe der Vorderwand, `T = hf / (tan α − tan β)`.
4. **Kontrolle:** Übernommen wird das Ergebnis nur, wenn Dachform plus Gauben den Rauminhalt des
   Modells auf **3 %** treffen. Sonst bleibt es beim Dach aus dem Modell (`A × hm`), und der
   Importbericht bzw. der Dach-Editor nennt den Grund.

Bauteile, deren Name „Gaube“ oder „Dormer“ enthält (z. B. Archicad-Bibliotheksobjekte, die als
`IfcBuildingElementProxy` exportiert werden), gehören zur Dachhaut und zu den Gaubenwänden.

**Nicht erkannt** werden u. a. Walm-, Fledermaus- und Tonnengauben, Mansarddächer, unterschiedlich
geneigte oder versetzte Dachflächen und L-/T-Grundrisse mit mehreren Firsten – den Umriss dann in
Teilflächen mit je eigenem Dach aufteilen.

**Getestet** mit dem Archicad-Beispiel AC20-FZK-Haus (Satteldach 30°, Traufe 0,73 m, Abweichung zum
Modell 0,0 %) sowie mit erzeugten Dachmodellen mit Dachüberstand (Walmdach mit Schleppgaube, Satteldach
mit Satteldach- und Flachdachgaube). Ein echtes Modell mit Gauben war bisher nicht dabei.

## Quellcode

| Datei | Inhalt |
|---|---|
| `src/core/roof.ts` | Dachformen, Dachebenen, exakte Volumenberechnung, 3D-Körper |
| `src/core/gaube.ts` | Gauben: Maße, Formeln, 3D-Körper |
| `src/core/rechenweg.ts` | Rechenweg (Teilkörper) und Körper mit geschlossenen Formeln (`koerper`) |
| `src/core/roofFit.ts` | Erkennung von Dachform und Gauben aus dem Modell |
| `src/core/ifcImport.ts` | IFC-Import, ruft die Erkennung auf |
