/** Opt-in isolated backend fixture from /tmp/job-intel-research-ui-qa.py, port 8005. */
import { request } from "node:http";
import { randomUUID } from "node:crypto";
import { ApiRepository } from "../src/api";
import { ResearchOperation } from "../src/research";
const qa =
  process.env.JOB_INTEL_RESEARCH_CONTRACT_QA === "1" ? test : test.skip;
function fixture(path: string, init: RequestInit = {}) {
  return new Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: 8005,
        path,
        method: init.method ?? "GET",
        headers: init.headers as Record<string, string>,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            ok: response.statusCode! >= 200 && response.statusCode! < 300,
            status: response.statusCode!,
            json: async () => JSON.parse(Buffer.concat(chunks).toString()),
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () =>
      req.destroy(new Error("Synthetic fixture unavailable")),
    );
    if (init.body) req.write(init.body);
    req.end();
  });
}
qa(
  "actual isolated queue supports mobile parsing, duplicate protection and exact-key recovery",
  async () => {
    expect((await fixture("/qa/session")).status).toBe(303);
    const headers = {
      Cookie: "session=inert-aging-owner-session",
      "X-CSRF-Token": "inert-aging-owner-csrf",
    };
    let loseResponse = false;
    const writes: { body: string; key: unknown }[] = [];
    const api = new ApiRepository(
      "https://synthetic-research.invalid",
      async () => headers,
      (async (url: string | URL, init: RequestInit = {}) => {
        const target = new URL(String(url));
        if (target.origin !== "https://synthetic-research.invalid")
          throw new Error("Fixture only");
        expect(init.credentials).toBe("omit");
        const response = await fixture(target.pathname + target.search, init);
        if (init.method === "POST") {
          writes.push({
            body: String(init.body),
            key: (init.headers as Record<string, string>)["Idempotency-Key"],
          });
          if (response.ok && loseResponse) {
            loseResponse = false;
            throw new Error("Lost synthetic acknowledgement");
          }
        }
        return response;
      }) as typeof fetch,
    );
    expect(await api.identity()).toEqual({ actor: "owner" });
    expect((await api.researchRequests("synthetic-aging-1"))[0].status).toBe(
      "queued",
    );
    expect(
      (await api.researchRequests("synthetic-aging-2"))[0].missing_deliverables,
    ).toHaveLength(4);
    expect(
      (await api.researchRequests("synthetic-aging-3"))[0].artifacts[0]
        .availability,
    ).toBe("available");
    const id = "synthetic-mobile-queue-" + randomUUID();
    await api.save({
      id,
      key: randomUUID(),
      payload: {
        kind: "job",
        job: null,
        version: 0,
        body: {
          company: "Synthetic Mobile QA",
          title: "Disposable contract fixture",
          stage: "Prospect",
          comp_status: "Unknown",
          lane: "Product engineering",
        },
      },
    });
    try {
      const operation: ResearchOperation = {
        key: randomUUID(),
        job: id,
        action: "request",
        payload: {
          package: "full_package",
          note: "Synthetic instructions only",
        },
      };
      loseResponse = true;
      await expect(api.researchWrite(operation)).rejects.toMatchObject({
        code: "network",
      });
      const row = await api.researchWrite(operation);
      expect(writes[0]).toEqual(writes[1]);
      expect(row.status).toBe("queued");
      expect(row.missing_deliverables).toHaveLength(4);
      expect(
        await api.researchWrite({
          ...operation,
          key: randomUUID(),
          payload: { ...operation.payload, note: "Must not replace" },
        }),
      ).toEqual(row);
      await expect(
        api.researchWrite({
          ...operation,
          key: randomUUID(),
          payload: { package: "research", note: "" },
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      const cancel: ResearchOperation = {
        action: "cancel",
        job: id,
        id: row.id,
        key: randomUUID(),
        payload: { version: row.version },
      };
      const cancelled = await api.researchWrite(cancel);
      expect(cancelled.status).toBe("cancelled");
      expect(await api.researchWrite(cancel)).toEqual(cancelled);
      await expect(
        api.researchWrite({ ...cancel, key: randomUUID() }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(await api.researchRequests(id)).toHaveLength(1);
      expect((await api.list()).find((r) => r.id === id)!.body.stage).toBe(
        "Prospect",
      );
    } finally {
      const job = (await api.list()).find((r) => r.id === id);
      if (job)
        expect(
          (
            await fixture(
              `/api/records/${encodeURIComponent(id)}?version=${job.version}`,
              { method: "DELETE", headers },
            )
          ).ok,
        ).toBe(true);
    }
  },
  30000,
);
