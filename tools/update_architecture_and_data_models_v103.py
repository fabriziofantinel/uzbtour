from pathlib import Path
from docx import Document
from docx.enum.text import WD_BREAK

ROOT=Path("docs")
ARCH=sorted((ROOT/"architecture").glob("SMF_Travel_Architettura_Soluzione_v*.docx"))
LOGICAL=sorted((ROOT/"data-model").glob("SMF_Travel_Modello_Logico_Dati_v*.docx"))
PHYSICAL=sorted((ROOT/"data-model").glob("SMF_Travel_Modello_Fisico_Dati_v*.docx"))
MARKER="Addendum 2026-08-30 - Governance KPI, variazioni, contenuti e onboarding"

def bullet(doc,text): doc.add_paragraph(text,style="List Bullet")
def begin(doc):
    p=doc.add_paragraph();p.add_run().add_break(WD_BREAK.PAGE)
    doc.add_heading(MARKER,level=1)

def update_architecture(path):
    doc=Document(path)
    if any(p.text.strip()==MARKER for p in doc.paragraphs): return False
    begin(doc)
    doc.add_paragraph("L'addendum recepisce la migrazione 103_v3_kpi_change_content_governance e il commit applicativo 300ed2d, mantenendo invariati i confini Vercel, Neon, AWS e Cloudflare R2.")
    doc.add_heading("Componenti e connessioni",level=2)
    for text in [
        "Client agenzia -> Next.js App Router su Vercel -> API Analytics -> Neon: lettura tenant-scoped delle definizioni KPI versionate e degli aggregati operativi.",
        "Editor programma -> API Vercel -> stored procedure SECURITY DEFINER -> Neon: aggiornamento della giornata e creazione atomica di una comunicazione leggibile dal viaggiatore.",
        "Client viaggiatore -> API change-notices -> funzione di acknowledgement -> Neon: presa visione individuale, idempotente tramite client_operation_id.",
        "Worker Bedrock -> normalizzatore Zod -> materializzatore -> Neon: il contenuto sensibile viene salvato come needs_review con fonte, scadenza e disclaimer; l'AI non attribuisce lo stato approved.",
        "Invito personale -> pagina attiva-account -> API Cognito server-side: l'utente sceglie accesso rapido monouso oppure username/password; l'email non è una chiave di identità.",
    ]: bullet(doc,text)
    doc.add_heading("Sicurezza, resilienza e audit",level=2)
    for text in [
        "RLS forzata su registro variazioni e ricevute; agency_id è la scope key e il leading field degli indici tenant.",
        "Le mutazioni sono esposte al runtime esclusivamente tramite funzioni SECURITY DEFINER con search_path bloccato e verifica dell'appartenenza alla partenza.",
        "La presa visione non equivale ad accettazione contrattuale. Consegna push, apertura e presa visione sono eventi distinti.",
        "La migrazione è additiva, reversibile per disuso applicativo e compatibile con deploy a due fasi: schema prima, applicazione dopo.",
        "Baseline verificata: 74 tabelle, 60 tabelle RLS, nessun indice invalido, vincolo non validato o tabella tenant priva di indice leading.",
    ]: bullet(doc,text)
    doc.add_heading("Decisioni architetturali",level=2)
    doc.add_paragraph("ADR-GOV-01: le formule KPI sono dati versionati. ADR-GOV-02: il registro comunicazioni è separato dall'audit tecnico. ADR-GOV-03: i contenuti sensibili richiedono human review. ADR-IAM-02: il magic link consuma un invito personale e crea una sessione Cognito senza trasformare l'email in identificatore univoco. Le passkey restano un'evoluzione subordinata alla configurazione WebAuthn del dominio Cognito.")
    doc.save(path);return True

