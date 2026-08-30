from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Iterable

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "data-model"
QA_DIR = ROOT / "tmp" / "data-model-qa"
DDL_PATH = ROOT / "database" / "schema-v3-review.sql"
DOCUMENT_VERSION = "1.3"

NAVY = "17324D"
BLUE = "2E74B5"
TEAL = "0F766E"
INK = "1F2937"
MUTED = "64748B"
LIGHT = "E8EEF5"
PALE = "F4F6F9"
WHITE = "FFFFFF"
RED = "9B1C1C"
GOLD = "7A5A00"
GREEN = "166534"
CONTENT_DXA = 9360
TABLE_INDENT_DXA = 120


TABLE_DESCRIPTIONS = {
    "ops.schema_migrations": "Registro immutabile delle migrazioni e del relativo checksum.",
    "iam.users": "Persona applicativa indipendente dal provider di autenticazione.",
    "iam.user_identities": "Identita esterne associabili a un utente applicativo.",
    "iam.agencies": "Tenant e soggetto contrattuale che governa viaggi e dati dei clienti.",
    "iam.agency_memberships": "Abilitazione di un utente come agente di una specifica agenzia.",
    "iam.invitations": "Inviti monouso con scadenza e token memorizzato solo come hash.",
    "iam.impersonation_sessions": "Sessioni di login-come del superadmin, motivate e auditabili.",
    "ref.countries": "Master globale dei paesi, identificato da codice ISO 3166-1 alpha-2.",
    "ref.cities": "Master globale delle localita, con coordinate e fuso verificabili.",
    "ref.visit_sites": "Master globale dei siti visitabili e relativi riferimenti ufficiali/Google.",
    "ref.hotels": "Master globale delle strutture ricettive.",
    "ref.currencies": "Reference data delle valute e dei minor unit ISO 4217.",
    "ref.reference_contents": "Contenuto riusabile per paese, citta o sito, con stato editoriale e freshness.",
    "ref.reference_content_sources": "Provenienza e data di acquisizione delle fonti usate dal contenuto.",
    "travel.trip_templates": "Prodotto itinerario riusabile, privo di date assolute.",
    "travel.trip_template_versions": "Snapshot editoriale versionato e pubblicabile dell'itinerario.",
    "travel.template_days": "Giorno relativo della versione, espresso come numero e offset.",
    "travel.template_day_cities": "Associazione ordinata tra giorno template e localita.",
    "travel.template_day_sites": "Associazione ordinata tra giorno template e sito da visitare.",
    "travel.template_day_hotels": "Associazione ordinata tra giorno template e pernottamento.",
    "travel.template_itinerary_items": "Scaletta ordinata del giorno; orari locali ammessi solo per trasporti.",
    "travel.template_itinerary_item_translations": "Traduzioni versionate delle tappe del template, con approvazione e stato di obsolescenza.",
    "travel.departures": "Istanza datata e venduta di una precisa versione del viaggio.",
    "travel.departure_days": "Mappa forte tra giorno relativo e data di servizio della partenza.",
    "travel.departure_itinerary_items": "Programma effettivo modificabile della partenza, derivato dal template.",
    "travel.departure_itinerary_item_translations": "Traduzioni e override linguistici delle tappe effettive della partenza.",
    "travel.itinerary_disruption_events": "Cronologia append-only di ritardi, cancellazioni e riprogrammazioni operative.",
    "travel.traveler_profiles": "Profilo viaggiatore riusabile nell'ambito di un'agenzia.",
    "travel.travel_parties": "Gruppo di viaggio e perimetro di condivisione all'interno della partenza.",
    "travel.party_memberships": "Partecipazione del viaggiatore al gruppo, con ruolo, capacita e stato.",
    "travel.traveler_guardianships": "Relazione contestuale e temporalizzata tra minore e adulto responsabile.",
    "travel.template_countries": "Paesi coperti dal template, ordinati e coerenti con il tenant.",
    "travel.template_accommodation_stays": "Pernottamenti multipli previsti nel giorno del template.",
    "travel.departure_accommodation_stays": "Pernottamenti effettivi della partenza, modificabili senza perdere il template sorgente.",
    "travel.template_useful_information": "Informazioni utili materializzate e localizzate per paese e versione.",
    "travel.template_phrasebook_entries": "Frasi localizzate generate per la lingua del paese del viaggio.",
    "content.activities": "Definizione governata di quiz, missione, bingo, gioco o contest.",
    "content.activity_items": "Elementi atomici dell'attivita: domande, celle, missioni e regole.",
    "content.activity_translations": "Titoli e istruzioni localizzati delle attivita, senza duplicare la regola di gioco.",
    "content.activity_item_translations": "Prompt e opzioni localizzati; le chiavi di risposta restano fuori dalla traduzione.",
    "ops.media_assets": "Metadati e ambito di accesso degli oggetti conservati in R2/S3.",
    "ops.media_asset_subjects": "Persone dichiarate o confermate come presenti in un asset multimediale.",
    "ops.travel_documents": "Documento del template, della partenza o di una singola tappa.",
    "ops.import_jobs": "Workflow di importazione, normalizzazione, revisione e pubblicazione preventivo.",
    "ops.generation_runs": "Lineage tecnico di ogni esecuzione AI, inclusi modello, prompt hash e costo.",
    "ops.platform_jobs": "Coda applicativa idempotente con possibile consegna a SQS.",
    "ops.integration_outbox": "Outbox transazionale per side effect esterni, inclusa cancellazione oggetti.",
    "ops.agency_deletion_jobs": "Workflow durevole e a fasi per la cancellazione asincrona dell'agenzia.",
    "ops.legacy_id_map": "Mappa tecnica owner-only tra identificativi legacy e UUID canonici V3.",
    "ops.legacy_generated_content_map": "Mappa tecnica owner-only tra contenuti legacy e activity item V3.",
    "privacy.consent_records": "Decisioni di consenso append-only, versionate, revocabili e corredabili da evidenza.",
    "journey.expense_groups": "Perimetro esplicito di condivisione spese tra famiglie della stessa partenza.",
    "journey.expense_group_parties": "Adesione verificabile di una famiglia a un gruppo di condivisione spese.",
    "journey.expenses": "Spesa con pagatore, importo originale, controvalore storico e metodo di ripartizione.",
    "journey.expense_shares": "Quota attribuita a un viaggiatore, riconciliata con i totali della spesa.",
    "journey.settlements": "Pagamento di pareggio o storno append-only tra viaggiatori del gruppo spese.",
    "journey.cash_movements": "Prelievo o cambio con importi e tasso effettivamente applicato.",
    "journey.day_notes": "Nota condivisa della famiglia per una giornata della partenza.",
    "journey.restaurant_visits": "Locale visitato dalla famiglia durante una giornata.",
    "journey.memories": "Ricordo fotografico/commentato, isolato per famiglia e giornata.",
    "journey.activity_access_grants": "Autorizzazione server-side allo scaricamento del quiz dopo lo sblocco temporale.",
    "journey.activity_attempts": "Tentativo e punteggio con grant, tempo client informativo e ricezione server verificabile.",
    "journey.activity_evidence": "Foto probatoria associata a tentativo o elemento della sfida.",
    "journey.photo_contest_entries": "Una delle massimo due foto del partecipante per contest.",
    "journey.photo_contest_judgements": "Valutazione AI o umana separata e riproducibile della foto.",
    "journey.programme_feedback": "Valutazione 1-5 della tappa effettiva della partenza.",
    "ops.audit_events": "Registro append-only delle azioni rilevanti e delle variazioni.",
}


LOGICAL_DOMAINS = [
    ("Identita e tenant", "Account, identita esterne, agenzie, agenti, inviti e impersonazione.",
     ["Utente", "Identita di autenticazione", "Agenzia", "Ruolo in agenzia", "Invito", "Sessione login-come"]),
    ("Master e reference data", "Anagrafiche globali deduplicate e contenuti riusabili con fonti e freshness.",
     ["Paese", "Localita", "Sito da visitare", "Hotel", "Valuta", "Contenuto di riferimento", "Fonte"]),
    ("Prodotto e programma", "Itinerario riusabile, versioni immutabili, giorni e scaletta senza vincolo orario.",
     ["Template viaggio", "Versione", "Giorno template", "Tappa template", "Attivita ludica"]),
    ("Erogazione del viaggio", "Istanza datata, programma effettivo, variazioni, famiglie e viaggiatori.",
     ["Partenza", "Giorno partenza", "Tappa effettiva", "Evento disruption", "Famiglia", "Viaggiatore", "Partecipazione", "Tutela"]),
    ("Esperienza privata", "Dati separati o condivisi esplicitamente: denaro, media, risultati e feedback.",
     ["Gruppo spese", "Spesa", "Quota", "Pareggio", "Consenso", "Ricordo", "Grant quiz", "Tentativo", "Contest", "Feedback"]),
    ("Documenti, AI e integrazioni", "Metadati R2/S3, importazioni, lineage AI, job, outbox e audit.",
     ["Asset", "Documento", "Importazione", "Generazione AI", "Job", "Evento outbox", "Cancellazione agenzia", "Evento audit"]),
]


