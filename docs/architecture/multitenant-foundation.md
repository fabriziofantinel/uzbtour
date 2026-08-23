# Fondazione multi-agenzia

Questa prima tranche affianca il nuovo modello SaaS all'app Uzbekistan esistente senza
modificarne schermate o dati operativi. L'obiettivo è migrare per moduli, mantenendo
sempre utilizzabile la demo pubblica.

## Modello di dominio

- `agencies`: tenant proprietario di viaggi, utenti e contenuti.
- `trip_templates` + `trip_template_versions`: viaggio riutilizzabile e revisioni
  pubblicabili dopo il controllo dell'agenzia.
- `trip_days`, `itinerary_items`, `places`, `accommodations`: programma estratto e
  modificabile.
- `departures`: una specifica edizione del viaggio con date reali.
- `travel_parties`: famiglia/gruppo privato all'interno della partenza.
- `traveler_profiles` + `party_memberships`: viaggiatori e appartenenza al gruppo.
- `media_assets` e `travel_documents`: soli metadati; i file restano nello storage a
  oggetti.
- `generated_content`: quiz, missioni, bingo, giochi e contest fotografici revisionabili.
- `import_jobs` + `platform_jobs`: importazione PDF o Word asincrona e rieseguibile.
- `audit_events`: traccia delle modifiche importanti con autore e tenant.

Ogni tabella di dominio contiene `agency_id`; le relazioni composte impediscono di
collegare per errore record di agenzie differenti. Le API devono inoltre partire
sempre dall'utente autenticato e dalle sue membership. La Row Level Security di Neon
sarà attivata quando il login agenzia sostituirà le credenziali legacy: abilitarla ora
con l'unico ruolo database usato dall'app interromperebbe le API esistenti.

## Provider sostituibili

Il codice applicativo dipende da porte, non direttamente dai servizi esterni:

- coda: Amazon SQS Standard con dead-letter queue;
- worker: AWS Lambda ARM64 senza VPC o capacità riservata;
- file: Cloudflare R2 privato;
- AI: Amazon Bedrock on-demand, inizialmente Amazon Nova Lite.

Le variabili `PLATFORM_*_PROVIDER` selezionano l'implementazione. Questa separazione
evita una riscrittura quando l'agenzia passa al piano a pagamento.

## Sequenza di migrazione

1. Creare il nuovo schema ed eseguire il seed Uzbekistan.
2. Costruire il pannello agenzia su queste API.
3. Implementare upload PDF, DOC e DOCX, estrazione asincrona e revisione.
4. Migrare foto, spese, giochi e risultati aggiungendo partenza e famiglia.
5. Sostituire il login legacy, applicare RLS e migrare definitivamente la UI viaggio.

## Importazione documenti asincrona

Il pannello agenzia carica il documento PDF, DOC o DOCX in R2 come oggetto privato e crea un job
`travel-programme.import` su Neon, poi pubblica su SQS un messaggio contenente soltanto
gli identificativi necessari. Non vengono inseriti documenti o credenziali nella coda.

Il worker Lambda acquisisce il job in modo atomico, legge l'oggetto privato, invia il file a
Amazon Bedrock come documento nativo e valida la risposta con uno schema Zod. La bozza rimane
in `import_jobs.result` finché un amministratore non la corregge e pubblica. Solo la
pubblicazione trasferisce giorni, attività, alberghi e informazioni utili nelle tabelle
normalizzate, all'interno di un'unica transazione Neon.

In caso di errore il job e l'importazione passano a `failed` e possono essere ritentati.
La dead-letter queue conserva i messaggi che falliscono quattro volte. I job rimasti
in elaborazione per oltre dieci minuti possono essere acquisiti nuovamente, evitando
che un arresto improvviso della Lambda blocchi definitivamente un'importazione.
