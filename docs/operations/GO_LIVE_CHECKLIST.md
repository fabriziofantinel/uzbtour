# SMF Travel - Checklist go-live

Questa checklist definisce le prove necessarie per dichiarare una release pronta per un primo operatore. Ogni voce deve riportare data, operatore, evidenza e risultato. Nessun test AI live viene avviato automaticamente.

## 1. Identificazione della release

- [x] Commit applicativo candidato presente su `smftravel/main`: `25228b7`; i commit successivi consolidano esclusivamente gate e documentazione.
- [x] Deployment Vercel di produzione completato sul commit `25228b7` l'8 settembre 2026.
- [x] Health check pubblico, login e manifest PWA validi su `https://smf-travel.vercel.app`; smoke Playwright mobile 5/5.
- [x] Schema Neon dichiarato dall'app uguale all'ultima migrazione applicata (`200_v3_rooming_and_post_trip_reviews`).
- [x] `npm run quality:guard`, `npm run build` e test pubblici Playwright verdi sul commit candidato, come attestato anche dai log di build Vercel.
- [x] Documentazione e materiali di collaudo necessari alla release versionati nel repository.

## 2. Capacità e piattaforme

- [x] Capacità Vercel bonificata l'8 settembre 2026: rimossi 189 deployment obsoleti, mantenuti 20 deployment di produzione pronti per rollback e 4 deployment protetti da alias. Retention impostata a 7 giorni e build non applicative escluse tramite `ignoreCommand`; l'aggiornamento del dato di utilizzo nel portale Vercel può essere asincrono.
- [ ] Quote Neon, connessioni e storage verificati.
- [ ] Code SQS operative e DLQ senza messaggi non analizzati.
- [ ] Lambda operative con allarmi CloudWatch attivi.
- [ ] R2 raggiungibile e CORS verificato per upload/download dai domini effettivi.
- [ ] Cognito, SES e mittente delle e-mail di invito verificati nell'ambiente di produzione.

## 3. Collaudo ruoli

- [ ] Superuser: agenzie, responsabile, branding, sospensione, login come e ritorno alla sessione originale.
- [ ] Responsabile: viaggio, agenti e staff, informazioni Paese, analytics, gruppi, documenti, chat, comunicazioni, assicurazione e operatività.
- [ ] Agente: parità operativa con il responsabile nel tenant, esclusa la nomina del responsabile.
- [ ] Accompagnatore: soli viaggi assegnati, programma completo, modifica delle sole giornate assegnate, documenti, chat, comunicazioni, assicurazione, presenze e segnalazioni.
- [ ] Guida: soli viaggi assegnati, programma e modifica delle sole giornate assegnate, presenze e segnalazioni; divieto delle funzioni escluse.
- [ ] Viaggiatore: programma, documenti, chat, informazioni utili, frasi, spese/cambi/prelievi, giochi, feedback, SOS e logout.
- [ ] Utente invitato non attivo: login come consentito soltanto agli operatori autorizzati.
- [ ] Staff revocato o agenzia sospesa: accesso e impersonazione invalidati.

## 4. Isolamento e privacy

- [ ] Due agenzie reali di collaudo non vedono reciprocamente utenti, viaggi, media, chat, analytics o documenti.
- [ ] Due gruppi della stessa partenza mantengono separati spese, documenti riservati, chat, classifiche e contenuti privati.
- [ ] Audience viaggio, gruppo, viaggiatore, accompagnatore e guida verificate con destinatari positivi e negativi.
- [ ] URL diretti e identificativi alterati restituiscono negazione senza rivelare dati.
- [ ] Minori e consensi foto verificati; nessun passaporto o documento sanitario memorizzato.
- [ ] Audit eventi contiene attore reale, eventuale identità impersonata, azione e tenant.

## 5. Dispositivi e accessibilità

- [ ] Desktop Chrome ed Edge: navigazione da tastiera, focus, zoom 200% e assenza di overflow.
- [ ] Android Chrome corrente e precedente: browser e PWA installata, online/offline, rotazione e ritorno alla pagina corrente.
- [ ] Android Fold chiuso e aperto: menu, scroll verticale, barra inferiore, modali e contenuti lunghi.
- [ ] iOS Safari corrente e precedente: Aggiungi a Home, standalone, safe area, offline, push e tastiera.
- [ ] Testo grande e modalità semplificata producono una differenza visibile e non interrompono le funzioni.
- [ ] Colore agenzia chiaro e scuro: testo e icone rimangono leggibili e non diventano bianchi sulle superfici configurabili.

## 6. Offline e notifiche

- [ ] Scarica documenti sul dispositivo marca correttamente ogni documento offline/solo online.
- [ ] Nuovo documento successivo richiede un nuovo download e non altera i conteggi.
- [ ] Programma, documenti già scaricati, contatti e informazioni utili leggibili in modalità aereo.
- [ ] Spesa, cambio e prelievo offline vengono sincronizzati una sola volta tramite `client_operation_id`.
- [ ] Push reale ricevuta con nome e logo agenzia e deep link corretto.
- [ ] Abilitazione avvisi resta persistente dopo refresh; revoca della subscription gestita.

## 7. Backup e rollback

- [ ] Branch Neon temporaneo creato da un punto precedente e validato con `npm run db:validate:v3`.
- [ ] Primo restore drill completato entro RPO/RTO osservati e registrato.
- [ ] Secondo restore drill consecutivo completato prima di inserire RPO/RTO nei contratti.
- [ ] Recupero campione R2 eseguito senza sovrascrivere l'oggetto originale.
- [ ] Rollback Vercel provato verso il deployment precedente.
- [ ] Compatibilità dello schema verificata con la versione applicativa di rollback oppure procedura di forward-fix approvata.
- [ ] Ripristino job da DLQ provato con workload innocuo e idempotente, senza Bedrock live se non autorizzato.

## 8. Dati demo e documentazione

- [ ] Tenant demo dedicato, privo di dati personali reali e chiaramente identificato.
- [ ] Lo script storico `scripts/seed-platform-demo.mjs` non viene eseguito in produzione senza revisione: usa tabelle e identità legacy e UUID fissi.
- [x] Documentazione funzionale, architetturale, logica, fisica, casi d'uso e rapporto test sono allineati alla migrazione 200, inclusi rooming list e post-viaggio.
- [ ] Manuale operativo, matrice ruoli, gestione incidenti e contatti di supporto consegnati all'operatore.
- [ ] Formazione dell'operatore completata su un viaggio campione non produttivo.

## 9. Decisione finale

Condizioni minime per **GO**:

- zero anomalie P0 o P1 aperte;
- tutti i casi prioritari della versione 1.4 eseguiti sul commit candidato;
- isolamento tenant e gruppo provato con identità reali;
- almeno un dispositivo Android e uno iOS verificati;
- capacità Vercel disponibile e rollback dimostrato;
- restore Neon dimostrato almeno una volta; gli obiettivi contrattuali richiedono due drill consecutivi;
- responsabile tecnico e operatore pilota concordano l'esito.

| Decisione | Data e ora | Commit | Responsabile tecnico | Operatore pilota | Note |
| --- | --- | --- | --- | --- | --- |
| GO / NO-GO |  |  |  |  |  |
