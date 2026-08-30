# DLQ incident - Vietnam reference enrichment

- Job: `01a04a62-c5b0-7144-a36e-d415d4b9ebbd` e retry
  `01a04a65-d844-79f2-9572-be4fcb000327`
- Tipo: `travel-reference.enrich`
- Tentativi: 4
- Esito originale: fallito e trasferito nella DLQ
- Causa: Bedrock restituiva un riferimento dell'ambasciata su un dominio non
  ufficiale; la validazione richiedeva `esteri.it` e rifiutava l'intero payload.
- Correzione: i riferimenti non verificabili vengono scartati senza perdere le
  altre informazioni; la generazione delle informazioni utili è separata da
  bingo, quiz e giochi e usa una materializzazione dedicata.
- Verifica sostitutiva: job `01a04a78-894a-75ac-b59b-ee60b328382a`, completato al
  primo tentativo il 2026-08-28 alle 22:23:42 UTC; 11 sezioni AI materializzate.
- Decisione DLQ: il messaggio obsoleto può essere rimosso dopo il deploy della
  correzione, perché non rappresenta più lavoro da recuperare.

Durante la bonifica è stato individuato anche il job legacy
`2aff39f2-8617-4ed4-8224-a7587b05287d`: agenzia, importazione, template e riga job
non esistono più in Neon. Il messaggio è quindi orfano e non recuperabile; la
rimozione non elimina lavoro applicativo ancora valido.

Non sono presenti credenziali o dati personali in questa evidenza.
