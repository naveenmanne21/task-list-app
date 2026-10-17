// POST /api/import — multipart form with a "file" field. Thin wrapper around
// importCsvBytes(); always answers JSON, never an unhandled error.
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { importCsvBytes, MAX_BYTES } from "@/lib/import/service";

// Room for multipart boundaries and headers on top of the file itself.
const MAX_BODY_BYTES = MAX_BYTES + 64 * 1024;

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: "You are not signed in." }, 401);

    // Reject obviously oversized uploads before reading the body.
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_BODY_BYTES) return json({ error: "The file is larger than 1 MB. Split it into smaller files." }, 413);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: 'Expected a multipart form upload with a "file" field.' }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return json({ error: file instanceof File ? "The file is empty." : "Choose a CSV file to upload." }, 400);
    }
    if (file.size > MAX_BYTES) return json({ error: "The file is larger than 1 MB. Split it into smaller files." }, 413);

    const outcome = await importCsvBytes(user.id, new Uint8Array(await file.arrayBuffer()));
    return outcome.ok ? json(outcome.result) : json({ error: outcome.error }, outcome.status);
  } catch (err) {
    console.error("POST /api/import failed", err);
    return json({ error: "Something went wrong. No tasks were imported." }, 500);
  }
}
