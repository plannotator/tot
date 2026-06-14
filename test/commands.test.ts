import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	listCommand,
	livingUrl,
	publishCommand,
	removeCommand,
	updateCommand,
	type CommandDeps,
} from "../src/commands.js";
import { Config, type RegistryEntry } from "../src/config.js";
import type { HttpResponse } from "../src/http.js";
import { emptyResponse, jsonResponse, type RecordedCall, stubHttp } from "./stub.js";

let tmpDir: string;
let logs: string[];

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tot-cmd-"));
	process.env.TOT_CONFIG = path.join(tmpDir, ".tot");
	logs = [];
});

afterEach(() => {
	delete process.env.TOT_CONFIG;
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Deps with an injected fake clock so the poll timeout is deterministic. */
function makeDeps(http: ReturnType<typeof stubHttp>, clock = { t: 0 }): CommandDeps {
	return {
		http,
		// Advancing the clock on each sleep makes the timeout reachable instantly.
		sleep: async (ms) => {
			clock.t += ms;
		},
		now: () => clock.t,
		log: (msg) => logs.push(msg),
	};
}

function writeFile(name: string, content: string): string {
	const p = path.join(tmpDir, name);
	fs.writeFileSync(p, content);
	return p;
}

const createOk = (over: Record<string, any> = {}) =>
	jsonResponse(201, {
		document: {
			id: "doc_1",
			workspace_id: "ws_1",
			doc_path: "index.md",
			version: null,
			...over,
		},
		workspace: { id: "ws_1", slug: "k7q9zyxwvu98abcd", visibility: "open" },
	});

describe("publish", () => {
	// Catches: the poll loop never terminating (or terminating early). Two GETs
	// return version:null, the third returns a hash — the loop must stop there
	// and the printed URL must be the living tot.page URL.
	it("polls GET until version is non-null, then prints the living URL", async () => {
		const file = writeFile("notes.md", "# Hello");
		let gets = 0;
		const versions: (string | null)[] = [null, null, "abc123"];
		const http = stubHttp((call): HttpResponse => {
			if (call.method === "POST") return createOk();
			if (call.method === "GET") {
				const v = gets < versions.length ? versions[gets] : "abc123";
				gets++;
				return jsonResponse(200, { id: "doc_1", doc_path: "index.md", version: v });
			}
			throw new Error("unexpected " + call.method);
		});
		const cfg = Config.load();
		await publishCommand(file, cfg, makeDeps(http));

		expect(gets).toBe(3); // polled exactly until the hash appeared
		expect(logs.join("\n")).toContain("https://tot.page/k7q9zyxwvu98abcd");
		expect(logs.join("\n")).toContain("commit  abc123");
		expect(logs.join("\n")).toContain(
			"frozen  https://tot.page/k7q9zyxwvu98abcd/index.md@abc123",
		);
		// And the registry recorded the page.
		expect(cfg.getEntryByFile(file)?.slug).toBe("k7q9zyxwvu98abcd");
	});

	// Catches: HTML being POSTed with the wrong kind or wrapped/rendered by the
	// CLI. The body must be the raw HTML and kind must be "html".
	it("publishes an HTML file as kind=html with the raw body", async () => {
		const file = writeFile("page.html", "<h1>Hi</h1>");
		let postBody = "";
		const http = stubHttp((call): HttpResponse => {
			if (call.method === "POST") {
				postBody = String(call.body);
				return jsonResponse(201, {
					document: {
						id: "doc_1",
						workspace_id: "ws_1",
						doc_path: "page.html",
						version: "v1",
					},
					workspace: { id: "ws_1", slug: "slugH", visibility: "open" },
				});
			}
			return jsonResponse(200, { id: "doc_1", doc_path: "page.html", version: "v1" });
		});
		await publishCommand(file, Config.load(), makeDeps(http));
		const parsed = JSON.parse(postBody);
		expect(parsed.kind).toBe("html");
		expect(parsed.body).toBe("<h1>Hi</h1>");
		// page.html is not an index — the URL keeps the filename.
		expect(logs.join("\n")).toContain("https://tot.page/slugH/page.html");
		expect(logs.join("\n")).toContain("commit  v1");
		expect(logs.join("\n")).toContain("frozen  https://tot.page/slugH/page.html@v1");
	});

	// Catches: an empty file breaking the POST or poll. Zero bytes is valid.
	it("publishes an empty (zero-byte) file successfully", async () => {
		const file = writeFile("empty.md", "");
		const http = stubHttp(
			(call): HttpResponse =>
				call.method === "POST"
					? createOk({ version: "v0" })
					: jsonResponse(200, { id: "doc_1", doc_path: "index.md", version: "v0" }),
		);
		const cfg = Config.load();
		await publishCommand(file, cfg, makeDeps(http));
		expect(cfg.getEntryByFile(file)?.bytes).toBe(0);
	});

	// Catches: a 422 size error being swallowed instead of surfaced. A 1.6MB
	// file gets MAX_DOCUMENT_BYTES from the server; the user must see it.
	it("surfaces a 422 MAX_DOCUMENT_BYTES message from the server", async () => {
		const file = writeFile("big.md", "x".repeat(1_600_000));
		const http = stubHttp(
			(): HttpResponse =>
				jsonResponse(422, {
					error: {
						code: "MAX_DOCUMENT_BYTES",
						message: "body exceeds MAX_DOCUMENT_BYTES",
					},
				}),
		);
		await expect(publishCommand(file, Config.load(), makeDeps(http))).rejects.toThrow(
			/MAX_DOCUMENT_BYTES/,
		);
	});

	// Catches: a missing file silently hitting the network. The check must be
	// synchronous — zero HTTP calls when the file does not exist.
	it("errors before any HTTP call when the file is missing", async () => {
		const http = stubHttp((): HttpResponse => {
			throw new Error("should not be called");
		});
		await expect(
			publishCommand(path.join(tmpDir, "nope.md"), Config.load(), makeDeps(http)),
		).rejects.toThrow(/file not found/);
		expect(http.calls).toHaveLength(0);
	});

	// Catches: the poll loop ignoring its timeout and hanging forever when the
	// version never lands. The fake clock advances past 30s → it must throw.
	it("times out when version never materializes", async () => {
		const file = writeFile("stuck.md", "# never saves");
		const http = stubHttp(
			(call): HttpResponse =>
				call.method === "POST"
					? createOk()
					: jsonResponse(200, { id: "doc_1", doc_path: "index.md", version: null }),
		);
		await expect(publishCommand(file, Config.load(), makeDeps(http))).rejects.toThrow(
			/still null after 30s/,
		);
	});
});

describe("update", () => {
	// Catches: update not resolving the file → {wsId, docId} from the registry,
	// or PUTting with the wrong content-type. Must be text/markdown for md docs.
	it("resolves the file from the registry and PUTs with text/markdown", async () => {
		const file = writeFile("notes.md", "# v2 content");
		const cfg = Config.load();
		const e: RegistryEntry = {
			wsId: "ws_9",
			docId: "doc_9",
			slug: "slug9",
			url: "https://tot.page/slug9",
			kind: "markdown",
			docPath: "index.md",
			bytes: 1,
			createdAt: "2026-06-07T18:24:00Z",
		};
		cfg.addEntry(file, e);

		let seen: RecordedCall | undefined;
		const http = stubHttp((call): HttpResponse => {
			seen = call;
			return jsonResponse(200, { id: "doc_9", version: "newhash" });
		});
		await updateCommand(file, cfg, makeDeps(http));

		expect(seen?.method).toBe("PUT");
		expect(seen?.path).toBe("/v1/workspaces/ws_9/documents/doc_9");
		expect(seen?.headers?.["content-type"]).toBe("text/markdown");
		expect(seen?.body).toBe("# v2 content");
		expect(logs.join("\n")).toContain("commit   newhash");
		expect(logs.join("\n")).toContain("frozen   https://tot.page/slug9/index.md@newhash");
	});

	// Catches: `tot update <url>` (the form SPEC §4 advertises) not reading from
	// the recorded local file. A user copies the living URL from `tot list` and
	// runs `tot update <url>`; the CLI must resolve the URL → entry, then re-read
	// the ORIGINAL file path it published from (not treat the URL as a file).
	it("update <url> resolves to the recorded file and PUTs its current contents", async () => {
		const file = writeFile("notes.md", "# v2 via url");
		const cfg = Config.load();
		const e: RegistryEntry = {
			wsId: "ws_u",
			docId: "doc_u",
			slug: "slugU",
			url: "https://tot.page/slugU",
			kind: "markdown",
			docPath: "index.md",
			bytes: 1,
			createdAt: "2026-06-07T18:24:00Z",
		};
		cfg.addEntry(file, e);

		let seen: RecordedCall | undefined;
		const http = stubHttp((call): HttpResponse => {
			seen = call;
			return jsonResponse(200, { id: "doc_u", version: "urlhash" });
		});
		// Pass the living URL, not the file path.
		await updateCommand("https://tot.page/slugU", cfg, makeDeps(http));

		expect(seen?.method).toBe("PUT");
		expect(seen?.path).toBe("/v1/workspaces/ws_u/documents/doc_u");
		expect(seen?.body).toBe("# v2 via url"); // read from the file, not the URL
	});

	// Catches: `update <url>` for an entry with NO recorded file path emitting a
	// misleading "file not found: https://…". It must instead say a local file is
	// required — and must not hit the network.
	it("update <url> with no recorded source file gives a clear error, no HTTP call", async () => {
		const cfg = Config.load();
		// An entry whose registry KEY is the slug itself (not a file path), so
		// resolve(slug) matches by slug only and resolve().file is null. This is
		// the "keyed only by slug" shape the SPEC-fidelity review flagged.
		cfg.registry["slugX"] = {
			wsId: "ws_x",
			docId: "doc_x",
			slug: "slugX",
			url: "https://tot.page/slugX",
			kind: "markdown",
			docPath: "index.md",
			bytes: 1,
			createdAt: "2026-06-07T18:24:00Z",
		};
		const http = stubHttp((): HttpResponse => {
			throw new Error("should not be called");
		});
		// Resolve via the full URL: getEntryByFile(url) is null (no such key), so
		// resolution falls to getEntryBySlug → {file: null}. Then update must emit
		// the clear "needs a local file" error, never "file not found: <url>".
		await expect(updateCommand("https://tot.page/slugX", cfg, makeDeps(http))).rejects.toThrow(
			/needs a local file/,
		);
		expect(http.calls).toHaveLength(0);
	});

	// Catches: update silently succeeding on an unknown target (no registry
	// entry) — it must error, not POST a new doc.
	it("errors when the target is not in the registry", async () => {
		const http = stubHttp((): HttpResponse => {
			throw new Error("should not be called");
		});
		await expect(updateCommand("ghost.md", Config.load(), makeDeps(http))).rejects.toThrow(
			/not in your registry/,
		);
		expect(http.calls).toHaveLength(0);
	});
});

describe("remove", () => {
	// Catches: DELETE not being issued, or the registry entry surviving the
	// delete. After remove, the file key must be gone from ~/.tot.
	it("issues DELETE and prunes the registry entry", async () => {
		const cfg = Config.load();
		cfg.addEntry("notes.md", {
			wsId: "ws_5",
			docId: "doc_5",
			slug: "slug5",
			url: "https://tot.page/slug5",
			kind: "markdown",
			docPath: "index.md",
			bytes: 1,
			createdAt: "2026-06-07T18:24:00Z",
		});
		let seen: RecordedCall | undefined;
		const http = stubHttp((call): HttpResponse => {
			seen = call;
			return emptyResponse(204);
		});
		await removeCommand("notes.md", cfg, makeDeps(http));

		expect(seen?.method).toBe("DELETE");
		expect(seen?.path).toBe("/v1/workspaces/ws_5/documents/doc_5");
		expect(cfg.getEntryByFile("notes.md")).toBeNull();
	});
});

describe("list", () => {
	// Catches: list hitting the network (it must be purely local) or omitting
	// entries from the output.
	it("prints every registry entry without any HTTP call", () => {
		const cfg = Config.load();
		cfg.addEntry("a.md", {
			wsId: "ws_a",
			docId: "doc_a",
			slug: "slugA",
			url: "https://tot.page/slugA",
			kind: "markdown",
			docPath: "index.md",
			bytes: 10,
			createdAt: "2026-06-07T18:24:00Z",
		});
		cfg.addEntry("b.html", {
			wsId: "ws_b",
			docId: "doc_b",
			slug: "slugB",
			url: "https://tot.page/slugB/b.html",
			kind: "html",
			docPath: "b.html",
			bytes: 20,
			createdAt: "2026-06-08T09:00:00Z",
		});
		const http = stubHttp((): HttpResponse => {
			throw new Error("list must not hit the network");
		});
		listCommand(cfg, makeDeps(http));
		const out = logs.join("\n");
		expect(out).toContain("https://tot.page/slugA");
		expect(out).toContain("https://tot.page/slugB/b.html");
		expect(http.calls).toHaveLength(0);
	});
});

describe("livingUrl", () => {
	// Catches: an index doc keeping its filename in the URL. index.md/index.html
	// must resolve to the bare /{slug}; other paths keep the filename.
	it("omits index.md/index.html and keeps other paths", () => {
		expect(livingUrl("https://tot.page", "s1", "index.md")).toBe("https://tot.page/s1");
		expect(livingUrl("https://tot.page", "s1", "index.html")).toBe("https://tot.page/s1");
		expect(livingUrl("https://tot.page", "s1", "notes.md")).toBe(
			"https://tot.page/s1/notes.md",
		);
	});
});
