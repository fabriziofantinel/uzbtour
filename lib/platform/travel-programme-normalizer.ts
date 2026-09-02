function recordValue(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
}

function normalizedName(value: unknown) {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("it").replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function canonicalHotelName(name: unknown, city: unknown) {
  const normalizedHotel = normalizedName(name);
  const normalizedCity = normalizedName(city);
  if (["movepick", "movenpick"].includes(normalizedHotel) && ["samarcanda", "samarkand"].includes(normalizedCity)) {
    return "Mövenpick Samarkand";
  }
  return name;
}

function text(value: unknown, maximum: number, field: string, changes: string[]) {
  if (typeof value !== "string" || value.length <= maximum) return value;
  changes.push(`${field}: ${value.length}→${maximum} caratteri`);
  return value.slice(0, maximum).trimEnd();
}

function list(value: unknown, maximum: number, field: string, changes: string[]) {
  if (!Array.isArray(value)) return value;
  if (value.length <= maximum) return value;
  changes.push(`${field}: ${value.length}→${maximum} elementi`);
  return value.slice(0, maximum);
}

function validation(value: unknown, field: string, changes: string[]) {
  const item = recordValue(value);
  if (!item) return value;
  return { ...item, reason: text(item.reason, 500, `${field}.reason`, changes) };
}

function activity(value: unknown, path: string, changes: string[]) {
  const item = recordValue(value);
  if (!item) return value;
  const placeName = text(item.placeName, 240, `${path}.placeName`, changes);
  const originalTitle = text(item.title, 240, `${path}.title`, changes);
  const title = item.type === "visit" && typeof placeName === "string" && placeName.trim()
    ? placeName
    : originalTitle;
  if (item.type === "visit" && title !== item.title) changes.push(`${path}.title: uniformato al sito`);
  if (item.startsAt) changes.push(`${path}.startsAt: orario rimosso`);
  if (item.endsAt) changes.push(`${path}.endsAt: orario rimosso`);
  return {
    ...item,
    title,
    description: text(item.description, 3000, `${path}.description`, changes),
    startsAt: "",
    endsAt: "",
    placeName,
    placeCity: text(item.placeCity, 240, `${path}.placeCity`, changes),
    placeCountry: text(item.placeCountry, 120, `${path}.placeCountry`, changes),
    placeValidation: validation(item.placeValidation, `${path}.placeValidation`, changes),
  };
}

function accommodation(value: unknown, path: string, changes: string[]) {
  const item = recordValue(value);
  if (!item) {
    changes.push(`${path}: campo assente→nessun pernottamento`);
    return {
      name: "",
      city: "",
      country: "",
      notes: "",
      validation: { needsValidation: false, reason: "Nessun pernottamento indicato nella fonte" },
    };
  }
  const canonicalName = item ? canonicalHotelName(item.name, item.city) : undefined;
  if (item && canonicalName !== item.name) changes.push(`${path}.name: ${String(item.name)}→${String(canonicalName)}`);
  return {
    ...item,
    name: text(canonicalName ?? "", 240, `${path}.name`, changes),
    city: text(item.city ?? "", 240, `${path}.city`, changes),
    country: text(item.country ?? "", 120, `${path}.country`, changes),
    notes: text(item.notes ?? "", 2000, `${path}.notes`, changes),
    validation: validation(item.validation, `${path}.validation`, changes) ?? {
      needsValidation: Boolean(canonicalName),
      reason: canonicalName ? "Pernottamento da verificare" : "Nessun pernottamento indicato nella fonte",
    },
  };
}

function day(value: unknown, index: number, changes: string[]) {
  const item = recordValue(value);
  if (!item) return value;
  const path = `days[${index}]`;
  const activities = list(item.activities, 40, `${path}.activities`, changes);
  const additionalAccommodations = list(item.additionalAccommodations ?? [], 10, `${path}.additionalAccommodations`, changes);
  const normalizedActivities = Array.isArray(activities)
    ? activities.map((entry, activityIndex) => activity(entry, `${path}.activities[${activityIndex}]`, changes))
    : activities;
  const visitsByCity = new Map<string, { city: string; country: string; count: number }>();
  if (Array.isArray(normalizedActivities)) {
    for (const entry of normalizedActivities) {
      const visit = recordValue(entry);
      if (visit?.type !== "visit" || typeof visit.placeCity !== "string" || !visit.placeCity.trim()) continue;
      const key = `${normalizedName(visit.placeCountry)}:${normalizedName(visit.placeCity)}`;
      const current = visitsByCity.get(key);
      visitsByCity.set(key, {
        city: visit.placeCity.trim(),
        country: typeof visit.placeCountry === "string" ? visit.placeCountry.trim() : "",
        count: (current?.count ?? 0) + 1,
      });
    }
  }
  const rankedCities = [...visitsByCity.values()].sort((left, right) => right.count - left.count);
  const dominantCity = rankedCities[0] && (!rankedCities[1] || rankedCities[0].count > rankedCities[1].count)
    ? rankedCities[0]
    : null;
  const city = dominantCity?.city || text(item.city, 240, `${path}.city`, changes);
  const country = dominantCity?.country || text(item.country, 120, `${path}.country`, changes);
  if (dominantCity && normalizedName(item.city) !== normalizedName(dominantCity.city)) {
    changes.push(`${path}.city: ${String(item.city)}→${dominantCity.city} (${dominantCity.count} visite)`);
  }
  return {
    ...item,
    date: text(item.date, 10, `${path}.date`, changes),
    label: text(item.label, 120, `${path}.label`, changes),
    title: text(item.title, 240, `${path}.title`, changes),
    country,
    countryValidation: validation(item.countryValidation, `${path}.countryValidation`, changes),
    city,
    cityValidation: dominantCity ? {
      needsValidation: false,
      reason: `Città predominante della giornata: ${dominantCity.count} visite`,
    } : validation(item.cityValidation, `${path}.cityValidation`, changes),
    description: text(item.description, 6000, `${path}.description`, changes),
    activities: normalizedActivities,
    accommodation: accommodation(item.accommodation, `${path}.accommodation`, changes),
    additionalAccommodations: Array.isArray(additionalAccommodations)
      ? additionalAccommodations.map((entry, accommodationIndex) => accommodation(entry, `${path}.additionalAccommodations[${accommodationIndex}]`, changes))
      : [],
  };
}

const italianMonths = new Map([
  ["gennaio", 1], ["febbraio", 2], ["marzo", 3], ["aprile", 4], ["maggio", 5], ["giugno", 6],
  ["luglio", 7], ["agosto", 8], ["settembre", 9], ["ottobre", 10], ["novembre", 11], ["dicembre", 12],
]);

function isoDate(year: number, month: number, dayOfMonth: number) {
  const candidate = new Date(Date.UTC(year, month - 1, dayOfMonth));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === dayOfMonth
    ? `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`
    : "";
}

function explicitDayDates(sourceText: string) {
  const dates: string[] = [];
  const headings = sourceText.matchAll(/\bgiorno\s+\d+\s*[-–:]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})|\s+([a-zà]+)\s+(\d{4}))/giu);
  for (const match of headings) {
    const dayOfMonth = Number(match[1]);
    const month = match[2] ? Number(match[2]) : italianMonths.get(normalizedName(match[4]));
    const year = Number(match[3] || match[5]);
    const date = month ? isoDate(year, month, dayOfMonth) : "";
    if (date) dates.push(date);
  }
  return dates;
}

