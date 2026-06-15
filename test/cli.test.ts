import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isCliEntrypoint } from "../src/cli.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tot-cli-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("cli entrypoint detection", () => {
	it("treats npm bin symlinks as CLI invocation", () => {
		const realCli = path.join(tmpDir, "real-cli.js");
		const binShim = path.join(tmpDir, "tot");
		fs.writeFileSync(realCli, "#!/usr/bin/env node\n");
		fs.symlinkSync(realCli, binShim);

		expect(isCliEntrypoint(pathToFileURL(realCli).href, binShim)).toBe(true);
	});

	it("does not run when imported from another module", () => {
		const realCli = path.join(tmpDir, "real-cli.js");
		const importer = path.join(tmpDir, "test-runner.js");
		fs.writeFileSync(realCli, "");
		fs.writeFileSync(importer, "");

		expect(isCliEntrypoint(pathToFileURL(realCli).href, importer)).toBe(false);
	});
});
