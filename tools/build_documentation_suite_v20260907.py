from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

from build_functional_catalog_doc import FUNCTIONS as BASE_FUNCTIONS


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
DATE = "7 settembre 2026"
SCHEMA = "197_v3_suspended_agency_session_boundary"

BLACK = "000000"
NAVY = "17365D"
BLUE = "DCE6F1"
PALE = "F5F7FA"
MID = "D9D9D9"
WHITE = "FFFFFF"
MUTED = "4F5B66"


def rgb(value: str) -> RGBColor:
    return RGBColor.from_string(value)


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=90, start=110, bottom=90, end=110) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.find(qn("w:tcMar"))
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for name, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{name}"))
        if node is None:
            node = OxmlElement(f"w:{name}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table) -> None:
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = borders.find(qn(f"w:{edge}"))
        if tag is None:
            tag = OxmlElement(f"w:{edge}")
            borders.append(tag)
        tag.set(qn("w:val"), "single")
        tag.set(qn("w:sz"), "4")
        tag.set(qn("w:color"), MID)


def repeat_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    flag = OxmlElement("w:tblHeader")
    flag.set(qn("w:val"), "true")
    tr_pr.append(flag)


def set_cell_width(cell, inches: float) -> None:
    cell.width = Inches(inches)
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(int(inches * 1440)))
    tc_w.set(qn("w:type"), "dxa")


def table(doc: Document, headers: list[str], rows: list[list[str]], widths: list[float] | None = None):
    result = doc.add_table(rows=1, cols=len(headers))
    result.alignment = WD_TABLE_ALIGNMENT.CENTER
    result.autofit = False
    set_table_borders(result)
    repeat_header(result.rows[0])
    for index, header in enumerate(headers):
        cell = result.rows[0].cells[index]
        set_cell_shading(cell, NAVY)
        set_cell_margins(cell)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        run = p.add_run(header)
        run.bold = True
        run.font.name = "Aptos"
        run.font.size = Pt(9)
        run.font.color.rgb = rgb(WHITE)
        if widths:
            set_cell_width(cell, widths[index])
    for row_index, values in enumerate(rows):
        row = result.add_row()
        for index, value in enumerate(values):
            cell = row.cells[index]
            if row_index % 2:
                set_cell_shading(cell, PALE)
            set_cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(str(value))
            run.font.name = "Aptos"
            run.font.size = Pt(8.5)
            run.font.color.rgb = rgb(BLACK)
            if widths:
                set_cell_width(cell, widths[index])
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return result


def configure_document(doc: Document, title: str | None = None) -> None:
    for section in doc.sections:
        section.page_width = Inches(8.5)
        section.page_height = Inches(11)
        section.top_margin = Inches(0.72)
        section.bottom_margin = Inches(0.7)
        section.left_margin = Inches(0.72)
        section.right_margin = Inches(0.72)
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Aptos"
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = rgb(BLACK)
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.08
    for style_name, size in (("Title", 28), ("Subtitle", 12), ("Heading 1", 18), ("Heading 2", 14), ("Heading 3", 12), ("Heading 4", 10.5)):
        if style_name not in styles:
            continue
        style = styles[style_name]
        style.font.name = "Aptos Display" if style_name != "Normal" else "Aptos"
        style.font.size = Pt(size)
        style.font.color.rgb = rgb(BLACK)
        style.font.bold = style_name != "Subtitle"
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.space_before = Pt(10 if style_name != "Title" else 0)
        style.paragraph_format.space_after = Pt(5)
    if title:
        doc.core_properties.title = title
    doc.core_properties.subject = "Documentazione funzionale e tecnica SMF Travel"
    doc.core_properties.author = "SMF Travel"
    doc.core_properties.last_modified_by = "SMF Travel"


def add_bullet(doc: Document, text: str, level: int = 0) -> None:
    style = "List Bullet" if level == 0 else "List Bullet 2"
    p = doc.add_paragraph(style=style)
    p.add_run(text)


def add_number(doc: Document, text: str) -> None:
    p = doc.add_paragraph(style="List Number")
    p.add_run(text)


def add_labeled(doc: Document, label: str, text: str) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.keep_together = True
    run = p.add_run(f"{label}. ")
    run.bold = True
    p.add_run(text)


def add_cover(doc: Document, title: str, subtitle: str, version: str) -> None:
    p = doc.add_paragraph(style="Title")
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.add_run(title)
    p = doc.add_paragraph(style="Subtitle")
    p.add_run(subtitle)
    doc.add_paragraph()
    table(doc, ["Voce", "Valore"], [["Versione", version], ["Data", DATE], ["Stato", "As built per collaudo operativo"], ["Schema dati", SCHEMA]], [1.5, 5.2])
    doc.add_paragraph("Il documento descrive il comportamento applicativo atteso, i ruoli, gli ambiti di visibilità e le regole verificabili. È la base per illustrare il prodotto, formare gli operatori e costruire un collaudo completo.")
    doc.add_page_break()


ROLE_SUMMARY = [
    ["Superuser", "Amministra la piattaforma e le agenzie", "Agenzie, responsabili, sospensione, cancellazione, panoramica e Login come", "Non crea viaggiatori o personale operativo per conto dell’agenzia"],
    ["Responsabile", "Amministra e opera per una sola agenzia", "Stesse funzioni dell’agente; è il referente creato dal superuser", "Non vede dati di altre agenzie"],
    ["Agente", "Opera sui viaggi dell’agenzia", "Preventivi, programmi, gruppi, persone, contenuti Paese, analytics e collaborazione", "Non impersona superuser, responsabili o altri agenti"],
    ["Accompagnatore", "Gestisce sul campo le partenze assegnate", "Programma, documenti, chat, comunicazioni, presenze e segnalazioni", "Modifica solo le giornate assegnate; non vede preventivi o assegnazione personale"],
    ["Guida", "Collabora sulle giornate assegnate", "Programma, documenti ricevuti, chat con l’agenzia, presenze e segnalazioni", "Modifica solo le giornate assegnate; perimetro più ristretto dell’accompagnatore"],
    ["Viaggiatore", "Consulta e partecipa al viaggio", "Programma, mappa, documenti, chat, spese, informazioni, giochi, foto e feedback", "Vede soltanto viaggio, gruppo e contenuti personali autorizzati"],
]


INTERACTIONS = [
    ["Chat viaggio", "Responsabile, agente, accompagnatori, guide, viaggiatori del viaggio", "Tutti i partecipanti autorizzati allo stesso viaggio"],
    ["Chat gruppo", "Responsabile, agente, accompagnatori; viaggiatori del gruppo", "Solo il gruppo scelto e gli operatori autorizzati"],
    ["Chat personale", "Responsabile, agente e singolo viaggiatore", "Solo il viaggiatore selezionato e l’agenzia"],
    ["Chat personale operativo", "Agenzia con accompagnatore o guida; accompagnatore con altra figura ammessa", "Solo gli operatori selezionati; una guida non apre conversazioni con viaggiatori"],
    ["Comunicazioni", "Responsabile, agente e accompagnatore nei limiti assegnati", "Viaggio, gruppo, viaggiatore, accompagnatore o guida selezionati; destinatari e letture tracciati"],
    ["Documenti", "Responsabile, agente e accompagnatore autorizzato", "Viaggio, gruppo, viaggiatore, accompagnatore o guida; download tramite link temporaneo"],
    ["Programma", "Agenzia modifica tutto; staff vede tutto", "Accompagnatore e guida modificano solo le giornate assegnate"],
    ["Presenze", "Agenzia e staff assegnato", "Elenco viaggiatori per gruppo; registro utilizzabile quando necessario"],
]


