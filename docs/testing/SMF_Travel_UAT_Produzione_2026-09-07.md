# SMF Travel UAT di produzione

Data: 7 settembre 2026  
Release verificata: `ec0f43b`
Ambiente: `https://smf-travel.vercel.app`  
Browser iniziale: Chrome desktop, sessione reale fornita dall'utente

## Esito sintetico

| Area | Esito | Evidenza |
| --- | --- | --- |
| Deployment e percorsi pubblici | Superato | Deployment Vercel `dpl_ASjaqwin3ptFqYzPuSNc9UJaeADP` Ready; Playwright mobile 5/5 |
| Superuser, percorsi non distruttivi | Superato | Sessione reale, riepilogo, agenzie, branding, utenti e accessibilità |
| Login come utente invitato | Superato | Sessione avviata come responsabile invitato e ritorno al superuser |
| Responsabile agenzia | Superato per i percorsi non mutativi | Dashboard, personale, Analytics e tutte le sezioni del viaggio aperte; correzione Informazioni Paesi verificata in produzione |
| Agente | In corso | Dashboard e isolamento sul tenant Golden Terra Travel verificati |
| Accompagnatore | Anomalia riprodotta | Il login assistito indirizza erroneamente a `/viaggio`; correzione preparata e coperta da test |
| Operazioni distruttive superuser | Copertura automatica | Sospensione e cancellazione non ripetute su tenant reali; coperte dai test transazionali |
| Altri ruoli e dispositivi reali | Da eseguire | Completare agente, accompagnatore, guida, viaggiatore, Android Fold e iOS |

## UAT superuser

| ID | Verifica | Risultato | Evidenza osservata |
| --- | --- | --- | --- |
| UAT-SU-01 | Apertura del riepilogo | Superato | 6 agenzie, 8 viaggi e 11 viaggiatori; indicatori medi visibili |
| UAT-SU-02 | Elenco e ricerca agenzie | Superato | 6 agenzie elencate con referente, viaggi, viaggiatori e agenti |
| UAT-SU-03 | Dettaglio agenzia | Superato | Referente, contatti, utenti, stato e zona pericolo disponibili |
| UAT-SU-04 | Branding dell'agenzia | Superato | Modifica dati espone colore, caricamento logo locale e rimozione logo |
| UAT-SU-05 | Gestione del responsabile | Superato, sola disponibilità UI | Sostituzione responsabile presente; invio non eseguito per non alterare dati reali |
| UAT-SU-06 | Login come | Superato | 16 utenti disponibili, inclusi profili attivi e 5 da attivare |
| UAT-SU-07 | Login come utente non attivo | Superato | Avviata sessione come `DSFDSF`, profilo responsabile invitato dell'agenzia `FFDFDS` |
| UAT-SU-08 | Autorizzazioni della sessione impersonata | Superato | Aperto pannello agenzia con zero viaggi del tenant e menu coerente con il ruolo |
| UAT-SU-09 | Ritorno al superuser | Superato | Fascia sessione temporanea e comando di ritorno ripristinano `/admin` e l'identità `Fabrizio` |
| UAT-SU-10 | Pagina accessibilità | Superato | Contenuti su tastiera, contrasto, zoom, tecnologie assistive e smartphone presenti |

## Note di esecuzione

- Nessuna agenzia reale è stata sospesa o eliminata.
- Nessun responsabile, agente o viaggiatore è stato creato o modificato.
- Nessun test Bedrock è stato eseguito e non sono stati consumati crediti AI.
- L'alias tecnico `smf-travel-smf6.vercel.app` richiede Vercel SSO; i test anonimi devono usare `smf-travel.vercel.app`.

## UAT responsabile agenzia

| ID | Verifica | Risultato | Evidenza osservata |
| --- | --- | --- | --- |
| UAT-RA-01 | Dashboard e viaggi dell'agenzia | Superato | Profilo Silvia Rossi, tenant Golden Terra Travel, 3 viaggi, 2 partenze e 3 gruppi |
| UAT-RA-02 | Elenco personale | Superato | Agente, accompagnatore e guida attivi visibili; nessuna mutazione eseguita |
| UAT-RA-03 | Informazioni Paesi | Superato dopo correzione | L'errore `1090945064` è stato corretto e la pagina si apre in produzione con il profilo responsabile impersonato |
| UAT-RA-04 | Correzione del confine identità | Superato | Distribuita con `ec0f43b`; quality guard e 26 test unitari superati, inclusi 3 test dedicati |
| UAT-RA-05 | Contenuti Paese da validare | Da eseguire quando disponibili | La pagina mostra correttamente lo stato vuoto: Golden Terra Travel non ha profili centrali verificati. Esistono contenuti legacy approvati per Uzbekistan e Vietnam, ma non vengono promossi senza verifica né esecuzione Bedrock autorizzata |
| UAT-RA-06 | Analytics | Superato | KPI principali presenti; 3 valutazioni aggregate e 3 schede di dettaglio coerenti, con sintesi per città, gruppo e viaggio |
| UAT-RA-07 | Menu e sezioni del viaggio | Superato | Programma, Gruppi, Documenti, Chat, Comunicazioni, Operatività e Assicurazione aperti senza errore; menu invariato e Preventivi sempre presente |

## UAT agente e personale operativo

| ID | Verifica | Risultato | Evidenza osservata |
| --- | --- | --- | --- |
| UAT-AG-01 | Accesso assistito agente | Superato | `Agente 1` entra nel pannello Golden Terra Travel e vede i 3 viaggi del tenant |
| UAT-OP-01 | Accesso assistito accompagnatore | Anomalia riprodotta, correzione pronta | `acco1`, pur assegnato a un viaggio, viene inviato a `/viaggio` e vede lo stato vuoto. Il redirect superuser distingueva solo amministratori e viaggiatori |
| UAT-OP-02 | Correzione redirect personale | Verifica unitaria superata | Il redirect ora consulta le assegnazioni e porta agenti operativi, accompagnatori e guide a `/tour-leader`; 3 test dedicati superati |
