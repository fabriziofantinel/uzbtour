export type TodayScheduleItem = {
  time: string;
  label: string;
  timestamp?: string;
};

export type TodayDetail = {
  day: number;
  isoDate: string;
  schedule: TodayScheduleItem[];
  meetingPoint: string;
};

export const todayDetails: TodayDetail[] = [
  {
    day: 12,
    isoDate: "2026-08-01",
    meetingPoint: "Aeroporto di Torino (TRN)",
    schedule: [
      { time: "10:25", label: "Volo TK1310 per Istanbul", timestamp: "2026-08-01T10:25:00+02:00" },
      { time: "18:25", label: "Volo TK370 per Tashkent", timestamp: "2026-08-01T18:25:00+03:00" }
    ]
  },
  {
    day: 1,
    isoDate: "2026-08-02",
    meetingPoint: "Hotel Inspira-S, Tashkent",
    schedule: [
      { time: "00:50", label: "Arrivo a Tashkent", timestamp: "2026-08-02T00:50:00+05:00" },
      { time: "10:30", label: "Inizio visita guidata di Tashkent", timestamp: "2026-08-02T10:30:00+05:00" },
      { time: "20:40", label: "Volo interno per Urgench", timestamp: "2026-08-02T20:40:00+05:00" }
    ]
  },
  { day: 2, isoDate: "2026-08-03", meetingPoint: "Hotel Zarafshon, Khiva", schedule: [{ time: "Mattina", label: "Visita guidata di Ichan Kala" }, { time: "Sera", label: "Cena in ristorante locale" }] },
  { day: 3, isoDate: "2026-08-04", meetingPoint: "Stazione ferroviaria di Khiva", schedule: [{ time: "Da confermare", label: "Treno Khiva–Bukhara" }, { time: "Pomeriggio", label: "Arrivo e passeggiata a Bukhara" }] },
  { day: 4, isoDate: "2026-08-05", meetingPoint: "Hotel Shaxriston, Bukhara", schedule: [{ time: "Mattina", label: "Inizio visite di Bukhara" }, { time: "Giornata", label: "Ark, Poi Kalon e mercati coperti" }] },
  {
    day: 5,
    isoDate: "2026-08-06",
    meetingPoint: "Hotel Shaxriston, Bukhara",
    schedule: [
      { time: "Mattina", label: "Palazzo Sitorai Mokhi Khosa" },
      { time: "15:03", label: "Treno per Samarcanda", timestamp: "2026-08-06T15:03:00+05:00" },
      { time: "Sera", label: "Registan illuminato" }
    ]
  },
  { day: 6, isoDate: "2026-08-07", meetingPoint: "Hotel Maridian Plaza, Samarcanda", schedule: [{ time: "Mattina", label: "Gur-e-Amir e Piazza Registan" }, { time: "Pomeriggio", label: "Bibi Khanum e Bazaar Siab" }] },
  { day: 7, isoDate: "2026-08-08", meetingPoint: "Hotel Maridian Plaza, Samarcanda", schedule: [{ time: "Mattina", label: "Partenza per Shahrisabz" }, { time: "Tardo pomeriggio", label: "Rientro a Samarcanda" }] },
  {
    day: 8,
    isoDate: "2026-08-09",
    meetingPoint: "Hotel Maridian Plaza, Samarcanda",
    schedule: [
      { time: "Mattina", label: "Shah-i-Zinda e Ulugh Beg" },
      { time: "17:40", label: "Treno per Tashkent", timestamp: "2026-08-09T17:40:00+05:00" }
    ]
  },
  {
    day: 9,
    isoDate: "2026-08-10",
    meetingPoint: "Stazione ferroviaria di Tashkent",
    schedule: [
      { time: "08:10", label: "Treno per Kokand", timestamp: "2026-08-10T08:10:00+05:00" },
      { time: "Pomeriggio", label: "Rishtan e trasferimento a Fergana" }
    ]
  },
  { day: 10, isoDate: "2026-08-11", meetingPoint: "Hotel Saroy Garden, Fergana", schedule: [{ time: "Mattina", label: "Setificio e bazar di Margilan" }, { time: "Pomeriggio", label: "Passo Kamchik e rientro a Tashkent" }] },
  { day: 11, isoDate: "2026-08-12", meetingPoint: "Hotel Inspira-S, Tashkent", schedule: [{ time: "12:00", label: "Check-out ordinario", timestamp: "2026-08-12T12:00:00+05:00" }, { time: "Sera", label: "Cena e trasferimento in aeroporto" }, { time: "23:50", label: "Volo TK363", timestamp: "2026-08-12T23:50:00+05:00" }] },
  {
    day: 13,
    isoDate: "2026-08-13",
    meetingPoint: "Aeroporto di Istanbul (IST)",
    schedule: [
      { time: "03:15", label: "Arrivo a Istanbul", timestamp: "2026-08-13T03:15:00+03:00" },
      { time: "07:30", label: "Volo TK1309 per Torino", timestamp: "2026-08-13T07:30:00+03:00" },
      { time: "09:30", label: "Arrivo a Torino", timestamp: "2026-08-13T09:30:00+02:00" }
    ]
  }
];

export function selectedTripDay(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const today = formatter.format(now);
  return todayDetails.find((entry) => entry.isoDate === today)
    ?? (today < todayDetails[0].isoDate ? todayDetails[0] : todayDetails[todayDetails.length - 1]);
}
