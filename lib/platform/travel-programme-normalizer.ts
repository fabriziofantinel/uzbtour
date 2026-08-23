function recordValue(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
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

function day(value: unknown, index: number, changes: string[]) {
  const item = recordValue(value);
  if (!item) return value;
  const path = `days[${index}]`;
  const activities = list(item.activities, 40, `${path}.activities`, changes);
  const accommodation = recordValue(item.accommodation);
  return {
    ...item,
    date: text(item.date, 10, `${path}.date`, changes),
    label: text(item.label, 120, `${path}.label`, changes),
    title: text(item.title, 240, `${path}.title`, changes),
    country: text(item.country, 120, `${path}.country`, changes),
    countryValidation: validation(item.countryValidation, `${path}.countryValidation`, changes),
    city: text(item.city, 240, `${path}.city`, changes),
    cityValidation: validation(item.cityValidation, `${path}.cityValidation`, changes),
    description: text(item.description, 6000, `${path}.description`, changes),
    activities: Array.isArray(activities)
      ? activities.map((entry, activityIndex) => activity(entry, `${path}.activities[${activityIndex}]`, changes))
      : activities,
    accommodation: accommodation ? {
      ...accommodation,
      name: text(accommodation.name, 240, `${path}.accommodation.name`, changes),
      city: text(accommodation.city, 240, `${path}.accommodation.city`, changes),
      country: text(accommodation.country, 120, `${path}.accommodation.country`, changes),
      notes: text(accommodation.notes, 2000, `${path}.accommodation.notes`, changes),
      validation: validation(accommodation.validation, `${path}.accommodation.validation`, changes),
    } : item.accommodation,
  };
}

export function normalizeTravelProgramme(input: unknown, options?: { fallbackTitle?: string }) {
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

  return {
    value: {
      ...source,
      title: text(title, 240, "title", changes),
      destinationCountry: text(destinationCountry, 120, "destinationCountry", changes),
      startDate: text(source.startDate, 10, "startDate", changes),
      endDate: text(source.endDate, 10, "endDate", changes),
      summary: text(source.summary, 6000, "summary", changes),
      days: Array.isArray(days) ? days.map((entry, index) => day(entry, index, changes)) : days,
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
