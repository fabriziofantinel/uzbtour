import { requireDepartureCollaborator } from "@/lib/platform/authorization";
import { createRoomingListDocx, readRoomingList } from "@/lib/platform/rooming-list";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const actor = await requireDepartureCollaborator(id);
    const stayId = new URL(request.url).searchParams.get("stayId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(stayId)) return Response.json({ error: "Pernottamento non valido" }, { status: 400 });
    const data = await readRoomingList(actor.nativeId, id);
    const bytes = await createRoomingListDocx(data, stayId);
    const stay = data.stays.find((item) => item.id === stayId);
    const filename = `rooming-list-${
      (stay?.hotelName || "hotel")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "hotel"
    }.docx`;
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Documento non disponibile" },
      { status: 403 },
    );
  }
}
