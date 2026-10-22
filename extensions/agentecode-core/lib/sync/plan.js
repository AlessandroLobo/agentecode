/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const { sha256 } = require('./snapshot');
const config = require('./config');

/**
 * Cria o plano de sincronizacao comparando o estado local, remoto e a base (ultima sincronizacao).
 * Implementa a decisao de 3 vias da secao 6.3 do plano.
 *
 * @param {object} params
 * @param {object} params.localSnapshot Retorno de snapshot.createLocalSnapshot
 * @param {Record<string, string> | null} params.remoteFiles Arquivos do Gist (ou null se o Gist nao existir)
 * @param {any} [params.remoteManifest] Manifesto remoto agentecode-sync.json
 * @param {string} [params.remoteUpdatedAt] Timestamp ISO updated_at do Gist no GitHub
 * @param {object | null} [params.base] Ultimo estado de sincronizacao salvo localmente
 * @param {string} [params.base.localHash] Hash composto do local na ultima sincronizacao
 * @param {string} [params.base.manifestHash] Hash composto do remoto na ultima sincronizacao
 * @param {string} [params.base.remoteUpdatedAt] updated_at remoto na ultima sincronizacao
 * @param {Record<string, string>} [params.base.files] Mapa de file -> sha256 da base
 * @param {any} [params.gist] Objeto completo do Gist (para checagem de dono)
 * @param {string} [params.currentLogin] Login do usuario conectado
 * @param {boolean} [params.isConfirmedThirdParty] Se o usuario ja confirmou explicitamente o download de terceiro
 * @returns {object} Plano com decisao, diferencas de arquivos e extensoes
 */
