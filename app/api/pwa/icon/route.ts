import { NextResponse } from "next/server";
import sharp from "sharp";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { getTravelerPwaBranding } from "@/lib/platform/pwa-branding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const size = requestUrl.searchParams.get("size") === "512" ? 512 : 192;
  const encodedSource = requestUrl.searchParams.get("source") || "";
  const branding = await getTravelerPwaBranding();
  let logoUrl = branding?.logoUrl || "";
  if (!logoUrl && encodedSource) {
    try { logoUrl = Buffer.from(encodedSource, "base64url").toString("utf8"); } catch { logoUrl = ""; }
  }
  if (!/^r2:\/\/agencies\/[0-9a-f-]{36}\/branding\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(logoUrl)) {
    return NextResponse.redirect(new URL(`/icons/icon-${size}.png`, request.url));
  }
  const key = logoUrl.slice("r2://".length);
  if (!/^agencies\/[0-9a-f-]{36}\/branding\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(key)) {
    return NextResponse.redirect(new URL(`/icons/icon-${size}.png`, request.url));
  }
  try {
    const sourceUrl = await getObjectStorage().createDownloadUrl(key, 60);
    const source = await fetch(sourceUrl, { cache: "no-store" });
    if (!source.ok) throw new Error("Logo non disponibile");
    const logo = await sharp(Buffer.from(await source.arrayBuffer()))
      .resize(Math.round(size * .76), Math.round(size * .76), { fit: "contain" })
      .png()
      .toBuffer();
    const image = await sharp({ create: { width: size, height: size, channels: 4, background: "#faf7f0" } })
      .composite([{ input: logo, gravity: "center" }])
      .png()
      .toBuffer();
    return new NextResponse(new Uint8Array(image), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, immutable" } });
  } catch {
    return NextResponse.redirect(new URL(`/icons/icon-${size}.png`, request.url));
  }
}