BUSINESS_RULES = [
    ("BR-001", "Tenant", "Ogni dato operativo appartiene a una sola agenzia; nessuna FK tenant puo attraversare agency_id."),
    ("BR-002", "Viaggio", "Le date assolute appartengono alla Partenza, mai al Template riusabile."),
    ("BR-003", "Versioni", "Una versione pubblicata e immutabile; ogni correzione genera una nuova versione."),
    ("BR-004", "Programma", "La giornata e una scaletta ordinata. Gli orari sono opzionali e ammessi solo per trasferimento, volo e treno."),
    ("BR-005", "Esecuzione", "Il programma effettivo della partenza e materializzato; le modifiche dell'agente non alterano il template pubblicato."),
    ("BR-006", "Gruppo", "Spese, cambi, ricordi, risultati, classifiche e contest sono isolati per gruppo di viaggio."),
    ("BR-007", "Partecipazione", "Solo un viaggiatore membro attivo del gruppo puo scrivere fatti per quel gruppo."),
    ("BR-008", "Valute", "Ogni spesa conserva minor unit, valuta, tasso applicato e importo base; i consuntivi storici non usano tassi live."),
    ("BR-009", "Media", "I blob sono privati in R2/S3; Neon conserva metadati, checksum, scope, retention e stato."),
    ("BR-010", "Quiz", "Ogni quiz giornaliero pubblicabile contiene 10 domande coerenti con citta e siti del giorno; lo sblocco standard e alle 20:00 locali."),
    ("BR-011", "Missioni", "Il pacchetto giornaliero contiene 5 missioni; lo sblocco standard e alle 20:00 locali di due giorni prima."),
    ("BR-012", "Bingo", "Il bingo e sempre disponibile e contiene 15 celle su schema 3x9; punti per ambo, terno, quaterna, cinquina e tombola."),
    ("BR-013", "Giochi", "I giochi sono sempre disponibili; il puzzle usa un asset del giorno o l'icona applicativa come fallback."),
    ("BR-014", "Contest", "Ogni giorno prevede contest libero e a tema; massimo due foto per viaggiatore e contest."),
    ("BR-015", "Validazione", "Le prove di missioni/bingo e l'avvio dei contest sono governati dal ruolo organizer, non da nomi propri."),
    ("BR-016", "Feedback", "Ogni viaggiatore puo assegnare un solo voto 1-5 a ciascuna tappa effettiva, incluso il pernottamento."),
    ("BR-017", "AI", "Nessun contenuto AI diventa visibile senza fonti, versione del modello, stato editoriale e approvazione umana."),
    ("BR-018", "Idempotenza", "Ogni scrittura mobile ritentabile porta un client_operation_id univoco nel proprio scope."),
    ("BR-019", "Cancellazione", "La cancellazione agenzia e asincrona e a fasi: freeze, revoca accessi, oggetti, facts, partenze, template, membership e chiusura; la FK radice e RESTRICT."),
    ("BR-020", "Audit", "Impersonazione, pubblicazione, giudizi, cancellazioni e variazioni critiche generano eventi append-only."),
    ("BR-021", "Ripartizione spese", "Una spesa non aggregata diventa allocated solo se quote originali e base riconciliano esattamente; lo split cross-family richiede adesione attiva al gruppo spese."),
    ("BR-022", "Minori", "La capacita e valutata alla data di partenza; un minore dipendente richiede un adulto responsabile attivo per esprimere il consenso."),
    ("BR-023", "Consensi media", "Le decisioni sono append-only e versionate; un minore non puo essere associato a un media senza consenso immagini corrente."),
    ("BR-024", "Disruption", "Ritardi, cancellazioni e riprogrammazioni passano da un comando atomico e conservano stato originale, motivazione ed evento append-only."),
    ("BR-025", "Quiz offline", "Il payload delle domande e disponibile solo con grant server-side calcolato nel fuso della partenza; answer_spec non viene esposto al client."),
    ("BR-026", "Localizzazione", "Il locale effettivo segue il fallback viaggiatore-famiglia-partenza-template; traduzioni e contenuto sorgente restano entita distinte."),
]


RELATIONSHIPS = [
    ("Agenzia", "Ruolo in agenzia", "1:N", "Un agente puo appartenere a piu agenzie; il ruolo e contestuale."),
    ("Utente", "Identita esterna", "1:N", "Un utente puo avere piu provider, uno per provider."),
    ("Agenzia", "Template viaggio", "1:N", "Il template e posseduto dall'agenzia."),
    ("Template viaggio", "Versione", "1:N", "Le versioni conservano la storia editoriale."),
    ("Versione", "Giorno template", "1:N", "Numero e offset sono univoci nella versione."),
    ("Giorno template", "Tappa template", "1:N", "Ordine univoco; orario normalmente assente."),
    ("Versione", "Partenza", "1:N", "La partenza blocca la versione pubblicata utilizzata."),
    ("Partenza", "Giorno partenza", "1:N", "Ogni data di servizio mappa un giorno della stessa versione."),
    ("Giorno partenza", "Tappa effettiva", "1:N", "E la scaletta modificabile dall'agente."),
    ("Partenza", "Famiglia", "1:N", "Ogni famiglia e un perimetro privato."),
    ("Famiglia", "Partecipazione", "1:N", "La partecipazione collega profilo e ruolo."),
    ("Viaggiatore", "Partecipazione", "1:N", "Il profilo e riutilizzabile in viaggi differenti."),
    ("Famiglia", "Spesa/ricordo/risultato", "1:N", "Ogni fatto porta anche partenza e agenzia per integrita e RLS."),
    ("Gruppo spese", "Famiglia", "N:M", "Solo famiglie aderenti possono ricevere quote cross-family."),
    ("Spesa", "Quota", "1:0..N", "Le quote riconciliano importo originale e controvalore base alla transizione allocated."),
    ("Minore", "Adulto responsabile", "N:M", "La tutela e contestuale alla partenza e limitata temporalmente."),
    ("Viaggiatore", "Consenso", "1:N", "Ogni decisione conserva soggetto, decisore, policy, ambito e precedente superato."),
    ("Tappa effettiva", "Evento disruption", "1:N", "La tappa resta presente; ogni variazione operativa e ricostruibile."),
    ("Attivita", "Elemento attivita", "1:N", "Domande e celle sono elementi atomici governati."),
    ("Viaggiatore + Attivita", "Tentativo", "1:0..1", "Un tentativo definitivo per famiglia; policy estendibile."),
    ("Viaggiatore + Quiz", "Grant accesso", "1:0..1 attivo", "Il server autorizza il download dopo lo sblocco o override tracciato."),
    ("Contest + Viaggiatore", "Foto candidata", "1:0..3", "Lo slot 1-3 rende il limite verificabile dal DB."),
    ("Tappa effettiva + Viaggiatore", "Feedback", "1:0..1", "Nessun target polimorfico: hotel e visita sono tappe."),
]


CDE = [
    ("Agenzia.id", "Identita", "Univocita, validita", "Platform owner", "UUIDv7; PK; immutabile"),
    ("Partenza.date", "Programma", "Completezza, coerenza", "Agency steward", "ends_on >= starts_on; copertura giorni"),
    ("Partenza.versione", "Programma", "Consistenza", "Agency steward", "FK composita agenzia-template-versione"),
    ("Giorno partenza", "Programma", "Consistenza", "Agency steward", "Stessa partenza/versione; data univoca"),
    ("Tappa.sort_order", "Programma", "Univocita", "Agency steward", "Univoco nel giorno"),
    ("Sito/Hotel.location", "Master data", "Accuratezza", "Catalog steward", "Coordinate puntuali verificate; mai surrogate dalla citta"),
    ("Contenuto.refresh_after", "Contenuti", "Attualita", "Content steward", "Refresh a 6 mesi o su evento"),
    ("Spesa.base_amount", "Finanza", "Accuratezza, tracciabilita", "Family organizer", "Minor unit + tasso storico immutabile"),
    ("Spesa.quote", "Finanza", "Completezza, riconciliazione", "Family organizer", "Somme originali/base esatte; differenza equal al massimo 1 minor unit"),
    ("Membership famiglia", "Privacy", "Consistenza, autorizzazione", "Agency steward", "FK di ogni fatto al membro"),
    ("Media.scope", "Privacy", "Confidenzialita", "Platform security", "Scope composito + URL firmate a breve durata"),
    ("Consenso minore", "Privacy", "Validita, prova, attualita", "Privacy steward", "Tutore attivo, policy version, decisione append-only e revoca"),
    ("Quiz.access_grant", "Sicurezza", "Autenticita, temporalita", "Product security", "Orario server/fuso partenza, token hash, payload senza answer key"),
    ("Generazione AI", "Lineage", "Tracciabilita", "Content steward", "Provider, modello, prompt hash, fonti, approvazione"),
]


