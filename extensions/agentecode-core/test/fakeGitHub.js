/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const http = require('http');

/**
 * Servidor HTTP falso para simular os endpoints da API do GitHub necessarios para os testes.
 */
function createFakeGitHub() {
	let server;
	let baseUrl = '';
	let apiBaseUrl = '';

	// Estado em memoria
	const gists = new Map();
	let gistIdCounter = 1;
	let tokenCounter = 1;

	// Configuracao de cenarios
	let scenario = 'default';
	let pollAttempt = 0;
	let customScenarioHandler = null;

	function reset() {
		gists.clear();
		gistIdCounter = 1;
		tokenCounter = 1;
		scenario = 'default';
		pollAttempt = 0;
		customScenarioHandler = null;
	}

	function setScenario(newScenario) {
		scenario = newScenario;
		pollAttempt = 0;
	}

	function addGist(gist) {
		const id = gist.id || `gist_${gistIdCounter++}`;
		const now = new Date().toISOString();
		const filesObj = {};
		for (const [name, fileData] of Object.entries(gist.files || {})) {
			const content = typeof fileData === 'string' ? fileData : (fileData?.content || '');
			filesObj[name] = {
				filename: name,
				content,
				size: Buffer.byteLength(content, 'utf8'),
				truncated: Boolean(fileData?.truncated),
				raw_url: fileData?.truncated ? `${apiBaseUrl}/raw/${id}/${encodeURIComponent(name)}` : undefined
			};
		}
		const fullGist = {
			id,
			description: gist.description || '',
			public: Boolean(gist.public),
			created_at: gist.created_at || now,
			updated_at: gist.updated_at || now,
			html_url: `https://gist.github.com/testuser/${id}`,
			etag: `"etag_${Date.now()}_${id}"`,
			files: filesObj
		};
		gists.set(id, fullGist);
		return fullGist;
	}

	async function start() {
		return new Promise((resolve, reject) => {
			server = http.createServer((req, res) => {
				const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
				const pathname = parsedUrl.pathname;
				const method = req.method;

				let bodyText = '';
				req.on('data', chunk => {
					bodyText += chunk;
				});

				req.on('end', () => {
					let body = {};
					try {
						body = bodyText ? JSON.parse(bodyText) : {};
					} catch {
						body = {};
					}

					// Custom scenario handler
					if (customScenarioHandler) {
						const handled = customScenarioHandler(req, res, { pathname, method, body, parsedUrl });
						if (handled) {
							return;
						}
					}

					// Cenarios globais de erro
					if (scenario === 'rate_limit' && pathname.startsWith('/gists')) {
						res.writeHead(429, {
							'Content-Type': 'application/json',
							'Retry-After': '60',
							'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60)
						});
						res.end(JSON.stringify({ message: 'API rate limit exceeded' }));
						return;
					}

					if (scenario === 'unauthorized' && pathname.startsWith('/gists')) {
						res.writeHead(401, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ message: 'Bad credentials' }));
						return;
					}

					// 1. POST /login/device/code
					if (method === 'POST' && pathname === '/login/device/code') {
						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({
							device_code: 'fake_device_code_123',
							user_code: 'ABCD-1234',
							verification_uri: `${baseUrl}/login/device`,
							expires_in: 900,
							interval: 1
						}));
						return;
					}

					// 2. POST /login/oauth/access_token
					if (method === 'POST' && pathname === '/login/oauth/access_token') {
						pollAttempt++;

						if (scenario === 'expired_token') {
							res.writeHead(200, { 'Content-Type': 'application/json' });
							res.end(JSON.stringify({ error: 'expired_token' }));
							return;
						}

						if (scenario === 'access_denied') {
							res.writeHead(200, { 'Content-Type': 'application/json' });
							res.end(JSON.stringify({ error: 'access_denied' }));
							return;
						}

						if (scenario === 'pending_then_slowdown_then_success') {
							if (pollAttempt === 1) {
								res.writeHead(200, { 'Content-Type': 'application/json' });
								res.end(JSON.stringify({ error: 'authorization_pending' }));
								return;
							}
							if (pollAttempt === 2) {
								res.writeHead(200, { 'Content-Type': 'application/json' });
								res.end(JSON.stringify({ error: 'slow_down', interval: 2 }));
								return;
							}
							// 3a tentativa em diante: sucesso
						}

						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({
							access_token: `gho_mock_token_${tokenCounter++}`,
							token_type: 'Bearer',
							scope: 'gist'
						}));
						return;
					}

					// 3. GET /user
					if (method === 'GET' && pathname === '/user') {
						const auth = req.headers.authorization;
						if (!auth || !auth.startsWith('Bearer ')) {
							res.writeHead(401, { 'Content-Type': 'application/json' });
							res.end(JSON.stringify({ message: 'Bad credentials' }));
							return;
						}
						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({
							login: 'alessandrolobo',
							id: 12345,
							name: 'Alessandro Lobo'
						}));
						return;
					}

					// 4. GET /gists (lista com paginacao)
					if (method === 'GET' && pathname === '/gists') {
						const page = parseInt(parsedUrl.searchParams.get('page') || '1', 10);
						const perPage = parseInt(parsedUrl.searchParams.get('per_page') || '100', 10);

						const all = Array.from(gists.values());
						const startIdx = (page - 1) * perPage;
						const paginated = all.slice(startIdx, startIdx + perPage);

						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify(paginated));
						return;
					}

					// 5. POST /gists (cria)
					if (method === 'POST' && pathname === '/gists') {
						const newGist = addGist({
							description: body.description,
							public: body.public,
							files: body.files
						});
						res.writeHead(201, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify(newGist));
						return;
					}

					// 6. GET /gists/:id
					if (method === 'GET' && pathname.startsWith('/gists/')) {
						const id = pathname.slice('/gists/'.length);
						const gist = gists.get(id);
						if (!gist) {
							res.writeHead(404, { 'Content-Type': 'application/json' });
							res.end(JSON.stringify({ message: 'Not Found' }));
							return;
						}

						const ifNoneMatch = req.headers['if-none-match'];
						if (ifNoneMatch && ifNoneMatch === gist.etag) {
							res.writeHead(304, { 'ETag': gist.etag });
							res.end();
							return;
						}

						res.writeHead(200, {
							'Content-Type': 'application/json',
							'ETag': gist.etag
						});
						res.end(JSON.stringify(gist));
						return;
					}

					// 7. GET /raw/:id/:file (arquivos truncados)
					if (method === 'GET' && pathname.startsWith('/raw/')) {
						const parts = pathname.slice('/raw/'.length).split('/');
						const id = parts[0];
						const filename = decodeURIComponent(parts.slice(1).join('/'));
						const gist = gists.get(id);
						if (!gist || !gist.files[filename]) {
							res.writeHead(404);
							res.end('Not found');
							return;
						}
						res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
						res.end(gist.files[filename].content || '');
						return;
					}

					// 8. PATCH /gists/:id (atualiza ou remove arquivos)
					if (method === 'PATCH' && pathname.startsWith('/gists/')) {
						const id = pathname.slice('/gists/'.length);
						const gist = gists.get(id);
						if (!gist) {
							res.writeHead(404, { 'Content-Type': 'application/json' });
							res.end(JSON.stringify({ message: 'Not Found' }));
							return;
						}

						if (body.description !== undefined) {
							gist.description = body.description;
						}

						if (body.files) {
							for (const [fname, fval] of Object.entries(body.files)) {
								if (fval === null) {
									delete gist.files[fname];
								} else {
									const content = fval.content || '';
									gist.files[fname] = {
										filename: fname,
										content,
										size: Buffer.byteLength(content, 'utf8')
									};
								}
							}
						}

						gist.updated_at = new Date().toISOString();
						gist.etag = `"etag_${Date.now()}_${id}"`;

						res.writeHead(200, {
							'Content-Type': 'application/json',
							'ETag': gist.etag
						});
						res.end(JSON.stringify(gist));
						return;
					}

					res.writeHead(404, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ message: 'Endpoint mock desconhecido' }));
				});
			});

			server.listen(0, '127.0.0.1', () => {
				const addr = server.address();
				baseUrl = `http://127.0.0.1:${addr.port}`;
				apiBaseUrl = baseUrl;
				resolve();
			});

			server.on('error', reject);
		});
	}

	async function stop() {
		if (server) {
			return new Promise(resolve => server.close(resolve));
		}
	}

	return {
		start,
		stop,
		reset,
		setScenario,
		setCustomHandler: fn => { customScenarioHandler = fn; },
		addGist,
		getGist: id => gists.get(id),
		getBaseUrl: () => baseUrl,
		getApiBaseUrl: () => apiBaseUrl
	};
}

module.exports = {
	createFakeGitHub
};
