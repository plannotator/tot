import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	Config,
	DEFAULT_CONTENT_ORIGIN,
	DEFAULT_ENDPOINT,
	type RegistryEntry,
} from "../src/config.js";

let tmpDir: string;
let cfgFile: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tot-cfg-"));
	cfgFile = path.join(tmpDir, ".tot");
	process.env.TOT_CONFIG = cfgFile;
});

afterEach(() => {
	delete process.env.TOT_CONFIG;
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
	return {
		wsId: "ws_1",
		docId: "doc_1",
		slug: "slug1",
		url: "https://tot.page/slug1",
		kind: "markdown",
		docPath: "index.md",
		bytes: 7,
		createdAt: "2026-06-07T18:24:00Z",
		...over,
	};
}

describe("config", () => {
	// Catches: THE dead-default regression. The default API origin must be the
	// live tot publish backend. `https://workspaces.plannotator.ai` has no DNS
	// and no server — a release that defaults to it fails on every command.
	// Pin the literal so a default change is a deliberate, test-visible act.
	it("DEFAULT_ENDPOINT is the live tot publish backend (literal pin)", () => {
		expect(DEFAULT_ENDPOINT).toBe("https://api.tot.page");
		expect(DEFAULT_CONTENT_ORIGIN).toBe("https://tot.page");
	});

	// Catches: a missing ~/.tot crashing the CLI instead of using defaults.
	it("load with no file yields defaults (endpoint, content origin, null key, empty registry)", () => {
		const cfg = Config.load();
		expect(cfg.endpoint).toBe(DEFAULT_ENDPOINT);
		expect(cfg.contentOrigin).toBe(DEFAULT_CONTENT_ORIGIN);
		expect(cfg.key).toBeNull();
		expect(cfg.registry).toEqual({});
	});

	// Catches: a broken JSON round-trip, and that save sets owner-only perms
	// (the file may hold an API key — it must not be world-readable).
	it("save then reload persists entries; file is mode 0600", () => {
		const cfg = Config.load();
		cfg.addEntry("notes.md", entry());
		cfg.key = "wsk_live_secret";
		cfg.save();

		const mode = fs.statSync(cfgFile).mode & 0o777;
		expect(mode).toBe(0o600);

		const reloaded = Config.load();
		expect(reloaded.key).toBe("wsk_live_secret");
		expect(reloaded.getEntryByFile("notes.md")?.slug).toBe("slug1");
	});

	// Catches: registry lookup failing by slug or by full living URL — both are
	// how `update`/`remove <target>` resolve when given a URL instead of a file.
	it("resolves an entry by file path, by slug, and by full url", () => {
		const cfg = Config.load();
		cfg.addEntry("notes.md", entry());

		expect(cfg.getEntryByFile("notes.md")?.docId).toBe("doc_1");
		expect(cfg.getEntryBySlug("slug1")?.docId).toBe("doc_1");
		expect(cfg.getEntryBySlug("https://tot.page/slug1")?.docId).toBe("doc_1");
		expect(cfg.resolve("notes.md")?.file).toBe("notes.md");
		expect(cfg.resolve("slug1")?.entry.docId).toBe("doc_1");
	});

	// Catches: removeEntry leaving an orphaned key, or not pruning every key
	// that points at the same (wsId, docId).
	it("removeEntry deletes every key pointing at the doc", () => {
		const cfg = Config.load();
		cfg.addEntry("notes.md", entry());
		cfg.addEntry("./notes.md", entry()); // same doc, second key
		cfg.removeEntry("ws_1", "doc_1");
		expect(Object.keys(cfg.registry)).toHaveLength(0);
	});

	// Catches: THE registry-wipe bug. A corrupt/half-written ~/.tot must NOT be
	// silently swallowed and then overwritten on the next save — that would
	// permanently destroy the only record of every anonymous page (no server-side
	// listing exists). load() must preserve the corrupt bytes by renaming them
	// aside before any save() can clobber them.
	it("preserves a corrupt ~/.tot (renames aside) instead of silently wiping it on save", () => {
		// A real entry, then truncated mid-write → invalid JSON.
		const broken = JSON.stringify({ registry: { "notes.md": entry() } }).slice(0, 40);
		expect(() => JSON.parse(broken)).toThrow(); // sanity: it IS corrupt
		fs.writeFileSync(cfgFile, broken);

		// load() must not crash and must start from an empty registry...
		const cfg = Config.load();
		expect(cfg.registry).toEqual({});

		// ...but the corrupt bytes must be preserved aside (recoverable), and the
		// live ~/.tot must no longer hold the corrupt content.
		const sidecars = fs.readdirSync(tmpDir).filter((f) => f.includes(".corrupt."));
		expect(sidecars).toHaveLength(1);
		expect(fs.readFileSync(path.join(tmpDir, sidecars[0]), "utf8")).toBe(broken);

		// And the very next save() (which every publish/update/remove performs)
		// must NOT have run over the corrupt file before it was preserved.
		cfg.addEntry("new.md", entry());
		cfg.save();
		const reloaded = Config.load();
		expect(reloaded.getEntryByFile("new.md")).not.toBeNull();
		// The preserved sidecar still carries the user's prior bytes for recovery.
		expect(fs.readFileSync(path.join(tmpDir, sidecars[0]), "utf8")).toBe(broken);
	});

	// Catches: a non-atomic save half-truncating the registry. save() writes to a
	// temp file then renames; no leftover temp files should remain after a save.
	it("save is atomic (writes via temp+rename, leaves no temp files)", () => {
		const cfg = Config.load();
		cfg.addEntry("notes.md", entry());
		cfg.save();
		const leftovers = fs.readdirSync(tmpDir).filter((f) => f.includes(".tmp."));
		expect(leftovers).toHaveLength(0);
		// And the result is the fully-written file (mode 0600, parseable).
		expect(fs.statSync(cfgFile).mode & 0o777).toBe(0o600);
		expect(Config.load().getEntryByFile("notes.md")?.slug).toBe("slug1");
	});
});
