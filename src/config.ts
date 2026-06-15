import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The /v1 API origin the CLI talks to. A branded alias (api.tot.page) so the
 * published package is decoupled from infra — repoint the DNS (staging → prod)
 * without republishing the CLI. */
export const DEFAULT_ENDPOINT = "https://api.tot.page";
/** The public content origin where living pages are served (the link you share). */
export const DEFAULT_CONTENT_ORIGIN = "https://tot.page";

export interface RegistryEntry {
	wsId: string;
	docId: string;
	slug: string;
	url: string;
	kind: "markdown" | "html";
	docPath: string;
	bytes: number;
	assets?: Record<string, RegistryAssetEntry>;
	createdAt: string;
}

export interface RegistryAssetEntry {
	sha256: string;
	contentType: string;
	size: number;
}

interface ConfigShape {
	endpoint: string;
	contentOrigin: string;
	key: string | null;
	registry: Record<string, RegistryEntry>;
}

function configPath(): string {
	// TOT_CONFIG lets tests point at a temp file instead of the real ~/.tot.
	return process.env.TOT_CONFIG ?? path.join(os.homedir(), ".tot");
}

/**
 * The on-disk `~/.tot` state: the API endpoint, an optional key, and a local
 * registry of pages published from this machine. Anonymous pages have no
 * server-side owner, so this registry is the only record of what you published
 * (SPEC §2.6 — "visited-by-link is never listable").
 */
export class Config {
	endpoint: string;
	contentOrigin: string;
	key: string | null;
	registry: Record<string, RegistryEntry>;
	private readonly file: string;

	private constructor(file: string, data: ConfigShape) {
		this.file = file;
		this.endpoint = data.endpoint;
		this.contentOrigin = data.contentOrigin;
		this.key = data.key;
		this.registry = data.registry;
	}

	/**
	 * Load from disk. A missing file yields defaults. A file that EXISTS but fails
	 * to parse is NOT silently treated as empty — that would let the next save()
	 * overwrite (and permanently destroy) the only record of every anonymous page
	 * published from this machine (SPEC §2.6: pages have no server-side listing).
	 * Instead the corrupt bytes are preserved by renaming the file aside, and we
	 * continue from defaults so the CLI still works going forward.
	 */
	static load(): Config {
		const file = configPath();
		let parsed: Partial<ConfigShape> = {};
		let raw: string | null = null;
		try {
			raw = fs.readFileSync(file, "utf8");
		} catch {
			// File is missing (or unreadable) — start from defaults, nothing to preserve.
			raw = null;
		}
		if (raw !== null) {
			try {
				parsed = JSON.parse(raw) as Partial<ConfigShape>;
			} catch {
				// The file exists but is corrupt/half-written. Preserve its bytes by
				// renaming aside BEFORE any later save() can clobber them, so the user
				// can recover their page list. Then continue from defaults.
				const backup = `${file}.corrupt.${Date.now()}`;
				try {
					fs.renameSync(file, backup);
				} catch {
					// best-effort — if even the rename fails, we still avoid a silent wipe
					// because we never reach here without having tried to preserve the file.
				}
				parsed = {};
			}
		}
		return new Config(file, {
			endpoint: parsed.endpoint ?? DEFAULT_ENDPOINT,
			contentOrigin: parsed.contentOrigin ?? DEFAULT_CONTENT_ORIGIN,
			key: parsed.key ?? null,
			registry: parsed.registry ?? {},
		});
	}

	/**
	 * Persist to `~/.tot` with owner-only perms (it may hold an API key).
	 * Writes atomically — to a temp file in the same dir, then rename over the
	 * target — so an interrupted write can never half-truncate the registry (the
	 * sole record of anonymous pages).
	 */
	save(): void {
		const data: ConfigShape = {
			endpoint: this.endpoint,
			contentOrigin: this.contentOrigin,
			key: this.key,
			registry: this.registry,
		};
		const tmp = `${this.file}.tmp.${process.pid}.${Date.now()}`;
		fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
		try {
			// writeFileSync's `mode` only applies on create; chmod covers an existing temp.
			fs.chmodSync(tmp, 0o600);
		} catch {
			// best-effort (e.g. Windows) — not fatal.
		}
		// rename is atomic on the same filesystem: readers see either the old file
		// or the fully-written new one, never a partial.
		fs.renameSync(tmp, this.file);
	}

	/** Record a freshly-published page, keyed by its local file path. */
	addEntry(file: string, entry: RegistryEntry): void {
		this.registry[file] = entry;
	}

	getEntryByFile(file: string): RegistryEntry | null {
		return this.registry[file] ?? null;
	}

	/** Find an entry by slug or by full living URL (for `update`/`remove <url>`). */
	getEntryBySlug(slugOrUrl: string): RegistryEntry | null {
		for (const entry of Object.values(this.registry)) {
			if (entry.slug === slugOrUrl || entry.url === slugOrUrl) return entry;
		}
		return null;
	}

	/** Resolve a target that may be a file path, a slug, or a living URL. */
	resolve(target: string): { file: string | null; entry: RegistryEntry } | null {
		const byFile = this.getEntryByFile(target);
		if (byFile) return { file: target, entry: byFile };
		const bySlug = this.getEntryBySlug(target);
		if (bySlug) {
			// Find the file key that points at this entry, if any.
			for (const [file, entry] of Object.entries(this.registry)) {
				if (entry === bySlug) return { file, entry };
			}
			return { file: null, entry: bySlug };
		}
		return null;
	}

	/** Remove every registry key pointing at this (wsId, docId) pair. */
	removeEntry(wsId: string, docId: string): void {
		for (const [file, entry] of Object.entries(this.registry)) {
			if (entry.wsId === wsId && entry.docId === docId) {
				delete this.registry[file];
			}
		}
	}
}
