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
- `import_jobs` + `platform_jobs`: importazione PDF asincrona e rieseguibile.
- `audit_events`: traccia delle modifiche importanti con autore e tenant.

Ogni tabella di dominio contiene `agency_id`; le relazioni composte impediscono di
collegare per errore record di agenzie differenti. Le API devono inoltre partire
sempre dall'utente autenticato e dalle sue membership. La Row Level Security di Neon
sarà attivata quando il login agenzia sostituirà le credenziali legacy: abilitarla ora
con l'unico ruolo database usato dall'app interromperebbe le API esistenti.

## Provider sostituibili

Il codice applicativo dipende da porte, non direttamente dai servizi esterni:

- coda: database Neon nella demo, SQS quando aumentano importazioni e concorrenza;
- file: Vercel Blob nella demo, Cloudflare R2 quando volume e traffico foto crescono;
- AI: Gemini nella demo, Bedrock o altro provider nel piano enterprise.

Le variabili `PLATFORM_*_PROVIDER` selezionano l'implementazione. Questa separazione
evita una riscrittura quando l'agenzia passa al piano a pagamento.

## Sequenza di migrazione

1. Creare il nuovo schema ed eseguire il seed Uzbekistan.
2. Costruire il pannello agenzia su queste API.
3. Implementare upload PDF, estrazione asincrona e revisione.
4. Migrare foto, spese, giochi e risultati aggiungendo partenza e famiglia.
5. Sostituire il login legacy, applicare RLS e migrare definitivamente la UI viaggio.
