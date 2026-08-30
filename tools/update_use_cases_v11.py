from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "testing" / "SMF_Travel_Casi_Uso_Completi_v1.0.docx"
OUTPUT = ROOT / "docs" / "testing" / "SMF_Travel_Casi_Uso_Completi_v1.1.docx"


def repeat_header(row):
    props = row._tr.get_or_add_trPr()
    marker = OxmlElement("w:tblHeader")
    marker.set(qn("w:val"), "true")
    props.append(marker)


def add_case(doc, case_id, title, actors, path, objective, preconditions, steps, variants, criteria):
    doc.add_heading(f"{case_id} · {title}", level=3)
    doc.add_paragraph(f"Attori: {actors}")
    doc.add_paragraph(f"Percorso: {path}")
    doc.add_paragraph(f"Obiettivo: {objective}")
    doc.add_paragraph(f"Precondizioni: {preconditions}")
    for step in steps:
        doc.add_paragraph(step, style="List Number")
    doc.add_paragraph(f"Varianti obbligatorie: {variants}")
    doc.add_paragraph(f"Criteri di accettazione: {criteria}")
    doc.add_paragraph("Esito test:  ☐ Non eseguito   ☐ Superato   ☐ Non superato   ☐ Bloccato     Evidenza/defect: ______________________________")


doc = Document(SOURCE)
doc.core_properties.title = "SMF Travel - Casi d'uso completi v1.1"
doc.core_properties.subject = "Catalogo completo di 107 casi d'uso funzionali, visuali e Analytics"

# Front matter.
meta = doc.tables[0]
meta.cell(1, 1).text = "1.1"
meta.cell(1, 2).text = "76 funzioni + 17 viste + 14 Analytics"

# Traceability matrix: update domain totals and identifiers.
trace = doc.tables[2]
updates = {
    "IAM": ("7", "UC-IAM-01 ... UC-IAM-07"),
    "TRP": ("15", "UC-TRP-01 ... UC-TRP-15"),
    "EXP": ("8", "UC-EXP-01 ... UC-EXP-08"),
}
for row in trace.rows[1:]:
    domain = row.cells[0].text.strip()
    if domain in updates:
        row.cells[2].text, row.cells[3].text = updates[domain]

# Analytics KPI semantics are explicit and independently testable.
analytics = doc.tables[3]
analytics.rows[4].cells[3].text = (
    "Tasso attivazione = account attivati / inviti consegnati; adozione partenza = viaggiatori con almeno una sessione / "
    "viaggiatori attivi; uso documenti = viaggiatori che aprono almeno un documento / viaggiatori attivi; engagement = "
    "utenti con almeno una sfida, ricordo o spesa / viaggiatori attivi."
)

doc.add_page_break()
doc.add_heading("8. Integrazione casi di governance e onboarding", level=1)
doc.add_paragraph(
    "Questa sezione completa il catalogo con le capacità introdotte dalla governance KPI, dal registro delle variazioni, "
    "dalla provenienza dei contenuti paese e dall'onboarding a basso attrito."
)
doc.add_heading("Casi d'uso aggiuntivi", level=2)

add_case(
    doc,
    "UC-IAM-07",
    "Accesso rapido da invito personale",
    "Viaggiatore invitato",
    "/attiva-account",
    "Consentire il primo accesso tramite collegamento personale senza obbligare l'utente a impostare subito una password.",
    "Invito individuale valido, non scaduto e non ancora consumato.",
    [
        "Aprire il collegamento personale e verificare identità, agenzia e stato dell'invito senza esporre il token nell'interfaccia.",
        "Selezionare Entra subito con il link personale e verificare creazione sessione, consumo atomico dell'invito e instradamento al viaggio corretto.",
        "Ripetere l'apertura dello stesso collegamento e verificare che il token non sia riutilizzabile.",
        "Verificare la variante tradizionale con scelta password e il recupero successivo basato su username ed e-mail.",
    ],
    "Invito scaduto, revocato, già usato, altro utente sulla stessa e-mail, agenzia sospesa e collegamento manomesso.",
    "Ogni invito attiva un solo utente; nessun altro account con la stessa e-mail viene consumato; sessione e audit sono coerenti; errori non rivelano dati personali.",
)

