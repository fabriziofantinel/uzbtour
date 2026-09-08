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
- [x] Filtro dei build verificato anche con clone Git a cronologia ridotta: il confronto considera soltanto gli input applicativi dichiarati e i commit che modificano esclusivamente documentazione, test manuali o materiali operativi non producono nuovi artefatti Vercel.
- [x] Capacità Neon verificata l'8 settembre 2026: database circa 44,5 MiB, 3 connessioni osservate su 901 disponibili; schema e integrità validati.
- [x] Code SQS operative l'8 settembre 2026: 10 code/DLQ senza messaggi visibili, in volo o ritardati; redrive e retention di 14 giorni presenti sulle code applicative.
- [x] Lambda operative con allarmi CloudWatch attivi: 7 funzioni `Active`, tracing abilitato, 5 event source mapping attivi e 9 allarmi in stato `OK`.
- [x] R2 verificato l'8 settembre 2026: bucket privato EU raggiungibile, policy CORS `PUT` per `https://smf-travel.vercel.app` con header `Content-Type`, URL pubblico disabilitato e download campione integro.
- [ ] Cognito e mittente SES verificati; la richiesta di uscita dalla sandbox è stata respinta a livello SES dopo l'invio dei chiarimenti. Il caso Support resta aperto in attesa della risposta finale AWS (`ProductionAccessEnabled: false`, `ReviewStatus: DENIED`).

Le sezioni 3-6 e le attività con l'operatore della sezione 8 costituiscono gli
UAT esplicitamente rinviati e non fanno parte della chiusura tecnica corrente.

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

- [x] Branch Neon temporaneo creato da un punto precedente e validato con `npm run db:validate:v3`.
- [x] Primo restore drill completato l'8 settembre 2026: punto a -5 minuti, verifica operativa in 15 secondi, branch temporaneo eliminato.
- [x] Secondo restore drill consecutivo completato l'8 settembre 2026: punto a -10 minuti, verifica operativa in 14 secondi, branch temporaneo eliminato.
- [x] Recupero campione R2 eseguito l'8 settembre 2026 senza sovrascrivere l'originale: DOCX 25.947 byte, 26 entry ZIP, `word/document.xml` presente e checksum SHA-256 registrato nell'evidenza.
- [x] Rollback Vercel provato l'8 settembre 2026 verso `dpl_8mvCgFtW1HixG8d87U9sV8ugsW9E`: alias pubblico HTTP 200; release corrente `dpl_Ee36v8rcdbuReDxegRW1HdU5HHbN` ripristinata e nuovamente HTTP 200.
- [x] Compatibilità dello schema verificata: fra le due release cambiano soltanto `.vercelignore` e `scripts/vercel-ignore-build-step.mjs`; codice applicativo e migrazione 200 sono invariati.
- [x] Ripristino job da DLQ provato l'8 settembre 2026 con un workload innocuo: redrive 1/1 dalla DLQ import, correzione `WORKLOAD=import` distribuita via CloudFormation, messaggio recuperato riconosciuto in 129 ms e code finali vuote, senza invocare Bedrock.

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
