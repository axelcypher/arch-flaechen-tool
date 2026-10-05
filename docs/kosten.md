# Massen- und Kostenermittlung (DIN 276)

Die **Kostenermittlung** (`apps/kosten`, eigene App mit eigenem Installer) leitet aus den Flächen und
Rauminhalten des Projekts Mengen ab und rechnet daraus mit Kennwerten die Kosten nach DIN 276 – als
Bandbreite (von / Mittel / bis), nachvollziehbar je Position.

Die Kennwerte sind Eingaben des Büros (eigene Projekte, Kennwertsammlungen, Literatur). Das Tool liefert
keine Preise; es rechnet transparent mit den hinterlegten Werten und dokumentiert Preisstand, Baupreisindex
und Regionalfaktor.

## Arbeitsweise

- **Öffnen:** ein Projekt des Flächenrechners (`.oap`/`.akhp`, auch ältere `.json`) oder direkt ein IFC-Modell
  (derselbe Import wie im Flächenrechner). Ohne Gebäudemodell lassen sich die Mengen von Hand eintragen.
- **Pflegen:** Stufe und Preisstand, Faktoren, Mengen, Positionen mit Kennwerten, Kostenstände.
- **Speichern:** in dieselbe Projektdatei. Flächenrechner und GRZ-Nachweis zeigen die Kostenermittlung nicht
  an, bewahren sie aber beim Speichern (ab Flächenrechner 0.9.4 und GRZ-Nachweis 0.2.3); umgekehrt bewahrt
  die Kostenermittlung alles, was die anderen Apps pflegen. Ändern sich dort Flächen, ändern sich die Kosten
  beim nächsten Öffnen mit. Beim Speichern
  liest jede App die Zieldatei neu und übernimmt, was eine andere App dort inzwischen gespeichert hat, statt es
  mit ihrem eigenen, älteren Stand zu überschreiben (ab Flächenrechner 0.11.0, GRZ-Nachweis 0.4.0,
  Kostenermittlung 0.4.0).

## Mengen

Alle Mengen werden aus dem Projekt abgeleitet. Ein eingetragener Wert gilt statt des abgeleiteten; ein
geleertes Feld schaltet zurück.

| Kürzel | Menge | Ermittlung |
|---|---|---|
| BGF, BRI, NUF, NRF, TF, VF | Grundflächen und Rauminhalt | DIN 277, wie im Flächenrechner |
| WoFl | Wohnfläche | WoFlV |
| GRF | Gründungsfläche | BGF des untersten Geschosses |
| BGI | Baugrubeninhalt | grob: Gründungsfläche × Tiefe des untersten Fußbodens unter ±0,00 |
| AWF | Außenwandfläche | grob: senkrechte Außenflächen der BGF-Körper (R), einschließlich Öffnungen und erdberührter Wände – bis zur Geschosshöhe, im obersten Geschoss bis zur Dachhaut; Wände zwischen aneinanderliegenden Umrissen zählen nicht (nur der Teil über dem niedrigeren Körper) |
| IWF | Innenwandfläche | Wände aus dem IFC-Modell: je Innenwand die Ansichtsfläche einer Seite vom Wandfuß bis zur Oberkante (Länge × Höhe, Öffnungen übermessen, Schrägen in wahrer Größe). Ohne IFC-Modell nur grob aus den Raumumfängen – siehe unten |
| DEF | Deckenfläche | BGF der Geschosse über dem untersten |
| DAF | Dachfläche | Oberseiten der BGF-Körper (R), geneigte Flächen in wahrer Größe; ebene Flächen nur, soweit kein Geschoss darüber liegt (Staffelgeschoss, Anbau). Versätze bis 25 cm zwischen den Geschossen zählen nicht; ohne Dachüberstände |
| AUF | Außenanlagenfläche | Grundstücksfläche − überbaute Fläche |
| FBG | Grundstücksfläche | Projektdaten |
| WE | Wohneinheiten | Wohnungen im Projekt |

Die Bauteilmengen sind Näherungen für frühe Leistungsphasen (keine Abzüge für Öffnungen, keine
Bauteilschichten). Für die Kostenberechnung auf Elementebene eigene Mengen eintragen. Abzugsflächen
(Innenhof, Luftraum) erzeugen weder Wände noch Dachflächen.

### Innenwände aus dem IFC-Modell

Räume können ohne Wand aneinandergrenzen (offene Küche, Flur ohne Tür), deshalb taugen die Raumumrisse nicht
für die Innenwandfläche. Enthält das Projekt ein IFC-Modell (direkt geöffnet oder im Flächenrechner importiert
und mitgespeichert), liest die Kostenermittlung beim Öffnen dessen Wände (`IfcWall`, `IfcWallStandardCase`) und
vermisst jede einzeln: Länge entlang der Achse, Dicke, Ansichtsfläche vom Wandfuß bis zur Oberkante. Türen und
Fenster werden übermessen, raumhohe Durchgänge überbrückt, Giebel und Dachschrägen in wahrer Größe gerechnet.