SOURCE_ROWS = [
    ("DAMA-DMBOK 2.0 Revised (2024)", "Governance, modellazione, master/reference data, metadata, qualita e sicurezza.", "https://dama.org/dama-dmbok-revision/"),
    ("DAMA-DMBOK infographics", "Conferma delle aree di conoscenza applicate al modello.", "https://dama.org/dmbok2r-infographics/"),
    ("PostgreSQL 18 - Constraints", "PK, FK, MATCH, azioni referenziali e indicizzazione delle FK.", "https://www.postgresql.org/docs/18/ddl-constraints.html"),
    ("PostgreSQL 18 - Row Security", "Policy RLS e comportamento dei ruoli.", "https://www.postgresql.org/docs/18/ddl-rowsecurity.html"),
    ("PostgreSQL 18 - UUID functions", "Uso di uuidv7() nativo per chiavi distribuite temporalmente ordinate.", "https://www.postgresql.org/docs/18/functions-uuid.html"),
    ("PostgreSQL 18 - Generated columns", "Colonne derivate e relative restrizioni.", "https://www.postgresql.org/docs/18/ddl-generated-columns.html"),
    ("PostgreSQL 18 - SELECT locking", "FOR UPDATE SKIP LOCKED per claim concorrenti di code.", "https://www.postgresql.org/docs/18/sql-select.html"),
    ("Neon Serverless Driver", "HTTP runtime, transaction context e divieto di owner/BYPASSRLS.", "https://neon.com/docs/serverless/serverless-driver"),
    ("Neon Connection Pooling", "Endpoint pooled per runtime e direct URL per migrazioni.", "https://neon.com/docs/connect/connection-pooling"),
    ("Neon Scale to Zero", "Sospensione per inattivita e riattivazione del compute alla connessione.", "https://neon.com/docs/introduction/scale-to-zero"),
    ("Neon Branching Workflow", "Branch isolati, test e migrazioni prima della produzione.", "https://neon.com/docs/get-started-with-neon/workflow-primer"),
]


def rgb(hex_value: str) -> RGBColor:
    return RGBColor.from_string(hex_value)


def apply_business_vocabulary(doc) -> None:
    """Allinea la terminologia utente: party resta fisico, ma in italiano e sempre gruppo."""
    paragraphs = list(doc.paragraphs)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                paragraphs.extend(cell.paragraphs)
    replacements = [
        ("cross-family", "cross-group"),
        ("Famiglie", "Gruppi"),
        ("famiglie", "gruppi"),
        ("Famiglia", "Gruppo"),
        ("famiglia", "gruppo"),
    ]
    for paragraph in paragraphs:
        updated = paragraph.text
        for old, new in replacements:
            updated = updated.replace(old, new)
        if updated != paragraph.text:
            for run in paragraph.runs:
                run.text = ""
            (paragraph.runs[0] if paragraph.runs else paragraph.add_run()).text = updated


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=80, start=120, bottom=80, end=120) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for m, v in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(v))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_table_geometry(table, widths: list[int], indent=TABLE_INDENT_DXA) -> None:
    total = sum(widths)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    tbl_pr = table._tbl.tblPr
    layout = tbl_pr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(total))
    tbl_w.set(qn("w:type"), "dxa")
    tbl_ind = tbl_pr.find(qn("w:tblInd"))
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), str(indent))
    tbl_ind.set(qn("w:type"), "dxa")
    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths:
        gc = OxmlElement("w:gridCol")
        gc.set(qn("w:w"), str(width))
        grid.append(gc)
    for row in table.rows:
        for i, cell in enumerate(row.cells):
            cell.width = Inches(widths[i] / 1440)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.find(qn("w:tcW"))
            if tc_w is None:
                tc_w = OxmlElement("w:tcW")
                tc_pr.append(tc_w)
            tc_w.set(qn("w:w"), str(widths[i]))
            tc_w.set(qn("w:type"), "dxa")
            set_cell_margins(cell)


def set_run_font(run, name="Calibri", size=None, color=INK, bold=None, italic=None) -> None:
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    if size is not None:
        run.font.size = Pt(size)
    if color:
        run.font.color.rgb = rgb(color)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic


def add_page_field(paragraph) -> None:
    run = paragraph.add_run()
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.extend([fld_char1, instr, fld_char2])
    set_run_font(run, size=9, color=MUTED)


def configure_document(doc: Document, short_title: str) -> None:
    sec = doc.sections[0]
    sec.page_width = Inches(8.5)
    sec.page_height = Inches(11)
    sec.top_margin = Inches(1)
    sec.bottom_margin = Inches(1)
    sec.left_margin = Inches(1)
    sec.right_margin = Inches(1)
    sec.header_distance = Inches(0.492)
    sec.footer_distance = Inches(0.492)
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Calibri"
    normal._element.rPr.rFonts.set(qn("w:ascii"), "Calibri")
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Calibri")
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = rgb(INK)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.15
    for name, size, color, before, after in (
        ("Title", 27, NAVY, 0, 8),
        ("Subtitle", 14, MUTED, 0, 14),
        ("Heading 1", 16, BLUE, 16, 8),
        ("Heading 2", 13, BLUE, 12, 6),
        ("Heading 3", 11.5, NAVY, 8, 4),
    ):
        st = styles[name]
        st.font.name = "Calibri"
        st._element.rPr.rFonts.set(qn("w:ascii"), "Calibri")
        st._element.rPr.rFonts.set(qn("w:hAnsi"), "Calibri")
        st.font.size = Pt(size)
        st.font.color.rgb = rgb(color)
        st.font.bold = name != "Subtitle"
        st.paragraph_format.space_before = Pt(before)
        st.paragraph_format.space_after = Pt(after)
        st.paragraph_format.keep_with_next = True
    for name in ("List Bullet", "List Number"):
        st = styles[name]
        st.font.name = "Calibri"
        st.font.size = Pt(10.5)
        st.paragraph_format.left_indent = Inches(0.5)
        st.paragraph_format.first_line_indent = Inches(-0.25)
        st.paragraph_format.space_after = Pt(5)
        st.paragraph_format.line_spacing = 1.15
    header = sec.header
    p = header.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_after = Pt(0)
    r = p.add_run(f"SMF TRAVEL  |  {short_title.upper()}")
    set_run_font(r, size=8.5, color=MUTED, bold=True)
    footer = sec.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = fp.add_run(f"Versione {DOCUMENT_VERSION}  |  Pagina ")
    set_run_font(r, size=9, color=MUTED)
    add_page_field(fp)
    props = doc.core_properties
    props.author = "SMF Travel"
    props.last_modified_by = "SMF Travel"
    props.subject = "Modello dati target v3 per validazione indipendente"
    props.keywords = "DAMA-DMBOK, PostgreSQL, Neon, modello dati"


def add_cover(doc: Document, title: str, subtitle: str, model_type: str) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run("ARCHITETTURA DATI  |  CANDIDATO ALLA VALIDAZIONE")
    set_run_font(r, size=9, color=TEAL, bold=True)
    p = doc.add_paragraph(title, style="Title")
    p.paragraph_format.space_after = Pt(6)
    doc.add_paragraph(subtitle, style="Subtitle")
    table = doc.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "Campo"
    table.cell(0, 1).text = "Valore"
    for cell in table.rows[0].cells:
        set_cell_shading(cell, LIGHT)
        for run in cell.paragraphs[0].runs:
            set_run_font(run, size=9, color=NAVY, bold=True)
    set_repeat_table_header(table.rows[0])
    rows = [
        ("Sistema", "SMF Travel - piattaforma SaaS multi-agenzia"),
        ("Elaborato", model_type),
        ("Versione", f"{DOCUMENT_VERSION} - Target state v3"),
        ("Data", "26 agosto 2026"),
        ("Stato", "Pronto per revisione indipendente"),
    ]
    for i, (label, value) in enumerate(rows):
        cells = table.add_row().cells
        cells[0].text = label
        cells[1].text = value
        set_cell_shading(cells[0], PALE)
        cells[0].paragraphs[0].runs[0].bold = True
    set_table_geometry(table, [2200, 7160])
    doc.add_paragraph()
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after = Pt(0)
    r = p.add_run("Base metodologica")
    set_run_font(r, size=10, color=MUTED, bold=True)
    p = doc.add_paragraph("DAMA-DMBOK 2.0 Revised (2024), progettazione relazionale, PostgreSQL 18 e pattern serverless Neon.")
    p.paragraph_format.space_after = Pt(0)
    doc.add_page_break()


