# Casi d'uso - Profili Paese verificati

## UC-REF-001 - Primo popolamento automatico

Dato un Paese privo di profilo, quando viene pubblicato il primo viaggio, il sistema interroga Web Grounding solo su fonti ufficiali, estrae il profilo strutturato, registra fonti e data, esegue i controlli deterministici e salva una revisione in Neon. Se tutti i controlli passano, lo stato è `verified`; altrimenti è `review_required` e le informazioni sensibili non vengono pubblicate.

## UC-REF-002 - Riuso tra viaggi e agenzie

Dato un profilo `verified` non scaduto, quando un altro viaggio dello stesso Paese viene pubblicato, il sistema riusa la versione presente in Neon senza una nuova ricerca Bedrock e materializza le stesse informazioni sensibili con fonti e scadenza.

## UC-REF-003 - Blocco di dati non verificati

Dato un candidato contenente un recapito non presente nel dossier o una fonte non citata, quando termina l'estrazione, il profilo passa a `review_required`, conserva gli errori e la pubblicazione delle informazioni utili si interrompe con un messaggio esplicito.

## UC-REF-004 - Revisione del responsabile dell'agenzia

Dato un profilo `review_required`, soltanto il responsabile (`owner`) dell'agenzia che utilizza quel Paese può approvarlo o rifiutarlo. Superuser, agenti e responsabili di altre agenzie ricevono `42501`. L'approvazione è legata all'agenzia e alla versione del profilo; una nuova versione richiede una nuova validazione.

## UC-REF-005 - Scadenza e aggiornamento

Dato un profilo con `refresh_after` superato, la successiva pubblicazione crea una nuova revisione tramite Grounding. La revisione precedente resta nell'audit e non viene sovrascritta.

## UC-REF-006 - Separazione contenuto fattuale e creativo

Durante la generazione di frasario, bingo, missioni e contest, Bedrock riceve il profilo verificato come contesto. Il modello può creare contenuti ludici, ma le 11 sezioni sensibili materializzate devono coincidere con il profilo verificato e non possono essere riscritte dal modello creativo.

## Criteri di prova

- Verificare 11 categorie univoche, ISO Paese/valuta e fusi IANA validi.
- Verificare che ogni fonte salvata compaia nelle citazioni Grounding.
- Verificare che ambasciata e contatti provengano da `esteri.it`.
- Alterare un numero nel payload e verificare il passaggio a `review_required`.
- Pubblicare due viaggi dello stesso Paese e verificare una sola versione attiva.
- Forzare la scadenza e verificare una nuova revisione con storico integro.
