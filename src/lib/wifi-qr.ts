// Parse a Wi-Fi auto-join QR payload into { ssid, password }.
// Format spec: WIFI:T:<auth>;S:<ssid>;P:<password>;H:<hidden>;;
// Backslash-escaped characters are: \ ; , : "
//
// Returns null if the payload doesn't look like a Wi-Fi QR.

export interface ParsedWifi {
  ssid: string;
  password: string | null;
}

export function parseWifiQr(text: string): ParsedWifi | null {
  if (!text.startsWith("WIFI:")) return null;
  const body = text.slice(5);

  // Walk the body splitting on unescaped ';' and ':'.
  const fields: Record<string, string> = {};
  let buf = "";
  let key: string | null = null;
  let escaped = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === ":" && key === null) {
      key = buf;
      buf = "";
      continue;
    }
    if (ch === ";") {
      if (key !== null) fields[key] = buf;
      key = null;
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (key !== null && buf) fields[key] = buf;

  if (!fields.S) return null;
  return {
    ssid: fields.S,
    password: fields.P ? fields.P : null,
  };
}
