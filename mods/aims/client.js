// Talks to an AIMS instance: one JSON-RPC `tools/call` per request against
// its /mcp endpoint, authenticated with the connection's personal token.
// The endpoint is stateless, so there is no handshake and no session.

/** kind: "auth" (token rejected), "network" (unreachable or not AIMS), "tool" (AIMS said no). */
export class AimsError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

export async function callTool(connection, name, args = {}) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: connection.workspace ? { workspace_slug: connection.workspace, ...args } : args,
    },
  };

  let response;
  try {
    response = await fetch(`${connection.url}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new AimsError("network", `Could not reach ${connection.url}: ${String(error?.message ?? error)}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new AimsError("auth", "The token was rejected. It may be revoked or expired.");
  }
  if (!response.ok) {
    throw new AimsError("network", `${connection.url} answered HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new AimsError("network", `${connection.url} did not answer as an AIMS MCP endpoint.`);
  }

  if (payload?.error) {
    throw new AimsError("tool", payload.error.message ?? "The request was refused.");
  }

  const text = (payload?.result?.content ?? []).map((part) => part?.text ?? "").join("");
  if (payload?.result?.isError) {
    throw new AimsError("tool", text || "The request was refused.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AimsError("tool", `Unexpected answer from ${name}.`);
  }
}
