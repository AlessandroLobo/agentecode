/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const crypto = require('crypto');
const path = require('path');
const config = require('./config');
const { filterSettings } = require('./exclusions');

/**
 * Calcula o hash SHA-256 de uma string em formato hexadecimal.
 * @param {string | Buffer} content
 * @returns {string}
 */
function sha256(content) {
	return crypto.createHash('sha256').update(content || '', 'utf8').digest('hex');
}

/**
 * Calcula um hash composto e deterministico para o conjunto de arquivos.
 * @param {Record<string, string>} files Mapa de nome de arquivo -> conteudo
 * @returns {string}
 */
function computeCompositeHash(files) {
	const sortedNames = Object.keys(files || {}).sort();
	const hash = crypto.createHash('sha256');
	for (const name of sortedNames) {
		const content = files[name];
		const fileHash = sha256(content);
		hash.update(`${name}:${fileHash}\n`, 'utf8');
	}
	return hash.digest('hex');
}

/**
 * Saneia o nome de um arquivo de snippet para inclusao no Gist (Gists nao suportam pastas).
 * Substitui caracteres nao permitidos por '_' preservando a extensao.
 * @param {string} fileName Nome original do arquivo (ex.: 'csharp.json' ou 'meu snippet!.code-snippets')
 * @returns {{ gistFileName: string, originalName: string, sanitized: boolean }}
 */
function sanitizeSnippetName(fileName) {
	const clean = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
	const gistFileName = `${config.SNIPPET_PREFIX}${clean}`;
	return {
		gistFileName,
		originalName: fileName,
		sanitized: clean !== fileName
	};
}

/**
 * Extrai o nome local original de um arquivo de snippet vindo do Gist.
 * @param {string} gistFileName Nome no Gist (ex.: 'snippets--csharp.json')
 * @param {Record<string, string>} [manifestSnippetNames] Mapeamento gravado no manifesto caso tenha sido saneado
 * @returns {string} Nome original (ex.: 'csharp.json')
 */
function restoreSnippetName(gistFileName, manifestSnippetNames = {}) {
	if (manifestSnippetNames[gistFileName]) {
		return manifestSnippetNames[gistFileName];
	}
	if (gistFileName.startsWith(config.SNIPPET_PREFIX)) {
		return gistFileName.slice(config.SNIPPET_PREFIX.length);
	}
	return gistFileName;
}

/**
 * Normaliza e ordena a lista de identificadores de extensoes do usuario.
 * @param {string[]} extensions
 * @returns {string[]}
 */
function normalizeExtensions(extensions) {
	if (!Array.isArray(extensions)) {
		return [];
	}
	const unique = new Set(
		extensions
			.map(id => (typeof id === 'string' ? id.trim().toLowerCase() : ''))
			.filter(Boolean)
	);
	return Array.from(unique).sort();
}

/**
 * Monta o snapshot local lendo os arquivos do disco atraves de um leitor injetavel.
 * @param {object} options
 * @param {string} options.userDir Diretorio 'User' do VS Code
 * @param {(filePath: string) => Promise<string | null>} options.readFile
 * @param {(dirPath: string) => Promise<string[]>} [options.readDir]
 * @param {() => Promise<string[]>} [options.listUserExtensions]
 * @param {string[]} [options.customExclusions]
 * @returns {Promise<{ files: Record<string, string>, fileHashes: Record<string, string>, extensions: string[], compositeHash: string, snippetNames: Record<string, string> }>}
 */
