// Verify the CLI package keeps the API/content domain split honest.
//
// The CLI talks to the live tot publish backend at api.tot.page. The links it
// prints stay on the cookieless raw content origin. `workspaces.plannotator.ai`
// has no DNS and no server — a package that defaults to it fails on every
// command, so it must never appear on the package surface.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const EXPECTED_API_ENDPOINT = "https://api.tot.page";
const EXPECTED_CONTENT_ORIGIN = "https://tot.page";
const DEAD_API_ENDPOINT = "https://workspaces.plannotator.ai";

const exactChecks = [
	{
		file: "src/config.ts",
		text: `DEFAULT_ENDPOINT = "${EXPECTED_API_ENDPOINT}"`,
	},
	{
		file: "src/config.ts",
		text: `DEFAULT_CONTENT_ORIGIN = "${EXPECTED_CONTENT_ORIGIN}"`,
	},
	{
		file: "dist/config.js",
		text: `DEFAULT_ENDPOINT = "${EXPECTED_API_ENDPOINT}"`,
	},
	{
		file: "dist/config.js",
		text: `DEFAULT_CONTENT_ORIGIN = "${EXPECTED_CONTENT_ORIGIN}"`,
	},
	{
		file: "dist/cli.js",
		text: `default ${EXPECTED_API_ENDPOINT}`,
	},
];

const packageSurfaceFiles = [
	"README.md",
	"package.json",
	"src/cli.ts",
	"src/config.ts",
	"dist/cli.js",
	"dist/config.js",
	"dist/config.d.ts",
];

function fail(message) {
	throw new Error(`domain-contract verification failed: ${message}`);
}

function read(file) {
	return readFileSync(join(process.cwd(), file), "utf8");
}

for (const check of exactChecks) {
	if (!read(check.file).includes(check.text)) {
		fail(`${check.file} does not contain ${check.text}`);
	}
}

for (const file of packageSurfaceFiles) {
	const text = read(file);
	if (text.includes(DEAD_API_ENDPOINT)) {
		fail(
			`${file} advertises ${DEAD_API_ENDPOINT}; that hostname has no DNS/server and breaks every CLI command`,
		);
	}
	if (text.includes("usercontent.plannotator.ai")) {
		fail(`${file} contains the old usercontent placeholder; content links belong on tot.page`);
	}
}

console.log(
	`domain contract verified: CLI API ${EXPECTED_API_ENDPOINT}; content ${EXPECTED_CONTENT_ORIGIN}`,
);
