# Gate di qualità AI

Aggiornato al 2 settembre 2026.

## Strategia

La qualità viene verificata su due livelli complementari:

1. **Replay deterministico ad ogni push e pull request.** Usa risultati Bedrock registrati e riesegue schema, normalizzazione, regole di business, generazione DOCX e controlli sulle anomalie senza credenziali AWS e senza costi di inferenza.
2. **Esecuzione Bedrock reale periodica.** Rileva variazioni del modello e aggiorna le fixture soltanto dopo revisione dell'esito. Il record richiede `AI_TEST_MODE=record` e `AI_TEST_RECORD_CONFIRM=1`.

Il replay conserva risultati applicativi versionati, non l'envelope del SDK AWS. In questo modo il test resta stabile rispetto agli aggiornamenti del client e continua a validare il contratto realmente consumato dall'applicazione.

## Frequenza

| Controllo | Frequenza | Comando |
| --- | --- | --- |
| Replay import e contenuti | Ogni push e pull request | `npm run acceptance:ai:replay` |
| Bedrock live sul dataset ridotto | Settimanale e prima di una release | `npm run acceptance:ai:live` |
| Registrazione nuova baseline | Solo dopo esito live approvato | `AI_TEST_RECORD_CONFIRM=1 npm run acceptance:ai:record` |
| Dataset fotografico sintetico | Settimanale e dopo modifiche ai prompt | `npm run acceptance:bedrock:photo-synthetic-dataset` |
| Regressione multi-formato e multi-paese | Prima di una release | UC-AI-IMP-08 |

## KPI e soglie

| KPI | Formula | Soglia di accettazione |
| --- | --- | --- |
| Conformità schema | output validi / output prodotti | 100% |
| Completezza campi critici | campi critici corretti / campi critici attesi | almeno 95% |
| Allucinazioni critiche | valori critici non sostenuti dalla fonte / valori critici prodotti | 0% |
| Copertura evidenze | campi estratti con evidence locator / campi estratti che richiedono fonte | almeno 95% sui critici, 90% complessivo |
| Rilevazione anomalie bloccanti | anomalie bloccanti rilevate / anomalie bloccanti attese | 100% |
| Accuratezza foto | verdetti corretti / verdetti totali | almeno 90% |
| Falsi positivi foto fuori tema | foto fuori tema approvate / foto fuori tema | 0% sul dataset hard-negative |
| Stabilità del verdetto | esecuzioni con verdetto modale / esecuzioni ripetute | almeno 95% |
| Invarianza rispetto all'ordine | coppie con stesso esito invertendo l'ordine / coppie provate | 100% |

Un fallimento di schema, un'allucinazione critica, un falso positivo hard-negative o un'anomalia bloccante non rilevata impediscono il rilascio. Gli scostamenti non bloccanti aprono un'anomalia con fixture, modello, prompt e metriche di utilizzo.

## Baseline corrente

- Import Belgio: 2 giornate, 4 visite, 1 pasto incluso, 1 struttura, 3 righe commerciali, 85 evidenze e 7 anomalie di riconciliazione.
- Contenuti Belgio: 11 sezioni utili, 12 frasi in olandese, 15 caselle bingo; città e sito con quiz, missioni, giochi, contest e schede fotografiche.
- Controlli deterministici: rilevate tutte le 8 classi di anomalia previste.
- Dataset fotografico sintetico: 18/18 verdetti corretti, nessun falso positivo o negativo e invarianza rispetto all'ordine.

## Gestione delle fixture

- Le fixture sono dati di test privi di credenziali e dati personali.
- Ogni file contiene versione, scenario, data di registrazione e risultato applicativo.
- Una modifica delle fixture deve essere accompagnata dall'esito live e dalla spiegazione della variazione attesa.
- La CI non può registrare o sovrascrivere fixture.
- I test live mantengono sempre `maxTokens` esplicito e retry adattivo.
