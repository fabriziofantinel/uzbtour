import "server-only";

import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

export type RoomType = "single" | "double" | "matrimonial" | "triple";
export type RoomingRoom = {
  id: string;
  label: string;
  type: RoomType;
  specialRequirements: string;
  occupantIds: string[];
};

export type RoomingListData = {
  departure: { id: string; title: string; agencyName: string; agencyPrimaryColor: string };
  stays: Array<{
    id: string;
    stayIds: string[];
    hotelName: string;
    notes: string;
    nights: Array<{
      id: string;
      dayId: string;
      dayNumber: number;
      serviceDate: string;
      nightDate: string;
      checkoutDate: string;
    }>;
  }>;
  groups: Array<{
    id: string;
    name: string;
    travelers: Array<{
      id: string;
      name: string;
      birthDate: string;
      memberType: "adult" | "dependent_minor";
    }>;
  }>;
  rooms: Array<RoomingRoom & { stayId: string; partyId: string }>;
};

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizedHotelName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("it-IT");
}

export async function readRoomingList(actorId: string, departureId: string): Promise<RoomingListData> {
  const sql = getSql();
  const scope = await sql`SELECT agency_id::text,title,agency_name,primary_color
    FROM app.read_rooming_list_scope_v3(${actorId}::uuid,${departureId}::uuid)`;
  if (!scope[0]) throw new PlatformRequestError("Rooming list non disponibile");
  const agencyId = String(scope[0].agency_id);
  const [, stayRows, travelerRows, roomRows] = await sql.transaction(
    (transaction) => [
      transaction`SELECT set_config('app.agency_id',${agencyId},true)`,
      transaction`SELECT stay.id::text,stay.hotel_id::text,stay.departure_day_id::text day_id,template_day.day_number,
        day.service_date::text,stay.name_snapshot hotel_name,stay.notes
        FROM travel.departure_accommodation_stays stay
        JOIN travel.departure_days day ON day.agency_id=stay.agency_id AND day.departure_id=stay.departure_id
          AND day.id=stay.departure_day_id
        JOIN travel.template_days template_day ON template_day.agency_id=day.agency_id
          AND template_day.template_version_id=day.template_version_id AND template_day.id=day.template_day_id
        WHERE stay.agency_id=${agencyId}::uuid AND stay.departure_id=${departureId}::uuid
          AND stay.operational_status<>'cancelled'
        ORDER BY day.service_date,stay.sort_order,stay.id`,
      transaction`SELECT party.id::text party_id,party.name party_name,profile.id::text traveler_id,
        profile.display_name traveler_name,profile.birth_date::text,membership.member_type
        FROM travel.travel_parties party
        LEFT JOIN travel.party_memberships membership ON membership.agency_id=party.agency_id
          AND membership.departure_id=party.departure_id AND membership.party_id=party.id
          AND membership.status<>'removed'
        LEFT JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id
          AND profile.id=membership.traveler_id
        WHERE party.agency_id=${agencyId}::uuid AND party.departure_id=${departureId}::uuid
          AND party.status<>'archived'
        ORDER BY party.name,membership.role,profile.display_name`,
      transaction`SELECT room.id::text,room.stay_id::text,room.party_id::text,room.room_label,room.room_type,
        room.special_requirements,COALESCE(array_agg(occupant.traveler_id::text ORDER BY profile.display_name)
          FILTER(WHERE occupant.traveler_id IS NOT NULL),'{}'::text[]) occupant_ids
        FROM travel.rooming_rooms room
        LEFT JOIN travel.rooming_room_occupants occupant ON occupant.room_id=room.id
        LEFT JOIN travel.traveler_profiles profile ON profile.id=occupant.traveler_id AND profile.agency_id=room.agency_id
        WHERE room.agency_id=${agencyId}::uuid AND room.departure_id=${departureId}::uuid
        GROUP BY room.id,room.stay_id,room.party_id,room.room_label,room.room_type,room.special_requirements
        ORDER BY room.stay_id,room.party_id,room.room_label`,
    ],
    { readOnly: true },
  );
  const rawStays = stayRows.map((row) => ({
    id: String(row.id),
    hotelId: stringValue(row.hotel_id),
    dayId: String(row.day_id),
    dayNumber: Number(row.day_number),
    serviceDate: String(row.service_date),
    hotelName: String(row.hotel_name),
    notes: stringValue(row.notes),
  }));
  const groupedStays = new Map<string, RoomingListData["stays"][number]>();
  for (const rawStay of rawStays) {
    const key = rawStay.hotelId ? `hotel:${rawStay.hotelId}` : `name:${normalizedHotelName(rawStay.hotelName)}`;
    const hotel = groupedStays.get(key) ?? {
      id: rawStay.id,
      stayIds: [],
      hotelName: rawStay.hotelName,
      notes: rawStay.notes,
      nights: [],
    };
    hotel.stayIds.push(rawStay.id);
    hotel.nights.push({
      id: rawStay.id,
      dayId: rawStay.dayId,
      dayNumber: rawStay.dayNumber,
      serviceDate: rawStay.serviceDate,
      nightDate: rawStay.serviceDate,
      checkoutDate: shiftIsoDate(rawStay.serviceDate, 1),
    });
    if (!hotel.notes && rawStay.notes) hotel.notes = rawStay.notes;
    groupedStays.set(key, hotel);
  }
  const stays = [...groupedStays.values()].map((hotel) => {
    const totals = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const night of hotel.nights) totals.set(night.serviceDate, (totals.get(night.serviceDate) ?? 0) + 1);
    const nights = hotel.nights.map((night) => {
      const index = seen.get(night.serviceDate) ?? 0;
      seen.set(night.serviceDate, index + 1);
      const nightDate = shiftIsoDate(night.serviceDate, index - (totals.get(night.serviceDate) ?? 1) + 1);
      return { ...night, nightDate, checkoutDate: shiftIsoDate(nightDate, 1) };
    });
    return { ...hotel, nights };
  });
  const grouped = new Map<string, RoomingListData["groups"][number]>();
  for (const row of travelerRows) {
    const partyId = String(row.party_id);
    const group = grouped.get(partyId) ?? { id: partyId, name: String(row.party_name), travelers: [] };
    if (row.traveler_id)
      group.travelers.push({
        id: String(row.traveler_id),
        name: String(row.traveler_name),
        birthDate: stringValue(row.birth_date),
        memberType: String(row.member_type) === "dependent_minor" ? "dependent_minor" : "adult",
      });
    grouped.set(partyId, group);
  }
  return {
    departure: {
      id: departureId,
      title: String(scope[0].title),
      agencyName: String(scope[0].agency_name),
      agencyPrimaryColor: String(scope[0].primary_color),
    },
    stays,
    groups: [...grouped.values()],
    rooms: stays.flatMap((hotel) => {
      const hotelRows = roomRows.filter((row) => hotel.stayIds.includes(String(row.stay_id)));
      const partyIds = [...new Set(hotelRows.map((row) => String(row.party_id)))];
      return partyIds.flatMap((partyId) => {
        const partyRows = hotelRows.filter((row) => String(row.party_id) === partyId);
        const sourceStayId = partyRows.some((row) => String(row.stay_id) === hotel.id)
          ? hotel.id
          : String(partyRows[0]?.stay_id ?? "");
        return partyRows
          .filter((row) => String(row.stay_id) === sourceStayId)
          .map((row) => ({
            id: String(row.id),
            stayId: hotel.id,
            partyId,
            label: String(row.room_label),
            type: String(row.room_type) as RoomType,
            specialRequirements: stringValue(row.special_requirements),
            occupantIds: Array.isArray(row.occupant_ids) ? row.occupant_ids.map(String) : [],
          }));
      });
    }),
  };
}

