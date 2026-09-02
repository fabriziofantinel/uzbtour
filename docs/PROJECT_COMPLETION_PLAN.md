# Piano di completamento SMF Travel

Aggiornato al 2 settembre 2026.

## Stato sintetico

- [x] 1. Collaudo end-to-end e chiusura dei casi d'uso
- [x] 2. Validazione sistematica della qualità AI
- [ ] 3. Consolidamento della governance delle informazioni Paese
- [ ] 4. Osservabilità e procedure operative
- [ ] 5. Sicurezza, privacy e conformità
- [ ] 6. Controllo costi, quote e limiti di servizio
- [ ] 7. Rifinitura funzionale e UX multi-dispositivo
- [ ] 8. Preparazione della release e criteri go-live

## 1. Collaudo end-to-end

### Completato

- Quality guard, TypeScript, sicurezza migrazioni e confini runtime.
- Build Next.js di produzione: 43 pagine statiche/dinamiche e route API compilate.
- Validazione schema Neon: 78 tabelle, 61 con RLS, nessun vincolo o indice invalido.
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

### Correzioni emerse dal collaudo

- Aggiornata la validazione schema per accettare il nuovo totale reale di 78 tabelle.
- Rese relative alla data di esecuzione le fixture del quiz giornaliero, evitando falsi errori dopo il 1 settembre 2026.
- Eliminato l'overflow orizzontale della testata Programma sui dispositivi Android compatti.

### Limiti di verifica non bloccanti

- La password della DSN Neon runtime non è stata letta: i privilegi sono verificati assumendo realmente `smf_app` e il funzionamento della produzione autenticata prova il collegamento applicativo senza esporre il segreto.
- Il collaudo browser corrente copre il responsabile; superuser e viaggiatore sono coperti dagli smoke test automatici e dalle evidenze manuali precedenti.
- Lettura errori runtime Vercel tramite connettore: non disponibile per autorizzazione insufficiente (HTTP 403); non è un errore applicativo.

## Criterio di chiusura del punto 1

Il punto è chiuso: i flussi critici sono coperti da test automatici, verifiche Neon/AWS/Bedrock e collaudo autenticato in produzione. La lettura diretta dei segreti runtime resta deliberatamente esclusa e demandata al monitoraggio operativo.

## Punti successivi

### 2. Qualità AI

Dataset di riferimento per conversione preventivi, contenuti Paese e valutazione immagini; metriche minime, regressioni e gestione degli esiti incerti.

Completato: replay deterministico obbligatorio in CI per importazione, contenuti di riferimento, valutazione fotografica e anomalie; baseline Bedrock live versionate per Belgio OCR, Norvegia PDF, Cile DOCX e itinerario OCR multi-Paese; formule, soglie e frequenze definite in `docs/testing/AI_QUALITY_GATE.md`. La pipeline ora riconcilia date e nomi hotel espliciti, recupera indipendentemente le attività, elimina classificazioni spurie e limita i retry agli output modello malformati. L'esecuzione live resta prevista settimanalmente e prima delle release; la sua schedulazione con allarmi rientra nel punto 4.

### 3. Governance informazioni Paese

Fonti ufficiali, data di aggiornamento, revisione del responsabile, scadenza e rigenerazione controllata dei contenuti sensibili.

### 4. Osservabilità

Dashboard, allarmi, code/DLQ, tempi di elaborazione, errori di pubblicazione, push e runbook verificati.

### 5. Sicurezza e conformità

Revisione autorizzazioni end-to-end, retention, consensi, audit, protezione documenti e dati personali.

### 6. Costi e quote

Budget e allarmi per Bedrock, storage, notifiche e database; limiti per tenant e protezioni da uso anomalo.

### 7. Rifinitura prodotto

Controlli finali responsive, accessibilità, offline, branding agenzia e coerenza dei feedback utente.

### 8. Release

Checklist go-live, rollback, backup/restore, dati demo, documentazione operativa e accettazione finale.
