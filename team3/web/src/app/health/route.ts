/**
 * GET /health - Health check endpoint.
 * Returns 200 with { status: 'ok' }.
 * Also triggers one-time startup logging.
 */
import { webLog } from "@/lib/web-logger";

let startLogged = false;

export async function GET() {
  if (!startLogged) {
    startLogged = true;
    webLog.start({ port: 3001 });
  }
  return Response.json({ status: "ok" });
}
