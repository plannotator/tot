// The injectable HTTP layer. Everything that touches the network goes through an
// `HttpClient`, so commands can be tested by passing a stub — no live server.

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export type HttpBody = string | Uint8Array | ArrayBuffer;

export interface HttpResponse {
	status: number;
	/** Parsed JSON body, or null when the body was empty / not JSON. */
	json: any;
	/** Raw response text (kept for error messages and non-JSON bodies). */
	text: string;
}

export interface HttpClient {
	fetch(
		method: HttpMethod,
		path: string,
		body?: HttpBody | undefined,
		headers?: Record<string, string>,
	): Promise<HttpResponse>;
}

/** Just the bits of `Config` the HTTP layer needs (keeps this module decoupled). */
export interface HttpConfig {
	endpoint: string;
	key: string | null;
}

const USER_AGENT = "tot-cli";

/**
 * Wraps the global `fetch` into an `HttpClient`. Adds the bearer key (when set)
 * and a User-Agent, joins the path onto the configured endpoint, and normalizes
 * every response into `{status, json, text}` so callers never re-parse.
 */
export function createHttpClient(cfg: HttpConfig, fetchImpl: typeof fetch = fetch): HttpClient {
	const base = cfg.endpoint.replace(/\/+$/, "");
	return {
		async fetch(method, path, body, headers) {
			const finalHeaders: Record<string, string> = {
				"user-agent": USER_AGENT,
				...headers,
			};
			if (cfg.key) {
				finalHeaders["authorization"] = "Bearer " + cfg.key;
			}
			let res: Response;
			try {
				res = await fetchImpl(base + path, {
					method,
					headers: finalHeaders,
					body,
				});
			} catch (cause) {
				// A DNS/offline/timeout error from fetch is an opaque `TypeError: fetch
				// failed`. Rethrow with the endpoint so the user can tell a connectivity
				// problem (or a wrong --endpoint) from a server error.
				const reason = cause instanceof Error ? cause.message : String(cause);
				throw new Error(
					`cannot reach ${base} (${reason}) — check your connection or --endpoint`,
					{ cause },
				);
			}
			const text = await res.text();
			let json: any = null;
			if (text.length > 0) {
				try {
					json = JSON.parse(text);
				} catch {
					json = null;
				}
			}
			return { status: res.status, json, text };
		},
	};
}

/** Pulls the clearest error message out of a non-2xx response. */
export function errorMessage(res: HttpResponse): string {
	if (res.json && typeof res.json === "object") {
		// The API's error envelope is `{error: {code, message}}` or `{message}`.
		const e = res.json.error ?? res.json;
		if (e && typeof e === "object") {
			if (typeof e.message === "string") return e.message;
			if (typeof e.code === "string") return e.code;
		}
		if (typeof e === "string") return e;
	}
	if (res.text) return res.text.slice(0, 500);
	return `HTTP ${res.status}`;
}

// ---- typed API wrappers (each maps to one /v1 endpoint) ----

export interface DocumentEntity {
	id: string;
	workspace_id: string;
	share_url: string;
	doc_path: string;
	kind: "markdown" | "html";
	title: string | null;
	version: string | null;
	body: string;
	created_at: string;
	updated_at: string;
	file_url: string | null;
}

export interface WorkspaceEntity {
	id: string;
	slug: string;
	share_url: string;
	visibility: string;
}

export interface CreateDocumentResult {
	document: DocumentEntity;
	workspace: WorkspaceEntity;
}

export type DocumentKind = "markdown" | "html";

/** POST /v1/documents — create a new anonymous (open) document. */
export async function postDocument(
	http: HttpClient,
	kind: DocumentKind,
	body: string,
): Promise<CreateDocumentResult> {
	const res = await http.fetch("POST", "/v1/documents", JSON.stringify({ kind, body }), {
		"content-type": "application/json",
	});
	if (res.status !== 201 && res.status !== 200) {
		throw new Error(errorMessage(res));
	}
	if (!res.json || !res.json.document || !res.json.workspace) {
		throw new Error("unexpected create response: missing document/workspace");
	}
	return res.json as CreateDocumentResult;
}