function explicitDayAccommodationNames(sourceText: string) {
  const names = new Map<number, string>();
  const sections = sourceText.matchAll(/\bgiorno\s+(\d+)\b[^\n]*\n([\s\S]*?)(?=\bgiorno\s+\d+\b|$)/giu);
  for (const section of sections) {
    const dayNumber = Number(section[1]);
    const match = section[2]?.match(/\bpernottamento\s+presso\s+([^,\n.]+)/iu);
    const name = match?.[1]?.trim();
    if (dayNumber > 0 && name) names.set(dayNumber, name);
  }
  return names;
}

export function normalizeTravelProgramme(input: unknown, options?: { fallbackTitle?: string; sourceText?: string }) {
  const source = recordValue(input);
  if (!source) return { value: input, changes: [] as string[] };
  const changes: string[] = [];
  const days = list(source.days, 90, "days", changes);
  const countries = Array.isArray(days)
    ? [...new Set(days.map((entry) => recordValue(entry)?.country).filter((value): value is string => typeof value === "string" && value.trim().length > 0))]
    : [];
  const title = source.title === undefined && options?.fallbackTitle
    ? (changes.push("title: campo assente→nome documento"), options.fallbackTitle)
    : source.title;
  const destinationCountry = source.destinationCountry === undefined
    ? (changes.push("destinationCountry: campo assente→paesi delle giornate"), countries.join(", "))
    : source.destinationCountry;
  const usefulInformation = source.usefulInformation === undefined
    ? (changes.push("usefulInformation: campo assente→array vuoto"), [])
    : list(source.usefulInformation, 80, "usefulInformation", changes);
  const normalizedDays = Array.isArray(days) ? days.map((entry, index) => day(entry, index, changes)) : days;
  const sourceDates = options?.sourceText ? explicitDayDates(options.sourceText) : [];
  const sourceAccommodationNames = options?.sourceText ? explicitDayAccommodationNames(options.sourceText) : new Map<number, string>();
  if (Array.isArray(normalizedDays) && sourceDates.length === normalizedDays.length) {
    normalizedDays.forEach((entry, index) => {
      const item = recordValue(entry);
      if (!item || item.date === sourceDates[index]) return;
      changes.push(`days[${index}].date: ${String(item.date)}→${sourceDates[index]} (data esplicita nella fonte)`);
      item.date = sourceDates[index];
    });
  }
  if (Array.isArray(normalizedDays)) {
    normalizedDays.forEach((entry, index) => {
      const item = recordValue(entry);
      const hotel = recordValue(item?.accommodation);
      const sourceName = sourceAccommodationNames.get(index + 1);
      if (!hotel || !sourceName || typeof hotel.name !== "string" || !hotel.name.trim() || hotel.name === sourceName) return;
      changes.push(`days[${index}].accommodation.name: ${hotel.name}→${sourceName} (nome esplicito nella fonte)`);
      hotel.name = sourceName;
    });
  }
  const normalizedDayDates = Array.isArray(normalizedDays)
    ? normalizedDays.map((entry) => recordValue(entry)?.date).filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    : [];
  const completeDaySequence = Array.isArray(normalizedDays) && normalizedDayDates.length === normalizedDays.length;
  const sourceStartDate = sourceDates.length > 0 ? sourceDates[0]
    : (!source.startDate && completeDaySequence ? normalizedDayDates[0] : source.startDate);
  const sourceEndDate = sourceDates.length > 0 ? sourceDates.at(-1)
    : (!source.endDate && completeDaySequence ? normalizedDayDates.at(-1) : source.endDate);

  return {
    value: {
      ...source,
      title: text(title, 240, "title", changes),
      destinationCountry: text(destinationCountry, 120, "destinationCountry", changes),
      startDate: text(sourceStartDate, 10, "startDate", changes),
      endDate: text(sourceEndDate, 10, "endDate", changes),
      summary: text(source.summary, 6000, "summary", changes),
      days: normalizedDays,
      usefulInformation: Array.isArray(usefulInformation)
        ? usefulInformation.map((entry, index) => {
            const item = recordValue(entry);
            const path = `usefulInformation[${index}]`;
            return item ? {
              ...item,
              category: text(item.category, 80, `${path}.category`, changes),
              title: text(item.title, 240, `${path}.title`, changes),
              body: text(item.body, 6000, `${path}.body`, changes),
              phone: text(item.phone, 100, `${path}.phone`, changes),
              url: text(item.url, 500, `${path}.url`, changes),
            } : entry;
          })
        : usefulInformation,
    },
    changes,
  };
}
