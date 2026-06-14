import fs from "node:fs";
import path from "node:path";
import type { Config, RegistryEntry } from "./config.js";
import {
	deleteDocument,
	getDocument,
	getMe,
	type HttpClient,
	postDocument,
	putDocument,
} from "./http.js";

/** Injected side-effects, so commands stay testable (no real clock, no console). */
export interface CommandDeps {
	http: HttpClient;
	/** Resolves after `ms` — overridable in tests to make polling instant. */
	sleep: (ms: number) => Promise<void>;
	/** Monotonic clock in ms — overridable in tests to drive the timeout. */
	now: () => number;
	log: (msg: string) => void;
}

export const POLL_INTERVAL_MS = 500;
export const POLL_TIMEOUT_MS = 30_000;

export interface PublishOpts {
	/** Override the detected kind (rarely needed; extension wins by default). */
	kind?: "markdown" | "html";
}

function detectKind(file: string): "markdown" | "html" {
	const ext = path.extname(file).toLowerCase();
	if (ext === ".html" || ext === ".htm") return "html";
	return "markdown";
}

function contentTypeFor(kind: "markdown" | "html"): string {
	return kind === "html" ? "text/html" : "text/markdown";
}

/**
 * Build the living URL. `index.md`/`index.html` resolve to the bare workspace
 * (mirrors `/s/{slug}`); anything else appends the doc path.
 */
export function livingUrl(contentOrigin: string, slug: string, docPath: string): string {
	const base = contentOrigin.replace(/\/+$/, "");
	if (docPath === "index.md" || docPath === "index.html") {
		return `${base}/${slug}`;
	}
	return `${base}/${slug}/${docPath}`;
}

/** Build the immutable, commit-pinned URL for one exact file version. */
export function frozenUrl(
	contentOrigin: string,
	slug: string,
	docPath: string,
	version: string,
): string {
	const base = contentOrigin.replace(/\/+$/, "");
	return `${base}/${slug}/${docPath}@${version}`;
}

function shortCommit(version: string): string {
	return version.slice(0, 7);
}

/**
 * `tot <file>` — publish a new page.
 * POST /v1/documents → poll GET until `version` is non-null → print living URL.
 */
export async function publishCommand(
	file: string,
	cfg: Config,
	deps: CommandDeps,
	opts: PublishOpts = {},
): Promise<void> {
	// Catches the no-network-on-missing-file contract: this throws before any
	// HTTP call, so a typo never hits the server.
	if (!fs.existsSync(file)) {
		throw new Error(`file not found: ${file}`);
	}
	const body = fs.readFileSync(file, "utf8");
	const kind = opts.kind ?? detectKind(file);

	const created = await postDocument(deps.http, kind, body);
	const wsId = created.workspace.id;
	const docId = created.document.id;
	const slug = created.workspace.slug;
	let docPath = created.document.doc_path;

	// Poll until the first save lands (version flips from null). Bounded by a
	// 30s timeout so a stuck publish fails loudly instead of hanging forever.
	const start = deps.now();
	let version: string | null = created.document.version;
	// Sequential by design: each poll waits for the previous to settle (the loop
	// IS the wait), so the await-in-loop warning doesn't apply here.
	// oxlint-disable no-await-in-loop
	let fileUrl: string | null = created.document.file_url ?? null;
	while (version === null) {
		if (deps.now() - start > POLL_TIMEOUT_MS) {
			throw new Error("document failed to publish; version is still null after 30s");
		}
		await deps.sleep(POLL_INTERVAL_MS);
		const doc = await getDocument(deps.http, wsId, docId);
		version = doc.version;
		docPath = doc.doc_path;
		fileUrl = doc.file_url ?? fileUrl;
	}
	// oxlint-enable no-await-in-loop

	const url = livingUrl(cfg.contentOrigin, slug, docPath);
	const snapshotUrl = fileUrl ?? frozenUrl(cfg.contentOrigin, slug, docPath, version);
	const entry: RegistryEntry = {
		wsId,
		docId,
		slug,
		url,
		kind,
		docPath,
		bytes: Buffer.byteLength(body, "utf8"),
		createdAt: new Date().toISOString(),
	};
	cfg.addEntry(file, entry);
	cfg.save();

	deps.log("");
	deps.log(`  ↳ ${url}`);
	deps.log(`  commit  ${shortCommit(version)}`);
	deps.log(`  frozen  ${snapshotUrl}`);
	deps.log("");
}

