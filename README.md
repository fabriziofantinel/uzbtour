# Via della Seta — Uzbekistan

MVP di un diario di viaggio condiviso per un tour di 11 giorni.

## Avvio locale

```bash
npm install
npm run dev
```

Aprire `http://localhost:3000`.

## Architettura cloud consigliata

- **Frontend e API:** Next.js App Router su Vercel
- **Database:** Neon Postgres dal Vercel Marketplace
- **Foto:** Vercel Blob
- **Autenticazione:** Auth.js con magic link o Google
- **Mappe:** OpenStreetMap nell'MVP; Mapbox se servono percorsi e mappe offline più evolute

La demo salva lo stato durante la sessione del browser. Il passaggio alla persistenza cloud richiede la creazione del progetto Vercel e delle relative integrazioni.

## Accesso privato

L'intera applicazione è protetta da tre codici personali e da sessioni firmate in cookie `HttpOnly` che identificano il partecipante.

Configurare in Vercel, per Production, Preview e Development:

- `TRIP_USERS_B64`: configurazione Base64 dei tre utenti e relativi codici
- `AUTH_SECRET`: stringa casuale di almeno 32 byte
- `DATABASE_URL`: connessione al database Neon Postgres collegato al progetto

Per lo sviluppo locale, sincronizzare le variabili con `vercel env pull .env.local`.

## Database

Note giornaliere, locali e spese sono persistiti su Neon Postgres. Ogni scrittura
registra l'identificativo e il nome dell'utente ricavati dalla sessione firmata.

Per creare o aggiornare le tabelle:

```bash
npm run db:migrate
```

Le foto restano al momento locali al browser e non vengono salvate nel database.

## Modello dati attuale

- `trip_notes`: una nota condivisa per ciascun giorno, con ultimo autore
- `trip_restaurants`: locali associati al giorno e all'utente che li ha inseriti
- `trip_expenses`: importi, descrizione e partecipante che ha pagato

## Storage fotografico

La scelta dello storage delle foto è intenzionalmente rimandata. Gmail non è adatto
come storage applicativo; Vercel Blob, Amazon S3 e Google Drive verranno valutati
separatamente prima di collegare il caricamento permanente.