NEW_FUNCTIONS = [
    {"id":"IAM-07","title":"Parità operativa tra responsabile e agente","purpose":"Applicare agli utenti dell’agenzia lo stesso perimetro operativo, distinguendo soltanto il modo in cui il responsabile viene nominato.","actors":"Responsabile e agente.","pre":"Membership attiva nella stessa agenzia.","flow":"Dopo il login entrambe le figure accedono a viaggi, personale, gruppi, programma, contenuti Paese, documenti, chat, comunicazioni, assicurazione, operatività e analytics.","rules":"Il responsabile è creato o sostituito dal superuser; l’agente è creato dall’agenzia. Nessuno dei due accede ad altri tenant.","outputs":"Menu e autorizzazioni equivalenti nel perimetro agenzia.","tests":"Confronto pagina per pagina; chiamate API dirette; utente rimosso o agenzia sospesa."},
    {"id":"IAM-08","title":"Login come utenti invitati non ancora attivi","purpose":"Permettere assistenza e collaudo prima che l’invitato completi l’attivazione.","actors":"Superuser; responsabile; agente.","pre":"Identità applicativa già creata e target nel perimetro consentito.","flow":"L’operatore seleziona il target anche se invitato, apre una sessione impersonata auditata e torna alla propria identità con Termina login come.","rules":"Il superuser può selezionare utenti applicativi; responsabile e agente non possono selezionare superuser, responsabili o agenti. Il target non acquisisce privilegi ulteriori.","outputs":"Sessione temporanea con identità reale e identità target entrambe tracciate.","tests":"Invito non accettato; target fuori tenant; ruoli vietati; logout e fine impersonazione."},
    {"id":"STA-01","title":"Anagrafica agenti accompagnatori e guide","purpose":"Gestire il personale dell’agenzia con identità e inviti individuali.","actors":"Responsabile e agente.","pre":"Agenzia attiva e username globale disponibile.","flow":"L’operatore sceglie ruolo, inserisce dati anagrafici e recapiti, invia l’invito, consulta stato e può rimuovere il profilo.","rules":"I profili rimossi, le membership revocate e gli account disabilitati non compaiono nell’elenco attivo; lo storico operativo resta auditabile.","outputs":"Profilo staff, identità IAM, membership e stato invito coerenti.","tests":"Stessa e-mail con più username; invito sospeso; rimozione; sessione aperta; elenco dopo revoca."},
    {"id":"STA-02","title":"Assegnazione personale alle giornate","purpose":"Stabilire quali accompagnatori, guide o agenti operano su ciascuna giornata.","actors":"Responsabile e agente.","pre":"Partenza pubblicata, personale attivo e giornate esistenti.","flow":"Nella scheda Assegna personale l’operatore seleziona una o più persone e una o più giornate, salva e può modificare l’associazione.","rules":"Una persona vede il viaggio se ha almeno un’assegnazione valida; la scrittura del programma è autorizzata giornata per giornata.","outputs":"Assegnazioni partenza-persona-giornata e menu operativo aggiornato.","tests":"Più persone e giorni; rimozione assegnazione; ruolo errato; giornata di altra partenza."},
    {"id":"STA-03","title":"Finestra temporale e accesso di collaudo dello staff","purpose":"Mostrare allo staff i viaggi pertinenti evitando che una data passata impedisca il collaudo controllato.","actors":"Accompagnatore, guida, agente assegnato; amministratore tecnico.","pre":"Assegnazione attiva alla partenza.","flow":"Il sistema include viaggi futuri e in corso; per dati storici di prova può applicare una scadenza test_access_until esplicita.","rules":"L’accesso di collaudo è temporaneo e non modifica le date commerciali del viaggio. Revoca del personale o scadenza interrompono l’accesso.","outputs":"Elenco viaggi coerente tra dashboard, menu laterale e pagine di dettaglio.","tests":"Viaggio futuro, in corso, passato senza/con accesso test; scadenza; staff rimosso."},
    {"id":"STA-04","title":"Esperienza personale di accompagnatore e guida","purpose":"Offrire allo staff una vista del viaggio simile a quella del viaggiatore ma compatibile con il ruolo operativo.","actors":"Accompagnatore e guida.","pre":"Partenza assegnata e accessibile temporalmente.","flow":"Dal menu Viaggi la persona apre programma, documenti ricevuti e chat con l’agenzia; dal pannello operativo apre le funzioni consentite.","rules":"L’elenco e il menu laterale devono mostrare lo stesso insieme di partenze. La guida non accede a preventivi, analytics, operatività di assegnazione o conversazioni con viaggiatori.","outputs":"Workspace personale brandizzato e limitato.","tests":"Coerenza elenco-menu; URL diretto a funzioni vietate; mobile; viaggio storico abilitato per test."},
    {"id":"PRG-01","title":"Lettura completa e modifica per giornate assegnate","purpose":"Dare a staff sul campo il contesto completo lasciando circoscritta la responsabilità di modifica.","actors":"Accompagnatore e guida.","pre":"Partenza assegnata; per la scrittura, giornata assegnata.","flow":"La persona consulta tutte le giornate; il comando Salva è disponibile o accettato soltanto per quelle associate al suo profilo.","rules":"Il controllo è server-side oltre che visivo; una giornata non assegnata resta in sola lettura anche con chiamata API costruita manualmente.","outputs":"Programma aggiornato per le sole giornate autorizzate.","tests":"Giornata assegnata/non assegnata; cambio assegnazione; concorrenza; ID di altra partenza."},
    {"id":"PRG-02","title":"Avviso delle modifiche operative ai viaggiatori","purpose":"Rendere verificabili le variazioni al programma di un viaggio in corso.","actors":"Responsabile, agente, accompagnatore, guida; viaggiatori destinatari.","pre":"Programma pubblicato e modifica salvata.","flow":"Il sistema registra autore e differenza, crea la comunicazione operativa pertinente, notifica i destinatari e permette la presa visione.","rules":"Gli avvisi automatici ai viaggiatori sono richiesti per viaggio in corso; il destinatario vede che cosa è cambiato e il collegamento alla giornata.","outputs":"Registro modifica, notifica e stato letto/non letto.","tests":"Viaggio futuro/in corso/passato; modifica staff; destinatario offline; doppio salvataggio."},
    {"id":"OPS-01","title":"Presenze per gruppo","purpose":"Consentire un riscontro operativo rapido dei partecipanti.","actors":"Responsabile, agente e staff assegnato.","pre":"Partenza accessibile e gruppi con viaggiatori.","flow":"La pagina elenca i viaggiatori raggruppati; l’operatore seleziona i presenti e salva oppure usa Annulla tutte le presenze.","rules":"Il registro non è obbligatoriamente legato a una tappa; l’azzeramento è atomico e autorizzato; un utente non vede gruppi di altri viaggi.","outputs":"Stato presenze con autore e timestamp.","tests":"Salvataggio parziale; azzeramento; lista vuota; viaggiatore rimosso; accesso non assegnato."},
    {"id":"OPS-02","title":"Segnalazioni operative dei viaggiatori","purpose":"Portare all’attenzione dello staff soltanto eventi essenziali durante il viaggio.","actors":"Viaggiatore; responsabile; agente; staff assegnato.","pre":"Partenza attiva e identità autorizzata.","flow":"Il viaggiatore invia una segnalazione; lo staff la vede nella pagina Presenze e segnalazioni e la gestisce secondo procedura.","rules":"Non viene raccolta la posizione; non vengono archiviati passaporti o documenti sanitari; dati minimi, consenso e scadenza seguono la governance privacy.","outputs":"Segnalazione tracciata con stato e ambito.","tests":"Testo vuoto/lungo; duplicato; viaggio errato; utente rimosso; visibilità dello staff."},
    {"id":"DOC-03","title":"Distribuzione documenti per destinatario","purpose":"Inviare lo stesso tipo di documento al pubblico esatto.","actors":"Responsabile, agente e accompagnatore autorizzato.","pre":"Partenza e destinatari accessibili; file valido.","flow":"L’operatore seleziona Viaggio, Gruppo, Viaggiatore, Accompagnatore o Guida, sceglie i destinatari previsti, carica il file e verifica l’elenco inviato.","rules":"Il destinatario singolo prevale sull’etichetta di ruolo; i file restano privati in R2 e sono risolti con autorizzazione e URL temporanea.","outputs":"Documento, metadati, audience e disponibilità offline per chi lo scarica.","tests":"Ogni audience; staff non assegnato; cross-tenant; nuovo file dopo pacchetto offline; cancellazione."},
    {"id":"COM-01","title":"Chat multicanale per viaggio gruppo persona e staff","purpose":"Separare le conversazioni mantenendo un’esperienza uniforme.","actors":"Responsabile, agente, accompagnatore, guida e viaggiatore secondo canale.","pre":"Partecipazione o assegnazione valida.","flow":"L’utente sceglie il pulsante di ambito, seleziona il destinatario quando richiesto, legge lo storico e invia il messaggio.","rules":"La chat resta visibile anche se vuota; accompagnatori e agenzia possono usare i canali operativi consentiti; la guida non chatta con viaggiatori; ogni messaggio è isolato per partenza e audience.","outputs":"Messaggi ordinati, mittente, ruolo, timestamp e operazione idempotente.","tests":"Viaggio/gruppo/persona/accompagnatore/guida; canale vuoto; polling; doppio invio; accesso vietato."},
    {"id":"COM-02","title":"Comunicazioni operative e ciclo di presa visione","purpose":"Inviare avvisi formali distinguendoli dalla chat.","actors":"Responsabile, agente e accompagnatore autorizzato; destinatari selezionati.","pre":"Partenza accessibile e audience valida.","flow":"Il mittente sceglie ambito e destinatari, inserisce titolo, riepilogo, severità e richiesta di lettura; il sistema pubblica, notifica, registra le conferme, permette sollecito e chiusura.","rules":"Ambiti: viaggio, gruppo, viaggiatore, accompagnatore e guida. Il mittente non seleziona se stesso tra i destinatari operativi quando non utile.","outputs":"Comunicazione con destinatari espansi, letture, solleciti e chiusura auditata.","tests":"Audience singola/multipla; presa visione; mancata lettura; sollecito; chiusura; duplicato."},
    {"id":"INS-02","title":"Assicurazione per viaggio gruppo o persona","purpose":"Associare i riferimenti assicurativi al perimetro corretto.","actors":"Responsabile e agente; destinatari autorizzati.","pre":"Partenza pubblicata.","flow":"L’operatore seleziona Viaggio, Gruppo o Viaggiatore, inserisce dati e documento di polizza e salva.","rules":"Non è prevista audience staff; il viaggiatore vede solo la polizza applicabile. L’assenza è mostrata con stato coerente.","outputs":"Polizza e allegato collegati all’audience.","tests":"Tre audience; sovrapposizione viaggio/persona; documento mancante; cross-group."},
    {"id":"CNT-01","title":"Profilo Paese centrale generato una sola volta","purpose":"Riutilizzare informazioni generali attendibili tra agenzie senza rigenerazioni e costi inutili.","actors":"Sistema AI e catalogo centrale.","pre":"Primo preventivo pubblicato per un Paese non ancora censito o profilo scaduto.","flow":"Il worker genera sezioni standard, fonti e date; valida struttura e riferimenti; memorizza la baseline cross-agenzia.","rules":"Contenuti sensibili richiedono fonte, data e disclaimer; il test AI live è manuale e disattivato per impostazione predefinita finché il prodotto non è commercializzato.","outputs":"Profilo Paese versionato con stato di verifica.","tests":"Primo/secondo viaggio; profilo esistente; fonte assente; scadenza; paese multilingue."},
    {"id":"CNT-02","title":"Validazione e personalizzazione del profilo Paese","purpose":"Permettere a ogni agenzia di approvare o correggere le informazioni mostrate ai propri viaggiatori.","actors":"Responsabile e agente.","pre":"Baseline centrale disponibile.","flow":"La pagina mostra tutte le sezioni, fonti, criticità e data; l’operatore modifica i campi desiderati e valida la versione dell’agenzia.","rules":"La modifica non altera la baseline né i dati di altri tenant; il viaggiatore riceve prima l’override validato, altrimenti la baseline ammessa.","outputs":"Override JSON per agenzia, revisore, timestamp e stato.","tests":"Modifica singola sezione; reset; due agenzie; profilo scaduto; salvataggio concorrente."},
    {"id":"ANA-02","title":"Analytics operativi e feedback per dimensione","purpose":"Mostrare adozione e gradimento con definizioni verificabili.","actors":"Responsabile e agente.","pre":"Eventi e feedback del tenant disponibili.","flow":"La dashboard aggrega KPI, città, tappe, gruppi e viaggi; il dettaglio riconcilia conteggi, media e singoli feedback.","rules":"Ogni KPI visualizzato ha definizione, formula funzionale e frequenza; totale e dettaglio devono usare lo stesso perimetro; nessun dato cross-tenant.","outputs":"Adozione, uso programma/documenti, assistenza, engagement, feedback e luoghi più/meno apprezzati.","tests":"Zero dati; tre feedback con due commenti; filtri; medie; gruppi differenti; timezone."},
]


