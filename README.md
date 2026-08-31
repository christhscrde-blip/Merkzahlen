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

## Daten

Die Merkzahlen liegen in `merkzahlen-trainer/data.json`. Jede Karte benötigt:

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
