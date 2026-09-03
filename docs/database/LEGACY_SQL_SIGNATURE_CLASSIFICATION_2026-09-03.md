# Classificazione firme SQL legacy

Data inventario live: 2026-09-03.

## Risultato iniziale

Il catalogo Neon conteneva 90 overload `app.*` con parametro attore testuale
`p_actor_legacy*`:

- 32 revocati a `smf_app` e già affiancati da un overload UUID;
- 2 revocati e non più utilizzati;
- 3 ancora eseguibili, ma con chiamanti runtime già passati all'overload UUID;
- 53 ancora eseguibili e privi di sostituto UUID completo.

Le migrazioni 165 e 166 hanno rimosso i primi tre gruppi, sempre senza `CASCADE`.
Il dry-run ha quindi verificato l'assenza di dipendenze catalogate prima dell'applicazione.

## Stato corrente

| Indicatore | Valore |
| --- | ---: |
| Firme testuali iniziali nel catalogo | 90 |
| Firme eliminate | 40 |
| Firme testuali residue | 50 |
| Firme residue eseguibili da `smf_app` | 50 |
| Bridge legacy nominativi nel runtime TypeScript | 0 |

La precedente baseline `maximumSqlLegacyFunctions: 54` conta i nomi funzione effettivi
ricostruiti staticamente dalle migrazioni, non gli overload presenti nel catalogo. Non deve
essere interpretata come inventario live.

## Strategia residua

Le 50 firme vengono convertite per dominio: operatività e comunicazioni, gruppi e
viaggiatori, gamification e fotografie, pubblicazione e catalogo, impersonificazione.
Ogni lotto introduce prima il contratto UUID, aggiorna i chiamanti, revoca la firma testuale,
la rimuove senza `CASCADE` e passa dry-run Neon, smoke test e gate di rilascio.
