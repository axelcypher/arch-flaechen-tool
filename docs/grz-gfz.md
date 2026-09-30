# GRZ, GFZ und Vollgeschosse

Der **GRZ-Nachweis** (`apps/grz`, eigene App mit eigenem Installer) weist das Maß der baulichen Nutzung nach:
Grundflächenzahl, Geschossflächenzahl und Zahl der Vollgeschosse – nach dem Recht, das für den jeweiligen
Bebauungsplan gilt.

## Arbeitsweise

- **Öffnen:** ein Projekt des Flächenrechners (`.oap`/`.akhp`, auch ältere `.json`) oder direkt ein IFC-Modell.
  Gebäudeumrisse, Geschosse, Räume und Dach kommen aus dem Projekt bzw. dem IFC-Import (derselbe Import wie im
  Flächenrechner, mit Dachform- und Gaubenerkennung).
- **Pflegen:** Festsetzungen, Lageplan-Flächen (zeichnen als Polygon oder Rechteck, Nutzung, Versiegelung,
  Nachbar-Kennzeichen), Vollgeschoss je Geschoss festlegen, Aufenthaltsräume einstufen.
- **Speichern:** in dieselbe Projektdatei. Der Flächenrechner zeigt Lageplan und Festsetzungen nicht an,
  bewahrt sie aber beim Speichern; umgekehrt bewahrt der GRZ-Nachweis alles, was der Flächenrechner pflegt.

## Welches Recht gilt

Unter „Festsetzungen“ wird das **Datum des Bebauungsplans** eingetragen (Inkrafttreten bzw. Satzungsbeschluss). Daraus wählt das
Tool zwei Regelwerke; beide lassen sich übersteuern, maßgebend ist die Planurkunde. Ohne Datum gilt das aktuelle
Recht (Vorhaben nach § 34 oder § 35 BauGB).

**BauNVO** (Bundesrecht, gilt in allen Ländern gleich):

| Fassung | Zeitraum | Grundfläche | Geschossfläche |
|---|---|---|---|
| 1962 | bis 31.12.1968 | Nebenanlagen (§ 14) werden nicht angerechnet; Garagen zählen (anrechnungsfrei nur in MK, GE, GI, § 19 Abs. 5) | Vollgeschosse nach Außenmaßen, dazu Aufenthaltsräume in anderen Geschossen |
| 1968/1977 | 01.01.1969 – 26.01.1990 | zusätzlich unberücksichtigt: Balkone, Loggien, Terrassen, Anlagen in Bauwich/Abstandsflächen (§ 19 Abs. 4); überdachte Stellplätze und Garagen bis 0,1 der Grundstücksfläche anrechnungsfrei (§ 21a Abs. 3) | Vollgeschosse, dazu Aufenthaltsräume in anderen Geschossen einschließlich zugehöriger Treppenräume und Umfassungswände (§ 20 Abs. 2) |
| 1990 ff. | ab 27.01.1990 | GRZ I für die Hauptanlage; GRZ II mit Garagen, Stellplätzen und Zufahrten, Nebenanlagen und unterirdischen Anlagen, bis 1,5 × GRZ, höchstens 0,8 (§ 19 Abs. 4) | nur Vollgeschosse (Aufenthaltsräume in anderen Geschossen nur bei Festsetzung) |

**Vollgeschoss** – statische Verweisung auf die Bauordnung NRW zum Zeitpunkt des Plans (OVG NRW, 03.05.2018,
10 A 2937/15):

| Fassung | Zeitraum | Vollgeschoss, wenn … |
|---|---|---|
| BauO NW 1962/1970 | 01.10.1962 – 31.12.1984 | vollständig über der festgelegten Geländeoberfläche und auf mindestens zwei Dritteln der eigenen Grundfläche die lichte Höhe für Aufenthaltsräume (2,50 m; im Einfamilienhaus und im Dachraum 2,30 m). Kellergeschosse, die im Mittel mehr als 1,40 m über das Gelände ragen, werden angerechnet. |
| BauO NW 1984/1995, BauO NRW 2000 | 01.01.1985 – 31.12.2018 | Deckenoberkante im Mittel mehr als 1,60 m über Gelände und Höhe mindestens 2,30 m (bis OK Fußboden darüber bzw. OK Dachhaut). Geneigte Dachflächen: über mehr als drei Viertel der eigenen Grundfläche; Staffelgeschoss: über mehr als zwei Drittel der Grundfläche darunter. |
| BauO NRW 2018 | ab 01.01.2019 | Deckenoberkante im Mittel mehr als 1,60 m über Gelände und lichte Höhe mindestens 2,30 m über mehr als drei Viertel der Grundfläche des Geschosses darunter. |

