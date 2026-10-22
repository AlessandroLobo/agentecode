/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const config = require('./config');

class GistError extends Error {
	constructor(message, code, status) {
		super(message);
		this.name = 'GistError';
		this.code = code;
		this.status = status;
	}
}

class TokenRevokedError extends GistError {
	constructor(message = 'Token de acesso revogado ou invalido (401).') {
		super(message, 'TOKEN_REVOKED', 401);
		this.name = 'TokenRevokedError';
	}
}

class RateLimitError extends GistError {
	constructor(message, resetSeconds, retryAfter) {
		super(message, 'RATE_LIMIT_EXCEEDED', 429);
		this.name = 'RateLimitError';
		this.resetSeconds = resetSeconds;
		this.retryAfter = retryAfter;
	}
}

class GistNotFoundError extends GistError {
	constructor(message = 'Gist nao encontrado no GitHub (404).') {
		super(message, 'NOT_FOUND', 404);
		this.name = 'GistNotFoundError';
	}
}

class GistValidationError extends GistError {
	constructor(message = 'Dados invalidos para o Gist (422).') {
		super(message, 'VALIDATION_FAILED', 422);
		this.name = 'GistValidationError';
	}
}

class GistNetworkError extends GistError {
	constructor(message = 'Erro de conexao com o servico de Gists do GitHub.') {
		super(message, 'NETWORK_ERROR', 0);
		this.name = 'GistNetworkError';
	}
}

/**
 * Cria os cabecalhos padrao para requisicoes a API de Gists do GitHub.
 * @param {string} token
 * @param {Record<string, string>} [extra]
 */
function defaultHeaders(token, extra = {}) {
	return {
		'Authorization': `Bearer ${token}`,
		'Accept': 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
		'User-Agent': 'AgenteCode-Sync',
		...extra
	};
}

/**
 * Avalia a resposta HTTP e lanca o erro tipado correspondente caso nao seja sucesso.
 * @param {Response} response
 */
async function handleResponseErrors(response) {
	if (response.ok || response.status === 304) {
		return;
	}

	if (response.status === 401) {
		throw new TokenRevokedError();
	}

	if (response.status === 404) {
		throw new GistNotFoundError();
	}

	if (response.status === 422) {
		const text = await response.text().catch(() => '');
		throw new GistValidationError(`Erro de validacao do Gist: ${text}`);
	}

	if (response.status === 403 || response.status === 429) {
		const retryAfter = Number(response.headers.get('retry-after')) || 0;
		const resetHeader = Number(response.headers.get('x-ratelimit-reset')) || 0;
		const resetSeconds = resetHeader ? Math.max(0, resetHeader - Math.floor(Date.now() / 1000)) : 0;
		throw new RateLimitError(
			`Limite de requisicoes ao GitHub atingido. Tente novamente em alguns minutos.`,
			resetSeconds,
			retryAfter
		);
	}

	const errorText = await response.text().catch(() => '');
	throw new GistError(`GitHub retornou erro HTTP ${response.status}: ${errorText}`, 'HTTP_ERROR', response.status);
}

/**
 * Procura um Gist existente da conta que contenha a marca de sincronizacao do AgenteCode.
 * Pagina a lista de gists caso haja mais de 100.
 *
 * @param {string} token
 * @param {object} [options]
 * @param {string} [options.marker]
 * @param {string} [options.apiBaseUrl]
 * @param {typeof fetch} [options.fetchFn]
 * @returns {Promise<any | null>} Objeto do Gist encontrado ou null
 */
async function findSyncGist(token, options = {}) {
	const marker = options.marker || config.GIST_MARKER;
	const apiBaseUrl = options.apiBaseUrl || config.getGitHubApi();
	const fetchFn = options.fetchFn || globalThis.fetch;

	let page = 1;
	while (page <= 10) {
		const url = `${apiBaseUrl}/gists?per_page=100&page=${page}`;
		let response;
		try {
			response = await fetchFn(url, {
				method: 'GET',
				headers: defaultHeaders(token)
			});
		} catch (err) {
			throw new GistNetworkError(err.message);
		}

		await handleResponseErrors(response);

		const gists = await response.json();
		if (!Array.isArray(gists) || gists.length === 0) {
			break;
		}

		for (const gist of gists) {
			if (gist && gist.description && gist.description.includes(marker)) {
				return gist;
			}
		}

		if (gists.length < 100) {
			break;
		}
		page++;
	}

	return null;
}

