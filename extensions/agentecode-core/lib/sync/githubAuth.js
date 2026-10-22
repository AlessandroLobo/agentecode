/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const config = require('./config');

class AuthError extends Error {
	constructor(message, code) {
		super(message);
		this.name = 'AuthError';
		this.code = code;
	}
}

class TokenExpiredError extends AuthError {
	constructor(message = 'O codigo de autorizacao expirou. Por favor, tente novamente.') {
		super(message, 'EXPIRED_TOKEN');
		this.name = 'TokenExpiredError';
	}
}

class AccessDeniedError extends AuthError {
	constructor(message = 'A autorizacao foi cancelada no navegador.') {
		super(message, 'ACCESS_DENIED');
		this.name = 'AccessDeniedError';
	}
}

class NetworkError extends AuthError {
	constructor(message = 'Nao foi possivel conectar ao GitHub. Verifique sua conexao.') {
		super(message, 'NETWORK_ERROR');
		this.name = 'NetworkError';
	}
}

/**
 * Inicia o fluxo Device Flow do GitHub.
 * @param {object} options
 * @param {string} [options.clientId]
 * @param {string} [options.scope] Padrao: 'gist'
 * @param {string} [options.baseUrl]
 * @param {typeof fetch} [options.fetchFn]
 * @returns {Promise<{ device_code: string, user_code: string, verification_uri: string, expires_in: number, interval: number }>}
 */
async function startDeviceFlow(options = {}) {
	const clientId = options.clientId || config.getClientId();
	const baseUrl = options.baseUrl || config.getGitHubBase();
	const scope = options.scope || 'gist';
	const fetchFn = options.fetchFn || globalThis.fetch;

	const url = `${baseUrl}/login/device/code`;
	let response;
	try {
		response = await fetchFn(url, {
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': 'AgenteCode-Sync'
			},
			body: JSON.stringify({
				client_id: clientId,
				scope
			})
		});
	} catch (err) {
		throw new NetworkError(`Falha na conexao com o GitHub: ${err.message}`);
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new AuthError(`GitHub retornou erro HTTP ${response.status} ao solicitar codigo: ${text}`, 'HTTP_ERROR');
	}

	const data = await response.json();
	if (data.error) {
		throw new AuthError(data.error_description || data.error, data.error);
	}

	return {
		device_code: data.device_code,
		user_code: data.user_code,
		verification_uri: data.verification_uri,
		expires_in: data.expires_in || 900,
		interval: data.interval || 5
	};
}

/**
 * Realiza polling aguardando o usuario autorizar o device code no navegador.
 * @param {object} options
 * @param {string} [options.clientId]
 * @param {string} options.deviceCode
 * @param {number} [options.interval] Intervalo em segundos
 * @param {number} [options.expiresIn] Tempo total limite em segundos
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.baseUrl]
 * @param {typeof fetch} [options.fetchFn]
 * @param {(ms: number) => Promise<void>} [options.sleepFn]
 * @param {(newInterval: number) => void} [options.onSlowDown]
 * @returns {Promise<{ accessToken: string, tokenType: string, scope: string }>}
 */
async function pollForToken(options) {
	const clientId = options.clientId || config.getClientId();
	const baseUrl = options.baseUrl || config.getGitHubBase();
	const deviceCode = options.deviceCode;
	const fetchFn = options.fetchFn || globalThis.fetch;
	const sleep = options.sleepFn || (ms => new Promise(resolve => setTimeout(resolve, ms)));

	let interval = options.interval || 5;
	const expiresAt = Date.now() + ((options.expiresIn || 900) * 1000);

	const url = `${baseUrl}/login/oauth/access_token`;

	while (Date.now() < expiresAt) {
		if (options.signal?.aborted) {
			const err = new Error('Operacao cancelada.');
			err.name = 'AbortError';
			throw err;
		}

		let response;
		try {
			response = await fetchFn(url, {
				method: 'POST',
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': 'AgenteCode-Sync'
				},
				body: JSON.stringify({
					client_id: clientId,
					device_code: deviceCode,
					grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
				}),
				signal: options.signal
			});
		} catch (err) {
			if (err.name === 'AbortError') {
				throw err;
			}
			throw new NetworkError(`Falha na conexao ao consultar token: ${err.message}`);
		}

		const data = await response.json().catch(() => ({}));

		if (data.access_token) {
			const scope = data.scope || '';
			if (!scope.includes('gist')) {
				throw new AuthError('O token retornado nao contem a permissao necessaria (gist).', 'INSUFFICIENT_SCOPE');
			}
			return {
				accessToken: data.access_token,
				tokenType: data.token_type || 'Bearer',
				scope
			};
		}

		if (data.error === 'authorization_pending') {
			await sleep(interval * 1000);
			continue;
		}

		if (data.error === 'slow_down') {
			interval = (data.interval || interval + 5);
			if (typeof options.onSlowDown === 'function') {
				options.onSlowDown(interval);
			}
			await sleep(interval * 1000);
			continue;
		}

		if (data.error === 'expired_token') {
			throw new TokenExpiredError();
		}

		if (data.error === 'access_denied') {
			throw new AccessDeniedError();
		}

		throw new AuthError(data.error_description || data.error || 'Erro desconhecido na autorizacao.', data.error);
	}

	throw new TokenExpiredError('O tempo para autorizar no navegador expirou.');
}

/**
 * Consulta informacoes do usuario autenticado (GET /user).
 * @param {string} token
 * @param {object} [options]
 * @param {string} [options.apiBaseUrl]
 * @param {typeof fetch} [options.fetchFn]
 * @returns {Promise<{ login: string, id: number, name?: string, html_url?: string }>}
 */
async function getUser(token, options = {}) {
	const apiBaseUrl = options.apiBaseUrl || config.getGitHubApi();
	const fetchFn = options.fetchFn || globalThis.fetch;

	let response;
	try {
		response = await fetchFn(`${apiBaseUrl}/user`, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Accept': 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'AgenteCode-Sync'
			}
		});
	} catch (err) {
		throw new NetworkError(`Falha ao obter perfil do usuario: ${err.message}`);
	}

	if (response.status === 401) {
		throw new AuthError('Token revogado ou invalido (401).', 'UNAUTHORIZED');
	}

	if (!response.ok) {
		throw new AuthError(`Erro ao consultar usuario: HTTP ${response.status}`, 'HTTP_ERROR');
	}

	return response.json();
}

module.exports = {
	AuthError,
	TokenExpiredError,
	AccessDeniedError,
	NetworkError,
	startDeviceFlow,
	pollForToken,
	getUser
};