def update_logical(path):
    doc=Document(path)
    if any(p.text.strip()==MARKER for p in doc.paragraphs): return False
    begin(doc)
    doc.add_heading("Nuove entità logiche",level=2)
    for text in [
        "Definizione KPI: identificata da codice e versione; descrive formula, numeratore, denominatore, eventi sorgente, frequenza ed efficacia temporale.",
        "Comunicazione di variazione: appartiene a una agenzia e a una partenza; può riferirsi a una giornata o tappa e conserva precedente, corrente, autore, severità e data di pubblicazione.",
        "Presa visione: associa una comunicazione a un viaggiatore; è unica per coppia comunicazione-viaggiatore e idempotente per operazione client.",
        "Governance informazione utile: estende il contenuto con fonte, URL, acquisizione, verifica, scadenza, stato di revisione, revisore e disclaimer.",
        "Invito personale: resta associato a un solo utente e username; più inviti possono condividere la stessa email senza dipendenze reciproche.",
    ]: bullet(doc,text)
    doc.add_heading("Relazioni e cardinalità",level=2)
    for text in [
        "Agenzia 1:N Comunicazioni; Partenza 1:N Comunicazioni; Giornata 0..1:N Comunicazioni; Tappa 0..1:N Comunicazioni.",
        "Comunicazione N:M Viaggiatore tramite Presa visione; l'accesso è ammesso solo se esiste una membership attiva nella partenza.",
        "Versione programma 1:N Informazioni utili; ciascuna informazione possiede esattamente uno stato di revisione corrente.",
        "Definizione KPI 1:N versioni temporali, con una sola versione efficace per codice in un istante logico.",
        "Utente 1:N Inviti storici, ma ogni token attivo è personale, monouso e riferito a un solo utente.",
    ]: bullet(doc,text)
    doc.add_heading("Regole di business aggiunte",level=2)
    for text in [
        "BR-ANA-01: adozione = viaggiatori con sessione significativa / viaggiatori abilitati, non / account attivati.",
        "BR-ANA-02: refresh tecnici, impersonificazioni e membership rimosse non concorrono ai KPI commerciali.",
        "BR-CHG-01: ogni modifica pubblicata al programma genera una comunicazione leggibile; l'audit tecnico non la sostituisce.",
        "BR-CNT-01: salute, sicurezza, documenti, emergenze e ambasciata scadono dopo 7 giorni salvo regola più restrittiva; contenuti non sensibili dopo 90 giorni.",
        "BR-CNT-02: la generazione AI produce needs_review; solo un revisore autorizzato può impostare approved.",
        "BR-IAM-01: l'email è un recapito, lo username è l'identificatore di accesso; il consumo di un invito non invalida quelli associati ad altri utenti.",
    ]: bullet(doc,text)
    doc.save(path);return True

def update_physical(path):
    doc=Document(path)
    if any(p.text.strip()==MARKER for p in doc.paragraphs): return False
    begin(doc)
    doc.add_heading("Oggetti fisici introdotti dalla migrazione 103",level=2)
    for text in [
        "ops.analytics_kpi_definitions(code, version): PK composita; formula, definizioni, source_events, refresh_interval, effective_from/effective_to.",
        "ops.traveler_change_notices(id): FK agency/departure/day/item, JSONB previous_value/current_value, severity, changed_by, published_at.",
        "ops.traveler_change_notice_receipts(notice_id, traveler_id): PK composita; UNIQUE(traveler_id, client_operation_id).",
        "travel.template_useful_information: source_name, source_url, source_retrieved_at, verified_at, expires_at, review_status, reviewed_by, disclaimer.",
    ]: bullet(doc,text)
    doc.add_heading("Indici, vincoli e RLS",level=2)
    for text in [
        "traveler_change_notices_scope_idx(agency_id, departure_id, published_at DESC).",
        "traveler_change_receipts_tenant_idx(agency_id, traveler_id, read_at DESC).",
        "useful_information_governance_idx(agency_id, template_version_id, review_status, expires_at).",
        "CHECK su severity, change_type, review_status e intervallo di efficacia KPI; JSONB non nullo per valori precedente/corrente.",
        "ENABLE + FORCE RLS sulle due tabelle tenant operative; policy basata su current_setting('app.agency_id').",
        "ON DELETE RESTRICT per radici e identità; CASCADE limitata alle ricevute dipendenti dalla comunicazione e alla partenza secondo il ciclo batch già governato.",
    ]: bullet(doc,text)
    doc.add_heading("Stored API e transazionalità",level=2)
    for text in [
        "app.publish_traveler_change_notice_v3: SECURITY DEFINER, search_path fisso, verifica ruolo owner/editor e appartenenza della giornata alla partenza.",
        "app.acknowledge_traveler_change_notice_v3: SECURITY DEFINER, verifica membership attiva e upsert idempotente della ricevuta.",
        "app.update_departure_programme_day_v3 resta il punto di mutazione del programma; il repository applicativo registra subito dopo la comunicazione con snapshot precedente/corrente.",
        "Il runtime smf_app riceve SELECT minimo e EXECUTE esclusivamente sulle stored API; PUBLIC è revocato.",
    ]: bullet(doc,text)
    doc.add_heading("Stato di validazione fisica",level=2)
    doc.add_paragraph("Migrazione applicata con gate positivi. Inventario risultante: 74 tabelle, 60 RLS, 0 constraint non validati, 0 indici invalidi, 0 tabelle tenant senza indice agency_id-leading. Quality guard e build Next.js 16.3.2 superati.")
    doc.save(path);return True

changed=[]
for p in ARCH:
    if update_architecture(p):changed.append(str(p))
for p in LOGICAL:
    if update_logical(p):changed.append(str(p))
for p in PHYSICAL:
    if update_physical(p):changed.append(str(p))
print({"changed":len(changed),"files":changed})