PATCHES = {
    "IAM-06": {
        "actors": "Superuser; responsabile e agente entro il perimetro consentito.",
        "pre": "Operatore autenticato; identità applicativa target esistente, anche se l’invito non è ancora stato accettato.",
        "rules": "Il superuser può assistere gli utenti applicativi; responsabile e agente non possono impersonare superuser, responsabili o agenti. Identità reale e target restano entrambe nell’audit.",
        "tests": "Target attivo/invitato; ruolo vietato; target fuori agenzia; termine impersonazione; logout; audit.",
    },
    "AGY-02": {
        "title": "Gestione del personale dell’agenzia",
        "purpose": "Creare, invitare, elencare e rimuovere agenti, accompagnatori e guide.",
        "actors": "Responsabile e agente.",
        "rules": "Responsabile e agente hanno uguali permessi operativi. Il responsabile è nominato soltanto dal superuser. La rimozione revoca l’accesso senza cancellare lo storico.",
    },
    "AGY-03": {
        "title": "Chat operativa multicanale",
        "purpose": "Mantenere conversazioni separate per viaggio, gruppo, persona e staff.",
        "actors": "Agenzia, accompagnatori, guide e viaggiatori secondo il canale.",
        "rules": "Autorizzazione per partenza e audience; la guida non conversa con viaggiatori; messaggi idempotenti e storico tracciato.",
    },
    "TRP-12": {
        "actors": "Responsabile e agente su tutte le giornate; accompagnatore e guida sulle giornate assegnate.",
        "rules": "Tutto lo staff assegnato può leggere l’intero programma. Il server rifiuta la modifica staff di una giornata non assegnata e crea gli avvisi previsti per variazioni operative.",
    },
    "DOC-01": {
        "title": "Documenti di viaggio con audience configurabile",
        "actors": "Responsabile, agente, accompagnatore autorizzato e destinatari.",
        "rules": "Audience disponibili: viaggio, gruppo, viaggiatore, accompagnatore o guida. Ogni documento conserva anche la giornata quando pertinente e resta privato.",
    },
}


def functions() -> list[dict[str, str]]:
    result = deepcopy(BASE_FUNCTIONS)
    for item in result:
        item.update(PATCHES.get(item["id"], {}))
    known = {item["id"] for item in result}
    result.extend(item for item in NEW_FUNCTIONS if item["id"] not in known)
    return result


