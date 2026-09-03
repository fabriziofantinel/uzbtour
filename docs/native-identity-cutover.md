# Cutover identità runtime nativa

## Obiettivo

Le API applicative devono passare alle funzioni PostgreSQL un identificatore IAM nativo tramite `p_actor_user_id UUID`. L'ID testuale del modello precedente resta ammesso soltanto nei bridge censiti durante la transizione.

## Baseline vincolante

Il registro `tests/contracts/native-identity-debt.json` fotografa ora 15 chiamate runtime residue a 5 bridge legacy. `npm run check:native-identity` blocca nuove funzioni legacy, nuovi utilizzi e baseline non ridotte dopo una rimozione. Il controllo fa parte di `quality:guard` e quindi della CI. Sessioni impersonate, download privati, registrazione media, spese, movimenti di cassa, note e feedback sono già passati all'identità UUID nativa.

## Sequenza di migrazione

1. Estendere la sessione applicativa con l'UUID di `iam.users`, mantenendo temporaneamente anche l'ID testuale.
2. Introdurre overload SQL con primo parametro `p_actor_user_id UUID`, autorizzazione basata direttamente su IAM e test di tenant isolation.
3. Migrare prima le letture viaggiatore, poi spese e feedback, quindi gamification e media.
4. Migrare amministrazione, importazioni e impersonazione; ogni changeset deve ridurre il registro.
5. Eliminare `app.resolve_legacy_user_id`, revocare gli ultimi bridge e portare la baseline a zero.

Ogni fase richiede dry-run e apply su Neon, smoke test con il ruolo `smf_app`, quality gate, build e verifica dei percorsi browser critici. Non sono ammessi accessi diretti a `ops.legacy_id_map` dal runtime.
