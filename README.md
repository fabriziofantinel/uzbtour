# SMF Travel

Piattaforma multi-agenzia per creare viaggi da un programma PDF, DOC o DOCX e condividerli con
famiglie e viaggiatori. Il tour Uzbekistan resta disponibile come contenuto demo.

## Avvio locale

```bash
npm install
npm run dev
```

Aprire `http://localhost:3000`.

## Architettura della demo SaaS

- **Frontend e API:** Next.js App Router su Vercel
- **Database:** Neon Postgres dal Vercel Marketplace
- **Documenti e foto:** bucket privato Cloudflare R2
- **Elaborazione asincrona:** Amazon SQS e AWS Lambda
- **Importazione programma:** Amazon Bedrock (Nova Lite), con stato e risultati su Neon
- **Autenticazione:** Neon Auth con sessioni `HttpOnly` e ruoli applicativi su Neon
- **Mappe:** OpenStreetMap nell'MVP; Mapbox se servono percorsi e mappe offline più evolute

Il caricamento dei file usa URL `PUT` firmati e temporanei: il browser invia il file
direttamente a R2, mentre le chiavi R2 rimangono esclusivamente nelle API server-side.

## Accesso privato

L'intera applicazione è protetta da Neon Auth. Identità e sessioni sono gestite nello schema `neon_auth`; agenzie, famiglie, viaggiatori e relativi permessi restano nelle tabelle applicative.

Configurare in Vercel, per Production, Preview e Development:

- `NEON_AUTH_BASE_URL`: endpoint Auth della branch Neon
- `NEON_AUTH_COOKIE_SECRET`: stringa casuale di almeno 32 caratteri per la sessione firmata
- `DATABASE_URL`: connessione al database Neon Postgres collegato al progetto

Per lo sviluppo locale, sincronizzare le variabili con `vercel env pull .env.local`.

## Database

Note giornaliere, locali e spese sono persistiti su Neon Postgres. Ogni scrittura
registra l'identificativo e il nome dell'utente ricavati dalla sessione Neon Auth.

Per creare o aggiornare le tabelle:

```bash
npm run db:migrate
```

Le foto restano al momento locali al browser e non vengono salvate nel database.

## Worker AWS

Il caricamento del documento crea un record idempotente su Neon e invia a SQS soltanto gli
identificativi del lavoro. Lambda scarica il documento privato da R2, lo elabora con
Bedrock e salva la bozza su Neon. La configurazione completa è descritta in
[`docs/aws-sqs-lambda-bedrock.md`](docs/aws-sqs-lambda-bedrock.md).

```bash
npm run aws:validate
npm run aws:build
npm run aws:deploy
```

## Modello dati attuale

- `trip_notes`: una nota condivisa per ciascun giorno, con ultimo autore
- `trip_restaurants`: locali associati al giorno e all'utente che li ha inseriti
- `trip_expenses`: importi, descrizione e partecipante che ha pagato

## Cloudflare R2

Creare un bucket privato e un token R2 limitato a lettura/scrittura di quel bucket,
quindi configurare su Vercel:

- `PLATFORM_OBJECT_STORAGE_PROVIDER=r2`
- `R2_ACCOUNT_ID`
- `R2_JURISDICTION=eu` se il bucket ha giurisdizione Unione Europea
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

Per gli upload diretti dal browser serve anche la policy CORS descritta in
[`docs/cloudflare-r2.md`](docs/cloudflare-r2.md).