/**
 * `tot update <file|url>` — push new content under the same living URL.
 * Resolves {wsId, docId} from the local registry, then PUTs the raw body.
 */
export async function updateCommand(target: string, cfg: Config, deps: CommandDeps): Promise<void> {
	const resolved = cfg.resolve(target);
	if (!resolved) {
		throw new Error(`not in your registry: ${target} (publish it first, or run 'tot list')`);
	}
	const { entry } = resolved;

	// Update always reads new content from a LOCAL file. When the target is a
	// slug/url we use the file path recorded at publish time. The registry may
	// not hold a usable local path (the entry was keyed by slug, or the file was
	// moved/renamed/deleted since publish). In that case, emit a message that
	// names a local file as the requirement — NOT a misleading
	// "file not found: https://…" / "file not found: <slug>" that implies the
	// URL or slug itself is a path.
	const file = resolved.file;
	if (file === null || !fs.existsSync(file)) {
		const where = file !== null && file !== target ? ` (recorded source '${file}')` : "";
		throw new Error(
			`tot update needs a local file: '${target}' resolves to a published page but its source` +
				`${where} is missing — pass the path to the current content`,
		);
	}
	const body = fs.readFileSync(file, "utf8");

	const doc = await putDocument(
		deps.http,
		entry.wsId,
		entry.docId,
		body,
		contentTypeFor(entry.kind),
	);

	entry.bytes = Buffer.byteLength(body, "utf8");
	cfg.save();

	deps.log("");
	deps.log(`  updated  ${entry.url}`);
	if (doc.version) {
		deps.log(`  commit   ${shortCommit(doc.version)}`);
		deps.log(
			`  frozen   ${doc.file_url ?? frozenUrl(cfg.contentOrigin, entry.slug, entry.docPath, doc.version)}`,
		);
	} else {
		deps.log("  commit   (pending — first save still landing)");
	}
	deps.log("");
}

/**
 * `tot remove <file|url|slug>` — hard-delete the page and prune the registry.
 */
export async function removeCommand(target: string, cfg: Config, deps: CommandDeps): Promise<void> {
	const resolved = cfg.resolve(target);
	if (!resolved) {
		throw new Error(`not in your registry: ${target} (run 'tot list')`);
	}
	const { entry } = resolved;

	await deleteDocument(deps.http, entry.wsId, entry.docId);
	cfg.removeEntry(entry.wsId, entry.docId);
	cfg.save();

	deps.log(`removed  ${entry.url}`);
}

/** `tot list` — purely local; print the pages published from this machine. */
export function listCommand(cfg: Config, deps: CommandDeps): void {
	const entries = Object.entries(cfg.registry);
	if (entries.length === 0) {
		deps.log("no pages — publish one with:  tot <file>");
		return;
	}
	deps.log("");
	for (const [file, entry] of entries) {
		deps.log(`  ${entry.url}`);
		deps.log(
			`    file=${file}  slug=${entry.slug}  ${entry.bytes}b  ${entry.kind}  ${entry.createdAt.slice(0, 19)}`,
		);
		deps.log("");
	}
}

/** `tot login --key <KEY>` — store a pre-minted key and verify it via /v1/me. */
export async function loginCommand(key: string, cfg: Config, deps: CommandDeps): Promise<void> {
	cfg.key = key;
	// Verify the key works before persisting it (a typo'd key gets a 401 here).
	const me = await getMe(deps.http);
	cfg.save();
	deps.log(`logged in as ${me.email ?? me.user_id}`);
}