def build_functional_analysis(path: Path) -> None:
    doc = Document()
    configure_document(doc, "SMF Travel Analisi funzionale completa")
    add_cover(doc, "SMF Travel Analisi funzionale completa", "Presentazione del prodotto manuale per ruolo e specifica per i casi d’uso", "2.0")
    doc.add_heading("Come leggere il documento", level=1)
    doc.add_paragraph("Il livello 1 spiega il prodotto alle agenzie e rende immediata la collaborazione fra ruoli. Il livello 2 funziona come manuale operativo esteso. Il livello 3 trasforma ogni capacità in una specifica atomica con precondizioni, flusso, regole, risultati e prove da eseguire.")
    table(doc, ["Livello", "Destinatario", "Uso"], [["1", "Agenzia e decisori", "Comprendere proposta di valore, ruoli e interazioni"], ["2", "Operatori e formazione", "Sapere che cosa fare e che cosa non è consentito"], ["3", "Collaudatori e analisti", "Derivare casi d’uso, dati di prova ed evidenze"], ["Appendici", "Tutti", "Glossario, matrice permessi e criteri di chiusura"]], [0.8, 2.1, 3.8])

    doc.add_heading("Livello 1 Panoramica per le agenzie", level=1)
    doc.add_heading("Che cosa offre SMF Travel", level=2)
    doc.add_paragraph("SMF Travel accompagna il viaggio dalla ricezione del preventivo all’operatività sul campo. L’agenzia importa il documento, controlla la bozza prodotta dall’intelligenza artificiale, pubblica un programma strutturato e distribuisce informazioni, documenti e comunicazioni alle persone corrette. Il viaggiatore usa dal telefono un’app installabile e brandizzata, con contenuti disponibili anche offline.")
    doc.add_heading("Ciclo completo del servizio", level=2)
    for text in [
        "Il superuser crea l’agenzia, imposta branding e responsabile e invia l’invito.",
        "Responsabile o agente crea il personale e importa il preventivo originale.",
        "Il sistema estrae il contenuto con OCR quando necessario e costruisce una bozza strutturata con Bedrock.",
        "L’agenzia revisiona giornate, attività, pernottamenti e dati commerciali; nulla viene pubblicato senza conferma umana.",
        "La pubblicazione crea programma, partenza, giornate, attività e collegamenti ai cataloghi condivisi.",
        "L’agenzia crea gruppi e viaggiatori, assegna capogruppo e preferenze di partecipazione ai giochi.",
        "Accompagnatori, guide e agenti possono essere associati a una o più giornate.",
        "Documenti, chat, comunicazioni e assicurazioni usano audience esplicite.",
        "Il viaggiatore consulta programma, mappa, documenti, informazioni Paese e frasi; registra spese e partecipa alle attività abilitate.",
        "Lo staff gestisce variazioni, presenze e segnalazioni essenziali; le modifiche rilevanti diventano comunicazioni verificabili.",
        "L’agenzia legge analytics di adozione, utilizzo ed esperienza per viaggio, gruppo, città e tappa.",
        "La piattaforma conserva audit, isolamento fra agenzie e tracciabilità delle elaborazioni asincrone.",
    ]:
        add_number(doc, text)
    doc.add_heading("Ruoli operativi", level=2)
    table(doc, ["Ruolo", "Obiettivo", "Funzioni principali", "Limite principale"], ROLE_SUMMARY, [1.0, 1.7, 2.6, 1.6])
    doc.add_heading("Come interagiscono le figure", level=2)
    table(doc, ["Canale", "Chi pubblica o scrive", "Chi riceve o partecipa"], INTERACTIONS, [1.5, 2.6, 2.8])
    doc.add_heading("Regole che rendono sicuro il modello", level=2)
    for text in [
        "Ogni agenzia è un tenant isolato. Filtri applicativi, stored procedure e Row Level Security impediscono accessi trasversali.",
        "Le audience non sono etichette grafiche: determinano realmente chi può leggere documenti, chat, comunicazioni e assicurazioni.",
        "Accompagnatori e guide vedono il programma completo ma modificano soltanto le giornate assegnate.",
        "Non vengono archiviate copie di passaporti o documenti sanitari e non è prevista la localizzazione delle persone.",
        "L’intelligenza artificiale prepara contenuti; la pubblicazione del preventivo e la validazione delle informazioni Paese restano sotto controllo umano.",
        "I test Bedrock live che consumano crediti sono predisposti ma non schedulati: si eseguono solo su avvio esplicito del proprietario.",
    ]:
        add_bullet(doc, text)

    doc.add_page_break()
    doc.add_heading("Livello 2 Manuale funzionale per ruolo", level=1)
    role_details = {
        "Superuser": [
            ("Agenzie", "Crea il tenant con anagrafica, logo, colore e responsabile; modifica i dati; sostituisce il responsabile; sospende, riattiva e richiede la cancellazione asincrona."),
            ("Accesso assistito", "Può aprire l’esperienza degli utenti applicativi anche invitati e non attivi. La sessione è temporanea, riconoscibile e auditata."),
            ("Controllo piattaforma", "Consulta indicatori cross-agenzia e stato operativo senza assumere il ruolo dell’agenzia nella creazione del personale o dei viaggi."),
        ],
        "Responsabile e agente": [
            ("Parità operativa", "Hanno lo stesso perimetro funzionale. Cambia soltanto la governance: il responsabile è nominato dal superuser, gli agenti sono gestiti dall’agenzia."),
            ("Viaggi", "Creano il viaggio da preventivo, seguono l’elaborazione, revisionano, pubblicano, scaricano originale e normalizzato e modificano il programma pubblicato."),
            ("Persone", "Creano agenti, accompagnatori, guide, gruppi e viaggiatori; rimuovono i profili; assegnano staff e giornate; scelgono capogruppo e livello di coinvolgimento del gruppo."),
            ("Collaborazione", "Inviano documenti, chat e comunicazioni a viaggio, gruppo, viaggiatore, accompagnatore o guida; configurano assicurazioni per viaggio, gruppo o persona."),
            ("Contenuti", "Revisionano le informazioni Paese dell’agenzia, controllano programma e contenuti generati e consultano analytics e feedback."),
            ("Login come", "Assistono viaggiatori, accompagnatori e guide, anche non ancora attivi; non possono impersonare superuser, responsabili o agenti."),
        ],
        "Accompagnatore": [
            ("Viaggi assegnati", "Vede partenze future e in corso e, per collaudo, quelle storiche con accesso temporaneo esplicito. Elenco e menu devono essere coerenti."),
            ("Programma", "Consulta tutte le giornate e modifica solo quelle assegnate. Le modifiche operative di un viaggio in corso generano gli avvisi previsti."),
            ("Operatività", "Usa documenti, chat, comunicazioni, assicurazioni in lettura, presenze e segnalazioni nei limiti del viaggio assegnato."),
            ("Esperienza personale", "Dal collegamento del viaggio apre una vista simile a quella del viaggiatore con programma, documenti ricevuti e chat con l’agenzia."),
        ],
        "Guida": [
            ("Viaggi e programma", "Vede i viaggi assegnati e tutte le giornate del programma; modifica solo quelle assegnate."),
            ("Presenze e segnalazioni", "Può usare la pagina operativa prevista per la partenza."),
            ("Collaborazione limitata", "Consulta documenti destinati a lei e chatta con l’agenzia. Non gestisce preventivi, gruppi, viaggiatori, analytics o chat con viaggiatori."),
        ],
        "Viaggiatore": [
            ("Consultazione", "Visualizza mappa complessiva, programma giornaliero, documenti autorizzati, assicurazione, informazioni Paese e frasario."),
            ("Offline", "Installa la PWA e usa Scarica documenti sul dispositivo; l’elenco distingue file disponibili offline e solo online."),
            ("Partecipazione", "Invia feedback, usa chat autorizzate, registra spese/prelievi/cambi e, se il gruppo lo consente, partecipa a quiz, missioni, bingo, contest e giochi."),
            ("Privacy e ambito", "Vede i dati del proprio viaggio e gruppo; la partecipazione alla classifica di viaggio è una preferenza personale; i minori richiedono consenso per i media."),
        ],
    }
    for role, sections in role_details.items():
        doc.add_heading(role, level=2)
        for title, body in sections:
            doc.add_heading(title, level=3)
            doc.add_paragraph(body)
    doc.add_heading("Matrice operativa sintetica", level=2)
    table(doc, ["Funzione", "Superuser", "Resp e agente", "Accompagnatore", "Guida", "Viaggiatore"], [
        ["Gestione agenzia", "Sì", "Proprio tenant", "No", "No", "No"],
        ["Preventivo e pubblicazione", "No", "Sì", "No", "No", "No"],
        ["Programma in lettura", "Login come", "Sì", "Tutto assegnato", "Tutto assegnato", "Proprio viaggio"],
        ["Programma in scrittura", "No", "Tutto", "Giorni assegnati", "Giorni assegnati", "No"],
        ["Gruppi e viaggiatori", "No", "Sì", "Lettura operativa", "No", "Proprio gruppo"],
        ["Presenze e segnalazioni", "No", "Sì", "Sì", "Sì", "Invia segnalazioni"],
        ["Documenti", "No", "Invia e legge", "Invia e legge", "Riceve", "Riceve"],
        ["Chat", "No", "Tutti i canali ammessi", "Canali ammessi", "Solo agenzia/staff ammesso", "Viaggio/gruppo/personale"],
        ["Comunicazioni", "No", "Pubblica e gestisce", "Pubblica nei limiti", "Riceve", "Riceve e conferma"],
        ["Analytics", "Panoramica", "Tenant", "No", "No", "No"],
    ], [1.55, 0.85, 1.25, 1.25, 1.0, 1.05])

    doc.add_page_break()
    doc.add_heading("Livello 3 Specifica atomica delle funzionalità", level=1)
    doc.add_paragraph("Ogni scheda è autonoma e può essere trasformata in uno o più casi d’uso. Per la copertura completa, ogni voce della sezione Prove deve produrre un esito e un’evidenza. Le prove negative sono obbligatorie quando verificano isolamento, ruolo o audience.")
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    area_names = {
        "IAM": "Identità accesso e impersonazione", "ADM": "Amministrazione piattaforma", "AGY": "Agenzia e personale",
        "TRP": "Viaggio preventivo e programma", "GRP": "Gruppi e viaggiatori", "DOC": "Documenti",
        "FIN": "Spese cassa e cambi", "TRV": "Esperienza viaggiatore", "GAM": "Quiz sfide giochi e contest",
        "PWA": "PWA offline e notifiche", "ANA": "Analytics", "OPS": "Operatività e segnalazioni",
        "STA": "Staff operativo", "PRG": "Modifica programma dello staff", "COM": "Chat e comunicazioni",
        "INS": "Assicurazioni", "CNT": "Informazioni Paese", "MEM": "Ricordi e album", "SEC": "Sicurezza e governance",
    }
    for item in functions():
        grouped[item["id"].split("-")[0]].append(item)
    for prefix, items in grouped.items():
        doc.add_heading(area_names.get(prefix, prefix), level=2)
        for item in items:
            doc.add_heading(f"{item['id']} {item['title']}", level=3)
            add_labeled(doc, "Scopo", item["purpose"])
            add_labeled(doc, "Attori", item["actors"])
            add_labeled(doc, "Precondizioni", item["pre"])
            add_labeled(doc, "Flusso principale", item["flow"])
            add_labeled(doc, "Regole e autorizzazioni", item["rules"])
            add_labeled(doc, "Risultati e dati prodotti", item["outputs"])
            add_labeled(doc, "Prove obbligatorie", item["tests"])
    doc.add_heading("Appendice A Regole trasversali di accettazione", level=1)
    transversal = [
        ["Autorizzazione", "Provare ruolo ammesso, ruolo negato, URL diretto e chiamata API costruita manualmente."],
        ["Tenant", "Ripetere lettura e scrittura con un secondo tenant e verificare assenza di dati e side effect."],
        ["Audience", "Provare viaggio, gruppo, persona e staff; verificare destinatari positivi e negativi."],
        ["Tempo", "Provare viaggio futuro, in corso e passato; timezone destinazione; accesso test con scadenza."],
        ["Idempotenza", "Ripetere doppio click, retry e stessa client_operation_id; non devono comparire duplicati."],
        ["Offline", "Aprire dati già scaricati, distinguere quelli solo online e riallineare la coda al ritorno della rete."],
        ["Mobile", "Provare Android Chrome, schermo stretto e fold chiuso; nessun overflow o controllo fuori viewport."],
        ["Accessibilità", "Testo grande, modalità semplificata, touch target, focus, contrasto e label leggibili."],
        ["Errori", "Messaggio comprensibile, nessun dato tecnico o personale, errorId disponibile per assistenza."],
        ["AI e costi", "Replay deterministico gratuito in CI; live Bedrock solo con comando e conferma espliciti."],
    ]
    table(doc, ["Dimensione", "Criterio minimo"], transversal, [1.4, 5.3])
    doc.add_heading("Appendice B Fuori perimetro deliberato", level=1)
    for text in [
        "Nessuna archiviazione di passaporti o documenti sanitari.",
        "Nessuna localizzazione o condivisione della posizione delle persone.",
        "SOS come pagina di contatti e istruzioni, non come centrale operativa geolocalizzata.",
        "WAF su dominio personalizzato rinviato finché non viene acquistato un dominio.",
        "Test AI live periodici disattivati finché l’app non è commercializzata; restano disponibili su avvio manuale.",
    ]:
        add_bullet(doc, text)
    doc.add_heading("Appendice C Criterio di pronto per collaudo operatore", level=1)
    for text in [
        f"Release candidata distribuita e schema di produzione allineato alla migrazione {SCHEMA.split('_', 1)[0]}.",
        "Tenant di collaudo isolato con almeno un utente per ruolo, una partenza e gruppi dati di prova.",
        "Percorsi responsabile, agente, accompagnatore, guida e viaggiatore verificati su desktop e Android Chrome.",
        "Documenti, chat, comunicazioni, assicurazioni, programma e presenze provati per ogni audience.",
        "Backup e procedura di rollback verificati; dashboard e allarmi operativi attivi.",
        "Anomalie bloccanti e gravi pari a zero; anomalie residue accettate e registrate.",
    ]:
        add_bullet(doc, text)
    doc.save(path)


