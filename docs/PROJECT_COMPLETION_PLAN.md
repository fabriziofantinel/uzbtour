# Piano di completamento SMF Travel

Aggiornato al 7 settembre 2026.

## Stato sintetico

- [ ] 1. Collaudo end-to-end e chiusura dei casi d'uso (in corso: automazione completata, UAT operatore da eseguire)
- [x] 2. Validazione sistematica della qualità AI
- [x] 3. Consolidamento della governance delle informazioni Paese
- [x] 4. Osservabilità e procedure operative
- [x] 5. Sicurezza, privacy e conformità applicativa
- [x] 6. Controllo quote e isolamento dei workload
- [ ] 7. Rifinitura funzionale e UX multi-dispositivo
- [ ] 8. Preparazione della release e criteri go-live

## 1. Collaudo end-to-end

### Completato

- Quality guard, TypeScript, sicurezza migrazioni e confini runtime.
- Build Next.js 16.3.2 di produzione completato con 33 pagine statiche e dinamiche, oltre alle route API.
- Validazione schema Neon 197: 96 tabelle, 70 con RLS, nessun vincolo o indice invalido e nessuna tabella tenant priva di indice leading.
- Flussi database: profili Paese, gruppi, inviti, utenti, analytics, cancellazioni, engagement e write cutover.
- PWA: installabilità, manifest dinamico, service worker, offline e sincronizzazione finanziaria.
- Push: sottoscrizione, invio pianificato e contratti applicativi.
- Giochi e foto: bingo, tentativi missioni, contest, album e isolamento gruppo.
- Conversione preventivo: validazione deterministica e rilevazione delle anomalie attese.
- Conversione preventivo Bedrock reale: 2 giornate, 4 visite, 1 struttura, 3 righe commerciali e 78 evidenze sorgente.
- Contenuti Paese Bedrock reali: 11 sezioni verificate, 12 frasi, 15 caselle bingo, quiz, missioni, giochi, contest e profili fotografici.
- Valutazione fotografica multimodale base: compatibilità corretta con confidenza 0,95.
- Dataset fotografico sintetico: 18/18 valutazioni corrette, zero falsi positivi e negativi, verdetto stabile e indipendente dall'ordine.
- Ruolo database `smf_app`: autenticazione, impersonazione, scope viaggiatore, media e mutazioni estranee verificati.
- Cancellazione agenzia SQS-Lambda-Neon: agenzia temporanea eliminata con fase finale `completed`.
- Produzione autenticata come responsabile: dashboard, programma, gruppi, documenti, chat, agenti, analytics, revisione Paese e login-come verificati.
- Layout mobile del programma corretto a 360 px: la voce Preventivi usa lo stesso controllo compatto delle altre schede e non forza più la barra oltre il viewport.
- Percorsi pubblici di produzione verificati con Playwright mobile: 5/5 superati.
- Installabilità e offline verificati: manifest, icone, service worker, programma e documenti offline, esclusione back-office e pulizia cache privata.
- Sincronizzazione finanziaria offline verificata: coda IndexedDB, retry, conflitti e idempotenza.
- Profili Paese verificati: responsabile autorizzato, superuser negato e dati isolati per agenzia.
- Ruoli accompagnatore e guida verificati in transazione: viaggio assegnato, programma completo, modifica della sola giornata assegnata, presenze, chat consentita/negata, scadenza e revoca.
- Isolamento agenzia verificato in transazione: rifiuto cross-tenant e invalidazione sessione/impersonazione dopo sospensione.
- Smoke runtime V3 riallineati alle identità native e superati: accesso e mutazioni superuser, dashboard agenzia e analytics, gestione viaggio e partecipanti, chat nativa, catalogo, spese, engagement, gamification, KPI, media e isolamento cross-tenant.

### Correzioni emerse dal collaudo

