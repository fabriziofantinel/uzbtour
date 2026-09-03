# Cutover identità runtime nativa

## Obiettivo

Le API applicative passano alle funzioni PostgreSQL l'identificatore IAM nativo tramite `p_actor_user_id UUID`. L'ID testuale del modello precedente resta nel risultato di alcuni contratti solo per compatibilità con dati e interfacce storiche, non per autorizzare l'attore.

## Baseline vincolante

Il registro `tests/contracts/native-identity-debt.json` ammette zero chiamate runtime a bridge legacy. `npm run check:native-identity` blocca ogni reintroduzione e fa parte di `quality:guard`, quindi della CI. Il cutover comprende sessioni impersonate superuser e agenzia, download privati, registrazione media, ambito viaggio, gamification, catalogo, spese, movimenti di cassa, note, feedback e programma. `npm run audit:v3:legacy-sql` interroga il catalogo Neon e distingue le firme storiche ancora presenti da quelle effettivamente eseguibili dal ruolo applicativo.

## Sequenza di migrazione

1. Estendere la sessione applicativa con l'UUID di `iam.users`, mantenendo temporaneamente anche l'ID testuale.
2. Introdurre overload SQL con primo parametro `p_actor_user_id UUID`, autorizzazione basata direttamente su IAM e test di tenant isolation.
3. Migrare prima le letture viaggiatore, poi spese e feedback, quindi gamification e media.
4. Migrare amministrazione, importazioni e impersonazione; ogni changeset deve ridurre il registro. Completato.
5. Portare la baseline runtime a zero. Completato con le migrazioni 149 e 150. Le migrazioni 151-154 hanno inoltre convertito Login come agenzia, letture della dashboard ed elenco agenti, riducendo a 79 le firme storiche censite. La loro rimozione fisica procede per dominio dopo l'introduzione e la verifica del sostituto nativo.

Ogni fase richiede dry-run e apply su Neon, smoke test con il ruolo `smf_app`, quality gate, build e verifica dei percorsi browser critici. Non sono ammessi accessi diretti a `ops.legacy_id_map` dal runtime.
