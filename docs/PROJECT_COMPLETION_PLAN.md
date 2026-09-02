# Piano di completamento SMF Travel

Aggiornato al 2 settembre 2026.

## Stato sintetico

- [ ] 1. Collaudo end-to-end e chiusura dei casi d'uso
- [ ] 2. Validazione sistematica della qualità AI
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

### Correzioni emerse dal collaudo

- Aggiornata la validazione schema per accettare il nuovo totale reale di 78 tabelle.
- Rese relative alla data di esecuzione le fixture del quiz giornaliero, evitando falsi errori dopo il 1 settembre 2026.

### Da completare

- Test reali Bedrock: bloccati dalla sessione AWS locale scaduta.
- Smoke test del ruolo database runtime: manca una `DATABASE_URL` locale valida con privilegi applicativi ridotti; la connessione owner non può sostituirla perché falserebbe il test.
- Verifica browser autenticata dei ruoli e dei layout responsive; le sessioni browser disponibili sono ferme alla pagina di login.
- Aggiornamento finale del rapporto DOCX con risultati, anomalie corrette ed evidenze.

## Criterio di chiusura del punto 1

Il punto è completato quando i test Bedrock passano, i controlli di autorizzazione usano il vero ruolo runtime, i flussi browser principali sono verificati per superuser, responsabile/agente e viaggiatore, e il rapporto di collaudo è aggiornato.

## Punti successivi

### 2. Qualità AI

Dataset di riferimento per conversione preventivi, contenuti Paese e valutazione immagini; metriche minime, regressioni e gestione degli esiti incerti.

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