def add_revision_header(doc: Document, heading: str, intro: str) -> None:
    doc.add_page_break()
    doc.add_heading(heading, level=1)
    doc.add_paragraph(intro)


def copy_and_configure(source: Path, target: Path, title: str) -> Document:
    doc = Document(source)
    configure_document(doc, title)
    return doc


def replace_visible_text(doc: Document, replacements: dict[str, str]) -> None:
    paragraphs = list(doc.paragraphs)
    for current_table in doc.tables:
        for row in current_table.rows:
            for cell in row.cells:
                paragraphs.extend(cell.paragraphs)
    for paragraph in paragraphs:
        for run in paragraph.runs:
            for old, new in replacements.items():
                if old in run.text:
                    run.text = run.text.replace(old, new)


def build_architecture(path: Path) -> None:
    source = DOCS / "architecture" / "SMF_Travel_Architettura_Soluzione_v1.3.docx"
    doc = copy_and_configure(source, path, "SMF Travel Architettura della soluzione")
    replace_visible_text(doc, {"Famiglia/party": "Gruppo/party", "media della famiglia": "media del gruppo", "Scope famiglia": "Scope gruppo"})
    add_revision_header(doc, "Addendum architetturale del 7 settembre 2026", "Questo addendum aggiorna l’architettura as built alle migrazioni 174-197 e al modello operativo con responsabile, agente, accompagnatore, guida e viaggiatore.")
    doc.add_heading("Identità e autorizzazioni", level=2)
    for text in [
        "Responsabile e agente condividono lo stesso perimetro applicativo; la differenza è di governance della nomina.",
        "Il Login come usa identità UUID native e ammette target invitati; responsabile e agente non impersonano superuser, responsabili o agenti.",
        "Accompagnatori e guide sono identità autonome dell’agenzia; l’accesso alla partenza deriva dall’assegnazione e dalla finestra temporale.",
        "Lo staff legge il programma completo e scrive soltanto le giornate assegnate; il vincolo è verificato nel database.",
    ]:
        add_bullet(doc, text)
    doc.add_heading("Collaborazione e audience", level=2)
    table(doc, ["Servizio", "Audience", "Garanzia"], [
        ["Documenti", "Viaggio, gruppo, viaggiatore, accompagnatore, guida", "R2 privato, metadati Neon, URL firmate e controllo download"],
        ["Chat", "Viaggio, gruppo, viaggiatore e canali staff selezionati", "Messaggi idempotenti, autorizzazione per partenza e destinatario"],
        ["Comunicazioni", "Stesse audience operative", "Destinatari materializzati, presa visione, sollecito e chiusura"],
        ["Assicurazione", "Viaggio, gruppo, viaggiatore", "Risoluzione dell’audience applicabile al destinatario"],
        ["Programma", "Tutti gli assegnati in lettura; giorni assegnati in scrittura", "Stored API UUID e controllo giornata"],
    ], [1.25, 2.35, 3.1])
    doc.add_heading("Dati e flussi introdotti", level=2)
    table(doc, ["Componente", "Responsabilità"], [
        ["iam.agency_staff_profiles", "Profilo e ruolo operativo dell’agenzia"],
        ["travel.departure_staff_day_assignments", "Associazione tra staff e singole giornate"],
        ["journey.departure_presence_register", "Registro presenze per partenza e viaggiatore"],
        ["journey.staff_operational_messages", "Chat operative staff con destinatario selezionabile"],
        ["ops.staff_departure_communications", "Comunicazioni allo staff e stato di chiusura"],
        ["ops.staff_departure_communication_recipients", "Audience espansa e presa visione"],
        ["ref.country_profile_agency_reviews", "Override del profilo Paese per singola agenzia"],
    ], [2.8, 3.9])
    doc.add_heading("Stato verificato", level=2)
    doc.add_paragraph(f"Schema corrente: {SCHEMA}. Ultima validazione registrata: 96 tabelle, 70 protette da RLS, zero vincoli non validati, zero indici invalidi e zero tabelle tenant prive di indice leading. Il gate applicativo, i 23 test unitari e il build Next.js 16.3.2 di produzione sono completati.")
    doc.add_heading("Vincoli operativi e costi", level=2)
    doc.add_paragraph("I test Bedrock live non sono pianificati automaticamente. I replay deterministici restano nel controllo qualità gratuito; ogni invocazione live richiede il comando del proprietario e la variabile di conferma. Il WAF perimetrale resta rinviato in assenza di dominio personalizzato e non blocca il collaudo del software.")
    doc.save(path)