def add_status_callout(doc: Document, label: str, text: str, color=GREEN) -> None:
    p = doc.add_paragraph()
    p_pr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), PALE)
    p_pr.append(shd)
    p.paragraph_format.left_indent = Inches(0.08)
    p.paragraph_format.right_indent = Inches(0.08)
    p.paragraph_format.space_before = Pt(5)
    p.paragraph_format.space_after = Pt(8)
    r = p.add_run(f"{label}: ")
    set_run_font(r, size=10.5, color=color, bold=True)
    r = p.add_run(text)
    set_run_font(r, size=10.5, color=INK)


def set_picture_alt(inline_shape, title: str, description: str) -> None:
    doc_pr = inline_shape._inline.docPr
    doc_pr.set("title", title)
    doc_pr.set("descr", description)


def add_table(doc: Document, headers: list[str], rows: Iterable[Iterable[str]], widths: list[int], font_size=9.2):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    for i, h in enumerate(headers):
        cell = table.cell(0, i)
        cell.text = h
        set_cell_shading(cell, LIGHT)
        for run in cell.paragraphs[0].runs:
            set_run_font(run, size=font_size, color=NAVY, bold=True)
    set_repeat_table_header(table.rows[0])
    for row in rows:
        table_row = table.add_row()
        # A semantic record must never be fragmented across two pages.
        cant_split = OxmlElement("w:cantSplit")
        table_row._tr.get_or_add_trPr().append(cant_split)
        cells = table_row.cells
        for i, value in enumerate(row):
            cells[i].text = str(value)
            for p in cells[i].paragraphs:
                p.paragraph_format.space_before = Pt(0)
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.line_spacing = 1.05
                for run in p.runs:
                    set_run_font(run, size=font_size, color=INK)
    set_table_geometry(table, widths)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return table


def add_bullets(doc: Document, items: Iterable[str]) -> None:
    for item in items:
        doc.add_paragraph(item, style="List Bullet")


def add_sources(doc: Document) -> None:
    doc.add_heading("Riferimenti autorevoli", level=1)
    add_table(doc, ["Fonte", "Impiego nel modello", "URL"], SOURCE_ROWS, [2450, 3800, 3110], font_size=8.4)
    p = doc.add_paragraph("Nota: DAMA-DMBOK e un framework di buone pratiche, non una certificazione automatica del modello. Le scelte specifiche restano motivate e verificabili nel presente elaborato.")
    p.runs[0].italic = True


