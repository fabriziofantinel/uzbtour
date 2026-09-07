# SMF Travel UAT di produzione

Data: 7 settembre 2026  
Release: `5b17fda`  
Ambiente: `https://smf-travel.vercel.app`  
Browser iniziale: Chrome desktop, sessione reale fornita dall'utente

## Esito sintetico

| Area | Esito | Evidenza |
| --- | --- | --- |
| Deployment e percorsi pubblici | Superato | Deployment Vercel `dpl_ASjaqwin3ptFqYzPuSNc9UJaeADP` Ready; Playwright mobile 5/5 |
| Superuser, percorsi non distruttivi | Superato | Sessione reale, riepilogo, agenzie, branding, utenti e accessibilità |
| Login come utente invitato | Superato | Sessione avviata come responsabile invitato e ritorno al superuser |
| Responsabile agenzia | In corso | Dashboard e personale superati; anomalia Informazioni Paesi riprodotta e corretta localmente |
| Operazioni distruttive superuser | Copertura automatica | Sospensione e cancellazione non ripetute su tenant reali; coperte dai test transazionali |
| Altri ruoli e dispositivi reali | Da eseguire | Responsabile, agente, accompagnatore, guida, viaggiatore, Android Fold e iOS |

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
| UAT-RA-03 | Informazioni Paesi | Anomalia riprodotta, correzione locale pronta | Produzione: errore `1090945064`; log Neon `country profile review reserved to agency`. La pagina usava l'attore Cognito superuser anziché l'identità impersonata |
| UAT-RA-04 | Correzione del confine identità | Verifica tecnica superata | Introdotto controllo sull'utente corrente; TypeScript, lint, formato e 26 test unitari superati, inclusi 3 test dedicati |

La ripresa del collaudo responsabile richiede la distribuzione della correzione e la verifica della stessa pagina in produzione.
