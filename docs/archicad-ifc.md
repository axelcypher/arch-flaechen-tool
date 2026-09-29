# Archicad → Flächenrechner (IFC)

Archicad-Projektdateien (`.pln`) sind ein proprietäres, nicht dokumentiertes Binärformat von
Graphisoft und lassen sich außerhalb von Archicad nicht lesen. Der verlässliche Weg ist der
**IFC-Export**, den Archicad ohne Zusatzsoftware beherrscht. Der Flächenrechner übernimmt daraus:

| Archicad | IFC | Flächenrechner |
|---|---|---|
| Geschosse | `IfcBuildingStorey` (Name, Höhe) | Geschosse mit Fußbodenhöhe; Geschosshöhe = Abstand zum nächsten Geschoss |
| Zonen | `IfcSpace` (Nummer = Name, Zonenname = LongName) | Räume mit Nummer und Bezeichnung, Nutzungsgruppe per Stichwort vorbelegt |
| Nettofläche der Zone | `Qto_SpaceBaseQuantities.NetFloorArea` | Putzabzug je Raum (z. B. 3 % bei Rohbaumaßen) |
| Zonenkörper unter Dachschrägen | 3D-Geometrie der Zone | WoFlV-Faktor aus lichten Höhen (≥ 2 m / 1–2 m / < 1 m), exakt aus den Deckenflächen |
| Wände, Stützen, Fenster, Türen, Vorhangfassaden | Bauteilgeometrie | BGF-Außenumriss je Geschoss, exakt auf die Bauteilkanten eingepasst |
| Dach, Dachdecken | `IfcRoof`, `IfcSlab` (ROOF) | Dachhaut für den BRI („Dach aus Modell“) |
| gesamtes Modell | Bauteilgeometrie | Geschossschnitt (Standard 1,00 m über Fußboden) als hinterlegter Vektorplan je Geschoss |

## BGF und BRI bei Dachgeschossen

Die **BGF** wird je Grundrissebene (Geschoss) auf Fußbodenhöhe ermittelt. Ein Geschoss ohne Wände
und Zonen – typischerweise der **Spitzboden bzw. die Dachspitze**, die in Archicad oft als eigenes
Geschoss oberhalb der lichten Höhe des DG angelegt ist – erhält keinen BGF-Umriss.

Der **BRI** umfasst dagegen die ganze Gebäudehülle bis zur Dachhaut. Beim „Dach aus Modell“ reicht
der Körper eines Umrisses deshalb nur dort bis zum Fußboden des nächsten Geschosses, wo dieses
Geschoss BGF hat (Umriss abzüglich Abzugsflächen). Überall sonst – über einem Luftraum, unter der
Dachspitze eines Spitzbodens ohne BGF oder neben einem kleineren Obergeschoss – geht er bis zur
Dachhaut. So wird die Dachspitze dem DG zugerechnet, ohne doppelt zu zählen. Eine feste Begrenzung
lässt sich je Umriss unter „Höhe begrenzen auf“ eintragen.

## Dachform und Gauben erkennen

Mit der Option **„Dachform und Gauben erkennen“** (Standard) wird das Dach aus dem Modell für den
obersten Abschluss eines Umrisses in eine Dachform mit Formeln übersetzt – damit der BRI in der
Excel-Vorlage wie gewohnt als z. B. *Walmdach B × H × (3 × L − B) / 6* plus *Schleppgaube
B × T² × (tan α − tan β) / 2* erscheint. Übernommen wird das nur, wenn Dachform und Gauben den
Rauminhalt des Modells auf 3 % treffen; sonst bleibt es beim Dach aus dem Modell. Für bereits
importierte Projekte gibt es im Dach-Editor die Schaltfläche **„Dachform und Gauben erkennen“**.

Formeln, Ablauf der Erkennung und Grenzen: [Dachform und Gauben](dach-und-gauben.md).

## Plan zum Prüfen und Korrigieren

Der Geschossschnitt wird als Vektorplan hinterlegt (Layer Wände, Stützen/Träger, Fenster, Türen,
Treppen/Geländer, Decken/Dach, Möblierung, Sonstiges). Umrisse und Räume lassen sich darauf mit
Punkt- und Kantenfang korrigieren oder mit „Erkennen“ neu erzeugen. Schnitthöhe im Importdialog
einstellbar; Layer in den Geschoss-Eigenschaften ein- und ausblenden.

## Empfohlene Exporteinstellungen

*Datei → Speichern unter… → Dateityp „IFC-Dateien“*, Übersetzer z. B. **„Allgemeiner Übersetzer“**
oder ein eigener Übersetzer „Flächenrechner“ (Datei → Interoperabilität → IFC → IFC-Übersetzer):

1. **Zu exportierende Elemente:** gesamtes Projekt (oder alle Geschosse einer Ansicht)
2. **Zonen exportieren:** ein – Zonen werden als `IfcSpace` geschrieben
3. **IFC-Basismengen (Base Quantities):** ein – liefert die Nettoflächen der Zonen (Putzabzug)
4. **Geometrie:** „Extrudiert/Rotiert“ oder BREP – beides wird gelesen
5. **Zonenkategorien als Klassifikation:** optional
6. Schema IFC4 (Reference View) oder IFC2x3 (Coordination View 2.0)

Das Beispiel `AC20-FZK-Haus.ifc` (KIT, Archicad 20) wurde so importiert: BGF 2 × 120,00 m²,
Raumflächen identisch mit den Archicad-Nettoflächen, Wohnfläche der Galerie im Dachgeschoss
74,51 m² (identisch mit Archicad), BRI bis zur Dachhaut.

## Arbeitsablauf

1. In Archicad Zonen für alle Räume anlegen (Zonenstempel mit Nummer und Name).
2. IFC exportieren.
3. Im Flächenrechner **IFC-Import** → Datei wählen → Optionen prüfen → Importieren.
4. In der **3D-Ansicht** kontrollieren, ob die Körper (BRI) zum Modell passen („IFC-Modell“ ein-/ausblenden).
5. Nutzungsgruppen (NUF/TF/VF) und R/S bei Bedarf in den Eigenschaften anpassen.

## Grenzen

- Innenhöfe/Lichthöfe werden als Teil der BGF erkannt – bei Bedarf als Abzugsfläche ergänzen.
- Balkone und auskragende Decken werden nicht automatisch als BGF (S) angelegt.
- Der unterste Geschoss-BRI beginnt an der Fußbodenhöhe des Geschosses; die Bodenplatte bei Bedarf
  über die Geschosshöhe berücksichtigen.
- Ein direkter Live-Abgleich mit dem laufenden Archicad (JSON-/Python-Schnittstelle) wäre möglich,
  ist aber noch nicht umgesetzt.
