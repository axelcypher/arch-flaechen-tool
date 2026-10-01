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
  beim nächsten Öffnen mit.

## Mengen

Alle Mengen werden aus dem Projekt abgeleitet. Ein eingetragener Wert gilt statt des abgeleiteten; ein
geleertes Feld schaltet zurück.

| Kürzel | Menge | Ermittlung |
|---|---|---|
| BGF, BRI, NUF, NRF, TF, VF | Grundflächen und Rauminhalt | DIN 277, wie im Flächenrechner |
| WoFl | Wohnfläche | WoFlV |
| GRF | Gründungsfläche | BGF des untersten Geschosses |
| BGI | Baugrubeninhalt | grob: Gründungsfläche × Tiefe des untersten Fußbodens unter ±0,00 |
| AWF | Außenwandfläche | grob: senkrechte Außenflächen der BGF-Körper (R), einschließlich Öffnungen |
| IWF | Innenwandfläche | grob: (Σ Raumumfänge − Außenumfang) / 2 × Geschosshöhe – nur, wenn Räume erfasst sind |
| DEF | Deckenfläche | BGF der Geschosse über dem untersten |
| DAF | Dachfläche | Oberseiten der BGF-Körper, geneigte Flächen in wahrer Größe, ohne Deckenfläche |
| AUF | Außenanlagenfläche | Grundstücksfläche − überbaute Fläche |
| FBG | Grundstücksfläche | Projektdaten |
| WE | Wohneinheiten | Wohnungen im Projekt |

Die Bauteilmengen sind Näherungen für frühe Leistungsphasen (keine Abzüge für Öffnungen, keine
Bauteilschichten). Für die Kostenberechnung auf Elementebene eigene Mengen eintragen.

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