def draw_domain_overview(path: Path) -> None:
    w, h = 1800, 1080
    im = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(im)
    font_path = Path("C:/Windows/Fonts/arial.ttf")
    bold_path = Path("C:/Windows/Fonts/arialbd.ttf")
    font = ImageFont.truetype(str(font_path), 27)
    small = ImageFont.truetype(str(font_path), 21)
    bold = ImageFont.truetype(str(bold_path), 29)
    nodes = {
        "Identita e tenant": (60, 70, 520, 260, "#E8EEF5"),
        "Master / reference": (640, 70, 1160, 260, "#E8F5F1"),
        "Prodotto viaggio": (1280, 70, 1740, 260, "#FFF4D6"),
        "Partenza datata": (1280, 430, 1740, 620, "#FBE8E8"),
        "Famiglia e viaggiatori": (640, 430, 1160, 620, "#F3E8FF"),
        "Esperienza privata": (60, 430, 520, 620, "#EAF2FF"),
        "Documenti / AI / audit": (640, 790, 1160, 990, "#F2F4F7"),
    }
    arrows = [
        ("Identita e tenant", "Prodotto viaggio"),
        ("Master / reference", "Prodotto viaggio"),
        ("Prodotto viaggio", "Partenza datata"),
        ("Partenza datata", "Famiglia e viaggiatori"),
        ("Famiglia e viaggiatori", "Esperienza privata"),
        ("Master / reference", "Documenti / AI / audit"),
        ("Prodotto viaggio", "Documenti / AI / audit"),
        ("Esperienza privata", "Documenti / AI / audit"),
    ]
    centers = {}
    for name, (x1, y1, x2, y2, fill) in nodes.items():
        centers[name] = ((x1+x2)//2, (y1+y2)//2)
    for a, b in arrows:
        x1, y1 = centers[a]
        x2, y2 = centers[b]
        d.line((x1, y1, x2, y2), fill="#94A3B8", width=5)
    details = {
        "Identita e tenant": "Utenti - Agenzie - Agenti",
        "Master / reference": "Paesi - Citta - Siti - Hotel",
        "Prodotto viaggio": "Template - Versioni - Giorni - Contenuti",
        "Partenza datata": "Date - Programma effettivo",
        "Famiglia e viaggiatori": "Party - Membership - Ruoli",
        "Esperienza privata": "Spese - Foto - Giochi - Feedback",
        "Documenti / AI / audit": "R2/S3 - Import - Lineage - Outbox",
    }
    for name, (x1, y1, x2, y2, fill) in nodes.items():
        d.rounded_rectangle((x1, y1, x2, y2), radius=28, fill=fill, outline="#475569", width=3)
        bb = d.textbbox((0,0), name, font=bold)
        d.text(((x1+x2-bb[2])/2, y1+42), name, font=bold, fill="#17324D")
        bb2 = d.textbbox((0,0), details[name], font=small)
        d.text(((x1+x2-bb2[2])/2, y1+112), details[name], font=small, fill="#475569")
    im.save(path)


def parse_tables(ddl: str):
    results = []
    pattern = re.compile(r"CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_]+\.[a-z_]+)\s*\(", re.I)
    for m in pattern.finditer(ddl):
        name = m.group(1)
        start = m.end()
        depth = 1
        i = start
        in_quote = False
        while i < len(ddl) and depth:
            ch = ddl[i]
            if ch == "'":
                in_quote = not in_quote
            elif not in_quote:
                if ch == "(": depth += 1
                elif ch == ")": depth -= 1
            i += 1
        body = ddl[start:i-1]
        parts, buf, depth, in_quote = [], [], 0, False
        for ch in body:
            if ch == "'": in_quote = not in_quote
            if not in_quote:
                if ch == "(": depth += 1
                elif ch == ")": depth -= 1
                elif ch == "," and depth == 0:
                    parts.append("".join(buf).strip())
                    buf = []
                    continue
            buf.append(ch)
        if buf: parts.append("".join(buf).strip())
        columns, constraints = [], []
        for part in parts:
            compact = re.sub(r"\s+", " ", part).strip()
            if not compact:
                continue
            if compact.upper().startswith(("PRIMARY KEY", "UNIQUE", "CHECK", "FOREIGN KEY", "CONSTRAINT")):
                constraints.append(compact)
            else:
                bits = compact.split(" ", 1)
                if len(bits) == 2:
                    columns.append((bits[0], bits[1]))
        results.append((name, columns, constraints))
    return results


def build_logical(diagram_path: Path) -> Path:
    path = OUT_DIR / "SMF_Travel_Modello_Logico_Dati_v1.3.docx"
    doc = Document()
    configure_document(doc, "Modello logico dati")
    doc.core_properties.title = "SMF Travel - Modello Logico dei Dati"
    add_cover(doc, "Modello Logico dei Dati", "Semantica, relazioni, regole e governo del dato", "Modello logico indipendente dalla tecnologia")

    doc.add_heading("1. Esito della verifica", level=1)
    add_status_callout(doc, "ESITO", "Il modello target v3.2 integra split e pareggi, minori e consensi, disruption operative, quiz offline governati e localizzazione dinamica. La fondazione fisica e stata installata e collaudata su Neon Production; backfill e cutover del runtime dalle tabelle public restano governati dal piano di convergenza.")
    doc.add_paragraph("La validazione ha distinto il significato di business dall'implementazione. Sono state eliminate ambiguita tra template e partenza, tra utente e identita di autenticazione, e tra tappa prevista e tappa effettivamente erogata. Le relazioni che isolano agenzia, partenza e famiglia sono esplicite e verificabili.")

    doc.add_heading("2. Scopo e confini", level=1)
    add_table(doc, ["Incluso", "Escluso intenzionalmente"], [
        ("Multi-agenzia, agenti e superadmin", "CRM commerciale e redazione del preventivo prima dell'accettazione"),
        ("Itinerari riusabili, versioni, partenze e programma", "Contabilita generale, fatturazione elettronica e incassi cliente"),
        ("Famiglie, viaggiatori, spese, ricordi e feedback", "GDS/PNR, emissione biglietti e inventory fornitori"),
        ("Quiz, missioni, bingo, giochi e contest", "Cartella clinica o gestione sanitaria del viaggiatore"),
        ("Import documenti, AI, R2/S3, audit e outbox", "Data warehouse analitico; saranno previste viste/eventi di alimentazione"),
    ], [4680, 4680])

    doc.add_heading("3. Metodo DAMA applicato", level=1)
    add_table(doc, ["Area DAMA-DMBOK", "Applicazione concreta"], [
        ("Data Governance", "Owner e steward per dominio, decision rights, regole BR numerate e publish gate."),
        ("Data Architecture", "Separazione tra master globali, prodotto, erogazione, fatti privati e operations."),
        ("Data Modeling & Design", "Entita, cardinalita, chiavi, normalizzazione e ridondanze controllate."),
        ("Reference & Master Data", "Paesi, localita, siti, hotel e valute deduplicati e riusabili."),
        ("Metadata Management", "Glossario, lineage fonti/AI, versioni, checksum e stato editoriale."),
        ("Data Quality", "CDE, dimensioni di qualita, controlli preventivi e freshness a sei mesi."),
        ("Data Security", "Tenant isolation, scope famiglia, classificazione, minimo privilegio e audit."),
        ("Document & Content", "Blob privati fuori DB; metadati, retention e cancellazione orchestrata."),
        ("Integration & Interoperability", "Import normalizzato, job idempotenti e transactional outbox."),
    ], [2700, 6660])

    doc.add_heading("4. Lessico controllato", level=1)
    glossary = [
        ("Template viaggio", "Struttura riusabile dell'itinerario, senza date assolute."),
        ("Versione template", "Snapshot immutabile e pubblicabile di giorni, tappe e contenuti."),
        ("Partenza", "Istanza datata e venduta di una specifica versione; in UI puo essere chiamata Viaggio."),
        ("Giorno template", "Posizione relativa day_offset della versione."),
        ("Giorno partenza", "Data di calendario associata a un giorno della stessa versione."),
        ("Tappa effettiva", "Elemento del programma della partenza, modificabile senza cambiare il template."),
        ("Famiglia / travel party", "Perimetro di condivisione e isolamento dentro una partenza."),
        ("Viaggiatore", "Profilo della persona; l'accesso digitale e opzionale e collegato a un Utente."),
        ("Attivita", "Quiz, missione, bingo, gioco, puzzle o contest; non una tappa del programma."),
        ("Contenuto di riferimento", "Informazione AI/manuale riusabile per paese, citta o sito."),
        ("Gruppo spese", "Perimetro esplicito al quale piu famiglie aderiscono per condividere quote e pareggi."),
        ("Quota di spesa", "Importo attribuito a un viaggiatore; le quote riconciliano la spesa alla conferma."),
        ("Adulto responsabile", "Viaggiatore adulto autorizzato a decidere per un minore nella specifica partenza."),
        ("Grant quiz", "Autorizzazione emessa dal server che abilita il download delle domande dopo lo sblocco."),
        ("Disruption", "Evento operativo che ritarda, sposta, cancella, sostituisce o ripristina una tappa."),
    ]
    add_table(doc, ["Termine", "Definizione normativa nel modello"], glossary, [2600, 6760])

    doc.add_heading("5. Vista concettuale dei domini", level=1)
    picture = doc.add_picture(str(diagram_path), width=Inches(6.45))
    set_picture_alt(
        picture,
        "Domini del modello logico",
        "Schema dei domini: identita e tenant, master e reference, prodotto viaggio, partenza datata, famiglia e viaggiatori, esperienza privata, documenti, AI e audit.",
    )
    p = doc.add_paragraph("Figura 1 - Domini e flusso principale di ownership e derivazione.")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.runs[0].italic = True
    for name, purpose, entities in LOGICAL_DOMAINS:
        doc.add_heading(name, level=2)
        doc.add_paragraph(purpose)
        add_bullets(doc, entities)

    doc.add_heading("6. Relazioni e cardinalita", level=1)
    add_table(doc, ["Origine", "Destinazione", "Cardinalita", "Vincolo semantico"], RELATIONSHIPS,
              [1800, 2100, 1100, 4360], font_size=8.6)

    doc.add_heading("7. Regole di business", level=1)
    add_table(doc, ["ID", "Dominio", "Regola verificabile"], BUSINESS_RULES, [1000, 1500, 6860], font_size=8.7)

    doc.add_heading("8. Ownership e stewardship", level=1)
    add_table(doc, ["Dominio dati", "Data owner", "Data steward", "Decisioni"], [
        ("Identita piattaforma", "Platform owner", "Security administrator", "Ruoli, accessi, incidenti, impersonazione"),
        ("Agenzia e viaggi", "Referente agenzia", "Agente admin/editor", "Pubblicazione, viaggiatori, programma"),
        ("Catalogo globale", "Platform data owner", "Catalog/content steward", "Deduplica, verifica, refresh, merge"),
        ("Famiglia", "Agenzia quale titolare/gestore", "Organizer della famiglia", "Validazione prove, condivisione interna e adesione gruppi spesa"),
        ("Minori e consensi", "Titolare definito contrattualmente", "Privacy steward", "Policy, prova, revoca, tutela e ambito media"),
        ("Dati personali", "Titolare definito contrattualmente", "Privacy steward", "Finalita, retention, richieste interessato"),
        ("AI content", "Platform product owner", "Human content reviewer", "Fonti, approvazione, ritiro, contestazione"),
    ], [2100, 2200, 2200, 2860], font_size=8.5)

    doc.add_heading("9. Critical Data Elements e qualita", level=1)
    add_table(doc, ["CDE", "Dominio", "Dimensioni", "Steward", "Controllo"], CDE,
              [1600, 1200, 1800, 1700, 3060], font_size=8.1)
    add_bullets(doc, [
        "Completezza: data partenza, versione, famiglia e membership sono obbligatori prima della pubblicazione.",
        "Validita: codici ISO, rating, coordinate, minor unit e intervalli hanno domini o CHECK.",
        "Consistenza: le FK composite verificano insieme agenzia, partenza, versione, giorno e famiglia.",
        "Univocita: chiavi naturali candidate e indici parziali impediscono duplicati attivi.",
        "Attualita: i contenuti di riferimento hanno verified/refresh_after e un processo di rinnovo.",
        "Tracciabilita: import, generazioni AI, fonti, approvazioni e modifiche critiche sono ricostruibili.",
    ])

    doc.add_heading("10. Sicurezza, privacy e ciclo di vita", level=1)
    add_table(doc, ["Classe", "Esempi", "Protezione minima"], [
        ("Pubblico", "Paesi, citta, siti, hotel, contenuti approvati", "Read-only, source lineage, integrita editoriale"),
        ("Interno agenzia", "Template, import, programma, audit operativo", "RLS agenzia e ruoli agenti"),
        ("Confidenziale famiglia", "Spese, cambi, risultati, note e locali", "RLS + membership famiglia"),
        ("Condiviso tra famiglie", "Quote e pareggi nel gruppo spese", "Adesione esplicita + membership + audit"),
        ("Personale", "Email, telefono, data di nascita", "Minimizzazione, accesso tracciato, retention"),
        ("Media/documenti privati", "Foto, biglietti, voucher, assicurazioni", "R2/S3 privato, URL firmate, checksum, quarantine"),
        ("Segreto tecnico", "Token, password, chiavi", "Mai nel modello dati; secret store/parametri runtime"),
    ], [1800, 3300, 4260], font_size=8.6)
    doc.add_paragraph("Le durate di conservazione non sono inventate nel modello: retention_until e legal_hold rendono applicabile una policy approvata da legale/privacy. I consensi sono eventi append-only con policy version e decisione sostitutiva; la qualificazione giuridica finale resta da ratificare con DPO/legale.")

    doc.add_heading("11. Controlli specifici per AI", level=1)
    add_bullets(doc, [
        "Ogni generazione registra provider, modello, prompt hash, timestamp, token/costo ed esito.",
        "Il contenuto di riferimento collega una o piu fonti con publisher e retrieved_at.",
        "Gli answer key restano server-side e non sono inclusi nei payload pubblici del client.",
        "Lo stato passa da draft a in_review e approved; l'approvazione umana e obbligatoria.",
        "Il giudizio fotografico conserva criteri, score, motivazione e modello; il verdetto finale puo essere umano.",
        "Le regole di gioco dipendono da ruoli e policy, non da nomi di persone della demo.",
    ])

    doc.add_heading("12. Decisioni di governance da ratificare", level=1)
    add_table(doc, ["Decisione", "Default tecnico proposto", "Autorita che approva"], [
        ("Retention foto/documenti", "Per agenzia e finalita; nessuna durata implicita", "Legale/Privacy + Agenzia"),
        ("Ruolo titolare/responsabile", "Definito da contratto, mercato e servizio", "DPO/Legale"),
        ("SLA refresh contenuti", "6 mesi o evento critico; fonti primarie", "Content owner"),
        ("Uso AI nel contest", "Supporto trasparente; override umano", "Product/Data Governance"),
        ("Tentativi quiz", "1 definitivo per partecipante; estendibile", "Product owner"),
        ("Maggiore eta e tutela", "18 anni alla data di partenza; eccezioni solo per policy locale ratificata", "DPO/Legale"),
        ("Fallback lingua", "Viaggiatore > famiglia > partenza > template > agenzia", "Product/Content owner"),
    ], [2600, 4300, 2460], font_size=8.1)

    doc.add_heading("13. Recepimento dei rilievi architetturali e funzionali", level=1)
    add_table(doc, ["Rilievo", "Decisione di modello", "Controllo verificabile"], [
        ("RLS e scope key", "agency_id resta ridondanza controllata", "Ogni tabella con policy tenant ha un indice con agency_id leading; audit catalogo in CI"),
        ("Publish gate", "Transizione atomica governata dal DB", "Stored procedure SECURITY DEFINER, advisory lock per versione e trigger anti-race"),
        ("Outbox e scale-to-zero", "Coda operativa con lease durevole", "Claim transazionale FOR UPDATE SKIP LOCKED da worker su connessione pooled dedicata"),
        ("Delete cascade", "Nessuna cascata dalla radice agenzia", "FK verso iam.agencies in RESTRICT e job asincrono a fasi secondo BR-019"),
        ("Split spese", "Quote tipizzate e gruppi cross-family", "Gate differibile riconcilia original/base; pareggi append-only"),
        ("Minori e media", "Capacita, tutela, consenso e soggetti media separati", "Consenso corrente obbligatorio prima del tag di un minore"),
        ("Disruption", "Stato corrente + evento append-only", "Comando SECURITY DEFINER atomico; update operativo diretto bloccato"),
        ("Quiz offline", "Grant server-side e payload pubblico senza answer key", "Orario calcolato nel fuso partenza; override autorizzato e tracciato"),
        ("Multilingua", "Traduzioni separate dal contenuto sorgente", "Fallback per viaggiatore e stato approved/stale verificabile"),
    ], [2100, 3400, 3860], font_size=8.3)

    doc.add_heading("14. Criteri di accettazione del modello logico", level=1)
    add_bullets(doc, [
        "Ogni termine ha una definizione univoca e non dipende dalla UI corrente.",
        "Ogni relazione ha cardinalita, optionality e regola di cancellazione comprensibili.",
        "Master/reference data non sono duplicati nei singoli viaggi.",
        "I fatti privati non possono essere associati a famiglia, partenza o giorno differenti.",
        "Il dato AI e distinguibile dal dato importato/manuale ed e corredato da provenance.",
        "Le ridondanze sono solo scope keys controllate da FK composite o snapshot storici deliberati.",
        "Privacy, qualita, audit e lifecycle sono parte del modello e non note applicative esterne.",
        "Quote finanziarie, consensi, grant e disruption hanno invarianti transazionali e storia verificabile.",
        "Le traduzioni non duplicano chiavi, punteggi, answer key o identita del contenuto sorgente.",
    ])

    add_sources(doc)
    apply_business_vocabulary(doc)
    doc.save(path)
    return path


def build_physical(ddl: str, diagram_path: Path) -> Path:
    path = OUT_DIR / "SMF_Travel_Modello_Fisico_Dati_v1.3.docx"
    doc = Document()
    configure_document(doc, "Modello fisico dati")
    doc.core_properties.title = "SMF Travel - Modello Fisico dei Dati"
    add_cover(doc, "Modello Fisico dei Dati", "PostgreSQL 18 su Neon: strutture, vincoli, indici e sicurezza", "Modello fisico target e piano di convergenza")

    ddl_hash = hashlib.sha256(ddl.encode("utf-8")).hexdigest()
    tables = parse_tables(ddl)
    doc.add_heading("1. Dichiarazione di conformita tecnica", level=1)
    add_status_callout(doc, "VALIDAZIONE", "DDL v3.2 installato su Neon PostgreSQL 18.6 Production con migrazione atomica 016 e checksum registrato. Smoke test transazionale superato; il runtime applicativo resta sul modello public fino al completamento controllato del backfill e del cutover.")
    add_table(doc, ["Evidenza", "Risultato"], [
        ("Motore target", "Neon PostgreSQL 18.6, eu-central-1; fondazione v3.2 installata in Production"),
        ("Tabelle target", f"{len(tables)} tabelle in 7 schemi di dominio + schema app"),
        ("Chiavi primarie", "100% delle tabelle"),
        ("Vincoli/index state", "0 vincoli non validati; 0 indici invalidi dopo la migrazione Production"),
        ("Tenant RLS", "54 tabelle verificate con RLS; 0 tabelle tenant prive di indice agency_id leading"),
        ("Indici RLS", "0 tabelle tenant prive di indice agency_id leading; audit catalogo incluso nello smoke"),
        ("Comandi governati", "Publish, outbox, disruption, grant/payload quiz e cancellazione tramite SECURITY DEFINER"),
        ("Smoke test", "Scenario esteso eseguito in transazione e concluso con rollback dei dati sintetici"),
        ("SHA-256 DDL", ddl_hash),
    ], [2500, 6860], font_size=8.8)

    doc.add_heading("2. Stato target e stato distribuito", level=1)
    add_table(doc, ["Area", "Produzione osservata", "Target v3"], [
        ("PostgreSQL", "18.6, 55 tabelle public", "18+, schemi di dominio"),
        ("Integrita catalogo", "0 indici invalidi; 0 vincoli non validati", "Stesso requisito, piu FK composite"),
        ("RLS", "54 tabelle abilitate e verificate", "RLS attiva; code operative senza grant runtime"),
        ("Identita", "Subject esterno come TEXT PK", "UUIDv7 interno + user_identities"),
        ("Template/partenza", "Override JSON e relazioni parziali", "Programma effettivo materializzato"),
        ("Giorno partenza", "Non materializzato nel live", "departure_days con version/date integrity"),
        ("Contenuti ludici", "generated_content JSONB", "activities + activity_items + publish gate"),
        ("Valute", "Campi transitori numeric", "minor unit BIGINT + FX snapshot obbligatorio"),
        ("Cataloghi legacy", "places/accommodations ancora presenti", "cities/sites/hotels unici"),
    ], [2100, 3380, 3880], font_size=8.4)
    p = doc.add_paragraph("La fondazione V3 e installata, riconciliata e collaudata in Production. I backfill core e operational risultano applicati senza utenti, movimenti di cassa o mapping mancanti; le copie legacy restano owner-only per audit e rollback controllato.")
    p.runs[0].italic = True

    doc.add_heading("3. Principi fisici", level=1)
    add_bullets(doc, [
        "UUIDv7 nativo PostgreSQL 18 per entita distribuite; BIGINT identity per audit/outbox append-only.",
        "Schemi: iam, ref, travel, content, ops, journey, privacy; app contiene domini e funzioni di contesto.",
        "agency_id ridondante solo come scope key, protetto da FK composite e RLS; il gate verifica che ogni tabella tenant abbia un indice valido con agency_id leading.",
        "TIMESTAMPTZ per istanti, DATE per giorni di servizio, TIME solo per orari locali template.",
        "Denaro in minor unit BIGINT; tassi NUMERIC(24,12); mai FLOAT/DOUBLE per importi.",
        "PostGIS GEOGRAPHY(POINT,4326) per coordinate; GiST solo dove serve prossimita.",
        "JSONB limitato a payload variabili con schema_version e CHECK di tipo; nessuna join key nel JSON.",
        "CHECK e FK proteggono le scritture; stored procedure e trigger sotto advisory lock proteggono le regole aggregate e la transizione di publish.",
        "Nessun DDL nel runtime; migrazioni checksumate con direct URL e advisory lock.",
    ])
    picture = doc.add_picture(str(diagram_path), width=Inches(6.45))
    set_picture_alt(
        picture,
        "Mappatura dei domini fisici",
        "Schema dei domini logici mappati sugli schemi PostgreSQL iam, ref, travel, content, journey, privacy, ops e app.",
    )
    p = doc.add_paragraph("Figura 1 - Mappatura dei domini logici sugli schemi PostgreSQL.")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.runs[0].italic = True

    doc.add_heading("4. Strategie di chiave e temporalita", level=1)
    add_table(doc, ["Tema", "Decisione", "Motivazione"], [
        ("PK distribuite", "UUID DEFAULT uuidv7()", "Ordinamento temporale migliore di UUIDv4 e generazione senza coordinamento."),
        ("Eventi ad alto volume", "BIGINT identity", "Compatto, sequenziale, adatto ad audit e outbox."),
        ("Identita esterne", "Tabella user_identities", "Evita di legare il dominio a Cognito o a un singolo provider."),
        ("Giorni", "DATE + day_offset", "Evita conversioni UTC errate e mantiene template riusabile."),
        ("Orari template", "TIME locale solo trasporti", "Il template non dispone ancora di una data/fuso concreto."),
        ("Orari partenza", "TIMESTAMPTZ", "Istante inequivocabile per biglietti e monitoraggio."),
        ("Storico", "Versioni e snapshot FX", "Il passato non cambia al variare di programma o tasso live."),
    ], [1800, 2900, 4660], font_size=8.7)

    doc.add_heading("5. Integrita referenziale critica", level=1)
    add_table(doc, ["Vincolo", "Implementazione fisica", "Rischio evitato"], [
        ("Versione della partenza", "FK (agency, template, version)", "Versione di altro template/tenant"),
        ("Data del giorno", "departure_days FK sia a departure/version sia a template_day/version", "Giorno di un'altra versione"),
        ("Tappa effettiva", "FK a departure_day con agency, departure e version", "Tappa collocata nel viaggio sbagliato"),
        ("Famiglia", "travel_parties UNIQUE (agency, departure, id)", "Fatto associato a famiglia di altra partenza"),
        ("Autore del fatto", "FK a party_memberships", "Scrittura da viaggiatore non appartenente"),
        ("Media privata", "FK (agency, departure, party, media)", "Foto/documento letto da altro nucleo"),
        ("Feedback", "FK alla tappa effettiva, non target polimorfico", "Voto a hotel/sito non erogato"),
        ("Quote spesa", "FK a membership + gruppo famiglie e gate differibile", "Quote cross-family implicite o totali non riconciliati"),
        ("Consenso minore", "FK a membership e tutela attiva; record append-only", "Decisione da soggetto non autorizzato o revoca persa"),
        ("Grant quiz", "FK composita a partenza, famiglia, viaggiatore e attivita", "Tentativo inviato senza accesso server autorizzato"),
        ("SET NULL composito", "Column list sulla sola colonna opzionale", "Null involontario di agency/party NOT NULL"),
    ], [1900, 4100, 3360], font_size=8.3)

    doc.add_heading("6. RLS, ruoli e accesso serverless", level=1)
    add_bullets(doc, [
        "smf_app e un ruolo LOGIN senza ownership, membership neon_superuser e BYPASSRLS.",
        "Ogni transazione runtime imposta app.agency_id con set_config(..., true) dopo autenticazione.",
        "Il catalogo consolidato contiene 67 tabelle di dominio, di cui 54 con RLS attiva; la policy tenant usa agency_id.",
        "Ogni tabella tenant soggetta alla policy dispone di almeno un indice valido con agency_id come prima chiave; il gate CI conferma zero eccezioni.",
        "iam.users, user_identities e impersonation_sessions non ricevono DML diretto dal runtime tenant.",
        "Le operazioni superadmin cross-tenant passano da funzioni SECURITY DEFINER minimali e auditabili, non da una policy booleana generica.",
        "integration_outbox e agency_deletion_jobs sono code operative senza DML runtime: il worker usa soltanto funzioni SECURITY DEFINER con grant EXECUTE mirati.",
        "Runtime usa DATABASE_URL pooled; migrazioni usano DATABASE_DIRECT_URL protetta.",
    ])
    add_table(doc, ["Ruolo", "Privilegi", "Uso"], [
        ("neondb_owner / migration", "DDL e ownership; nessun traffico utente", "CI protetta e manutenzione"),
        ("smf_app", "DML tenant sotto RLS; SELECT master", "Next.js/Vercel runtime"),
        ("smf_worker", "Claim job/outbox e aggiornamento esito", "Lambda/SQS"),
        ("smf_admin_api", "Solo EXECUTE su comandi security-definer", "Superadmin e operazioni piattaforma"),
        ("smf_readonly", "SELECT viste governate", "Supporto e analisi autorizzata"),
    ], [1900, 3700, 3760], font_size=8.5)

    doc.add_heading("7. Indici e query pattern", level=1)
    add_table(doc, ["Pattern", "Indice guida", "Nota"], [
        ("Viaggi agenzia per stato/data", "departures(agency_id,status,starts_on,ends_on,id)", "Filtro da fare/in corso/fatto"),
        ("Programma giornaliero", "departure_items(departure_day_id,sort_order,id)", "Lettura sequenziale deterministica"),
        ("Famiglia corrente", "party_memberships(traveler_id,party_id,agency_id) WHERE active", "Risoluzione accesso mobile"),
        ("Spese/cambi recenti", "facts(agency_id,party_id,created_at DESC,id)", "RLS indexable + paginazione keyset"),
        ("Quote e pareggi", "expense_shares/settlements(agency,departure,group,...)", "Riconciliazione e saldo cross-family"),
        ("Grant quiz", "activity_access_grants(agency,departure,party,traveler,activity,...)", "Sblocco e lookup token server-side"),
        ("Disruption", "disruption_events(agency,departure,item,occurred_at DESC,id)", "Timeline operativa append-only"),
        ("Contenuti approvati", "activities(agency,version,day,sort) WHERE approved", "Esclude bozze"),
        ("Catalogo per nome", "UNIQUE normalizzato + GIN trigram siti/hotel", "Dedup e fuzzy match controllato"),
        ("Geolocalizzazione", "GiST(location)", "Solo query di prossimita"),
        ("Coda/outbox", "Partial available_at/id + lease_expires_at/id", "SKIP LOCKED, lease e retry"),
        ("Audit", "(agency,entity_type,entity_id,created_at DESC,id DESC)", "Ricostruzione cronologica"),
    ], [2500, 4300, 2560], font_size=8.0)
    doc.add_paragraph("Per le policy tenant la regola e inderogabile: agency_id e la prima chiave di almeno un indice valido. Per le altre FK, l'indice e richiesto sui percorsi ad alto volume o coinvolti in cancellazioni frequenti; le eccezioni verso lookup piccoli sono motivate nel registro degli indici per evitare write amplification inutile.")

    doc.add_heading("8. Denaro, arrotondamenti e consuntivi", level=1)
    add_bullets(doc, [
        "amount_minor e base_amount_minor sono interi; ref.currencies.minor_unit governa la scala.",
        "exchange_rate_to_base e definito come unita di valuta base per una unita della valuta originale.",
        "Se currency = base_currency, tasso = 1 e importi minor devono coincidere.",
        "Il calcolo usa decimal arithmetic e rounding half-up definito a livello di servizio; il risultato persiste.",
        "Il movimento exchange richiede entrambi gli importi e il tasso; il withdrawal puo non conoscere subito l'importo origine.",
        "I totali in EUR sommano base_amount_minor, mai conversioni live retroattive.",
        "Le quote possono essere parziali in draft; la transizione allocated attiva un constraint trigger differibile che riconcilia entrambi i totali.",
        "Lo split cross-family richiede un expense_group e adesioni active; i pareggi sono payment/reversal append-only.",
    ])

    doc.add_heading("9. Contenuti, quiz e publish gate", level=1)
    add_table(doc, ["Regola aggregata", "Controllo al publish"], [
        ("Quiz", "1 attivita per giorno, 10 activity_items coerenti con citta e siti, answer_spec completo"),
        ("Missioni", "1 attivita per giorno, 5 activity_items mission, evidence richiesto"),
        ("Bingo", "1 attivita per versione, 15 celle, coordinate 3x9 e milestone punteggio"),
        ("Giochi", "3 attivita semplici per giorno; puzzle con fallback_media_asset configurato"),
        ("Contest", "2 per giorno, category free/theme, max_entries=2"),
        ("Freshness", "Reference content approved e non oltre refresh_after, oppure waiver motivato"),
        ("Fonti", "Almeno una fonte; fonte primaria quando esiste; human approval obbligatoria"),
    ], [2800, 6560], font_size=8.7)
    doc.add_paragraph("Le regole che contano righe non sono CHECK: PostgreSQL non consente subquery in CHECK. app.publish_trip_template_version e la sola operazione applicativa autorizzata: acquisisce un advisory transaction lock sulla versione, valida e aggiorna lo stato nella stessa transazione. I trigger sulle tabelle figlie prendono lo stesso lock e rifiutano modifiche dopo il publish; anche un UPDATE diretto dello stato attiva il gate, eliminando la race tra conteggio e transizione.")
    doc.add_paragraph("Per i quiz temporizzati, app.issue_activity_access_grant calcola available_at rispetto a departure_days e departures.timezone. Il client riceve il payload solo tramite app.get_unlocked_activity_payload: answer_spec resta escluso; client_answered_at e informativo, mentre server_received_at e assegnato dal trigger. Gli override anticipati richiedono un ruolo autorizzato e restano distinguibili dal grant ordinario.")

    doc.add_heading("10. Privacy minori, disruption e localizzazione", level=1)
    add_bullets(doc, [
        "party_memberships separa ruolo operativo e capacita adult/dependent_minor, calcolata rispetto alla data di partenza.",
        "traveler_guardianships rende esplicito chi puo decidere per il minore e in quale intervallo.",
        "privacy.consent_records e append-only: una revoca e una nuova decisione che riferisce quella superata.",
        "media_asset_subjects identifica le persone presenti; il tag di un minore richiede un consenso immagini corrente.",
        "record_itinerary_disruption aggiorna lo stato corrente e inserisce l'evento nella stessa transazione; gli update operativi diretti sono rifiutati.",
        "Traduzioni di template, programma effettivo, attivita e item sono separate dalla sorgente, approvabili e marcabili stale.",
        "Fallback locale: profilo viaggiatore, famiglia, partenza, template e infine agenzia; la scelta effettiva avviene nel servizio.",
    ])

    doc.add_heading("11. Outbox, media e cancellazione", level=1)
    add_bullets(doc, [
        "object_key e univoca per provider/bucket; checksum_sha256 consente deduplica e integrita.",
        "visibility e scope composito determinano autorizzazione; nessun bucket pubblico.",
        "Upload pending -> scan/quarantine -> ready; deleted richiede deleted_at.",
        "Il DB inserisce un evento integration_outbox nella stessa transazione della cancellazione logica.",
        "app.claim_integration_outbox usa FOR UPDATE SKIP LOCKED, batch limitato, locked_by e lease_expires_at; un lease scaduto rende il lavoro nuovamente reclamabile.",
        "Il worker Lambda/SQS usa il pooled endpoint Neon con connessione dedicata al ruolo smf_worker: una nuova invocazione risveglia il compute dopo autosuspend, senza dipendere da un processo residente nel database.",
        "Il worker elimina l'oggetto in modo idempotente e completa l'evento; dead letter genera allarme.",
        "retention_until e legal_hold impediscono cancellazioni premature secondo policy ratificata.",
        "Cloudflare R2 applica inoltre Bucket Lock per 30 giorni sul prefisso agencies/, impedendo overwrite e delete prematuri anche fuori dal database.",
        "Le FK dirette verso iam.agencies sono RESTRICT: la radice non puo avviare una cascata massiva.",
        "BR-019 e materializzata in agency_deletion_jobs con fasi, cursore, lease e retry; il DELETE finale e ammesso solo dopo status closed e assenza di figli.",
    ])

    doc.add_heading("12. Data dictionary - inventario", level=1)
    inventory_rows = []
    for name, columns, constraints in tables:
        schema, table = name.split(".")
        pk = next((c for c in constraints if c.upper().startswith("PRIMARY KEY")), "PK inline/id")
        inventory_rows.append((name, TABLE_DESCRIPTIONS.get(name, "Tabella tecnica del modello target."), str(len(columns)), pk.replace("PRIMARY KEY ", "")))
    add_table(doc, ["Tabella", "Scopo", "Colonne", "PK"], inventory_rows,
              [2300, 4700, 900, 1460], font_size=7.6)

    doc.add_heading("13. Data dictionary - colonne e vincoli", level=1)
    for idx, (name, columns, constraints) in enumerate(tables, 1):
        doc.add_heading(f"13.{idx} {name}", level=2)
        doc.add_paragraph(TABLE_DESCRIPTIONS.get(name, "Tabella tecnica del modello target."))
        col_rows = [(col, definition) for col, definition in columns]
        add_table(doc, ["Colonna", "Definizione fisica"], col_rows, [2350, 7010], font_size=7.7)
        if constraints:
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run("Vincoli di tabella: ")
            set_run_font(r, size=8.5, color=NAVY, bold=True)
            r = p.add_run(" | ".join(constraints))
            set_run_font(r, size=7.8, color=INK)

    doc.add_heading("14. Operazioni Neon e CI/CD", level=1)
    add_table(doc, ["Ambiente", "Database", "Migrazioni", "Dati"], [
        ("Production", "Branch production", "Direct URL, expand/migrate/contract", "Dati reali, RLS obbligatoria"),
        ("Preview Vercel", "Branch Neon per Git branch", "Migrazioni e smoke test", "Clone isolato, cleanup asincrono"),
        ("Audit schema", "Branch temporaneo con TTL", "DDL completo + catalog audit", "Rollback dati test"),
        ("Local", "Branch personale o DB locale compatibile", "Stessa catena checksum", "Seed sintetico"),
    ], [1700, 2600, 2800, 2260], font_size=8.5)
    add_bullets(doc, [
        "Migrazioni immutabili: version, SHA-256, durata, advisory lock e fail-fast.",
        "Worker Lambda/SQS usa il pooled endpoint, transazioni brevi e claim SKIP LOCKED; direct URL resta riservata a migrazioni e manutenzione.",
        "Autosuspend non sostituisce il worker: SQS/Lambda e la sorgente di attivazione e ogni invocazione puo risvegliare Neon.",
        "Indici grandi con CREATE INDEX CONCURRENTLY fuori dalla transazione globale.",
        "NOT NULL evolutivi con CHECK NOT VALID, backfill, VALIDATE e contract successivo.",
        "Restore point prima di contract migration; test restore periodico con RTO/RPO misurati.",
        "pg_stat_statements per baseline e regressioni; niente partizionamento prima della soglia misurata.",
    ])

    doc.add_heading("15. Piano di convergenza dalla produzione", level=1)
    add_table(doc, ["Fase", "Intervento", "Gate"], [
        ("A - Freeze semantics", "Ratifica glossario, BR, CDE, owner/steward", "Approvazione esperto e governance"),
        ("B - Expand", "Nuovi schemi, chiavi UUIDv7, FK nullable, tabelle departure_days/items", "DDL su preview e zero invalid objects"),
        ("C - Migrate", "Backfill cataloghi, versioni, giorni, FX, media scope e identita", "Conteggi, checksum e orfani = 0"),
        ("D - Dual read", "Confronto payload legacy/target e metriche", "Differenze spiegate = 0"),
        ("E - Contract", "RLS FORCE, revoke legacy DML, rimozione places/accommodations/trip_*", "Restore test + finestra sicurezza"),
        ("F - Operate", "Quality dashboard, freshness, retention e p95", "SLO e ownership attivi"),
    ], [1600, 5100, 2660], font_size=8.4)

    doc.add_heading("16. Criteri di accettazione fisica", level=1)
    add_bullets(doc, [
        "DDL riproducibile su PostgreSQL 18; migrazione 016 applicata atomicamente e registrata in Production.",
        "Tutte le tabelle hanno PK; catalogo Production conferma 0 vincoli non validati e 0 indici invalidi.",
        "Nessuna fact puo attraversare tenant, partenza, versione, giorno o famiglia.",
        "RLS attiva su 54 tabelle; audit statico conferma zero tabelle tenant prive di indice agency_id leading.",
        "Publish gate atomico in stored procedure SECURITY DEFINER, con advisory lock e trigger anti-race verificati.",
        "FK ad alto volume indicizzate; eccezioni documentate con cardinalita e delete pattern.",
        "Importi e score deterministici; scritture mobile idempotenti.",
        "Quote spesa riconciliate, gruppi cross-family espliciti e pareggi append-only verificati nello smoke.",
        "Consensi minori, soggetti media e tutele sono storicizzati; decisioni privacy da ratificare con DPO/legale.",
        "Disruption atomiche e auditabili; quiz offline protetti da grant server-side e payload senza answer key.",
        "Traduzioni separate dalla sorgente con stato editoriale e fallback documentato.",
        "Contenuti AI con provenance e human approval; answer key non esposti.",
        "Blob privati con outbox leased, claim SKIP LOCKED, retention, legal hold e cleanup verificabile.",
        "Nessuna FK diretta dalla radice agenzia usa CASCADE; BR-019 opera a batch e il DELETE finale e protetto.",
        "Migrazione zero-downtime e rollback provato prima del contract.",
        "Schema live e documentazione confrontati automaticamente in CI.",
    ])

    add_sources(doc)
    apply_business_vocabulary(doc)
    doc.save(path)
    return path


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)
    diagram = QA_DIR / "domain-overview.png"
    draw_domain_overview(diagram)
    ddl_sources = [
        DDL_PATH,
        ROOT / "database" / "backfill-v3-shadow-core.sql",
        ROOT / "database" / "backfill-v3-shadow-operational.sql",
        ROOT / "database" / "migrations" / "045_v3_operational_stays.sql",
    ]
    ddl = "\n\n".join(path.read_text(encoding="utf-8") for path in ddl_sources)
    logical = build_logical(diagram)
    physical = build_physical(ddl, diagram)
    print(logical)
    print(physical)


if __name__ == "__main__":
    main()
