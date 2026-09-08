# Piano di completamento SMF Travel

Aggiornato all'8 settembre 2026.

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
- Schema Neon portato alla migrazione 200 con 99 tabelle applicative nominalmente verificate, 73 protette da RLS, nessun vincolo o indice invalido e nessuna tabella tenant priva di indice leading. La ricostruzione pulita contiene inoltre il solo registro tecnico `ops.repository_migrations`.
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
- Percorsi pubblici di produzione verificati con Playwright mobile: 5/5 superati sul commit `ec5feee` distribuito il 7 settembre 2026. L'alias pubblico verificato è `https://smf-travel.vercel.app`; l'alias tecnico di team è protetto da Vercel SSO e non deve essere usato come base dei test anonimi.
- Installabilità e offline verificati: manifest, icone, service worker, programma e documenti offline, esclusione back-office e pulizia cache privata.
- Sincronizzazione finanziaria offline verificata: coda IndexedDB, retry, conflitti e idempotenza.
- Profili Paese verificati: responsabile autorizzato, superuser negato e dati isolati per agenzia.
- Ruoli accompagnatore e guida verificati in transazione: viaggio assegnato, programma completo, modifica della sola giornata assegnata, presenze, chat consentita/negata, scadenza e revoca.
- Isolamento agenzia verificato in transazione: rifiuto cross-tenant e invalidazione sessione/impersonazione dopo sospensione.
- Smoke runtime V3 riallineati alle identità native e superati: accesso e mutazioni superuser, dashboard agenzia e analytics, gestione viaggio e partecipanti, chat nativa, catalogo, spese, engagement, gamification, KPI, media e isolamento cross-tenant.
- UAT di produzione superuser avviato sul commit `5b17fda`: riepilogo, elenco e dettaglio agenzie, branding, disponibilità della gestione responsabile, accessibilità, login come responsabile invitato e ritorno al superuser superati senza modificare dati reali. Evidenze in `docs/testing/SMF_Travel_UAT_Produzione_2026-09-07.md`.

### Correzioni emerse dal collaudo

- Aggiornata la validazione schema per accettare il nuovo totale reale di 78 tabelle.
- Rese relative alla data di esecuzione le fixture del quiz giornaliero, evitando falsi errori dopo il 1 settembre 2026.
- Eliminato l'overflow orizzontale della testata Programma sui dispositivi Android compatti.
- Corretta con la migrazione 196 l'ambiguità SQL che bloccava la lettura della chat operativa nativa.
- Corretta con la migrazione 197 la mancata invalidazione di sessioni Cognito e impersonazioni per un'agenzia sospesa.
- Rimossi dai collaudi residui gli identificativi attore e le firme funzione legacy; gli script possono assumere localmente il ruolo `smf_app` tramite la DSN owner senza richiedere o leggere una seconda password runtime.
- Individuata in produzione l'anomalia `1090945064` nella pagina Informazioni Paesi durante il login come responsabile: il controllo usava l'identità Cognito del superuser anziché il profilo corrente impersonato. La correzione separa esplicitamente identità corrente e attore autenticato, è coperta da tre test unitari ed è stata distribuita con `ec0f43b`; il nuovo collaudo ha aperto correttamente la pagina. Il tenant non ha ancora profili Paese centrali verificati, quindi la validazione effettiva dei contenuti resta da eseguire senza avviare automaticamente Bedrock.
- Completata la bonifica delle firme attore legacy: il censimento live ha individuato 51 firme testuali (una in più della baseline statica), sono stati creati e distribuiti i sostituti UUID prima del cutover e la migrazione 199 le ha eliminate tutte senza `CASCADE`. Gate finale: 0 firme legacy e 195 firme native UUID.
- Aggiunte la rooming list per pernottamento e gruppo, con autorizzazioni di responsabile, agente e accompagnatore, controlli di capienza e tutela dei minori, ed esportazione DOCX priva di dati documentali sensibili.
- Aggiunto il ciclo post-viaggio a costo AI zero: valutazione 0-10 dal secondo giorno dopo il rientro, push idempotente, percorso differenziato per promotori e detrattori, codice passaparola e analisi per partenza incrociata con i feedback di tappa.
- Sostituita la validazione basata sul solo conteggio 99/100 con il manifesto nominale `database/v3-table-inventory.json`: produzione e ricostruzione pulita hanno le stesse 99 tabelle applicative; la centesima tabella del bootstrap è esclusivamente il registro checksum opzionale.

### Limiti di verifica non bloccanti

- La password della DSN Neon runtime non è stata letta: i privilegi sono verificati assumendo realmente `smf_app` e il funzionamento della produzione autenticata prova il collegamento applicativo senza esporre il segreto.
- Il collaudo browser autenticato corrente non può essere ripetuto automaticamente perché nell'ambiente non sono configurati gli account E2E dedicati.
- Restano da provare con un operatore reale i percorsi UI autenticati per responsabile, agente, accompagnatore, guida e viaggiatore, l'isolamento visivo fra due tenant e due gruppi, iOS Safari e Android Fold chiuso. Il percorso superuser non distruttivo è completato.
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

Checklist predisposta in `docs/operations/GO_LIVE_CHECKLIST.md`. La capacità Vercel è stata bonificata l'8 settembre 2026 riducendo l'inventario da 213 a 24 deployment, mantenendo 20 release di produzione utilizzabili per rollback e 4 deployment protetti da alias; retention a 7 giorni e `ignoreCommand` limitano la crescita futura. Due restore drill Neon consecutivi sono stati completati l'8 settembre 2026 su punti a -5 e -10 minuti, con validazione integra e tempi operativi di 15 e 14 secondi. SQS, Lambda, CloudWatch e Cognito risultano operativi; SES è ancora in sandbox e il recupero campione R2 resta da dimostrare con un percorso sicuro per le credenziali. Il punto release resta aperto finché non sono disponibili: UAT ruoli/dispositivi comprendente rooming list e post-viaggio, rollback Vercel provato, uscita SES dalla sandbox, prova R2 e accettazione dell'operatore pilota. Lo script storico dei dati demo richiede revisione prima di qualsiasi esecuzione perché usa ancora strutture legacy e identificativi fissi.