add_case(
    doc,
    "UC-TRP-15",
    "Governance dei contenuti paese sensibili",
    "Agente, responsabile agenzia, viaggiatore",
    "Revisione preventivo e /viaggio > Informazioni utili",
    "Garantire che salute, documenti, sicurezza, emergenze e ambasciata siano tracciabili, aggiornati e approvati prima della pubblicazione.",
    "Viaggio con paese identificato e contenuti informativi generati o importati.",
    [
        "Verificare per ogni sezione fonte, URL, data di acquisizione, data di revisione, stato di approvazione e disclaimer.",
        "Tentare la pubblicazione con contenuto AI/import privo di fonte, scaduto o non approvato e verificare il blocco del publish gate.",
        "Approvare una versione supportata da fonte ufficiale o cross-check documentato e pubblicare il programma.",
        "Aprire le informazioni come viaggiatore e verificare paese corretto, data di aggiornamento, disclaimer e assenza di contenuti di altri viaggi.",
    ],
    "Fonte irraggiungibile, paese multiplo, contenuto scaduto, modifica dopo approvazione, dato ufficiale in conflitto e viaggio ripubblicato.",
    "I contenuti sensibili non approvati o non tracciabili non sono pubblicabili; il viaggiatore vede provenienza e aggiornamento; ogni revisione resta auditabile.",
)

add_case(
    doc,
    "UC-EXP-08",
    "Registro variazioni e presa visione",
    "Agente, responsabile agenzia, viaggiatore",
    "/agenzia/viaggi/[id]/programma e /viaggio",
    "Rendere ogni variazione operativa leggibile, collegata alla tappa e verificabile tramite presa visione del viaggiatore.",
    "Programma pubblicato, viaggiatore assegnato al gruppo e modifica operativa registrata.",
    [
        "Modificare o annullare una tappa indicando motivo, data/ora e autore; verificare creazione della comunicazione immutabile.",
        "Aprire il viaggio come destinatario e verificare testo della variazione, evidenza del prima/dopo e collegamento alla giornata o tappa.",
        "Premere Ho letto e verificare registrazione idempotente di utente, timestamp e client_operation_id.",
        "Riaprire il viaggio, ripetere l'azione e verificare che la presa visione rimanga unica e che Analytics distingua inviato, aperto e letto.",
    ],
    "Altro gruppo, altro tenant, utente non destinatario, modifica concorrente, offline, doppio tap e tappa cancellata.",
    "Solo i destinatari vedono la comunicazione; il record non è alterabile; la presa visione è idempotente e auditabile; il link apre la tappa corretta.",
)

add_case(
    doc,
    "UC-ANA-015",
    "Definizioni, formule e freschezza dei KPI",
    "Responsabile agenzia, agente autorizzato",
    "/agenzia/analytics",
    "Rendere ogni KPI commercialmente non ambiguo e riconciliabile con gli eventi sorgente.",
    "Dashboard Analytics disponibile con inviti, sessioni, documenti, engagement e notifiche.",
    [
        "Aprire la definizione di ciascun KPI e verificare numeratore, denominatore, formula, esclusioni, eventi sorgente, versione e frequenza di aggiornamento.",
        "Preparare un dataset noto e riconciliare manualmente tasso di attivazione, adozione per partenza, utilizzo documenti ed engagement.",
        "Verificare timestamp Ultimo aggiornamento e comportamento durante ritardo o indisponibilità della pipeline.",
        "Cambiare periodo e partenza e verificare che formula e versione restino costanti mentre cambiano soltanto popolazione e risultati.",
    ],
    "Denominatore zero, invito revocato o scaduto, sessione duplicata, evento offline ritardato, viaggiatore rimosso e cambio versione KPI.",
    "Valori riconciliabili senza interpretazioni; denominatore zero non produce percentuali ingannevoli; versione e freschezza sono visibili; isolamento tenant invariato.",
)

# Extend the analytics quick matrix with the new KPI definition case.
row = analytics.add_row()
for cell in row.cells:
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
row.cells[0].text = "UC-ANA-015"
row.cells[1].text = "Definizioni, formule e freschezza KPI"
row.cells[2].text = "Dashboard con dataset noto"
row.cells[3].text = "Formula, inclusioni/esclusioni, versione e ultimo aggiornamento sono visibili e riconciliabili."
repeat_header(analytics.rows[0])

# Update completion rule.
for paragraph in doc.paragraphs:
    if paragraph.text.startswith("Tutti gli 89 casi"):
        paragraph.text = "Tutti i 107 casi hanno esito e collegamento a evidenza o defect."

doc.save(OUTPUT)
print(OUTPUT)
