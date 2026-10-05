/** Opt-in QA against the existing loopback-only synthetic backend. No live auth. */
import { request } from "node:http";
import { randomUUID } from "node:crypto";
import { ApiRepository } from "../src/api";
import { prepareWrite } from "../src/domain";
import { parseTracking } from "../src/planning";

const localQA =
  process.env.JOB_INTEL_SYNTHETIC_CONTRACT_QA === "1" ? test : test.skip;
function loopback(path: string, init: RequestInit = {}) {
  return new Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: 8004,
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

localQA(
  "actual synthetic backend accepts mobile parsing, versioned writes and exact-key recovery",
  async () => {
    // This is an inert browser fixture, NOT a native bearer or production login.
    expect((await loopback("/qa/session")).status).toBe(303);
    let loseNextWriteResponse = false;
    const sentWrites: string[] = [];
    const transport = (async (url: URL | string, init: RequestInit = {}) => {
      const target = new URL(String(url));
      if (target.origin !== "https://synthetic-contract.invalid")
        throw new Error("QA origin only");
      expect(init.credentials).toBe("omit");
      const response = await loopback(target.pathname + target.search, init);
      if (init.method === "PUT") {
        sentWrites.push(String(init.body));
        if (loseNextWriteResponse && response.ok) {
          loseNextWriteResponse = false;
          throw new Error("Synthetic lost acknowledgement");
        }
      }
      return response;
    }) as typeof fetch;
    const api = new ApiRepository(
      "https://synthetic-contract.invalid",
      async () => ({
        Cookie: "session=inert-aging-owner-session",
        "X-CSRF-Token": "inert-aging-owner-csrf",
      }),
      transport,
    );
    expect(await api.identity()).toEqual({ actor: "owner" });
    const jobs = (await api.list()).filter((r) => r.kind === "job");
    expect(jobs).toHaveLength(16);
    expect(jobs.every((r) => r.id.startsWith("synthetic-"))).toBe(true);
    const workload = await api.workload();
    expect(workload.counts.open_applications).toBe(15);
    expect(workload.counts.interviewing_companies).toBe(3);
    expect(workload.counts.weekly_new).toBe(2);
    for (const job of jobs)
      expect(workload.jobs[job.id].record_version).toBe(job.version);
    expect(workload.jobs["synthetic-aging-1"].status).toBe("review_due");
    expect(workload.jobs["synthetic-aging-1"].waiting_days).toBe(14);
    expect(workload.jobs["synthetic-aging-4"].status).toBe(
      "interview_scheduled",
    );
    expect(workload.jobs["synthetic-aging-8"].status).toBe("dates_unknown");
    const original = jobs.find((r) => r.id === "synthetic-aging-15")!;
    const tracking = {
      ...parseTracking(original.body.tracking),
      next_action: {
        text: "Synthetic local QA task",
        owner: "owner",
        due_on: workload.local_date,
        source: "Synthetic cross-contract QA",
      },
    };
    const write = prepareWrite(original, { tracking }, randomUUID());
    let committed;
    try {
      loseNextWriteResponse = true;
      await expect(api.save(write)).rejects.toMatchObject({ code: "network" });
      committed = await api.save(write);
      expect(sentWrites.slice(-2)[0]).toBe(sentWrites.slice(-2)[1]);
      expect(committed.version).toBe(original.version + 1);
      expect(committed.body.stage).toBe(original.body.stage);
      expect(committed.body.title).toBe(original.body.title);
      expect(await api.save(write)).toEqual(committed);
      expect((await api.workload()).jobs[original.id]).toMatchObject({
        record_version: committed.version,
        status: "action_due",
        next_action: tracking.next_action,
      });
      await expect(
        api.save(prepareWrite(original, { tracking }, randomUUID())),
      ).rejects.toMatchObject({ code: "conflict" });
    } finally {
      // Restore only the synthetic role body with its latest revision.
      const latest = (await api.list()).find((r) => r.id === original.id)!;
      await api.save(prepareWrite(latest, original.body, randomUUID()));
    }
  },
  30000,
);