async function createLocalSnapshot({
	userDir,
	readFile,
	readDir,
	listUserExtensions,
	customExclusions = []
}) {
	const files = {};
	const fileHashes = {};
	const snippetNames = {};

	// 1. settings.json
	const settingsPath = path.join(userDir, config.SETTINGS_FILE);
	const rawSettings = await readFile(settingsPath);
	if (rawSettings !== null && rawSettings !== undefined) {
		const filtered = filterSettings(rawSettings, customExclusions);
		files[config.SETTINGS_FILE] = filtered;
		fileHashes[config.SETTINGS_FILE] = sha256(filtered);
	}

	// 2. keybindings.json
	const keybindingsPath = path.join(userDir, config.KEYBINDINGS_FILE);
	const rawKeybindings = await readFile(keybindingsPath);
	if (rawKeybindings !== null && rawKeybindings !== undefined) {
		files[config.KEYBINDINGS_FILE] = rawKeybindings;
		fileHashes[config.KEYBINDINGS_FILE] = sha256(rawKeybindings);
	}

	// 3. snippets/
	if (readDir) {
		const snippetsDir = path.join(userDir, 'snippets');
		try {
			const entries = await readDir(snippetsDir);
			for (const entry of entries) {
				if (entry.endsWith('.json') || entry.endsWith('.code-snippets')) {
					const snippetPath = path.join(snippetsDir, entry);
					const snippetContent = await readFile(snippetPath);
					if (snippetContent !== null && snippetContent !== undefined) {
						const { gistFileName, originalName, sanitized } = sanitizeSnippetName(entry);
						files[gistFileName] = snippetContent;
						fileHashes[gistFileName] = sha256(snippetContent);
						if (sanitized) {
							snippetNames[gistFileName] = originalName;
						}
					}
				}
			}
		} catch {
			// pasta de snippets pode nao existir, segue normal
		}
	}

	// 4. extensions.json
	let userExtensions = [];
	if (listUserExtensions) {
		try {
			const list = await listUserExtensions();
			userExtensions = normalizeExtensions(list);
		} catch {
			userExtensions = [];
		}
	}
	const extensionsJson = JSON.stringify({ extensions: userExtensions }, null, '\t') + '\n';
	files[config.EXTENSIONS_FILE] = extensionsJson;
	fileHashes[config.EXTENSIONS_FILE] = sha256(extensionsJson);

	// 5. LEIA-ME.md
	files[config.README_FILE] = config.README_CONTENT;
	fileHashes[config.README_FILE] = sha256(config.README_CONTENT);

	// 6. Hash composto
	const compositeHash = computeCompositeHash(files);

	return {
		files,
		fileHashes,
		extensions: userExtensions,
		compositeHash,
		snippetNames
	};
}

/**
 * Cria o objeto de manifesto 'agentecode-sync.json'.
 * @param {object} snapshot Retorno de createLocalSnapshot
 * @param {object} machineInfo
 * @param {string} [machineInfo.appVersion]
 * @param {string} [machineInfo.id]
 * @param {string} [machineInfo.name]
 * @param {string} [machineInfo.platform]
 * @returns {string} Conteudo JSON formatado do manifesto
 */
function buildManifest(snapshot, machineInfo = {}) {
	const filesMeta = {};
	for (const [name, content] of Object.entries(snapshot.files)) {
		if (name === config.MANIFEST_FILE) {
			continue;
		}
		filesMeta[name] = {
			sha256: snapshot.fileHashes[name] || sha256(content),
			size: Buffer.byteLength(content, 'utf8')
		};
	}

	const manifest = {
		schema: 1,
		app: 'AgenteCode',
		appVersion: machineInfo.appVersion || '1.0.4',
		savedAt: new Date().toISOString(),
		machine: {
			id: machineInfo.id || 'unknown',
			name: machineInfo.name || 'DESKTOP',
			platform: machineInfo.platform || process.platform
		},
		compositeHash: snapshot.compositeHash,
		files: filesMeta
	};

	if (snapshot.snippetNames && Object.keys(snapshot.snippetNames).length > 0) {
		manifest.snippetNames = snapshot.snippetNames;
	}

	return JSON.stringify(manifest, null, '\t') + '\n';
}

/**
 * Deserializa arquivos remotos recebidos do Gist em um mapa legivel.
 * @param {Record<string, { content?: string, raw_url?: string }>} gistFiles
 * @returns {{ files: Record<string, string>, manifest: any, extensions: string[] }}
 */
function parseRemoteGistFiles(gistFiles = {}) {
	const files = {};
	let manifest = null;
	let extensions = [];

	for (const [name, fileObj] of Object.entries(gistFiles)) {
		if (!fileObj || typeof fileObj.content !== 'string') {
			continue;
		}
		files[name] = fileObj.content;
		if (name === config.MANIFEST_FILE) {
			try {
				manifest = JSON.parse(fileObj.content);
			} catch {
				manifest = null;
			}
		}
		if (name === config.EXTENSIONS_FILE) {
			try {
				const parsed = JSON.parse(fileObj.content);
				extensions = normalizeExtensions(parsed.extensions);
			} catch {
				extensions = [];
			}
		}
	}

	return { files, manifest, extensions };
}

module.exports = {
	sha256,
	computeCompositeHash,
	sanitizeSnippetName,
	restoreSnippetName,
	normalizeExtensions,
	createLocalSnapshot,
	buildManifest,
	parseRemoteGistFiles
};