Nicht automatisch geprüft werden (BauO NW 1962/1970) Geschosse mit mehr als 1,80 m lichter Höhe unterhalb der
Traufenoberkante und Garagengeschosse; sie lassen sich je Geschoss als Vollgeschoss festlegen.

## Lageplan

Der Lageplan ist ein eigener Teil der Projektdatei (kein Geschoss): keine BGF, kein BRI, keine
Geschosshöhe. Er besteht aus **Lageplan-Flächen** mit zwei Merkmalen:

- **Nutzung** (Zufahrt, Stellplatz, Garage/Carport, Terrasse, Weg, Nebenanlage, unterirdische Anlage, Garten,
  sonstige) – entscheidet über die Anrechnung auf die Grundfläche.
- **Versiegelung** (vollversiegelt, teilversiegelt, Grünfläche) – für die Flächenbilanz. Sie entscheidet nach
  verbreiteter Auslegung nicht über die GRZ: Eine Zufahrt aus Rasengitter zählt wie eine gepflasterte.

Flächen von **Nachbargrundstücken** (zur Darstellung, oft größer als ihr Flurstück) werden als „Nachbar“ markiert und
zählen nirgends mit.

Bedienung im Lageplan: Werkzeug „Polygon“ (Punkte setzen, ersten Punkt, Doppelklick oder Enter schließt,
Rück löscht den letzten Punkt, Esc bricht ab) oder „Rechteck“ (zwei Ecken); Ecken von Gebäude und Flächen
werden gefangen. „Auswahl“ wählt eine Fläche, Entf löscht sie. An der ausgewählten Fläche lassen sich die
Ecken ziehen (mit Fang), das Quadrat in der Kantenmitte fügt beim Ziehen eine neue Ecke ein, ein Doppelklick
auf eine Ecke löscht sie (mindestens drei bleiben). Jede Änderung ist ein Rückgängig-Schritt. Mausrad zoomt,
mittlere Maustaste oder Alt+Ziehen verschiebt, „Einpassen“ zeigt alles.

### IFC-Import

- Ein Geschoss, dessen Name „Lageplan“ enthält, wird kein Gebäudegeschoss, sondern der Lageplan – unabhängig
  davon, wo es im IFC einsortiert ist (in Archicad liegt es meist auf Höhe des UG). Es beeinflusst die
  Geschosshöhen nicht. Das gilt auch beim IFC-Import im Flächenrechner.
- Seine Bauteile (Decken, Beläge, Zonen, Objekte, Wände) und das IFC-Gelände (`IfcSite`, z. B. eine
  Garageneinfahrt aus dem Gelände-Werkzeug) werden Lageplan-Flächen. Nutzung und Versiegelung werden aus dem Namen
  vorgeschlagen (z. B. „Zufahrt Rasengitter“ → Zufahrt, teilversiegelt), die Höhe der Oberseite wird übernommen.
- Flächen ohne Verbindung zum Gebäude – auch nicht über andere Flächen – werden als Nachbargrundstück markiert.

### Grundstück und Gelände

- **Grundstücksfläche:** aus den Projektdaten; fehlt sie, aus den eigenen Lageplan-Flächen zusammen mit dem
  Gebäude. Weichen beide voneinander ab, weist der Nachweis darauf hin.
- **Geländeoberfläche:** eingetragener Wert (vor 1985: die festgelegte Geländeoberfläche) oder das Mittel der
  Flächenhöhen entlang der Außenwände – nur wenn Lageplan-Flächen mindestens die Hälfte des Umfangs säumen.
  Sonst wird ±0,00 angenommen.

## Berechnung

- **Hauptanlage:** Vereinigung aller Geschossgrundrisse (BGF-Umrisse abzüglich Abzugsflächen) der Geschosse, deren
  Decke über dem Gelände liegt – als Überdeckung, nicht als Summe. Nach BauNVO 1968/1977 ohne S-Umrisse
  (Balkone, Loggien, Terrassen).