function createSyncPlan({
	localSnapshot,
	remoteFiles,
	remoteManifest = null,
	remoteUpdatedAt = null,
	base = null,
	gist = null,
	currentLogin = null,
	isConfirmedThirdParty = false
}) {
	const localFiles = localSnapshot.files || {};
	const localHashes = localSnapshot.fileHashes || {};

	// Checagem de dono do Gist (E2)
	let isThirdParty = false;
	let warning = null;
	const remoteOwner = (gist && gist.owner && gist.owner.login) || (remoteManifest && remoteManifest.machine && remoteManifest.machine.owner);
	if (remoteOwner && currentLogin) {
		if (remoteOwner.trim().toLowerCase() !== currentLogin.trim().toLowerCase()) {
			isThirdParty = true;
			warning = 'Este Gist não é seu. Configurações de terceiros podem executar programas e instalar extensões.';
		}
	}

	// 1. Caso sem Gist remoto (primeiro envio absoluto)
	if (!remoteFiles) {
		const filesToUpload = Object.keys(localFiles).filter(f => f !== config.MANIFEST_FILE);
		return {
			action: 'initialUpload',
			hasChanges: filesToUpload.length > 0,
			localChanged: true,
			remoteChanged: false,
			filesToUpload,
			fileDiffs: [],
			extensionsDiff: { toInstall: [], alreadyInstalled: localSnapshot.extensions, localOnly: [] },
			summary: 'Primeiro envio de configurações para o GitHub.',
			isThirdParty: false,
			canAutoSync: true,
			warning: null
		};
	}

	// 2. Calcula diferencas detalhadas de arquivos (Local x Remoto)
	const allFileNames = new Set([
		...Object.keys(localFiles),
		...Object.keys(remoteFiles)
	]);
	allFileNames.delete(config.MANIFEST_FILE);
	allFileNames.delete(config.README_FILE);

	const fileDiffs = [];
	for (const fileName of Array.from(allFileNames).sort()) {
		const inLocal = Object.prototype.hasOwnProperty.call(localFiles, fileName);
		const inRemote = Object.prototype.hasOwnProperty.call(remoteFiles, fileName);

		const localContent = inLocal ? localFiles[fileName] : null;
		const remoteContent = inRemote ? remoteFiles[fileName] : null;

		const localSha = inLocal ? (localHashes[fileName] || sha256(localContent)) : null;
		const remoteSha = inRemote ? sha256(remoteContent) : null;

		let status;
		if (inLocal && inRemote) {
			status = localSha === remoteSha ? 'identical' : 'modified';
		} else if (inLocal) {
			status = 'localOnly';
		} else {
			status = 'remoteOnly';
		}

		fileDiffs.push({
			file: fileName,
			status,
			localContent,
			remoteContent,
			localSha,
			remoteSha
		});
	}

	// 3. Diferencas de extensoes
	const localExtensions = new Set(localSnapshot.extensions || []);
	let remoteExtensionsList = [];
	if (remoteFiles[config.EXTENSIONS_FILE]) {
		try {
			const parsed = JSON.parse(remoteFiles[config.EXTENSIONS_FILE]);
			if (Array.isArray(parsed.extensions)) {
				remoteExtensionsList = parsed.extensions.map(id => id.toLowerCase().trim()).filter(Boolean);
			}
		} catch {
			remoteExtensionsList = [];
		}
	}
	const remoteExtensions = new Set(remoteExtensionsList);

	const toInstall = remoteExtensionsList.filter(id => !localExtensions.has(id));
	const alreadyInstalled = remoteExtensionsList.filter(id => localExtensions.has(id));
	const localOnlyExt = (localSnapshot.extensions || []).filter(id => !remoteExtensions.has(id));

	const extensionsDiff = {
		toInstall,
		alreadyInstalled,
		localOnly: localOnlyExt
	};

	// 4. Caso sem base ou base invalida (E5.5: base sem localHash nem files deve ser tratada como sem base)
	const hasValidBase = Boolean(
		base &&
		typeof base === 'object' &&
		(
			(typeof base.localHash === 'string' && base.localHash.length > 0) ||
			(base.files && typeof base.files === 'object' && Object.keys(base.files).length > 0)
		)
	);

	if (!hasValidBase) {
		const hasRemoteItems = fileDiffs.some(d => d.status !== 'identical') || toInstall.length > 0;
		return {
			action: 'downloadFirst',
			hasChanges: hasRemoteItems,
			localChanged: false,
			remoteChanged: true,
			fileDiffs,
			extensionsDiff,
			filesToUpload: [],
			summary: 'Gist existente encontrado. Recomendado baixar primeiro.',
			isThirdParty,
			canAutoSync: !isThirdParty,
			requiresThirdPartyConfirmation: isThirdParty && !isConfirmedThirdParty,
			warning
		};
	}

	// 5. Decisao de 3 vias com base existente
	const localCompositeHash = localSnapshot.compositeHash;
	// E5.5: hash de fallback nao deve incluir agentecode-sync.json e LEIA-ME.md
	const remoteKeysForHash = Object.keys(remoteFiles)
		.filter(f => f !== config.MANIFEST_FILE && f !== config.README_FILE)
		.sort();
	const remoteCompositeHash = (remoteManifest && remoteManifest.compositeHash) ||
		sha256(remoteKeysForHash.map(f => `${f}:${sha256(remoteFiles[f])}\n`).join(''));

	// Local mudou desde a base?
	let localChanged = false;
	if (base.localHash) {
		localChanged = localCompositeHash !== base.localHash;
	} else if (base.files) {
		for (const [f, h] of Object.entries(localHashes)) {
			if (base.files[f] !== h) {
				localChanged = true;
				break;
			}
		}
	}

	// Remoto mudou desde a base?
	let remoteChanged = false;
	if (base.manifestHash) {
		remoteChanged = remoteCompositeHash !== base.manifestHash;
	} else if (base.remoteUpdatedAt && remoteUpdatedAt) {
		remoteChanged = base.remoteUpdatedAt !== remoteUpdatedAt;
	}

	// Arquivos que mudaram localmente em relacao ao remoto ou base
	const filesToUpload = fileDiffs
		.filter(d => d.status === 'modified' || d.status === 'localOnly')
		.map(d => d.file);

	let action;
	let summary;

	if (!localChanged && !remoteChanged) {
		action = 'nothing';
		summary = 'Nenhuma mudança detectada (tudo sincronizado).';
	} else if (localChanged && !remoteChanged) {
		action = 'upload';
		summary = `${filesToUpload.length} arquivo(s) modificado(s) localmente para enviar.`;
	} else if (!localChanged && remoteChanged) {
		action = 'notifyDownload';
		summary = 'Existem configurações mais novas no GitHub prontas para download.';
	} else {
		action = 'conflict';
		summary = 'As configurações mudaram neste computador e também no GitHub (conflito).';
	}

	return {
		action,
		hasChanges: action !== 'nothing',
		localChanged,
		remoteChanged,
		fileDiffs,
		extensionsDiff,
		filesToUpload,
		summary,
		isThirdParty,
		canAutoSync: !isThirdParty,
		requiresThirdPartyConfirmation: isThirdParty && !isConfirmedThirdParty,
		warning
	};
}

module.exports = {
	createSyncPlan
};
