/*
  The connect-time address check, with a real HTTP server on 127.0.0.1 and a
  scripted DNS. The attack it stops: a domain whose DNS answers with a public
  address for a check and a private one for the connection (rebinding).
*/
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const dnsState = vi.hoisted(() => ({ answers: [] as string[][], calls: 0 }));

vi.mock("node:dns", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns")>();
  return {
    ...real,
    lookup: (
      hostname: string,
      options: { all?: boolean },
      callback: (err: Error | null, addresses: { address: string; family: number }[]) => void,
    ) => {
      if (hostname === "localhost" || /^\d/.test(hostname)) return real.lookup(hostname, options as never, callback as never);
      const answer = dnsState.answers[Math.min(dnsState.calls, dnsState.answers.length - 1)] ?? [];
      dnsState.calls++;
      callback(null, answer.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
    },
  };
});

import { fetchText, guardedLookup, PRIVATE_ADDRESS_CODE } from "./fetch";

let server: Server;
let port = 0;
let hits = 0;

beforeAll(async () => {
  server = createServer((_req, res) => {
    hits++;
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>INTERNAL SECRET</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  hits = 0;
  dnsState.calls = 0;
});

const opts = { userAgent: "LegiitAiInfoBot/0.1", timeoutMs: 3_000, maxBytes: 10_000 };

describe("the connect-time address check", () => {
  it("connects only to the address it checked, so a rebinding answer never reaches the server", async () => {
    // Public for the first query, private for every later one: the old pre-check saw the
    // public answer and the socket's own lookup got the private one.
    dnsState.answers = [["93.184.216.34"], ["127.0.0.1"]];
    const r = await fetchText(`http://rebind.attacker.example:${port}/internal`, { ...opts, timeoutMs: 1_500 });
    expect(r.ok).toBe(false);
    expect(hits).toBe(0);
    // One lookup, the one the connection used; there is no second answer to switch to.
    expect(dnsState.calls).toBe(1);
  });

  it("refuses the rebinding answer when it is the one the connection gets", async () => {
    dnsState.answers = [["127.0.0.1"], ["93.184.216.34"]];
    const r = await fetchText(`http://rebind.attacker.example:${port}/internal`, opts);
    expect(r.error).toBe("private or local host");
    expect(hits).toBe(0);
  });

  it("refuses a host whose only answer is private", async () => {
    dnsState.answers = [["10.0.0.5"]];
    const r = await fetchText(`http://internal.attacker.example:${port}/`, opts);
    expect(r.error).toBe("private or local host");
    expect(hits).toBe(0);
  });

  it("refuses a host when any one of its answers is private", async () => {
    dnsState.answers = [["93.184.216.34", "127.0.0.1"]];
    const r = await fetchText(`http://mixed.attacker.example:${port}/`, opts);
    expect(r.error).toBe("private or local host");
    expect(hits).toBe(0);
  });

  it("passes public answers through in both callback shapes", async () => {
    dnsState.answers = [["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]];
    const all = await new Promise<unknown>((resolve) =>
      guardedLookup("example.com", { all: true }, (err, addresses) => resolve(err ?? addresses)),
    );
    expect(all).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    dnsState.calls = 0;
    const one = await new Promise<unknown>((resolve) =>
      guardedLookup("example.com", {}, (err, address, family) => resolve(err ?? [address, family])),
    );
    expect(one).toEqual(["93.184.216.34", 4]);
  });

  it("names the refusal with its own code", async () => {
    dnsState.answers = [["169.254.169.254"]];
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      guardedLookup("metadata.attacker.example", {}, (e) => resolve(e)),
    );
    expect(err?.code).toBe(PRIVATE_ADDRESS_CODE);
  });
});
