import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require      = createRequire(import.meta.url);
const electronPath = require('electron');
const target       = process.argv[2];
const childEnv     = { ...process.env };

if (!target) {
	throw new Error('Electron test target is required');
}

delete childEnv.ELECTRON_RUN_AS_NODE;

const result = spawnSync(electronPath, [
	'--in-process-gpu',
	'--disable-gpu',
	'--disable-software-rasterizer',
	'--no-sandbox',
	path.resolve(target),
], {
	env    : childEnv,
	stdio  : 'inherit',
	windowsHide: true,
});

const tempRoot = path.resolve(os.tmpdir());

for (const entry of fs.readdirSync(tempRoot)) {
	if (!entry.startsWith('tms-app-launcher-row-drag-')
		&& !entry.startsWith('tms-app-launcher-ui-')
		&& !entry.startsWith('tms-al-icon-cache-')) {
		continue;
	}

	const candidate = path.resolve(tempRoot, entry);

	if (path.dirname(candidate) === tempRoot) {
		try {
			fs.rmSync(candidate, { recursive: true, force: true, maxRetries: 3 });
		} catch (error) {
			console.warn(`Could not remove test directory: ${candidate}`, error);
		}
	}
}

if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 1);
