import {
  AlertTriangle, CalendarDays, CheckCircle2, ExternalLink, FileText, Globe2,
  HeartPulse, Luggage, Phone, ReceiptText, ShieldCheck, Stethoscope, Users
} from "lucide-react";

const POLICY_NUMBER = "12092552";
const ASSISTANCE_PHONE = "+390258286828";

const coverages = [
  {
    icon: ShieldCheck,
    label: "Assistenza",
    value: "Inclusa",
    detail: "Centrale operativa Europ Assistance"
  },
  {
    icon: HeartPulse,
    label: "My Clinic",
    value: "Incluso",
    detail: "Servizio indicato nel simplo di polizza"
  },
  {
    icon: Stethoscope,
    label: "Spese mediche",
    value: "€ 500.000",
    detail: "Massimale riportato nella polizza"
  },
  {
    icon: Luggage,
    label: "Bagaglio",
    value: "€ 1.000",
    detail: "Massimale riportato nella polizza"
  }
];

export default function InsuranceInfo() {
  return (
    <section className="insurancePage">
      <header className="insuranceHero">
        <div className="insuranceHeroIcon"><ShieldCheck size={30}/></div>
        <div>
          <span>EUROP ASSISTANCE · VIAGGI MONDO</span>
          <h2>Assicurazione di viaggio</h2>
          <p>I dati essenziali della polizza, pronti da usare anche in emergenza.</p>
        </div>
        <b>ATTIVA 31 LUG — 13 AGO</b>
      </header>

      <section className="insuranceEmergency" aria-labelledby="insurance-emergency-title">
        <div>
          <small>ASSISTENZA MEDICA DALL’ESTERO</small>
          <h3 id="insurance-emergency-title">Chiama subito la centrale operativa</h3>
          <p>Comunica il numero di polizza, il nome dell’assicurato, dove ti trovi e un recapito telefonico.</p>
        </div>
        <a className="insuranceCall" href={`tel:${ASSISTANCE_PHONE}`}>
          <Phone size={20}/>
          <span><small>TOCCA PER CHIAMARE</small><strong>+39 02 58 28 68 28</strong></span>
        </a>
      </section>

      <div className="insuranceSummary">
        <section className="policyCard">
          <div className="policyCardIcon"><FileText size={22}/></div>
          <div><small>NUMERO DI POLIZZA</small><strong>{POLICY_NUMBER}</strong></div>
        </section>
        <section className="policyCard">
          <div className="policyCardIcon"><CalendarDays size={22}/></div>
          <div><small>VALIDITÀ</small><strong>31/07/2026 — 13/08/2026</strong><span>Dalle ore 24 del 31 luglio alle ore 24 del 13 agosto</span></div>
        </section>
        <section className="policyCard">
          <div className="policyCardIcon"><Globe2 size={22}/></div>
          <div><small>ESTENSIONE TERRITORIALE</small><strong>Mondo esclusi USA e Canada</strong><span>L’Uzbekistan rientra nell’area indicata</span></div>
        </section>
      </div>

      <section className="insuranceSection">
        <div className="insuranceSectionHead">
          <ShieldCheck size={20}/>
          <div><small>COPERTURE</small><h3>Cosa risulta assicurato</h3></div>
        </div>
        <div className="coverageGrid">
          {coverages.map(({ icon: Icon, label, value, detail }) => (
            <article key={label}>
              <span><Icon size={20}/></span>
              <small>{label}</small>
              <strong>{value}</strong>
              <p>{detail}</p>
            </article>
          ))}
        </div>
        <div className="insuranceWarning">
          <AlertTriangle size={18}/>
          <p><strong>Annullamento viaggio non indicato.</strong> Nel simplo firmato non compare una garanzia per l’annullamento del viaggio.</p>
        </div>
      </section>

      <div className="insuranceColumns">
        <section className="insuranceSection">
          <div className="insuranceSectionHead">
            <Users size={20}/>
            <div><small>ASSICURATI</small><h3>Chi è coperto</h3></div>
          </div>
          <ul className="insuredList">
            <li><CheckCircle2 size={17}/><strong>Fabrizio Fantinel</strong></li>
            <li><CheckCircle2 size={17}/><strong>Simona Rotolo</strong></li>
            <li><CheckCircle2 size={17}/><strong>Mattia Fantinel</strong></li>
          </ul>
        </section>

        <section className="insuranceSection">
          <div className="insuranceSectionHead">
            <ReceiptText size={20}/>
            <div><small>RIMBORSI</small><h3>Documenti da conservare</h3></div>
          </div>
          <ul className="insuranceChecklist">
            <li>Fatture e ricevute originali delle spese sostenute.</li>
            <li>Certificati, referti, prescrizioni e cartelle mediche.</li>
            <li>Biglietti, carte d’imbarco e documenti di viaggio.</li>
            <li>Per il bagaglio: denuncia o rapporto del vettore e prova degli acquisti.</li>
          </ul>
        </section>
      </div>

      <section className="insuranceSection insuranceProcedure">
        <div className="insuranceSectionHead">
          <Phone size={20}/>
          <div><small>IN CASO DI NECESSITÀ</small><h3>Procedura rapida</h3></div>
        </div>
        <ol>
          <li><b>1</b><span><strong>Contatta Europ Assistance</strong>Prima di organizzare prestazioni mediche importanti, quando possibile.</span></li>
          <li><b>2</b><span><strong>Comunica la polizza {POLICY_NUMBER}</strong>Indica nome dell’assicurato, luogo, problema e numero di richiamata.</span></li>
          <li><b>3</b><span><strong>Segui le istruzioni della centrale</strong>Annota riferimenti e numero della pratica eventualmente aperta.</span></li>
          <li><b>4</b><span><strong>Conserva tutta la documentazione</strong>Servirà per chiedere il rimborso delle spese ammesse.</span></li>
        </ol>
      </section>

      <div className="insuranceLinks">
        <a href="https://viaggi.quickassistance.it/" target="_blank" rel="noreferrer">
          <ReceiptText size={18}/>
          <span><small>ASSISTENZA E RIMBORSI</small><strong>Apri Quick Assistance</strong></span>
          <ExternalLink size={16}/>
        </a>
        <a href="https://www.europassistance.it/" target="_blank" rel="noreferrer">
          <ShieldCheck size={18}/>
          <span><small>SITO DELLA COMPAGNIA</small><strong>Europ Assistance</strong></span>
          <ExternalLink size={16}/>
        </a>
      </div>

      <p className="insuranceDisclaimer">
        Questa pagina riassume il documento contrattuale firmato. Franchigie, esclusioni, limiti e modalità
        complete restano disciplinati dalle Condizioni di Assicurazione Mod. 22230. In caso di dubbio,
        contatta la centrale operativa prima di sostenere spese o organizzare trasferimenti.
      </p>
    </section>
  );
}
