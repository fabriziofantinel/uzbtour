# Test AI su immagini sintetiche - 1 settembre 2026

## Obiettivo

Verificare che il giudice fotografico distingua fotografie pertinenti, casi geograficamente simili e contenuti completamente fuori tema per il contest "Piazza dell'Indipendenza, Tashkent".

## Dataset

- 6 immagini sintetiche indipendenti.
- 2 immagini attese valide.
- 4 immagini attese non valide.
- 3 esecuzioni per immagine, alternando l'ordine delle coppie.
- 18 valutazioni Bedrock complessive.

## Risultato

- Accuratezza: **83,3%** (15/18).
- Falsi negativi: **0**.
- Falsi positivi: **3**.
- Verdetti stabili tra le ripetizioni: **sì**.
- Separazione corretta dei punteggi: **no**.

## Anomalia riproducibile

La fotografia di Piazza Ala-Too a Bishkek è stata ammessa in tutte e tre le esecuzioni con punteggio 75. Bedrock ha identificato erroneamente la statua equestre di Manas come monumento di Piazza dell'Indipendenza a Tashkent. Anche dopo aver reso più prudente il prompt, una verifica rapida ha riprodotto il falso positivo con punteggio 78.

Le altre cinque fixture sono state classificate correttamente in tutte le esecuzioni. Registan, paesaggio marino e colazione in hotel sono stati esclusi con punteggio zero; entrambe le immagini valide sono state ammesse.

## Diagnosi

Il modello riceve il tema prima di descrivere la fotografia e tende a interpretare una scena monumentale compatibile come conferma del luogo richiesto. Un semplice irrigidimento del prompt non elimina il bias di conferma.

## Correzione raccomandata

Usare una valutazione in due passaggi:

1. analisi neutrale della fotografia senza comunicare il tema, con descrizione degli elementi visibili e possibili luoghi;
2. confronto tra l'analisi neutrale e il tema del contest, seguito dalla valutazione fotografica.

Il dataset e il comando `npm run acceptance:bedrock:photo-synthetic-dataset -- --runs=3` costituiscono il test di regressione. La correzione è accettata solo con 18/18 classificazioni corrette, nessun falso positivo, nessun falso negativo e verdetto indipendente dall'ordine.

## Esperimento a due passaggi

È stata provata localmente una prima analisi neutrale della foto seguita dal confronto con il tema. Il falso positivo su Piazza Ala-Too è stato eliminato, ma la fotografia parziale valida della fontana è diventata un falso negativo. Risultato: 5/6 corrette, con un errore di tipo diverso. La modifica sperimentale non è stata mantenuta nel codice applicativo perché non costituisce un miglioramento netto.

Per i temi che identificano un luogo preciso serve quindi un riferimento autorevole associato al contest, ad esempio una o più immagini verificate o una scheda con elementi distintivi e incompatibili. Le sole immagini generate non sono una fonte geografica affidabile: sono adatte ai test semantici, ma non possono certificare che un dettaglio architettonico appartenga realmente al luogo richiesto.

## Implementazione finale: scheda dinamica nascosta

La pubblicazione genera ora con Bedrock una scheda `photoValidation` per ogni missione, casella bingo e contest. La scheda contiene soggetto, tipo, descrizione visiva, caratteristiche obbligatorie e facoltative, varianti accettabili, condizioni di rifiuto, soggetti confondibili e soglia minima di confidenza. Viene salvata nel payload tecnico dell'attività e non è esposta dalle API del viaggiatore.

La generazione avviene in una seconda fase dedicata, in blocchi di massimo cinque schede, per evitare output incompleti del modello. Eventuali profili inseriti incidentalmente durante la prima generazione vengono scartati; sono conservati soltanto quelli prodotti e validati dalla fase dedicata.

Verifiche finali:

- dataset Piazza dell'Indipendenza: **18/18**, accuratezza 100%, zero falsi positivi e zero falsi negativi;
- generazione dinamica Belgio: **15/15** schede bingo;
- generazione dinamica Bruxelles: **5/5** missioni e **2/2** contest;
- generazione dinamica Grand-Place: **5/5** missioni e **2/2** contest;
- modello verificato: `eu.amazon.nova-lite-v1:0`.
