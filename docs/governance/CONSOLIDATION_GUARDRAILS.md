# Protezione del consolidamento

## Regola di rilascio

Il database V3 e il layout documentato in `DESIGN.md` sono baseline approvate. Ogni modifica deve partire da un ramo dedicato, produrre un deployment Preview e superare `npm run quality:gate`. Il deploy Production avviene solo dopo collaudo dei casi d'uso interessati.

## Database

- Le migrazioni `001`-`053` sono immutabili. Correzioni ed evoluzioni usano una nuova migrazione forward-only.
- Il runtime usa il ruolo `smf_app`; migrazioni e validazioni usano una connessione owner separata.
- È vietato riaprire accessi diretti alle tabelle normalizzate V2 in `public`.
- Ogni funzione `SECURITY DEFINER` deve fissare `search_path`, revocare l'esecuzione a `PUBLIC` e concedere soltanto i privilegi necessari.
- Prima di Production: dry-run su branch Neon Preview, apply, acceptance con `smf_app`, `db:validate:v3`, quindi la stessa sequenza in Production.
- Le modifiche distruttive richiedono migrazione dedicata, backup/branch Neon e approvazione esplicita indicata nel file SQL.

## Layout

- `PRODUCT.md` e `DESIGN.md` sono la fonte di verità.
- La baseline comprende tutte le pagine e gli stili sotto `app/`, escluse le API.
- Una modifica funzionale può cambiare la UI soltanto se mantiene accessibilità, mobile-first del viaggiatore e desktop/tablet del back-office.
- Se il layout cambia intenzionalmente, eseguire `npm run quality:baseline:report`, documentare prima/dopo e aggiornare la baseline soltanto dopo approvazione esplicita.
- Il controllo Impeccable deve essere rieseguito sulle superfici modificate prima del rilascio.

## Limiti e responsabilità

I gate riducono drasticamente il rischio ma non eliminano guasti di provider, errori umani con privilegi owner o modifiche effettuate direttamente dalle console. L'accesso Production deve restare limitato e ogni operazione manuale deve essere tracciata.
