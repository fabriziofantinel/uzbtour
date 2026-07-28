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

## Modello dati previsto

- `trips`, `participants`, `days`, `activities`
- `comments`, `restaurants`, `expenses`, `expense_splits`
- `photos` con URL Blob, autore, giorno e didascalia

## Perché non Gmail

Gmail è un servizio email, non uno storage applicativo. Google Drive sarebbe tecnicamente possibile ma richiede OAuth e gestione dei permessi. Amazon S3 è un'alternativa valida per grandi volumi; per tre persone e un singolo viaggio, Vercel Blob è più rapido da configurare e resta integrato con il deployment.