- **Anrechnung der Lageplan-Flächen** je Fassung (siehe Tabelle oben). Wo die Fassung keine eindeutige Antwort gibt
  (z. B. Terrassen nach 1990, Zufahrten vor 1990), steht „prüfen“: Die GRZ wird ohne und mit diesen Flächen angegeben,
  und im Tab lässt sich je Nutzung festlegen, ob sie zählt. Keller-Grundflächen außerhalb der Hauptanlage gelten als
  unterirdische Anlagen.
- **Geschossfläche:** R-Umrisse der Vollgeschosse. Bei Plänen vor 1990 kommen in Nicht-Vollgeschossen die
  Aufenthaltsräume samt zugehörigen Treppenräumen hinzu, erweitert um die Umfassungswände (Wandzuschlag, Standard
  0,25 m) und begrenzt auf den Grundriss. Ob ein Raum Aufenthaltsraum oder Treppenraum ist, ergibt sich aus Name und
  Nutzungsgruppe und lässt sich je Raum festlegen.
- **Höhen:** Das Tool rechnet auf einem Raster über dem Grundriss mit der Höhe bis zur Dachhaut (Dachform mit Gauben
  bzw. IFC-Modell) oder bis zum Fußboden darüber. Lichte Höhe = diese Höhe minus Dachaufbau (Standard 0,30 m,
  einstellbar).

## Ausgabe

- Kennzahlen mit Ampel und Reserve, Vollgeschossprüfung mit Begründung, Geschossfläche je Geschoss,
  Flächenbilanz (Gebäude, voll-/teilversiegelt, grün) und Hinweise.
- **Nachweis drucken** (Strg+P): Nachweis auf A4 hoch – Grundlagen und Festsetzungen, Ergebnis-Tabelle, Lageplan
  mit nummerierten Flächen, Grundfläche je Fläche mit Anrechnung, Vollgeschossprüfung mit Begründung,
  Geschossfläche, vor 1990 die Aufenthaltsräume in Nicht-Vollgeschossen, Flächenbilanz, Hinweise und
  Unterschriftszeile. Über den Druckdialog auch als PDF.
- **Excel …**: Standardlayout (Blatt „GRZ GFZ“ mit Summenformeln) oder eigene Vorlage mit Platzhaltern wie
  `{{grz}}`, `{{gfz}}`, `{{vollgeschosse}}`, `{{bilanz.*}}` und den Sammlungen `geschoss`, `lageplan`, `raum`,
  `hinweis` – siehe [Excel-Vorlagen](excel-vorlagen.md#grz-nachweis). Die Vorlage wird wie im Flächenrechner im
  Projekt mitgespeichert, aber getrennt von dessen Vorlage.

Das Tool rechnet nach und zeigt die angewandte Fassung; die Verantwortung für den Nachweis bleibt bei der
Entwurfsverfasserin bzw. dem Entwurfsverfasser.

## Quellen

- [§ 19 BauNVO](https://www.gesetze-im-internet.de/baunvo/__19.html), [§ 20 BauNVO](https://www.gesetze-im-internet.de/baunvo/__20.html)
- Frühere Fassungen: [BauNVO 1962](https://www.planertreff.de/recht/baunvo/baunvo-1962.html), [BauNVO 1968](https://www.planertreff.de/recht/baunvo/baunvo-1968.html), [BauNVO 1977](https://www.planertreff.de/recht/baunvo/baunvo-1977.html)
- [Stadt Meschede: Vollgeschossbegriff in den Bauordnungen NRW 1962 bis 2018](https://www.meschede.de/fileadmin/Mediendatenbank/Downloads/Planen_und_Bauen/Bauleitplanung/Rechtskraeftige_Bebauungsplaene/Vollgeschoss_Begriff_Vollgeschossigkeit.pdf)
- [AKNW-Rechtstipp zum alten Bauordnungsrecht](https://www.aknw.de/recht/rechtstipps-und-urteile/details/news/rechtstipp-nach-welchen-grundlagen-ermittle-ich-fuer-ein-staffelgeschoss-ob-es-sich-um-ein-vollgeschoss-handelt-wenn-der-bebauungsplan-von-1978-ist-1)
- [BauO NRW 2018](https://recht.nrw.de/lrgv/gesetz/01092026-landesbauordnung-2018-bauo-nrw-2018/)
