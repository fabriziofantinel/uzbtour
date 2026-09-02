"use client";
import { FormEvent, useState } from "react";
import { CheckCircle2, HeartHandshake } from "lucide-react";

export default function OperationalAlertForm({
  departureId,
  travelers,
}: {
  departureId: string;
  travelers: Array<{ id: string; name: string; isCurrent: boolean; memberType: string }>;
}) {
  const current = travelers.find((traveler) => traveler.isCurrent),
    [saved, setSaved] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/departures/${departureId}/operations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "operationalAlert",
        travelerId: form.get("travelerId"),
        summary: form.get("summary"),
        instructions: form.get("instructions"),
        explicitConsent: form.get("consent") === "on",
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error || "Segnalazione non registrata");
      return;
    }
    setSaved(true);
  }
  return (
    <form className="operationalAlertForm" onSubmit={submit}>
      <h3>
        <HeartHandshake /> Segnalazione operativa essenziale
      </h3>
      <p>
        Comunica solo ciò che responsabile e Tour Leader devono sapere per assisterti durante il viaggio. Non inserire
        diagnosi, passaporti o documenti sanitari.
      </p>
      <label>
        Persona
        <select name="travelerId" defaultValue={current?.id}>
          {travelers.map((traveler) => (
            <option key={traveler.id} value={traveler.id}>
              {traveler.name}
              {traveler.memberType === "dependent_minor" ? " (minore)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Segnalazione
        <textarea
          name="summary"
          required
          minLength={3}
          maxLength={500}
          placeholder="Es. necessita di assistenza per salire le scale"
        />
      </label>
      <label>
        Istruzioni utili
        <textarea name="instructions" maxLength={1000} placeholder="Indicazioni pratiche per l’assistenza" />
      </label>
      <label className="consentCheck">
        <input type="checkbox" name="consent" required /> Acconsento esplicitamente al trattamento per l’assistenza
        operativa. I dati saranno eliminati entro 30 giorni dal rientro.
      </label>
      <button type="submit">Registra segnalazione</button>
      {saved && (
        <p role="status">
          <CheckCircle2 /> Segnalazione registrata.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