def build_logical(path: Path) -> None:
    source = DOCS / "data-model" / "SMF_Travel_Modello_Logico_Dati_v1.5.docx"
    doc = copy_and_configure(source, path, "SMF Travel Modello logico dei dati")
    add_revision_header(doc, "Estensione logica personale operativo e collaborazione", "La versione 1.7 integra il modello dei ruoli operativi, delle assegnazioni per giornata, delle audience e dei confini di sessione consolidati.")
    table(doc, ["Entità", "Identificatore e relazioni", "Regole logiche"], [
        ["Profilo personale agenzia", "Utente e agenzia; ruolo agente, accompagnatore o guida", "Profilo attivo solo con identità, membership e account validi"],
        ["Assegnazione personale partenza", "Partenza e utente", "Abilita il viaggio; può avere scadenza di collaudo esplicita"],
        ["Assegnazione personale giornata", "Assegnazione partenza e giornata", "La giornata deve appartenere alla stessa partenza; autorizza la scrittura"],
        ["Presenza", "Partenza e viaggiatore", "Un solo stato corrente per coppia; autore e timestamp tracciati"],
        ["Messaggio operativo", "Partenza, autore, ruolo e destinatario opzionale", "Canale derivato da ruolo e destinatario; la guida non apre canali con viaggiatori"],
        ["Comunicazione staff", "Partenza, autore, audience e contenuto", "Titolo, severità, richiesta lettura, chiusura e idempotenza"],
        ["Destinatario comunicazione", "Comunicazione e utente", "Stato di consegna e presa visione per ogni persona"],
        ["Documento di viaggio", "Partenza, giornata opzionale, audience e oggetto storage", "Audience viaggio, gruppo, viaggiatore o staff selezionato"],
        ["Revisione profilo Paese", "Paese e agenzia", "Override isolato per tenant, revisore e data; non modifica la baseline"],
    ], [1.75, 2.45, 2.55])
    doc.add_heading("Cardinalità principali", level=2)
    for text in [
        "Una persona dello staff può essere assegnata a molte partenze; una partenza può avere molte persone dello staff.",
        "Un’assegnazione di partenza può comprendere molte giornate; ogni associazione giornata-persona è univoca.",
        "Una comunicazione può espandersi in molti destinatari; ogni destinatario conserva il proprio stato di lettura.",
        "Un documento può avere una sola regola di audience e, per destinatari selezionati, un insieme di UUID staff.",
        "Una baseline Paese può avere una revisione distinta per ogni agenzia.",
    ]:
        add_bullet(doc, text)
    doc.add_heading("Invarianti", level=2)
    table(doc, ["Invariante", "Controllo"], [
        ["Tenant coerente", "Tutte le entità operative condividono agency_id derivato dalla partenza o dal profilo"],
        ["Scrittura giornata", "Consentita a responsabile/agente oppure a staff assegnato alla specifica giornata"],
        ["Visibilità staff", "Richiede profilo, membership e account attivi; i profili revocati non sono elencati"],
        ["Temporalità", "Viaggi futuri e in corso visibili; passato solo entro test_access_until esplicito"],
        ["Privacy", "Nessun passaporto, documento sanitario o posizione personale nel modello"],
    ], [2.1, 4.6])
    doc.save(path)


def build_physical(path: Path) -> None:
    source = DOCS / "data-model" / "SMF_Travel_Modello_Fisico_Dati_v1.5.docx"
    doc = copy_and_configure(source, path, "SMF Travel Modello fisico dei dati")
    add_revision_header(doc, "Dizionario fisico delle migrazioni 174 197", f"Questa sezione estende il dizionario fisico alla versione di schema {SCHEMA}.")
    table(doc, ["Oggetto", "Colonne o firma rilevante", "Vincoli e accesso"], [
        ["iam.agency_staff_profiles", "agency_id, user_id, staff_role, status, created_at", "Ruoli staff ammessi; RLS forzata; elenco filtra revocati e account non attivi"],
        ["travel.departure_staff_assignments", "departure_id, user_id, role, valid_from, valid_to, test_access_until", "Assegnazione alla partenza; test_access_until è eccezione temporanea esplicita"],
        ["travel.departure_staff_day_assignments", "departure_staff_assignment_id, departure_day_id", "Unicità persona-giornata; stessa partenza"],
        ["journey.departure_presence_register", "departure_id, traveler_user_id, is_present, recorded_by, recorded_at", "Una riga corrente per viaggiatore; scrittura solo operatori autorizzati"],
        ["journey.staff_operational_messages", "departure_id, sender_user_id, sender_role, recipient_user_id, body, client_operation_id", "FK recipient_user_id; idempotenza; confine guida applicato dalle stored API"],
        ["ops.staff_departure_communications", "departure_id, audience_role, audience_user_ids, title, summary, severity, requires_ack, closed_at, closed_by, closure_note", "Audience selezionata e ciclo di vita"],
        ["ops.staff_departure_communication_recipients", "communication_id, user_id, acknowledged_at", "Unicità destinatario; RLS forzata"],
        ["ops.travel_documents", "staff_role, staff_user_ids", "CHECK audience validata; download risolto con attore UUID"],
        ["ref.country_profile_agency_reviews", "profile_override, updated_by, updated_at", "Override JSON tenant-scoped; baseline centrale immutata"],
    ], [1.9, 3.15, 1.85])
    doc.add_heading("Stored API principali", level=2)
    table(doc, ["Dominio", "Funzioni"], [
        ["Personale", "read_agency_staff_v3, provision_agency_staff_v3, remove_agency_staff_v3, assign_departure_staff_days_v3"],
        ["Autorizzazione", "is_departure_operator_v3, can_edit_departure_day_v3, departure_staff_role_v3"],
        ["Dashboard staff", "read_staff_dashboard_v3, read_staff_trip_cards_v3, read_staff_journey_management_v3, list_my_departure_staff_v3"],
        ["Programma", "update_departure_programme_day_staff_v3"],
        ["Presenze", "set_departure_presence_v3, clear_departure_presence_v3, list_departure_presence_v3"],
        ["Chat", "list_staff_operational_messages_v3, send_staff_operational_message_v3, list_selected_staff_messages_v3, send_selected_staff_message_v3, list_operational_messages_scoped_v3, send_operational_message_scoped_v3"],
        ["Comunicazioni", "publish_staff_departure_communication_v3, publish_selected_staff_communication_v3, read_staff_departure_communications_v3, acknowledge_staff_communication_v3, close_staff_communication_v3"],
        ["Documenti", "register_selected_staff_day_document_v3, list_staff_personal_trip_documents_v3, resolve_travel_document_download_v3"],
        ["Impersonazione", "read_agency_impersonation_travelers, start_agency_traveler_impersonation, start_impersonation_v3, resolve_impersonation_v3"],
        ["Profilo Paese", "read_verified_country_profile_v3, save_country_profile_override_v3, review_country_profile_v3"],
    ], [1.3, 5.6])
    doc.add_heading("Catena migrazioni", level=2)
    table(doc, ["Intervallo", "Contenuto"], [
        ["174-180", "Profili staff, assegnazioni giornata, presenze, audience documenti, chat, comunicazioni e scrittura programma"],
        ["181-188", "Destinatari staff selezionati, correzione reset presenze, accesso test, dashboard e vista personale"],
        ["189-193", "Parità ruoli, impersonazione invitati, override Paese, collaborazione staff, lifecycle e confine chat guida"],
        ["194-195", "Esclusione staff revocato e allineamento temporale dell’accesso ai viaggi"],
        ["196-197", "Correzione lettura chat nativa e invalidazione delle sessioni per agenzie sospese"],
    ], [1.1, 5.8])
    doc.add_paragraph("Metriche dell’ultima validazione disponibile: 96 tabelle complessive, 70 tabelle con RLS, zero vincoli non validati, zero indici invalidi e zero tabelle tenant senza indice leading.")
    doc.save(path)