Welche Wand innen liegt, entscheidet:

- `IsExternal` aus `Pset_WallCommon` – aber nur, wenn das Modell beide Werte enthält. Viele Modelle markieren
  alle Wände als außen (Archicad-Voreinstellung), dann ist die Angabe wertlos;
- sonst die Lage: Eine Außenwand liegt auf ganzer Länge am umschlossenen BGF-Umriss ihres Geschosses.

Außenwände, Wände außerhalb der BGF und Wände unter 0,50 m Höhe (Aufkantungen, Sockel) stehen in der Liste,
zählen aber zunächst nicht. Ohne IFC-Modell bleibt die grobe Näherung (Σ Raumumfänge − Außenumfang) / 2 ×
Geschosshöhe mit einem Hinweis auf ihre Schwäche.

### Teile an- und abwählen

Jede Menge ist eine Summe von Teilen, und jedes Teil lässt sich in **Mengen prüfen** einzeln an- oder abwählen:
mit dem Häkchen im Rechenweg oder per Klick auf das Teil im Grundriss bzw. im 3D-Modell. Abgewählte Teile
erscheinen grau und durchgestrichen und zählen weder zur Menge noch zu den Kosten. Über dem Rechenweg setzen
„alle“, „keine“ und „Standard“ die Auswahl der gewählten Menge auf einmal. Die Auswahl wird im Projekt
gespeichert (nur Abweichungen vom Standard) und gilt auch für Druck, Excel und Kostenstände.

### Mengen prüfen

Keine Menge ist nur eine Zahl: Jede ist die Summe einzelner Teile – Umrisse, Räume, Wand- und Dachflächen –,
und genau diese Teile zeigt die Ansicht **Mengen prüfen** (Werkzeugleiste, oder Klick auf das Kürzel einer
Menge in der Kostenansicht):

- **links** alle Mengen mit ihrem abgeleiteten Wert,
- **in der Mitte** die gewählte Menge im Bild: **Grundrisse** aller Geschosse im selben Ausschnitt (oberstes
  zuerst) oder das **3D-Modell**. Was zählt, ist blau gefüllt und beschriftet, Abzüge sind rot schraffiert,
  der Rest des Projekts steht nur als dünne Linie bzw. blasser Körper da. Geschosse, die zur Menge nichts
  beitragen, sind mit „zählt nicht“ gekennzeichnet,
- **rechts** der Rechenweg: je Teil Geschoss, Bezeichnung, Rechenansatz und Wert; die Summe ist die Menge.

Ein Teil unter dem Mauszeiger wird in Bild und Tabelle gemeinsam hervorgehoben, ein Klick darauf wählt es an
oder ab (siehe oben). Grundflächen, Räume,
Gründung, Decken und Außenanlagen öffnen in den Grundrissen, Rauminhalt, Außenwand und Dach im 3D-Modell
(drehen, zoomen, Geschosse auseinanderziehen); beide Darstellungen lassen sich für jede Menge umschalten.
Ist eine Menge von Hand festgelegt, weist die Ansicht darauf hin – das Bild zeigt immer die abgeleitete Menge.

Die Ansicht zeigt auch Schwächen des Modells: Reicht etwa ein Körper des Rauminhalts weiter nach oben als
erwartet, liegt das an den Umrissen bzw. der Dachzuordnung im Flächenrechner („Dach aus Modell“ ohne
Begrenzung auf die Geschosshöhe) und sollte dort korrigiert werden.

## Positionen

Jede Position gehört zu einer Kostengruppe (dreistellig, 1. bis 3. Ebene) und hat eine Bezugsgröße:

- eine der **Mengen** oben – Kosten = Menge × Kennwert × Faktor
- **eigene Menge** mit Einheit (z. B. 2 Stk Aufzug, 35 m Zaun)
- **pauschal** – ein Betrag
- **% von KG** – Prozentsatz auf die Summe anderer Kostengruppen (z. B. Baunebenkosten auf KG 300 + 400)

Kennwerte werden als **von / Mittel / bis** eingetragen. Fehlt „von“ oder „bis“, gilt der Mittelwert; fehlt
der Mittelwert, wird er aus „von“ und „bis“ gemittelt. Positionen lassen sich ausschalten – sie bleiben
sichtbar, werden aber nicht gerechnet (für Alternativen).

