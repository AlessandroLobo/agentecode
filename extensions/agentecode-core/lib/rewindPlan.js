/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const fs = require('fs');
const path = require('path');
const { fileHistoryDir } = require('./sessionStore');

/** @param {string} file */
async function readIfExists(file) {
	try {
		return await fs.promises.readFile(file);
	} catch (error) {
		if (error.code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}
}

/**
 * Compara o plano com o disco e devolve so o que realmente mudaria.
 * @param {{ file: string, backupFileName: string | null }[]} plan
 * @param {string} sessionId
 * @returns {Promise<{ changes: { file: string, action: 'restore' | 'recreate' | 'delete', backup?: string }[], missingBackups: number }>}
 */
async function diffPlanAgainstDisk(plan, sessionId) {
	const historyDir = fileHistoryDir(sessionId);
	const changes = [];
	let missingBackups = 0;
	for (const item of plan) {
		const current = await readIfExists(item.file);
		if (item.backupFileName === null) {
			if (current !== undefined) {
				changes.push({ file: item.file, action: 'delete' });
			}
			continue;
		}
		const backup = path.join(historyDir, item.backupFileName);
		const target = await readIfExists(backup);
		if (target === undefined) {
			missingBackups++;
			continue;
		}
		if (current === undefined) {
			changes.push({ file: item.file, action: 'recreate', backup });
		} else if (!current.equals(target)) {
			changes.push({ file: item.file, action: 'restore', backup });
		}
	}
	return { changes, missingBackups };
}

/**
 * Aplica uma mudanca do plano (restaurar/recriar a partir da copia, ou excluir arquivo que nao existia).
 * @param {{ file: string, action: string, backup?: string }} change
 */
async function applyChange(change) {
	if (change.action === 'delete') {
		await fs.promises.rm(change.file, { force: true });
		return;
	}
	await fs.promises.mkdir(path.dirname(change.file), { recursive: true });
	await fs.promises.copyFile(/** @type {string} */ (change.backup), change.file);
}

module.exports = { readIfExists, diffPlanAgainstDisk, applyChange };
