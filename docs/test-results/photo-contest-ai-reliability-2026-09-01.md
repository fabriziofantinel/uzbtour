# Affidabilità giudizio AI dei contest fotografici

Data: 1 settembre 2026  
Modello: Amazon Nova 2 Lite tramite Amazon Bedrock  
Caso campione: `Piazza dell'Indipendenza - Libera`

## Obiettivo

Verificare che il giudizio AI riconosca una fotografia pertinente al tema, escluda una fotografia chiaramente fuori tema, rispetti la griglia dei punteggi e non cambi risultato quando viene invertito l'ordine delle immagini.

## Risultato atteso

- Foto della Piazza dell'Indipendenza: pertinente, ammessa e vincente.
- Foto di un paesaggio marino: non pertinente, esclusa e con zero punti validi per il contest.

## Piano eseguito

1. Sei esecuzioni indipendenti con temperatura zero.
2. Ordine delle due foto alternato a ogni esecuzione.
3. Verifica di `themeMatch` per entrambe le immagini.
4. Verifica dei limiti: composizione 25, tecnica 20, racconto 25, originalità 15, aderenza 15.
5. Verifica che una foto fuori tema abbia totale valido pari a zero.
6. Misurazione della variabilità del punteggio della foto pertinente.

## Anomalia trovata e corretta

La valutazione con entrambe le immagini nello stesso prompt presentava un effetto d'ordine: la seconda fotografia poteva essere associata o interpretata in modo errato. Il sistema è stato modificato per valutare ogni fotografia con un'invocazione indipendente e applicare poi il confronto in modo deterministico nel codice.

## Esito finale

| Indicatore | Risultato |
| --- | ---: |
| Esecuzioni superate | 6/6 |
| Accuratezza sul campione | 100% |
| Riconoscimento foto pertinente | 100% |
| Esclusione foto fuori tema | 100% |
| Indipendenza dall'ordine | 100% |
| Punteggio medio foto pertinente | 86/100 |
| Deviazione standard | 0 |
| Intervallo osservato | 0 punti |

## Limiti e prossima estensione

Questo risultato convalida il caso Piazza contro mare e il funzionamento tecnico del contratto, ma non dimostra ancora l'affidabilità su ogni destinazione. Per una validazione rappresentativa occorre un corpus annotato di almeno 50 coppie, distribuite fra monumenti, piazze, paesaggi, gastronomia, persone non identificabili, scene notturne e casi ambigui. Le soglie consigliate sono: almeno 95% di esclusioni corrette per i fuori tema, almeno 90% di ammissioni corrette per i pertinenti e scarto medio inferiore a 8 punti nelle ripetizioni.

## Riesecuzione

Il test automatico è disponibile tramite lo script npm `acceptance:bedrock:photo-contest-reliability`, con username e numero di esecuzioni configurabili.