def build_catalog(path: Path) -> None:
    source = DOCS / "functional" / "SMF_Travel_Catalogo_Funzionale_v1.1.docx"
    doc = copy_and_configure(source, path, "SMF Travel Catalogo funzionale")
    replace_visible_text(doc, {"componenti della famiglia": "persone dello stesso nucleo o gruppo"})
    add_revision_header(doc, "Aggiornamento funzionale ruoli e collaborazione", "La versione 1.3 censisce le funzioni introdotte per parità responsabile-agente, personale operativo, audience selezionate, informazioni Paese personalizzabili e invalidazione delle sessioni sospese.")
    for item in NEW_FUNCTIONS:
        doc.add_heading(f"{item['id']} {item['title']}", level=2)
        add_labeled(doc, "Valore", item["purpose"])
        add_labeled(doc, "Utenti", item["actors"])
        add_labeled(doc, "Comportamento", item["flow"])
        add_labeled(doc, "Regole", item["rules"])
    doc.add_heading("Decisioni di perimetro", level=2)
    for text in [
        "Responsabile e agente hanno uguali permessi; soltanto il superuser crea o sostituisce il responsabile.",
        "Accompagnatore e guida leggono tutto il programma e modificano solo giornate assegnate.",
        "La guida non comunica direttamente con i viaggiatori.",
        "Non vengono archiviati passaporti, documenti sanitari o posizioni personali.",
        "Test AI live disponibili solo su avvio manuale e non schedulati finché il prodotto non è venduto.",
    ]:
        add_bullet(doc, text)
    doc.save(path)


def build_use_cases(path: Path) -> None:
    source = DOCS / "testing" / "SMF_Travel_Casi_Uso_Completi_v1.2.docx"
    doc = copy_and_configure(source, path, "SMF Travel Casi d’uso completi")
    add_revision_header(doc, "Casi d’uso aggiuntivi per ruoli e collaborazione", "La versione 1.4 aggiunge i casi necessari per coprire le funzioni successive alla versione 1.2 e le regressioni rilevate durante il consolidamento. I casi precedenti restano validi salvo le regole aggiornate esplicitamente qui.")
    use_cases = [
        ["UC-IAM-07", "Parità responsabile e agente", "Confrontare menu, pagine e API sui due ruoli", "Stesse funzioni nel tenant; nessun accesso cross-tenant"],
        ["UC-IAM-08", "Impersonare utente invitato", "Aprire Login come su target non attivo e terminare", "Esperienza target disponibile; audit; ritorno all’operatore"],
        ["UC-IAM-09", "Negare target privilegiato", "Agente tenta di impersonare superuser, responsabile e agente", "Target assenti o richiesta rifiutata"],
        ["UC-IAM-10", "Sospendere agenzia con sessioni attive", "Sospendere il tenant mentre utente e impersonazione sono aperti", "Alla richiesta successiva Cognito e impersonazione non risolvono più l’utente"],
        ["UC-STA-01", "Creare accompagnatore", "Inserire identità e accettare invito", "Profilo attivo e accesso coerente"],
        ["UC-STA-02", "Creare guida", "Inserire identità e accettare invito", "Profilo attivo e accesso limitato"],
        ["UC-STA-03", "Rimuovere staff", "Rimuovere guida con assegnazioni", "Scompare dagli elenchi e perde accesso; storico conservato"],
        ["UC-STA-04", "Assegnare più persone e giorni", "Selezionare staff e giornate, salvare e riaprire", "Associazioni complete senza duplicati"],
        ["UC-STA-05", "Coerenza elenco e menu", "Accedere come staff e confrontare dashboard e menu laterale", "Stesse partenze visibili"],
        ["UC-STA-06", "Accesso temporaneo a viaggio passato", "Impostare test_access_until e poi farlo scadere", "Visibile entro la scadenza, non visibile dopo"],
        ["UC-PRG-01", "Leggere tutto il programma", "Aprire come accompagnatore o guida", "Tutte le giornate leggibili"],
        ["UC-PRG-02", "Modificare giornata assegnata", "Salvare descrizione o attività autorizzata", "Modifica persistita e auditata"],
        ["UC-PRG-03", "Negare giornata non assegnata", "Forzare UI e API su altra giornata", "Rifiuto senza modifica"],
        ["UC-PRG-04", "Notificare variazione in corso", "Modificare programma durante il viaggio", "Registro modifica e comunicazione ai destinatari"],
        ["UC-OPS-01", "Registrare presenze", "Selezionare persone di più gruppi e salvare", "Stati corretti per ogni viaggiatore"],
        ["UC-OPS-02", "Annullare tutte le presenze", "Premere Annulla e confermare", "Tutti i flag azzerati senza errore"],
        ["UC-OPS-03", "Leggere segnalazioni", "Viaggiatore invia segnalazione e staff apre pagina", "Segnalazione visibile soltanto agli operatori della partenza"],
        ["UC-DOC-03", "Documento a viaggio", "Caricare file con audience Viaggio", "Tutti i partecipanti autorizzati lo vedono"],
        ["UC-DOC-04", "Documento a gruppo", "Caricare file per un gruppo", "Solo quel gruppo e operatori autorizzati lo vedono"],
        ["UC-DOC-05", "Documento a viaggiatore", "Caricare file per una persona", "Solo la persona selezionata e operatori lo vedono"],
        ["UC-DOC-06", "Documento ad accompagnatore", "Selezionare staff assegnato", "Solo destinatari selezionati lo vedono"],
        ["UC-DOC-07", "Documento a guida", "Selezionare guida assegnata", "Solo destinatari selezionati lo vedono"],
        ["UC-CHAT-04", "Chat viaggio", "Inviare da agenzia e rispondere da viaggiatore", "Storico comune del viaggio"],
        ["UC-CHAT-05", "Chat gruppo", "Inviare a un gruppo e controllare altro gruppo", "Visibile solo nel gruppo scelto"],
        ["UC-CHAT-06", "Chat personale", "Conversazione agenzia-viaggiatore", "Visibile solo ai due lati autorizzati"],
        ["UC-CHAT-07", "Chat con accompagnatore o guida", "Selezionare persona staff e inviare", "Canale resta visibile anche vuoto e messaggio è isolato"],
        ["UC-CHAT-08", "Lettura chat nativa", "Aprire un canale di viaggio come accompagnatore e uno vietato come guida", "L’accompagnatore legge senza errore SQL; la guida riceve un diniego controllato"],
        ["UC-CHAT-08", "Confine guida", "Guida tenta canale con viaggiatore", "Funzione assente o rifiutata"],
        ["UC-COM-04", "Comunicazione per audience", "Ripetere per viaggio, gruppo, persona e staff", "Destinatari espansi correttamente"],
        ["UC-COM-05", "Presa visione e sollecito", "Confermare con alcuni destinatari e inviare reminder", "Stati coerenti e nessun doppione"],
        ["UC-COM-06", "Chiusura comunicazione", "Chiudere con nota", "Comunicazione chiusa e auditata"],
        ["UC-CNT-04", "Modificare profilo Paese", "Agenzia A cambia una sezione", "Viaggiatori A vedono override; agenzia B vede baseline"],
        ["UC-CNT-05", "Validare contenuti sensibili", "Controllare fonti, data e sezioni", "Profilo validato con revisore e timestamp"],
        ["UC-ANA-04", "Riconciliare feedback", "Confrontare totale, media e dettaglio", "Conteggi coerenti anche con feedback senza commento"],
        ["UC-ANA-05", "Analizzare luoghi e gruppi", "Filtrare per città, tappa, viaggio e gruppo", "Migliori/peggiori e trend derivano dallo stesso perimetro"],
    ]
    table(doc, ["ID", "Caso", "Passi essenziali", "Esito atteso"], use_cases, [0.95, 1.45, 2.45, 2.1])
    doc.add_heading("Dati minimi per eseguire i nuovi casi", level=2)
    for text in [
        "Due agenzie isolate; un responsabile e un agente per agenzia.",
        "Due accompagnatori, due guide e almeno un agente assegnabile.",
        "Una partenza futura o in corso e una passata con accesso test temporaneo.",
        "Almeno tre giornate con assegnazioni differenti.",
        "Due gruppi, tre viaggiatori per gruppo e un capogruppo adulto.",
        "File di prova distinti per ogni audience e almeno una comunicazione con presa visione.",
        "Un profilo Paese centrale e due override tenant differenti.",
    ]:
        add_bullet(doc, text)
    doc.save(path)


