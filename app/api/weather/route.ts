import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";

export const revalidate = 1800;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lon"));
  const date = url.searchParams.get("date") ?? "";
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return NextResponse.json({ error: "Località non valida" }, { status: 400 });
  }

  try {
    const endpoint = new URL("https://api.open-meteo.com/v1/forecast");
    endpoint.searchParams.set("latitude", String(latitude));
    endpoint.searchParams.set("longitude", String(longitude));
    endpoint.searchParams.set("timezone", "Asia/Tashkent");
    endpoint.searchParams.set("forecast_days", "16");
    endpoint.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    const response = await fetch(endpoint, { next: { revalidate: 1800 } });
    if (!response.ok) throw new Error(`Meteo ${response.status}`);
    const payload = await response.json() as {
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
      };
    };
    const index = payload.daily?.time?.indexOf(date) ?? -1;
    if (index < 0) {
      return NextResponse.json({ available: false });
    }
    return NextResponse.json({
      available: true,
      code: payload.daily?.weather_code?.[index] ?? 0,
      max: payload.daily?.temperature_2m_max?.[index] ?? null,
      min: payload.daily?.temperature_2m_min?.[index] ?? null,
      rain: payload.daily?.precipitation_probability_max?.[index] ?? null
    });
  } catch (error) {
    console.error("Previsioni meteo non disponibili", error);
    return NextResponse.json({ available: false });
  }
}
