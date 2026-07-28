import { NextResponse } from "next/server";

type CentralBankRate = {
  Ccy: string;
  Nominal: string;
  Rate: string;
  Date: string;
};

export const revalidate = 3600;

export async function GET() {
  try {
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