/** POST /v1/workspaces — create an empty workspace shell. */
export async function postWorkspace(http: HttpClient): Promise<WorkspaceEntity> {
	const res = await http.fetch("POST", "/v1/workspaces", JSON.stringify({}), {
		"content-type": "application/json",
	});
	if (res.status !== 201 && res.status !== 200) {
		throw new Error(errorMessage(res));
	}
	if (!res.json || !res.json.workspace) {
		throw new Error("unexpected create workspace response: missing workspace");
	}
	return res.json.workspace as WorkspaceEntity;
}

/** PUT /v1/workspaces/{wsId}/assets/{assetPath} — upload/replace raw support bytes. */
export async function putAsset(
	http: HttpClient,
	wsId: string,
	assetPath: string,
	body: Uint8Array,
	contentType: string,
): Promise<void> {
	const res = await http.fetch(
		"PUT",
		`/v1/workspaces/${encodeURIComponent(wsId)}/assets/${encodeAssetPath(assetPath)}`,
		body,
		{ "content-type": contentType },
	);
	if (res.status !== 200) {
		throw new Error(errorMessage(res));
	}
}

/** POST /v1/workspaces/{wsId}/documents — add a document after support files exist. */
export async function postWorkspaceDocument(
	http: HttpClient,
	wsId: string,
	docPath: string,
	kind: DocumentKind,
	body: string,
): Promise<DocumentEntity> {
	const res = await http.fetch(
		"POST",
		`/v1/workspaces/${encodeURIComponent(wsId)}/documents`,
		JSON.stringify({ doc_path: docPath, kind, body }),
		{ "content-type": "application/json" },
	);
	if (res.status !== 201 && res.status !== 200) {
		throw new Error(errorMessage(res));
	}
	if (!res.json || !res.json.id) {
		throw new Error("unexpected add document response: missing document");
	}
	return res.json as DocumentEntity;
}

/** GET /v1/workspaces/{wsId}/documents/{docId} — read current document (JSON). */
export async function getDocument(
	http: HttpClient,
	wsId: string,
	docId: string,
): Promise<DocumentEntity> {
	const res = await http.fetch(
		"GET",
		`/v1/workspaces/${encodeURIComponent(wsId)}/documents/${encodeURIComponent(docId)}`,
		undefined,
		{ accept: "application/json" },
	);
	if (res.status !== 200) {
		throw new Error(errorMessage(res));
	}
	return res.json as DocumentEntity;
}

/** PUT /v1/workspaces/{wsId}/documents/{docId} — replace the raw body. */
export async function putDocument(
	http: HttpClient,
	wsId: string,
	docId: string,
	body: string,
	contentType: string,
): Promise<DocumentEntity> {
	const res = await http.fetch(
		"PUT",
		`/v1/workspaces/${encodeURIComponent(wsId)}/documents/${encodeURIComponent(docId)}`,
		body,
		{ "content-type": contentType },
	);
	if (res.status !== 200) {
		throw new Error(errorMessage(res));
	}
	return res.json as DocumentEntity;
}

/** DELETE /v1/workspaces/{wsId}/documents/{docId} — hard delete (204). */
export async function deleteDocument(http: HttpClient, wsId: string, docId: string): Promise<void> {
	const res = await http.fetch(
		"DELETE",
		`/v1/workspaces/${encodeURIComponent(wsId)}/documents/${encodeURIComponent(docId)}`,
	);
	// 204 = deleted; 404 = already gone — treat both as success for idempotency.
	if (res.status !== 204 && res.status !== 404) {
		throw new Error(errorMessage(res));
	}
}

export interface MeEntity {
	user_id: string;
	email: string | null;
	active_org_id: string | null;
}

/** GET /v1/me — verify a stored key and return the identity behind it. */
export async function getMe(http: HttpClient): Promise<MeEntity> {
	const res = await http.fetch("GET", "/v1/me", undefined, { accept: "application/json" });
	if (res.status !== 200) {
		throw new Error(errorMessage(res));
	}
	return res.json as MeEntity;
}

function encodeAssetPath(assetPath: string): string {
	return assetPath.split("/").map(encodeURIComponent).join("/");
}
