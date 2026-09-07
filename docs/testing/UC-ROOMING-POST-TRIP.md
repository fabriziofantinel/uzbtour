# Casi d'uso rooming list e post viaggio

## Perimetro

Questi casi coprono la preparazione della rooming list prima della partenza e la valutazione complessiva due giorni dopo il rientro. Le prove non richiedono Bedrock o altri servizi AI.

## UC ROOM 01 Accesso per ruolo

**Attori autorizzati:** responsabile agenzia, agente e accompagnatore assegnato al viaggio.  
**Attore non autorizzato:** guida.

1. Aprire un viaggio dalla propria area operativa.
2. Selezionare `Rooming list` nel menu invariato del viaggio.
3. Verificare che responsabile, agente e accompagnatore vedano pernottamenti, gruppi e viaggiatori.
4. Accedere allo stesso URL come guida e verificare il rifiuto dell'accesso.

**Esito atteso:** la funzione è disponibile solo ai tre ruoli autorizzati e resta isolata all'agenzia e al viaggio correnti.

## UC ROOM 02 Assegnazione camere

1. Selezionare un pernottamento e un gruppo.
2. Creare camere singole, doppie, matrimoniali e triple.
3. Assegnare ciascun viaggiatore a una sola camera.
4. Inserire eventuali esigenze operative per l'hotel e salvare.
5. Cambiare gruppo o pernottamento e poi tornare alla selezione iniziale.

**Esito atteso:** tipologia, occupanti ed esigenze restano salvati per la combinazione pernottamento e gruppo selezionata; le assegnazioni degli altri gruppi e pernottamenti non cambiano.

## UC ROOM 03 Controlli preventivi

1. Lasciare almeno un viaggiatore non assegnato.
2. Tentare di superare la capienza dichiarata della camera.
3. Tentare di assegnare lo stesso viaggiatore a due camere.
4. Assegnare un minore a una camera senza adulti del suo gruppo.

**Esito atteso:** l'interfaccia segnala i non assegnati; capienza, duplicati e minore senza adulto impediscono il salvataggio. Gli stessi vincoli sono verificati nuovamente dal database.

## UC ROOM 04 Documento per hotel

1. Completare e salvare l'assegnazione di almeno un gruppo.
2. Selezionare il pernottamento e scaricare il DOCX.
3. Aprire il documento e controllare intestazione, hotel, data, gruppi, camere, tipologie, nomi ed esigenze.

**Esito atteso:** il documento è leggibile e non contiene numeri di passaporto, numeri di altri documenti o dati documentali sensibili.

## UC POST 01 Disponibilità e notifica

1. Aprire il viaggio prima che siano trascorsi due giorni dal rientro.
2. Ripetere la prova nel secondo giorno successivo, usando il fuso orario del viaggio.
3. Eseguire manualmente il processo schedulato delle notifiche push nell'ambiente di collaudo.

**Esito atteso:** prima della scadenza la valutazione non è disponibile; alla scadenza compare in `Altro` e la notifica apre direttamente la sezione `Valuta il viaggio`. Una nuova esecuzione non duplica la notifica della stessa partenza.

## UC POST 02 Valutazione complessiva

1. Selezionare ciascun valore limite della scala, inclusi 0 e 10.
2. Inserire un commento facoltativo e inviare.
3. Modificare voto e commento e salvare nuovamente.

**Esito atteso:** il voto deve essere compreso tra 0 e 10; il commento è facoltativo; una seconda conferma aggiorna la valutazione esistente senza duplicarla.

## UC POST 03 Esito alto neutro e basso

1. Salvare un voto da 9 a 10.
2. Verificare il collegamento alla recensione pubblica configurato dall'agenzia e il codice passaparola riferito ad agenzia, partenza e viaggiatore.
3. Salvare un voto da 7 a 8.
4. Salvare un voto da 0 a 6.

**Esito atteso:** con voto alto sono proposti recensione pubblica e passaparola; con voto neutro viene mostrato il ringraziamento; con voto basso non viene promossa una recensione pubblica ed è proposta la chat privata con l'agenzia.

## UC POST 04 Vista agenzia

1. Aprire Analytics come responsabile o agente.
2. Configurare un URL HTTPS per le recensioni pubbliche.
3. Filtrare per periodo e partenza.
4. Confrontare il voto post viaggio con i feedback per tappa della stessa partenza.

**Esito atteso:** sono visibili media e numero di valutazioni complessive per partenza, commenti, gruppo e viaggiatore; il confronto usa l'identificativo della partenza e non soltanto il titolo.

## UC POST 05 Isolamento e idempotenza

1. Ripetere una richiesta con lo stesso `client_operation_id`.
2. Tentare di leggere o scrivere una valutazione con partenza o gruppo di un'altra agenzia.

**Esito atteso:** la richiesta ripetuta non crea duplicati e l'accesso fuori tenant viene rifiutato.