export async function saveRoomingList(input: {
  actorId: string;
  departureId: string;
  stayId: string;
  partyId: string;
  rooms: RoomingRoom[];
}) {
  const rows = await getSql()`SELECT app.save_rooming_list_v3(${input.actorId}::uuid,${input.departureId}::uuid,
    ${input.stayId}::uuid,${input.partyId}::uuid,${JSON.stringify(
      input.rooms.map((room) => ({
        id: room.id,
        label: room.label,
        type: room.type,
        specialRequirements: room.specialRequirements,
        occupantIds: room.occupantIds,
      })),
    )}::jsonb) saved`;
  if (!rows[0]?.saved) throw new PlatformRequestError("Rooming list non salvata");
}

const roomTypeLabel: Record<RoomType, string> = {
  single: "Singola",
  double: "Doppia",
  matrimonial: "Matrimoniale",
  triple: "Tripla",
};

export async function createRoomingListDocx(data: RoomingListData, stayId: string) {
  const stay = data.stays.find((item) => item.id === stayId);
  if (!stay) throw new PlatformRequestError("Pernottamento non disponibile");
  const names = new Map(
    data.groups.flatMap((group) => group.travelers.map((traveler) => [traveler.id, traveler.name])),
  );
  const rows = data.rooms.filter((room) => room.stayId === stayId);
  const tableRows = [
    new TableRow({
      tableHeader: true,
      children: ["Gruppo", "Camera", "Tipologia", "Ospiti", "Esigenze"].map(
        (label) =>
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })] }),
      ),
    }),
    ...rows.map((room) => {
      const group = data.groups.find((item) => item.id === room.partyId);
      return new TableRow({
        children: [
          group?.name ?? "Gruppo",
          room.label,
          roomTypeLabel[room.type],
          room.occupantIds.map((id) => names.get(id) ?? "Ospite").join(", "),
          room.specialRequirements || "—",
        ].map((value) => new TableCell({ children: [new Paragraph(String(value))] })),
      });
    }),
  ];
  const document = new Document({
    creator: data.departure.agencyName,
    title: `Rooming list - ${stay.hotelName}`,
    sections: [
      {
        children: [
          new Paragraph({ text: "Rooming list", heading: HeadingLevel.TITLE }),
          new Paragraph({ children: [new TextRun({ text: data.departure.agencyName, bold: true })] }),
          new Paragraph(`${data.departure.title} · ${stay.hotelName}`),
          new Paragraph({
            children: [
              new TextRun({
                text: `${stay.nights.length} ${stay.nights.length === 1 ? "notte" : "notti"}`,
                bold: true,
              }),
            ],
          }),
          ...stay.nights.map(
            (night, index) =>
              new Paragraph(
                `Notte ${index + 1}: ${new Intl.DateTimeFormat("it-IT", { dateStyle: "full" }).format(
                  new Date(`${night.nightDate}T12:00:00`),
                )} - ${new Intl.DateTimeFormat("it-IT", { dateStyle: "full" }).format(
                  new Date(`${night.checkoutDate}T12:00:00`),
                )}`,
              ),
          ),
          new Paragraph("Il documento contiene esclusivamente nomi, assegnazioni ed esigenze operative."),
          new Paragraph({ text: "Assegnazione camere", heading: HeadingLevel.HEADING_1 }),
          rows.length
            ? new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows })
            : new Paragraph("Nessuna camera assegnata."),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