/**
 * Cria um novo Gist secreto no GitHub.
 * @param {string} token
 * @param {object} params
 * @param {string} [params.description]
 * @param {boolean} [params.isPublic] Padrao: false (secreto)
 * @param {Record<string, { content: string }>} params.files
 * @param {object} [options]
 * @param {string} [options.apiBaseUrl]
 * @param {typeof fetch} [options.fetchFn]
 * @returns {Promise<any>}
 */
async function createGist(token, { description, isPublic = false, files }, options = {}) {
	const apiBaseUrl = options.apiBaseUrl || config.getGitHubApi();
	const fetchFn = options.fetchFn || globalThis.fetch;

	const desc = description || config.GIST_DESCRIPTION;
	const body = JSON.stringify({
		description: desc,
		public: isPublic,
		files
	});

	let response;
	try {
		response = await fetchFn(`${apiBaseUrl}/gists`, {
			method: 'POST',
			headers: defaultHeaders(token, { 'Content-Type': 'application/json' }),
			body
		});
	} catch (err) {
		throw new GistNetworkError(err.message);
	}

	await handleResponseErrors(response);
	return response.json();
}

/**
 * Obtem os detalhes de um Gist pelo seu ID.
 * Suporta ETag (retorna { notModified: true } em caso de HTTP 304).
 * Baixa automaticamente o conteudo completo via raw_url caso algum arquivo venha truncated.
 *
 * @param {string} token
 * @param {string} gistId
 * @param {object} [options]
 * @param {string} [options.etag]
 * @param {string} [options.apiBaseUrl]
 * @param {typeof fetch} [options.fetchFn]
 * @returns {Promise<{ notModified: boolean, gist?: any, etag?: string }>}
 */
async function getGist(token, gistId, options = {}) {
	const apiBaseUrl = options.apiBaseUrl || config.getGitHubApi();
	const fetchFn = options.fetchFn || globalThis.fetch;

	const headers = defaultHeaders(token);
	if (options.etag) {
		headers['If-None-Match'] = options.etag;
	}

	let response;
	try {
		response = await fetchFn(`${apiBaseUrl}/gists/${gistId}`, {
			method: 'GET',
			headers
		});
	} catch (err) {
		throw new GistNetworkError(err.message);
	}

	if (response.status === 304) {
		return { notModified: true, etag: options.etag };
	}

	await handleResponseErrors(response);

	const gist = await response.json();
	const etag = response.headers.get('etag') || undefined;

	// Trata arquivos truncados baixando o raw_url
	if (gist && gist.files) {
		for (const [name, fileObj] of Object.entries(gist.files)) {
			if (fileObj && fileObj.truncated && fileObj.raw_url) {
				try {
					const rawRes = await fetchFn(fileObj.raw_url, {
						headers: defaultHeaders(token)
					});
					if (rawRes.ok) {
						fileObj.content = await rawRes.text();
						fileObj.truncated = false;
					}
				} catch {
					// se falhar o download do raw_url, mantem o arquivo como estava
				}
			}
		}
	}

	return { notModified: false, gist, etag };
}

/**
 * Atualiza um Gist existente.
 * Arquivos podem ser atualizados ({ content: string }) ou apagados ({ [nome]: null }).
 *
 * @param {string} token
 * @param {string} gistId
 * @param {object} params
 * @param {string} [params.description]
 * @param {Record<string, { content: string } | null>} params.files
 * @param {object} [options]
 * @param {string} [options.apiBaseUrl]
 * @param {typeof fetch} [options.fetchFn]
 * @returns {Promise<any>}
 */
async function updateGist(token, gistId, { description, files }, options = {}) {
	const apiBaseUrl = options.apiBaseUrl || config.getGitHubApi();
	const fetchFn = options.fetchFn || globalThis.fetch;

	const payload = { files };
	if (description !== undefined) {
		payload.description = description;
	}

	let response;
	try {
		response = await fetchFn(`${apiBaseUrl}/gists/${gistId}`, {
			method: 'PATCH',
			headers: defaultHeaders(token, { 'Content-Type': 'application/json' }),
			body: JSON.stringify(payload)
		});
	} catch (err) {
		throw new GistNetworkError(err.message);
	}

	await handleResponseErrors(response);
	return response.json();
}

module.exports = {
	GistError,
	TokenRevokedError,
	RateLimitError,
	GistNotFoundError,
	GistValidationError,
	GistNetworkError,
	findSyncGist,
	createGist,
	getGist,
	updateGist
};