def build_test_report(path: Path) -> None:
    source = DOCS / "testing" / "SMF_Travel_Rapporto_Completo_Test_v1.4_2026-09-03.docx"
    doc = copy_and_configure(source, path, "SMF Travel Rapporto completo dei test")
    add_revision_header(doc, "Aggiornamento di predisposizione al collaudo operatore", "Questo aggiornamento conserva gli esiti storici del rapporto 1.4 e registra le evidenze tecniche successive. Non dichiara superati i nuovi casi che richiedono un operatore reale.")
    table(doc, ["Area", "Evidenza disponibile", "Stato"], [
        ["Gate, build e test locali", "Controlli schema, API, nomenclatura, TypeScript, lint e formato; 23/23 test unitari; build Next.js 16.3.2", "Superato il 7 settembre 2026"],
        ["Produzione pubblica", "Playwright mobile: login, validazione username, recupero password, attivazione incompleta e manifest PWA", "5/5 superati"],
        ["Schema Neon", f"Versione {SCHEMA.split('_', 1)[0]}; 96 tabelle, 70 RLS, nessun vincolo o indice invalido", "Superato"],
        ["Staff revocato", "Migrazione 194: profili, membership e account non attivi esclusi dagli elenchi", "Superato tecnicamente"],
        ["Confini staff", "Test transazionale: viaggio, programma completo, giornate assegnate, chat, presenze, revoca e scadenza", "Superato con rollback"],
        ["Isolamento agenzia", "Creazione/sostituzione responsabile, impersonazione, rifiuto cross-tenant e sospensione", "Superato con rollback"],
        ["Profilo Paese", "Responsabile autorizzato, superuser negato e override isolato per agenzia", "Superato con rollback"],
        ["Offline", "Installazione, cache programma/documenti, esclusione back-office e coda finanziaria idempotente", "Superato"],
        ["Guida di prova", "Guida rimossa non visibile; guida attiva con accesso test vede la partenza assegnata", "Superato su dato di prova"],
        ["Collaudi V3 transazionali", "Accesso agenzia, owner e agenti; gruppi e partecipanti; budget tenant; gamification e contest; notifiche; engagement; scritture programma, partenze e riferimenti; cancellazione BR-019; mutazioni superuser", "Superati con rollback"],
        ["Smoke runtime V3", "Identità e impersonazione native; superuser; dashboard e analytics; viaggi e partecipanti; chat; spese; catalogo; KPI; media e isolamento cross-tenant", "Superati"],
        ["Ruoli e audience 174-197", "Contratti database verificati; resta la conferma UI su dispositivi e account reali", "Parziale: collaudo operatore"],
        ["AI live", "Harness disponibile ma nessuna pianificazione automatica", "Sospeso per decisione costi"],
        ["WAF e dominio", "Non configurabile sul dominio condiviso attuale", "Rinviato e non bloccante"],
    ], [1.5, 4.25, 1.25])
    doc.add_heading("Anomalie riprodotte e corrette durante il consolidamento", level=2)
    table(doc, ["ID", "Anomalia", "Correzione ed evidenza"], [
        ["BUG-COL-001", "La lettura della chat operativa UUID falliva per riferimento SQL ambiguo alla colonna id.", "Migrazione 196; test accompagnatore/guida superato con rollback."],
        ["BUG-COL-002", "La sospensione dell’agenzia non invalidava una sessione Cognito o impersonata già attiva.", "Migrazione 197; test di accesso agenzia e sospensione superato con rollback."],
    ], [1.15, 2.9, 3.0])
    doc.add_heading("Casi prioritari da eseguire con l’operatore", level=2)
    for text in [
        "Creazione completa del personale e accettazione degli inviti per ogni ruolo.",
        "Assegnazione di accompagnatori, guide e agenti a giornate differenti.",
        "Confronto dei menu e delle autorizzazioni fra responsabile e agente.",
        "Accesso accompagnatore e guida, lettura di tutto il programma e modifica delle sole giornate assegnate.",
        "Distribuzione di documenti e comunicazioni a viaggio, gruppo, viaggiatore, accompagnatore e guida.",
        "Chat per ogni canale, compresi canale vuoto, aggiornamento automatico e confine della guida.",
        "Presenze, azzeramento completo e segnalazioni del viaggiatore.",
        "Impersonazione di utente invitato e rifiuto dei ruoli privilegiati.",
        "Override informazioni Paese e verifica dell’isolamento fra due agenzie.",
        "Responsive desktop, Android Chrome e dispositivo fold chiuso; offline documenti e logout.",
    ]:
        add_bullet(doc, text)
    doc.add_heading("Criterio per dichiarare chiuso il collaudo", level=2)
    doc.add_paragraph("Tutti i casi prioritari e i casi della versione 1.4 devono avere esito registrato. Le anomalie bloccanti e gravi devono essere pari a zero. Le anomalie medie o lievi eventualmente rinviate devono avere responsabile, motivazione e data obiettivo. Nessun test AI live deve essere avviato senza autorizzazione esplicita.")
    doc.save(path)


def main() -> None:
    outputs = [
        DOCS / "functional" / "SMF_Travel_Analisi_Funzionale_Completa_v2.1.docx",
        DOCS / "functional" / "SMF_Travel_Catalogo_Funzionale_v1.3.docx",
        DOCS / "architecture" / "SMF_Travel_Architettura_Soluzione_v1.5.docx",
        DOCS / "data-model" / "SMF_Travel_Modello_Logico_Dati_v1.7.docx",
        DOCS / "data-model" / "SMF_Travel_Modello_Fisico_Dati_v1.7.docx",
        DOCS / "testing" / "SMF_Travel_Casi_Uso_Completi_v1.4.docx",
        DOCS / "testing" / "SMF_Travel_Rapporto_Completo_Test_v1.6_2026-09-07.docx",
    ]
    for output in outputs:
        output.parent.mkdir(parents=True, exist_ok=True)
    build_functional_analysis(outputs[0])
    build_catalog(outputs[1])
    build_architecture(outputs[2])
    build_logical(outputs[3])
    build_physical(outputs[4])
    build_use_cases(outputs[5])
    build_test_report(outputs[6])
    for output in outputs:
        print(output)


if __name__ == "__main__":
    main()
