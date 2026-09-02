# Merkzahlen

Eine kleine, installierbare Lern-App für historische Merkzahlen der Klassen 7 bis 10. Der vollständige Datensatz reicht von 1096 bis 1990.

## Funktionen

- Karteikarten, Multiple Choice, Tippen und gemischte Runden
- Abfrage in beide Richtungen
- Filter nach Klasse, Zeitraum und Lernstand
- Spaced Repetition mit getrennten neuen, fälligen und unsicheren Karten
- lokale Speicherung ohne Konto
- Sicherung und Wiederherstellung des Lernstands als JSON
- drei reduzierte Farbstile
- installierbare PWA mit Offline-Cache
- eindeutiges Richtig/Falsch-Feedback und Antwortverlauf in jedem Modus
- vollständige Abschlussauswertung mit Frage, Eingabe, Lösung und Fehler-Wiederholung

## Lernstand und Auswertung

Jede bewertete Aufgabe wird genau einmal im Antwortprotokoll gespeichert. Daraus entstehen die Runden-Zähler, die vollständige Auswertung und die gezielte Fehler-Runde. Das Aufdecken einer Karteikarte zählt erst nach der Selbstbewertung. Im Tipp- und Auswahlmodus zählt „Nicht gewusst“ als falsch; eine leere Eingabe allein zählt nicht.

Der Rundenzähler startet bei null und zählt bewertete Antworten, nicht angezeigte Fragen. Die Lernstand-Gruppen Neu, Im Aufbau, Unsicher und Beherrscht sind überschneidungsfrei. Fällig ist eine zusätzliche zeitliche Markierung. Nach einem Fehler ist die Karte sofort fällig und startet wieder bei Lernstufe null. Zwei richtige Antworten in Folge lösen „Unsicher“ auf; ab Stufe fünf gilt eine Karte als beherrscht. Die Abstände richtiger Antworten sind 1, 3, 7, 14, 30 und 60 Tage. Das ist ein transparentes, einfaches Wiederholsystem, kein wissenschaftlich kalibriertes Gedächtnismodell.

Vorhandene Antwortzähler bleiben erhalten. Die Migration korrigiert alte Fehlantworten, die irrtümlich 60 Tage zurückgestellt wurden. Alte Abschlusslisten ohne tatsächliches Antwortprotokoll werden nicht rekonstruiert oder als verifizierte neue Auswertung angezeigt.

Tippantworten werden lokal anhand normalisierter Datumswerte und Schlüsselwörter geprüft, nicht mit einer semantischen KI. Datumsgenauigkeit und alle Ereignisse doppelt vergebener Merkzahlen bleiben erforderlich. Abweichende korrekte Formulierungen können weiterhin eine Selbstprüfung mit der angezeigten Kataloglösung erfordern.

## Lernapp-Referenzen

- [Duolingos Erläuterung des Lernpfads](https://blog.duolingo.com/new-duolingo-home-screen-design/): kleine Einheiten, ein klarer nächster Schritt und integrierte Wiederholung. Übertragen auf diese App: 10-Karten-Schnellstart, Antwortserie und direkter Einstieg in die Fehler-Runde. Keine zusätzlichen Kataloginhalte, Ranglisten oder Herzen.
- [Ankis Lernablauf](https://docs.ankiweb.net/studying.html): erst erinnern, dann vergleichen und ehrlich bewerten; nächster Wiederholungszeitpunkt wird sichtbar. Übertragen: ausdrücklich beschriftete Selbstbewertung, unmittelbares Feedback und verständliche Lernstufen.

## Lokal starten

Da die App ihre Daten mit `fetch` lädt, sollte sie über einen kleinen lokalen Webserver geöffnet werden:

```bash
python3 -m http.server 8000
```

Danach `http://localhost:8000` im Browser öffnen.

## Tests

```bash
npm test
```

Zusätzlich stehen unter `merkzahlen-trainer/tests.html` ein Browser-Testlauf und unter `merkzahlen-trainer/smoke.html` ein einfacher Oberflächentest bereit. GitHub Actions führt die Node-Tests bei Pushes und Pull Requests automatisch aus.

Die Node-Suite enthält vollständige 56-Karten-Durchläufe für jeden Modus in beiden Richtungen. `ui-flow.test.cjs` führt die echten App-Ereignishandler mit einem isolierten DOM-Testdouble aus und prüft auch bewusst falsche Antworten, leere Eingaben, Doppelbewertung, Speicherfehler, Neuladen, vorzeitiges Rundenende und die Zuordnung aller Auswertungseinträge. Diese Tests ersetzen keine visuelle Prüfung im echten Browser. Der Daten-Hash schützt den unveränderten Schulkatalog.

## Daten

Die Merkzahlen liegen in `merkzahlen-trainer/data.json`. Als alleinige Inhaltsquelle gilt der schulische „Merkzahlenkatalog (2025/26)“. Die 56 Katalogzeilen sind strikt so zugeordnet: Klasse 7 enthält 11, Klasse 8 enthält 4, Klasse 9 enthält 24 und Klasse 10 enthält 17 Einträge.

Die doppelt vergebenen Merkzahlen 1919 und 1955 werden in der Richtung „Merkzahl → Ereignis“ jeweils mit beiden zugehörigen Ereignissen abgefragt. In der Gegenrichtung bleiben es einzelne Katalogzeilen.

Jede Karte benötigt:

```json
{
  "id": "eindeutige-id",
  "prompt": "Jahr oder Datum",
  "answer": "Historisches Ereignis"
}
```

## Datenschutz

Fortschritt und Einstellungen bleiben im lokalen Speicher des jeweiligen Browsers. Es werden keine Konten, Tracker oder externen Analysedienste verwendet.

## Lizenz

MIT