- Aggiornata la validazione schema per accettare il nuovo totale reale di 78 tabelle.
- Rese relative alla data di esecuzione le fixture del quiz giornaliero, evitando falsi errori dopo il 1 settembre 2026.
- Eliminato l'overflow orizzontale della testata Programma sui dispositivi Android compatti.
- Corretta con la migrazione 196 l'ambiguità SQL che bloccava la lettura della chat operativa nativa.
- Corretta con la migrazione 197 la mancata invalidazione di sessioni Cognito e impersonazioni per un'agenzia sospesa.
- Rimossi dai collaudi residui gli identificativi attore e le firme funzione legacy; gli script possono assumere localmente il ruolo `smf_app` tramite la DSN owner senza richiedere o leggere una seconda password runtime.

### Limiti di verifica non bloccanti

- La password della DSN Neon runtime non è stata letta: i privilegi sono verificati assumendo realmente `smf_app` e il funzionamento della produzione autenticata prova il collegamento applicativo senza esporre il segreto.
- Il collaudo browser autenticato corrente non può essere ripetuto automaticamente perché nell'ambiente non sono configurati gli account E2E dedicati.
- Restano da provare con un operatore reale i percorsi UI autenticati per tutti i ruoli, l'isolamento visivo fra due tenant e due gruppi, iOS Safari e Android Fold chiuso.
- Lettura errori runtime Vercel tramite connettore: non disponibile per autorizzazione insufficiente (HTTP 403); non è un errore applicativo.

## Criterio di chiusura del punto 1

Il punto sarà chiuso quando il collaudo manuale con operatore avrà registrato l'esito di tutti i casi prioritari della versione 1.4, con zero anomalie bloccanti o gravi. I controlli tecnici e i test gratuiti disponibili sono attualmente superati; i test Bedrock live restano disattivati e richiedono un comando esplicito del proprietario.

## Punti successivi

### 2. Qualità AI

Dataset di riferimento per conversione preventivi, contenuti Paese e valutazione immagini; metriche minime, regressioni e gestione degli esiti incerti.

Completato: replay deterministico obbligatorio in CI per importazione, contenuti di riferimento, valutazione fotografica e anomalie; baseline Bedrock live versionate per Belgio OCR, Norvegia PDF, Cile DOCX e itinerario OCR multi-Paese; formule, soglie e frequenze definite in `docs/testing/AI_QUALITY_GATE.md`. La pipeline ora riconcilia date e nomi hotel espliciti, recupera indipendentemente le attività, elimina classificazioni spurie e limita i retry agli output modello malformati. L'esecuzione live resta prevista settimanalmente e prima delle release; la sua schedulazione con allarmi rientra nel punto 4.

### 3. Governance informazioni Paese

Completato: baseline centrale attestata, fonti e data di aggiornamento, criticità per singolo campo, revisione del responsabile, scadenza e rigenerazione controllata dei contenuti sensibili.

### 4. Osservabilità

Completato: dashboard CloudWatch multi-workload, allarmi errori e DLQ, code isolate e correlazione `traceId` fra Vercel, Neon, SQS e Lambda.

### 5. Sicurezza e conformità

Completato per il perimetro applicativo: wrapper di autorizzazione delle API, censimento delle route, rate limiting sui confini sensibili, RLS forzata, URL firmati e audit. Il WAF resta dipendente da un futuro dominio personalizzato e non blocca l'assetto corrente.

### 6. Costi e quote

Completato per il controllo tecnico: quote di job attivi per agenzia e workload, concorrenza indipendente dei consumer, DLQ e allarmi. Budget commerciali e soglie economiche restano configurazioni operative, non modifiche applicative.

### 7. Rifinitura prodotto

Controlli finali responsive, accessibilità, offline, branding agenzia e coerenza dei feedback utente.

Audit statico Impeccable 4.2.2 completato il 7 settembre 2026: 14/20, nessuna anomalia P0 e un solo anti-pattern effettivo. Restano due temi P1 prima del go-live: collaudo autenticato su iOS/Android Fold/zoom 200% e progressivo consolidamento dei token di colore e tipografia white-label. Dettaglio in `docs/testing/SMF_Travel_Frontend_Audit_2026-09-07.md`.

### 8. Release

Checklist go-live, rollback, backup/restore, dati demo, documentazione operativa e accettazione finale.