„Gliederung 1. Ebene“ legt leere Positionen für KG 300, 400, 500 und 700 an (Kostenrahmen und
Kostenschätzung, Kennwerte je m² BGF), „Gliederung 2. Ebene“ für KG 310 bis 450 mit Bauteilmengen
(Kostenberechnung). Jede Kostengruppe bekommt dabei ihre übliche Bezugsgröße: Baugrube je m³ BGI, Gründung
je m² GRF, Außenwände je m² AWF, Innenwände je m² IWF, Decken je m² DEF, Dächer je m² DAF, technische
Anlagen je m² BGF, Außenanlagen je m² AUF, Baunebenkosten in % von KG 300 + 400.

Das Tool weist auf **Doppelerfassung** hin, wenn eine Kostengruppe und eine ihr übergeordnete gleichzeitig
gerechnet werden (z. B. KG 300 je m² BGF und zusätzlich KG 330), und auf Positionen ohne Menge oder Kennwert.

## Faktoren und Umsatzsteuer

- **Baupreisindex:** Index zum Stand der Kennwerte und aktueller Index; der Faktor ist aktuell / Stand.
- **Regionalfaktor:** 1,000 = Bundesdurchschnitt.
- Beide wirken auf Kennwerte je Einheit, nicht auf Pauschalen und Prozentsätze.
- Gerechnet wird **netto**; die Umsatzsteuer (Standard 19 %) wird am Ende ausgewiesen. Enthalten die
  Kennwerte die Umsatzsteuer, wird das angekreuzt – sie werden dann vor der Rechnung auf netto umgerechnet.

## Kennwertkatalog

Der Katalog ist eine eigene, austauschbare Datei (JSON oder CSV) mit Name, Quelle, Preisstand und
Baupreisindex. Der zuletzt geladene Katalog bleibt in der Anwendung hinterlegt; übernommene Kennwerte stehen
mit Quelle im Projekt.

- **Katalog laden …** – JSON oder CSV
- **Aus Projektpositionen erstellen** – die Kennwerte eines fertigen Projekts als Katalog für das nächste
- **Als CSV / JSON speichern …**
- Einträge ankreuzen und **als Positionen übernehmen**

CSV aus Excel (Semikolon, Dezimalkomma):

```
# Name: Bürokennwerte
# Quelle: eigene Projekte
# Stand: 1. Quartal 2026
# Index: 131,4
KG;Bezeichnung;Bezug;Grundlage;von;Mittel;bis;Bemerkung
300;Bauwerk – Baukonstruktionen;BGF;;1.500;1.800;2.100;
330;Außenwände;AWF;;;420;;WDVS, verputzt
461;Aufzug;Stk;;;45.000;;
540;Carport;psch;;;30.000;;
700;Baunebenkosten;%;300+400;18;20;22;
```

Spalte **Bezug**: Kürzel einer Menge (`BGF`, `BRI`, `AWF`, `DAF` …), `psch` für pauschal, `%` für Prozent
(mit den Kostengruppen in **Grundlage**); alles andere gilt als Einheit einer eigenen Menge (`Stk`, `m`).
Ohne Angabe gilt die übliche Bezugsgröße der Kostengruppe. Die Zahlen im Beispiel sind Platzhalter, keine
Kennwerte.

## Kostenstände

„Stand festhalten“ speichert die aktuellen Kosten je Kostengruppe und die Mengen mit Datum, Stufe
(Kostenrahmen, -schätzung, -berechnung, -voranschlag, -anschlag, -feststellung) und Bemerkung. Die
Übersicht zeigt **Vorher/Nachher** gegenüber dem gewählten Stand – je Kostengruppe und mit den geänderten
Mengen. So wird sichtbar, was eine Planänderung kostet.

## Ausgabe

- **Kosten drucken** (Strg+P): Kostenermittlung auf A4 hoch – Grundlagen, Kostenübersicht nach Kostengruppen
  mit Bandbreite, Kennwerte des Bauwerks (€/m² BGF, €/m³ BRI …), Positionen mit Menge und Kennwert, Mengen
  mit Ermittlung, Kostenstände, Hinweise und Unterschriftszeile. Über den Druckdialog auch als PDF.
- **Excel …**: Standardlayout (Blatt „Kosten“ mit Summenformeln) oder eigene Vorlage mit Platzhaltern wie
  `{{gesamt.brutto}}`, `{{kg300}}` und den Sammlungen `kg`, `kg2`, `position`, `menge`, `stand`, `hinweis` –
  siehe [Excel-Vorlagen](excel-vorlagen.md#kostenermittlung). Die Vorlage wird im Projekt mitgespeichert,
  getrennt von denen der anderen Apps.

## Grenzen

- Kostenermittlung bis zur Kostenberechnung (Elemente auf der 2. und 3. Ebene). Vergabeeinheiten,
  Nachträge und Ist-Kosten werden nicht erfasst.
- Varianten werden über ausgeschaltete Positionen und Kostenstände verglichen; ein eigener
  Variantenvergleich fehlt.
- Honorarfragen (HOAI, anrechenbare Kosten) sind nicht abgebildet.
