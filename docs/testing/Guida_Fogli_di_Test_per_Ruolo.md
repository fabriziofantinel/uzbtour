# Fogli di test per ruolo - guida d'uso

Questo pacchetto contiene un foglio di test per ciascun ruolo dell'applicazione.
Tutti i fogli hanno la **stessa struttura di colonne**, cosi gli esiti si possono
unire in un unico riepilogo finale.

## 1. I fogli

| File | Ruolo | Casi di test |
| --- | --- | --- |
| Test_Superuser_SMF_Travel.csv | Superuser (piattaforma) | 52 |
| Test_Agenzia_SMF_Travel.csv | Responsabile agenzia | 83 |
| Test_Agente_SMF_Travel.csv | Agente | 83 |
| Test_Accompagnatore_SMF_Travel.csv | Accompagnatore | 31 |
| Test_Guida_SMF_Travel.csv | Guida | 25 |
| Test_Viaggiatore_SMF_Travel.csv | Viaggiatore | 57 |

Totale: 331 casi di test.

Ogni foglio ha un file di istruzioni dedicato dove disponibile
(`..._Istruzioni.md/.pdf`); questa guida vale per tutti.

## 2. Come aprire i fogli

Sono file CSV con separatore **punto e virgola** (;). In Excel: Dati >
Da testo/CSV e imposta il separatore su "Punto e virgola". In Google Fogli:
File > Importa. Salva poi come .xlsx o Foglio Google mentre compili.

## 3. Come compilare (uguale per tutti i ruoli)

Le prime sette colonne descrivono il test e **non si modificano**. Si compila dalla
ottava in poi:

- **Esito**: `OK` / `KO` / `Bloccato` / `Non testabile`.
- **Gravita problema**: solo se KO o Bloccato (Bloccante / Grave / Media / Lieve).
- **Descrizione problema**: cosa e successo, in modo riproducibile.
- **Riproducibile**: Sempre / A volte / No.
- **Dispositivo e browser**, **Data test**, **Tester**, **Note**.

## 4. Ordine consigliato tra i ruoli

I ruoli si appoggiano ai dati creati dai ruoli precedenti. Esegui in quest'ordine:

1. **Superuser**: crea due agenzie A e B con i rispettivi responsabili.
2. **Agenzia (responsabile)**: crea i viaggi, i gruppi, i viaggiatori e il
   personale; pubblica almeno un viaggio in profilo Completo.
3. **Agente**: ripeti le funzioni operative con un account agente, verificando dove
   i permessi sono ridotti rispetto al responsabile.
4. **Accompagnatore** e **Guida**: assegnati al viaggio, provano l'operativita sul
   campo. Falli vicini perche condividono l'area ma con confini diversi.
5. **Viaggiatore**: dallo smartphone, l'esperienza completa prima, durante e dopo.

## 5. Differenze di ruolo importanti da conoscere

Alcuni test verificano che un ruolo NON possa fare una cosa. Sono negativi e sono
tra i piu importanti.

- **Agente vs Responsabile**: l'agente NON puo approvare o respingere i profili
  Paese (riservato al responsabile). Nel foglio agente i test AGT-CTY verificano
  proprio che l'operazione sia negata.
- **Guida vs Accompagnatore**: la guida puo usare SOLO la conversazione diretta con
  l'agenzia; le chat di viaggio, gruppo e individuale le sono precluse.
  L'accompagnatore invece puo usarle. Nel foglio guida i test GUI-CHT verificano il
  confine.
- **Accompagnatore e Guida** non vedono spese, cassa, ricordi e foto private dei
  gruppi, ne altri viaggi, ne i dati dell'agenzia; possono modificare solo le
  giornate a loro assegnate; rispettano la finestra temporale e la revoca.
- **Viaggiatore**: vede solo il proprio viaggio e il proprio gruppo; le foto di un
  minore richiedono consenso.

## 6. I test negativi piu importanti (non saltarli)

Un problema qui e grave. Verifica sempre che:

- Un'agenzia non veda i dati di un'altra agenzia.
- Un gruppo non veda spese, chat, foto e ricordi di un altro gruppo.
- Accompagnatore e guida non vedano denaro e contenuti privati, ne viaggi non
  assegnati.
- La guida non acceda alle chat che non le competono.
- L'agente non approvi i profili Paese.
- Un link o un identificativo copiato non dia accesso a chi non ne ha diritto.
- Gli sblocchi a orario (quiz alle 20:00 locali) resistano alla manomissione
  dell'ora del telefono.

## 7. Scala di gravita

- **Bloccante**: non si prosegue, si perdono dati, o si vedono dati non propri.
  Avvisa subito.
- **Grave**: la funzione non fa quello che deve, ma c'e un modo per aggirarla.
- **Media**: fastidio evidente, testo sbagliato, layout rotto, lentezza anomala.
- **Lieve**: rifinitura, refuso, dettaglio estetico.

## 8. Prove

Per ogni KO, salva uno screenshot con lo stesso ID del test (es. `VIA-GAM-03.png`).
Riporta eventuali codici d'errore e annota data e ora.

## 9. Ambiente

Prima di iniziare, assicurati di lavorare sull'ultima versione pubblicata
dell'applicazione: alcune funzioni (in particolare il personale operativo) sono
recenti e potrebbero non essere presenti su versioni piu vecchie, generando falsi
problemi.
