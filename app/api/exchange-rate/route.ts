import { NextResponse } from "next/server";

type CentralBankRate = {
  Ccy: string;
  Nominal: string;
  Rate: string;
  Date: string;
};

export const revalidate = 3600;

export async function GET(request: Request) {
  const currency = new URL(request.url).searchParams.get("currency")?.toUpperCase() || "UZS";
  if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Valuta non valida" }, { status: 400 });
  if (currency === "EUR") return NextResponse.json({ rate: 1, source: "Parità euro" });
  try {
    if (currency !== "UZS") {
      const response = await fetch("https://open.er-api.com/v6/latest/EUR", { next: { revalidate: 3600 } });
      if (!response.ok) throw new Error(`Exchange response: ${response.status}`);
      const data = await response.json() as { rates?: Record<string, number>; time_last_update_utc?: string };
      const rate = data.rates?.[currency];
      if (!rate || !Number.isFinite(rate)) throw new Error("Invalid exchange rate");
      return NextResponse.json({ rate, date: data.time_last_update_utc, source: "Exchange Rate API" });
    }
    const response = await fetch("https://cbu.uz/en/arkhiv-kursov-valyut/json/EUR/", {
      next: { revalidate: 3600 }
    });

    if (!response.ok) throw new Error(`Central Bank response: ${response.status}`);

    const rates = await response.json() as CentralBankRate[];
    const euro = rates.find((item) => item.Ccy === "EUR");
    const nominal = Number(euro?.Nominal);
    const value = Number(euro?.Rate);

    if (!euro || !Number.isFinite(nominal) || !Number.isFinite(value) || nominal <= 0) {
      throw new Error("Invalid EUR rate");
    }

    return NextResponse.json({
      rate: value / nominal,
      date: euro.Date,
      source: "Banca Centrale della Repubblica dell’Uzbekistan"
    });
  } catch {
    return NextResponse.json(
      { error: "Tasso ufficiale temporaneamente non disponibile" },
      { status: 503 }
    );
  }
}
