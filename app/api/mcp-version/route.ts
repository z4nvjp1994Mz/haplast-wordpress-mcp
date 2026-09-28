export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return Response.json({
    service: "haplast-wordpress-mcp",
    schema: "media-v2",
    expected_tools: [
      "upload_media_base64",
      "set_featured_image",
      "upload_and_set_featured_image"
    ]
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate"
    }
  });
}
