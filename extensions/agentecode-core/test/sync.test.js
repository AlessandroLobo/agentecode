/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const config = require('../lib/sync/config');
const jsonc = require('../lib/sync/jsonc');
const exclusions = require('../lib/sync/exclusions');
const snapshot = require('../lib/sync/snapshot');
const plan = require('../lib/sync/plan');
const githubAuth = require('../lib/sync/githubAuth');
const gistClient = require('../lib/sync/gistClient');
const backup = require('../lib/sync/backup');
const { createFakeGitHub } = require('./fakeGitHub');

describe('Sincronizacao de Configuracoes - Nucleo Puro', () => {

	describe('1. jsonc.js', () => {
		test('parseJsonc aceita comentarios de linha e bloco e virgula final', () => {
			const text = `{
	// Comentario de linha
	"editor.fontSize": 14,
	/* Comentario de bloco */
	"editor.tabSize": 4,
	"arr": [1, 2, 3,]
}`;
			const res = jsonc.parseJsonc(text);
			assert.equal(res['editor.fontSize'], 14);
			assert.equal(res['editor.tabSize'], 4);
			assert.deepEqual(res.arr, [1, 2, 3]);
		});

		test('stripTopLevelProperties remove propriedades com comentario colado preservando o resto', () => {
			const text = `{
	// Comentario da fonte
	"editor.fontSize": 14,
	// Comentario colado ao segredo
	"claudeCode.environmentVariables": {
		"KEY": "123"
	},
	"workbench.colorTheme": "AgenteCode Deep Teal Clean"
}`;

			const stripped = jsonc.stripTopLevelProperties(text, ['claudeCode.environmentVariables']);
			assert.ok(!stripped.includes('claudeCode.environmentVariables'));
			assert.ok(!stripped.includes('Comentario colado ao segredo'));
			assert.ok(stripped.includes('editor.fontSize'));
			assert.ok(stripped.includes('Comentario da fonte'));
			assert.ok(stripped.includes('workbench.colorTheme'));

			// O resultado precisa ser um JSONC valido
			const parsed = jsonc.parseJsonc(stripped);
			assert.equal(parsed['editor.fontSize'], 14);
			assert.equal(parsed['workbench.colorTheme'], 'AgenteCode Deep Teal Clean');
			assert.equal(parsed['claudeCode.environmentVariables'], undefined);
		});

		test('stripTopLevelProperties lida com valores string, array e objeto', () => {
			const text = `{
	"str": "valor",
	"arr": [1, 2],
	"obj": { "nested": true },
	"keep": true
}`;
			const stripped = jsonc.stripTopLevelProperties(text, ['str', 'arr', 'obj']);
			const parsed = jsonc.parseJsonc(stripped);
			assert.deepEqual(parsed, { keep: true });
		});

		test('parseJsonc lida com texto vazio ou invalido de forma resiliente', () => {
			assert.deepEqual(jsonc.parseJsonc(''), {});
			assert.deepEqual(jsonc.parseJsonc('   '), {});
			assert.throws(() => jsonc.parseJsonc('{ invalido: true'));
		});
	});

	describe('2. exclusions.js', () => {
		test('exclui chaves padrao sensiveis e locais', () => {
			assert.equal(exclusions.isExcludedSetting('claudeCode.environmentVariables', 'environmentVariables'), true);
			assert.equal(exclusions.isExcludedSetting('git.path', 'path'), true);
			assert.equal(exclusions.isExcludedSetting('python.defaultInterpreterPath', 'defaultInterpreterPath'), true);
			assert.equal(exclusions.isExcludedSetting('editor.fontSize', 'fontSize'), false);
		});

		test('exclui chaves por padrao regex (token, secret, password, api_key)', () => {
			assert.equal(exclusions.isExcludedSetting('myService.apiKey', 'apiKey'), true);
			assert.equal(exclusions.isExcludedSetting('auth.userToken', 'userToken'), true);
			assert.equal(exclusions.isExcludedSetting('database.password', 'password'), true);
			assert.equal(exclusions.isExcludedSetting('app.client_secret', 'client_secret'), true);
		});

		test('exclui chaves com prefixo agentecode.sync.', () => {
			assert.equal(exclusions.isExcludedSetting('agentecode.sync.auto', 'auto'), true);
			assert.equal(exclusions.isExcludedSetting('agentecode.sync.excludedSettings', 'excludedSettings'), true);
		});

		test('filterSettings remove chave aninhada sensivel preservando o restante do objeto', () => {
			const text = `{
	"editor.fontSize": 14,
	"servico": {
		"apiKey": "12345",
		"nome": "publico"
	}
}`;
			const filtered = exclusions.filterSettings(text);
			assert.ok(!filtered.includes('apiKey'));
			assert.ok(filtered.includes('"nome": "publico"'));

			const parsed = jsonc.parseJsonc(filtered);
			assert.equal(parsed['editor.fontSize'], 14);
			assert.equal(parsed.servico.apiKey, undefined);
			assert.equal(parsed.servico.nome, 'publico');
		});
	});

	describe('3. snapshot.js', () => {
		test('calcula sha256 e compositeHash estavel e deterministico', () => {
			const h1 = snapshot.sha256('teste');
			const h2 = snapshot.sha256('teste');
			assert.equal(h1, h2);

			const files1 = { 'b.json': '2', 'a.json': '1' };
			const files2 = { 'a.json': '1', 'b.json': '2' };
			assert.equal(snapshot.computeCompositeHash(files1), snapshot.computeCompositeHash(files2));
		});

		test('saneia nomes de snippets e permite restauracao', () => {
			const { gistFileName, originalName, sanitized } = snapshot.sanitizeSnippetName('csharp.json');
			assert.equal(gistFileName, `${config.SNIPPET_PREFIX}csharp.json`);
			assert.equal(originalName, 'csharp.json');
			assert.equal(sanitized, false);

			const restored = snapshot.restoreSnippetName(gistFileName);
			assert.equal(restored, 'csharp.json');
		});

		test('normalizeExtensions filtra duplicatas, coloca em minusculas e ordena', () => {
			const input = ['ms-python.python', 'ESBENP.prettier-vscode', 'ms-python.python', '  ANOTHER.EXT  '];
			const normalized = snapshot.normalizeExtensions(input);
			assert.deepEqual(normalized, ['another.ext', 'esbenp.prettier-vscode', 'ms-python.python']);
		});

		test('createLocalSnapshot e buildManifest montam manifesto estruturado', async () => {
			const fakeFs = {
				'C:/User/settings.json': '{\n  "editor.fontSize": 16,\n  "git.path": "C:/git.exe"\n}',
				'C:/User/keybindings.json': '[\n  { "key": "ctrl+k", "command": "cmd" }\n]',
				'C:/User/snippets/csharp.json': '{\n  "prop": { "prefix": "prop" }\n}'
			};

			const snap = await snapshot.createLocalSnapshot({
				userDir: 'C:/User',
				readFile: async (p) => fakeFs[p.replace(/\\/g, '/')] || null,
				readDir: async (d) => ['csharp.json', 'ignorar.txt'],
				listUserExtensions: async () => ['ms-dotnettools.csharp', 'GitHub.copilot']
			});

			assert.ok(snap.files['settings.json']);
			assert.ok(!snap.files['settings.json'].includes('git.path')); // git.path foi excluido
			assert.ok(snap.files['keybindings.json']);
			assert.ok(snap.files['snippets--csharp.json']);
			assert.ok(snap.files['extensions.json']);
			assert.ok(snap.files['LEIA-ME.md']);

			const manifestJson = snapshot.buildManifest(snap, {
				appVersion: '1.0.4',
				id: 'uuid-123',
				name: 'MEU-PC',
				platform: 'win32'
			});
			const manifest = JSON.parse(manifestJson);
			assert.equal(manifest.app, 'AgenteCode');
			assert.equal(manifest.appVersion, '1.0.4');
			assert.equal(manifest.machine.name, 'MEU-PC');
			assert.ok(manifest.files['settings.json'].sha256);
		});
	});

	describe('4. plan.js (Tabela 6.3 de 3 vias)', () => {
		const dummyLocal = {
			files: { 'settings.json': '{"a":1}', 'extensions.json': '{"extensions":["ext.a"]}' },
			fileHashes: { 'settings.json': 'sha_loc_1', 'extensions.json': 'sha_ext_1' },
			extensions: ['ext.a'],
			compositeHash: 'hash_local_1'
		};

		test('Linha 1: local nao mudou, remoto nao mudou -> action: nothing', () => {
			const p = plan.createSyncPlan({
				localSnapshot: dummyLocal,
				remoteFiles: { 'settings.json': '{"a":1}', 'extensions.json': '{"extensions":["ext.a"]}' },
				remoteManifest: { compositeHash: 'hash_remote_1' },
				base: {
					localHash: 'hash_local_1',
					manifestHash: 'hash_remote_1'
				}
			});
			assert.equal(p.action, 'nothing');
			assert.equal(p.hasChanges, false);
		});

		test('Linha 2: local mudou, remoto nao mudou -> action: upload', () => {
			const p = plan.createSyncPlan({
				localSnapshot: {
					...dummyLocal,
					files: { 'settings.json': '{"a":2}' },
					fileHashes: { 'settings.json': 'sha_loc_2' },
					compositeHash: 'hash_local_2'
				},
				remoteFiles: { 'settings.json': '{"a":1}' },
				remoteManifest: { compositeHash: 'hash_remote_1' },
				base: {
					localHash: 'hash_local_1',
					manifestHash: 'hash_remote_1'
				}
			});
			assert.equal(p.action, 'upload');
			assert.equal(p.localChanged, true);
			assert.equal(p.remoteChanged, false);
			assert.ok(p.filesToUpload.includes('settings.json'));
		});

		test('Linha 3: local nao mudou, remoto mudou -> action: notifyDownload', () => {
			const p = plan.createSyncPlan({
				localSnapshot: dummyLocal,
				remoteFiles: { 'settings.json': '{"a":2}' },
				remoteManifest: { compositeHash: 'hash_remote_2' },
				base: {
					localHash: 'hash_local_1',
					manifestHash: 'hash_remote_1'
				}
			});
			assert.equal(p.action, 'notifyDownload');
			assert.equal(p.localChanged, false);
			assert.equal(p.remoteChanged, true);
		});

		test('Linha 4: local mudou e remoto mudou -> action: conflict', () => {
			const p = plan.createSyncPlan({
				localSnapshot: {
					...dummyLocal,
					compositeHash: 'hash_local_mod'
				},
				remoteFiles: { 'settings.json': '{"a":99}' },
				remoteManifest: { compositeHash: 'hash_remote_mod' },
				base: {
					localHash: 'hash_local_1',
					manifestHash: 'hash_remote_1'
				}
			});
			assert.equal(p.action, 'conflict');
			assert.equal(p.localChanged, true);
			assert.equal(p.remoteChanged, true);
		});

		test('Linha 5: sem base e Gist existe -> action: downloadFirst', () => {
			const p = plan.createSyncPlan({
				localSnapshot: dummyLocal,
				remoteFiles: { 'settings.json': '{"a":1}' },
				base: null
			});
			assert.equal(p.action, 'downloadFirst');
		});

		test('Linha 6: sem base e sem Gist -> action: initialUpload', () => {
			const p = plan.createSyncPlan({
				localSnapshot: dummyLocal,
				remoteFiles: null,
				base: null
			});
			assert.equal(p.action, 'initialUpload');
			assert.ok(p.filesToUpload.includes('settings.json'));
		});

		test('Idempotencia do plano: apos aplicar, plano deve retornar nothing', () => {
			const currentFiles = { 'settings.json': '{"editor":1}' };
			const currentHashes = { 'settings.json': snapshot.sha256(currentFiles['settings.json']) };
			const compHash = snapshot.computeCompositeHash(currentFiles);

			const p = plan.createSyncPlan({
				localSnapshot: { files: currentFiles, fileHashes: currentHashes, compositeHash: compHash, extensions: [] },
				remoteFiles: currentFiles,
				remoteManifest: { compositeHash: compHash },
				base: { localHash: compHash, manifestHash: compHash }
			});
			assert.equal(p.action, 'nothing');
		});
	});

	describe('5. backup.js', () => {
		let tempBase;
		let tempUser;

		before(async () => {
			tempBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ac-backup-test-'));
			tempUser = path.join(tempBase, 'User');
			await fs.promises.mkdir(path.join(tempUser, 'snippets'), { recursive: true });
			await fs.promises.writeFile(path.join(tempUser, 'settings.json'), '{"fontSize":12}', 'utf8');
			await fs.promises.writeFile(path.join(tempUser, 'keybindings.json'), '[]', 'utf8');
			await fs.promises.writeFile(path.join(tempUser, 'snippets', 'csharp.json'), '{"test":1}', 'utf8');
		});

		after(async () => {
			if (tempBase) {
				await fs.promises.rm(tempBase, { recursive: true, force: true }).catch(() => {});
			}
		});

		test('cria backup, lista e restaura corretamente', async () => {
			const backupsDir = path.join(tempBase, 'backups');
			const b1 = await backup.createBackup(tempUser, backupsDir);
			assert.ok(b1.backupPath);
			assert.ok(b1.filesCopied.includes('settings.json'));
			assert.ok(b1.filesCopied.includes('keybindings.json'));
			assert.ok(b1.filesCopied.includes('snippets/csharp.json'));

			const list = await backup.listBackups(backupsDir);
			assert.equal(list.length, 1);
			assert.equal(list[0].backupPath, b1.backupPath);

			// Altera o arquivo no User
			await fs.promises.writeFile(path.join(tempUser, 'settings.json'), '{"fontSize":999}', 'utf8');

			// Restaura
			const res = await backup.restoreBackup(b1.backupPath, tempUser);
			assert.ok(res.restoredFiles.includes('settings.json'));

			const restoredContent = await fs.promises.readFile(path.join(tempUser, 'settings.json'), 'utf8');
			assert.equal(restoredContent, '{"fontSize":12}');
		});

		test('mantem apenas os 10 backups mais recentes apagando os excedentes', async () => {
			const backupsDir = path.join(tempBase, 'backups-prune');
			for (let i = 0; i < 12; i++) {
				await backup.createBackup(tempUser, backupsDir, { maxBackups: 10 });
				// pequeno delay para timestamps distintos
				await new Promise(r => setTimeout(r, 10));
			}
			const list = await backup.listBackups(backupsDir);
			assert.equal(list.length, 10);
		});
	});

	describe('6. githubAuth.js e gistClient.js com Fake GitHub Server', () => {
		let fake;

		before(async () => {
			fake = createFakeGitHub();
			await fake.start();
		});

		after(async () => {
			if (fake) {
				await fake.stop();
			}
		});

		beforeEach(() => {
			fake.reset();
		});

		test('startDeviceFlow solicita e retorna codigo com sucesso', async () => {
			const df = await githubAuth.startDeviceFlow({
				clientId: 'fake_client_id',
				baseUrl: fake.getBaseUrl()
			});
			assert.equal(df.user_code, 'ABCD-1234');
			assert.equal(df.device_code, 'fake_device_code_123');
			assert.ok(df.verification_uri);
		});

		test('pollForToken lida com sequencia pending -> slow_down -> sucesso', async () => {
			fake.setScenario('pending_then_slowdown_then_success');
			let slowedDown = false;

			const tokenInfo = await githubAuth.pollForToken({
				clientId: 'fake_client_id',
				deviceCode: 'fake_device_code_123',
				interval: 0.01,
				baseUrl: fake.getBaseUrl(),
				sleepFn: () => Promise.resolve(),
				onSlowDown: (newInterval) => {
					slowedDown = true;
					assert.equal(newInterval, 2);
				}
			});

			assert.ok(tokenInfo.accessToken.startsWith('gho_'));
			assert.equal(tokenInfo.scope, 'gist');
			assert.equal(slowedDown, true);
		});

		test('pollForToken lida com expired_token', async () => {
			fake.setScenario('expired_token');
			await assert.rejects(
				() => githubAuth.pollForToken({
					clientId: 'fake_client_id',
					deviceCode: 'fake_device_code_123',
					interval: 0.01,
					baseUrl: fake.getBaseUrl(),
					sleepFn: () => Promise.resolve()
				}),
				githubAuth.TokenExpiredError
			);
		});

		test('pollForToken lida com access_denied', async () => {
			fake.setScenario('access_denied');
			await assert.rejects(
				() => githubAuth.pollForToken({
					clientId: 'fake_client_id',
					deviceCode: 'fake_device_code_123',
					interval: 0.01,
					baseUrl: fake.getBaseUrl(),
					sleepFn: () => Promise.resolve()
				}),
				githubAuth.AccessDeniedError
			);
		});

		test('pollForToken cancela com AbortSignal', async () => {
			const controller = new AbortController();
			controller.abort();
			await assert.rejects(
				() => githubAuth.pollForToken({
					clientId: 'fake_client_id',
					deviceCode: 'fake_device_code_123',
					interval: 0.01,
					signal: controller.signal,
					baseUrl: fake.getBaseUrl(),
					sleepFn: () => Promise.resolve()
				}),
				{ name: 'AbortError' }
			);
		});

		test('getUser obtem dados do usuario autenticado', async () => {
			const user = await githubAuth.getUser('dummy_token', {
				apiBaseUrl: fake.getApiBaseUrl()
			});
			assert.equal(user.login, 'alessandrolobo');
		});

		test('gistClient: cria Gist secreto e o encontra pela marca', async () => {
			const token = 'mock_token';
			const created = await gistClient.createGist(token, {
				description: config.GIST_DESCRIPTION,
				isPublic: false,
				files: {
					'agentecode-sync.json': { content: '{"app":"AgenteCode"}' },
					'settings.json': { content: '{"zoom":1}' }
				}
			}, { apiBaseUrl: fake.getApiBaseUrl() });

			assert.ok(created.id);
			assert.equal(created.public, false);

			const found = await gistClient.findSyncGist(token, {
				apiBaseUrl: fake.getApiBaseUrl()
			});
			assert.ok(found);
			assert.equal(found.id, created.id);
		});

		test('gistClient: getGist com ETag 304 Not Modified', async () => {
			const token = 'mock_token';
			const created = await gistClient.createGist(token, {
				files: { 'settings.json': { content: '{"zoom":1}' } }
			}, { apiBaseUrl: fake.getApiBaseUrl() });

			const first = await gistClient.getGist(token, created.id, {
				apiBaseUrl: fake.getApiBaseUrl()
			});
			assert.equal(first.notModified, false);
			assert.ok(first.etag);

			const second = await gistClient.getGist(token, created.id, {
				etag: first.etag,
				apiBaseUrl: fake.getApiBaseUrl()
			});
			assert.equal(second.notModified, true);
		});

		test('gistClient: getGist baixa arquivo truncated via raw_url', async () => {
			const token = 'mock_token';
			const fakeGist = fake.addGist({
				description: 'Gist com arquivo truncado',
				files: {
					'large.json': {
						content: 'conteudo_completo_gigante',
						truncated: true
					}
				}
			});

			const res = await gistClient.getGist(token, fakeGist.id, {
				apiBaseUrl: fake.getApiBaseUrl()
			});
			assert.equal(res.notModified, false);
			assert.equal(res.gist.files['large.json'].content, 'conteudo_completo_gigante');
			assert.equal(res.gist.files['large.json'].truncated, false);
		});

		test('gistClient: updateGist atualiza e remove arquivo com null', async () => {
			const token = 'mock_token';
			const created = await gistClient.createGist(token, {
				files: {
					'a.json': { content: '1' },
					'b.json': { content: '2' }
				}
			}, { apiBaseUrl: fake.getApiBaseUrl() });

			const updated = await gistClient.updateGist(token, created.id, {
				files: {
					'a.json': { content: '1_atualizado' },
					'b.json': null
				}
			}, { apiBaseUrl: fake.getApiBaseUrl() });

			assert.equal(updated.files['a.json'].content, '1_atualizado');
			assert.equal(updated.files['b.json'], undefined);
		});

		test('gistClient: erro 401 lanca TokenRevokedError', async () => {
			fake.setScenario('unauthorized');
			await assert.rejects(
				() => gistClient.getGist('invalid_token', '123', { apiBaseUrl: fake.getApiBaseUrl() }),
				gistClient.TokenRevokedError
			);
		});

		test('gistClient: erro 429 lanca RateLimitError com retryAfter', async () => {
			fake.setScenario('rate_limit');
			await assert.rejects(
				() => gistClient.getGist('token', '123', { apiBaseUrl: fake.getApiBaseUrl() }),
				err => {
					assert.ok(err instanceof gistClient.RateLimitError);
					assert.equal(err.retryAfter, 60);
					return true;
				}
			);
		});
	});

	describe('7. Fluxo Ponta a Ponta (Computador A -> Envia | Computador B -> Baixa)', () => {
		let fake;
		let tempA;
		let tempB;

		before(async () => {
			fake = createFakeGitHub();
			await fake.start();

			tempA = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ac-e2e-a-'));
			tempB = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ac-e2e-b-'));

			// Prepara ambiente do computador A
			await fs.promises.mkdir(path.join(tempA, 'snippets'), { recursive: true });
			await fs.promises.writeFile(path.join(tempA, 'settings.json'), '{\n\t"editor.fontSize": 18,\n\t"workbench.colorTheme": "AgenteCode Eficaz Clean"\n}\n', 'utf8');
			await fs.promises.writeFile(path.join(tempA, 'keybindings.json'), '[\n\t{ "key": "ctrl+shift+p", "command": "workbench.action.showCommands" }\n]\n', 'utf8');
			await fs.promises.writeFile(path.join(tempA, 'snippets', 'csharp.json'), '{\n\t"mySnippet": { "prefix": "my" }\n}\n', 'utf8');

			// Computador B esta limpo
			await fs.promises.mkdir(tempB, { recursive: true });
		});

		after(async () => {
			if (fake) {
				await fake.stop();
			}
			if (tempA) {
				await fs.promises.rm(tempA, { recursive: true, force: true }).catch(() => {});
			}
			if (tempB) {
				await fs.promises.rm(tempB, { recursive: true, force: true }).catch(() => {});
			}
		});

		test('computador A envia ao Gist e computador B baixa e aplica com resultado identico', async () => {
			const token = 'gho_token_e2e';

			// 1. Computador A monta snapshot e envia
			const snapA = await snapshot.createLocalSnapshot({
				userDir: tempA,
				readFile: p => fs.promises.readFile(p, 'utf8').catch(() => null),
				readDir: d => fs.promises.readdir(d).catch(() => []),
				listUserExtensions: async () => ['ms-dotnettools.csharp', 'esbenp.prettier-vscode']
			});

			const manifestA = snapshot.buildManifest(snapA, {
				appVersion: '1.0.4',
				id: 'machine-a-uuid',
				name: 'DESKTOP-ALESSANDRO-A',
				platform: 'win32'
			});

			const gistFilesA = {
				[config.MANIFEST_FILE]: { content: manifestA }
			};
			for (const [fname, content] of Object.entries(snapA.files)) {
				gistFilesA[fname] = { content };
			}

			const createdGist = await gistClient.createGist(token, {
				description: config.GIST_DESCRIPTION,
				files: gistFilesA
			}, { apiBaseUrl: fake.getApiBaseUrl() });

			assert.ok(createdGist.id);

			// 2. Computador B conecta e localiza o Gist pela marca
			const foundGist = await gistClient.findSyncGist(token, {
				apiBaseUrl: fake.getApiBaseUrl()
			});
			assert.ok(foundGist);
			assert.equal(foundGist.id, createdGist.id);

			const { gist } = await gistClient.getGist(token, foundGist.id, {
				apiBaseUrl: fake.getApiBaseUrl()
			});

			const remoteParsed = snapshot.parseRemoteGistFiles(gist.files);
			assert.ok(remoteParsed.files['settings.json']);
			assert.ok(remoteParsed.files['keybindings.json']);
			assert.ok(remoteParsed.files['snippets--csharp.json']);
			assert.deepEqual(remoteParsed.extensions, ['esbenp.prettier-vscode', 'ms-dotnettools.csharp']);

			// 3. Computador B monta plano (primeira vez sem base)
			const snapB = await snapshot.createLocalSnapshot({
				userDir: tempB,
				readFile: p => fs.promises.readFile(p, 'utf8').catch(() => null),
				readDir: d => fs.promises.readdir(d).catch(() => []),
				listUserExtensions: async () => []
			});

			const planB = plan.createSyncPlan({
				localSnapshot: snapB,
				remoteFiles: remoteParsed.files,
				remoteManifest: remoteParsed.manifest,
				base: null
			});

			assert.equal(planB.action, 'downloadFirst');
			assert.deepEqual(planB.extensionsDiff.toInstall, ['esbenp.prettier-vscode', 'ms-dotnettools.csharp']);

			// 4. Computador B aplica os arquivos
			await fs.promises.mkdir(path.join(tempB, 'snippets'), { recursive: true });
			await fs.promises.writeFile(path.join(tempB, 'settings.json'), remoteParsed.files['settings.json'], 'utf8');
			await fs.promises.writeFile(path.join(tempB, 'keybindings.json'), remoteParsed.files['keybindings.json'], 'utf8');
			await fs.promises.writeFile(path.join(tempB, 'snippets', 'csharp.json'), remoteParsed.files['snippets--csharp.json'], 'utf8');

			// 5. Verifica se os conteudos no Computador B sao identicos ao Computador A
			const contentSettingsB = await fs.promises.readFile(path.join(tempB, 'settings.json'), 'utf8');
			const contentKeybindingsB = await fs.promises.readFile(path.join(tempB, 'keybindings.json'), 'utf8');
			const contentSnippetB = await fs.promises.readFile(path.join(tempB, 'snippets', 'csharp.json'), 'utf8');

			assert.equal(contentSettingsB, snapA.files['settings.json']);
			assert.equal(contentKeybindingsB, snapA.files['keybindings.json']);
			assert.equal(contentSnippetB, snapA.files['snippets--csharp.json']);
		});
	});

	describe('8. Correcoes da Revisao da Fase 1 (Apendice E1 a E5)', () => {
		let fake;

		before(async () => {
			fake = createFakeGitHub();
			await fake.start();
		});

		after(async () => {
			if (fake) {
				await fake.stop();
			}
		});

		beforeEach(() => {
			if (fake) {
				fake.reset();
			}
		});

		test('E1: remove senhas em PT, credenciais em URL e chaves em valores retornando lista de omitidos', () => {
			const settings = `{
	// Fonte normal
	"editor.fontSize": 14,
	// Senha em portugues
	"segredo": "12345",
	"auth": {
		"senha": "minha-senha-secreta",
		"usuario": "alessandro"
	},
	// URL com usuario e senha
	"http.proxy": "http://usuario:senha@proxy:8080",
	// Token em valor de texto
	"anthropic.key": "sk-ant-api03-abcdef1234567890",
	"github.token": "ghp_1234567890abcdef1234567890",
	"workbench.colorTheme": "AgenteCode Deep Teal Clean"
}`;

			const { text: filtered, omitted } = exclusions.filterSettings(settings);

			// Deve manter itens legitimos e comentarios
			assert.ok(filtered.includes('editor.fontSize'));
			assert.ok(filtered.includes('Fonte normal'));
			assert.ok(filtered.includes('usuario'));
			assert.ok(filtered.includes('alessandro'));
			assert.ok(filtered.includes('workbench.colorTheme'));

			// Nao deve conter segredos
			assert.ok(!filtered.includes('segredo'));
			assert.ok(!filtered.includes('12345'));
			assert.ok(!filtered.includes('senha'));
			assert.ok(!filtered.includes('minha-senha-secreta'));
			assert.ok(!filtered.includes('http://usuario:senha@proxy:8080'));
			assert.ok(!filtered.includes('sk-ant-'));
			assert.ok(!filtered.includes('ghp_'));

			// Confere a lista de chaves omitidas
			assert.ok(omitted.includes('segredo'));
			assert.ok(omitted.includes('auth.senha'));
			assert.ok(omitted.includes('http.proxy'));
			assert.ok(omitted.includes('anthropic.key'));
			assert.ok(omitted.includes('github.token'));

			// Deve ser um JSONC valido
			const parsed = jsonc.parseJsonc(filtered);
			assert.equal(parsed['editor.fontSize'], 14);
			assert.equal(parsed.auth.usuario, 'alessandro');
			assert.equal(parsed.auth.senha, undefined);
			assert.equal(parsed['http.proxy'], undefined);
			assert.equal(parsed['anthropic.key'], undefined);
		});

		test('E1: filterKeybindings e filterSnippets removem itens com credenciais', () => {
			const keybindings = `[
	{
		"key": "ctrl+k ctrl+s",
		"command": "workbench.action.openGlobalKeybindings"
	},
	{
		"key": "ctrl+shift+x",
		"command": "custom.secretCommand",
		"args": {
			"token": "ghp_secrettoken1234567890"
		}
	}
]`;
			const resKeybindings = exclusions.filterKeybindings(keybindings);
			assert.ok(!resKeybindings.text.includes('ghp_secrettoken1234567890'));
			assert.ok(resKeybindings.text.includes('workbench.action.openGlobalKeybindings'));
			assert.ok(resKeybindings.omitted.length > 0);

			const snippets = `{
	"Snippet Seguro": {
		"prefix": "seguro",
		"body": ["console.log('ola');"],
		"description": "Log simples"
	},
	"Snippet Inseguro": {
		"prefix": "inseguro",
		"body": ["const apiKey = 'sk-ant-api03-abcdef1234567890';"],
		"description": "Vazamento de chave"
	}
}`;
			const resSnippets = exclusions.filterSnippets(snippets);
			assert.ok(!resSnippets.text.includes('sk-ant-api03-abcdef1234567890'));
			assert.ok(!resSnippets.text.includes('Snippet Inseguro'));
			assert.ok(resSnippets.text.includes('Snippet Seguro'));
			assert.ok(resSnippets.omitted.includes('Snippet Inseguro'));
		});

		test('E2: dono do Gist vs terceiro exige confirmacao e desativa envio automatico', () => {
			const gistSameOwner = { owner: { login: 'alessandrolobo' } };
			const gistOtherOwner = { owner: { login: 'hacker123' } };

			assert.equal(gistClient.isGistOwner(gistSameOwner, 'alessandrolobo'), true);
			assert.equal(gistClient.isGistOwner(gistOtherOwner, 'alessandrolobo'), false);

			const localSnap = { files: { 'settings.json': '{}' }, fileHashes: {}, extensions: [] };
			const remoteFiles = { 'settings.json': '{"theme":"dark"}' };

			// Plano para Gist de terceiro sem confirmacao
			const planThirdParty = plan.createSyncPlan({
				localSnapshot: localSnap,
				remoteFiles,
				gist: gistOtherOwner,
				currentLogin: 'alessandrolobo',
				isConfirmedThirdParty: false
			});

			assert.equal(planThirdParty.isThirdParty, true);
			assert.equal(planThirdParty.canAutoSync, false);
			assert.equal(planThirdParty.requiresThirdPartyConfirmation, true);
			assert.ok(planThirdParty.warning.includes('não é seu'));

			// Plano para Gist de terceiro com confirmacao explicita
			const planConfirmed = plan.createSyncPlan({
				localSnapshot: localSnap,
				remoteFiles,
				gist: gistOtherOwner,
				currentLogin: 'alessandrolobo',
				isConfirmedThirdParty: true
			});

			assert.equal(planConfirmed.isThirdParty, true);
			assert.equal(planConfirmed.canAutoSync, false);
			assert.equal(planConfirmed.requiresThirdPartyConfirmation, false);
		});

		test('E2: path traversal em snippets e rejeitado no restore e resolvePath', () => {
			// Testes exigidos no Apendice E2: manifesto com ..\\..\\evil.js, nome com /, com \\, vazio, so pontos
			assert.equal(snapshot.restoreSnippetName('snippets--evil.json', { 'snippets--evil.json': '../../evil.js' }), null);
			assert.equal(snapshot.restoreSnippetName('snippets--evil.json', { 'snippets--evil.json': 'sub/snippet.json' }), null);
			assert.equal(snapshot.restoreSnippetName('snippets--evil.json', { 'snippets--evil.json': 'sub\\snippet.json' }), null);
			assert.equal(snapshot.restoreSnippetName('snippets--evil.json', { 'snippets--evil.json': '' }), null);
			assert.equal(snapshot.restoreSnippetName('snippets--evil.json', { 'snippets--evil.json': '.' }), null);
			assert.equal(snapshot.restoreSnippetName('snippets--evil.json', { 'snippets--evil.json': '..' }), null);
			assert.equal(snapshot.restoreSnippetName('snippets--evil.json', { 'snippets--evil.json': '...' }), null);
			assert.equal(snapshot.restoreSnippetName('snippets--evil.json', { 'snippets--evil.json': 'arquivo.exe' }), null);

			// Nome valido
			assert.equal(snapshot.restoreSnippetName('snippets--python.json', { 'snippets--python.json': 'python.json' }), 'python.json');
			assert.equal(snapshot.restoreSnippetName('snippets--csharp.code-snippets'), 'csharp.code-snippets');

			// resolveSnippetPath garante que caminho fica dentro da pasta snippets/
			const snippetsDir = path.join(os.tmpdir(), 'ac-test-snippets');
			assert.equal(snapshot.resolveSnippetPath(snippetsDir, '../../evil.js'), null);
			assert.equal(snapshot.resolveSnippetPath(snippetsDir, 'csharp.json'), path.resolve(snippetsDir, 'csharp.json'));
		});

		test('E3: arquivo truncado com falha de raw_url lanca GistError TRUNCATED e nao envia token', async () => {
			fake.setFailRawUrl(true);

			const created = fake.addGist({
				description: `Gist truncado ${config.GIST_MARKER}`,
				public: false,
				files: {
					'settings.json': {
						content: '{"cortado": true',
						truncated: true
					}
				}
			});

			await assert.rejects(
				() => gistClient.getGist('gho_valid_token_123', created.id, {
					apiBaseUrl: fake.getApiBaseUrl()
				}),
				err => {
					assert.ok(err instanceof gistClient.GistError);
					assert.equal(err.code, 'TRUNCATED');
					return true;
				}
			);

			// Verifica se a requisicao ao raw_url foi feita SEM enviar o token no header
			const rawHeaders = fake.getLastRawHeaders();
			assert.ok(rawHeaders);
			assert.equal(rawHeaders.authorization, undefined);
		});

		test('E4: 403 Forbidden lanca GistForbiddenError e 403 RateLimit lanca RateLimitError', async () => {
			fake.setScenario('forbidden');

			await assert.rejects(
				() => gistClient.findSyncGist('gho_test_token', {
					apiBaseUrl: fake.getApiBaseUrl()
				}),
				err => {
					assert.ok(err instanceof gistClient.GistForbiddenError);
					assert.equal(err.code, 'FORBIDDEN');
					assert.equal(err.status, 403);
					return true;
				}
			);

			fake.setScenario('forbidden_rate_limit');

			await assert.rejects(
				() => gistClient.findSyncGist('gho_test_token', {
					apiBaseUrl: fake.getApiBaseUrl()
				}),
				err => {
					assert.ok(err instanceof gistClient.RateLimitError);
					assert.equal(err.code, 'RATE_LIMIT_EXCEEDED');
					return true;
				}
			);
		});

		test('E5: base ausente ou invalida tratada como downloadFirst e hash ignora manifesto e leia-me', () => {
			const localSnap = {
				files: { 'settings.json': '{"a":1}' },
				fileHashes: { 'settings.json': 'h1' },
				compositeHash: 'comp_local',
				extensions: []
			};
			const remoteFiles1 = {
				'settings.json': '{"a":1}',
				'agentecode-sync.json': '{"schema":1}',
				'LEIA-ME.md': '# Sync v1'
			};
			const remoteFiles2 = {
				'settings.json': '{"a":1}',
				'agentecode-sync.json': '{"schema":2, "outro": true}',
				'LEIA-ME.md': '# Sync v2 diferente'
			};

			// Base invalida (objeto vazio sem localHash nem files)
			const planInvalidBase = plan.createSyncPlan({
				localSnapshot: localSnap,
				remoteFiles: remoteFiles1,
				base: {}
			});
			assert.equal(planInvalidBase.action, 'downloadFirst');

			// Base valida: como apenas agentecode-sync.json e LEIA-ME.md mudaram entre remoteFiles1 e remoteFiles2,
			// o hash de fallback do remoto nao deve mudar (nada a fazer)
			const singleFileHash = snapshot.sha256('settings.json:' + snapshot.sha256('{"a":1}') + '\n');
			const plan1 = plan.createSyncPlan({
				localSnapshot: localSnap,
				remoteFiles: remoteFiles1,
				base: { localHash: 'comp_local', manifestHash: singleFileHash }
			});
			assert.equal(plan1.action, 'nothing');

			const plan2 = plan.createSyncPlan({
				localSnapshot: localSnap,
				remoteFiles: remoteFiles2,
				base: { localHash: 'comp_local', manifestHash: singleFileHash }
			});
			assert.equal(plan2.action, 'nothing');
		});

		test('E5: pollForToken tolera erro 500 transitorio e espera antes da consulta', async () => {
			fake.setScenario('transient_500_then_success');

			let sleepCalls = 0;
			const res = await githubAuth.pollForToken({
				clientId: 'test_client',
				deviceCode: 'code_500',
				interval: 1,
				expiresIn: 10,
				baseUrl: fake.getBaseUrl(),
				sleepFn: async () => { sleepCalls++; }
			});

			assert.ok(res.accessToken);
			// Esperou interval antes da tentativa 1 e antes da tentativa 2
			assert.ok(sleepCalls >= 2);
		});

		test('E5: normalizacao estetica de jsonc e acentos no README_CONTENT', () => {
			const text = `{
	// comentario
	"removido": 123
}`;
			const stripped = jsonc.stripTopLevelProperties(text, ['removido']);
			// Nao deve conter chaves com espacos desnecessarios nem virgulas invalidas
			assert.ok(!stripped.includes('removido'));

			// README_CONTENT tem acentuacao em pt-BR
			assert.ok(config.README_CONTENT.includes('configurações'));
			assert.ok(config.README_CONTENT.includes('é **secreto**'));
			assert.ok(config.README_CONTENT.includes('não aparece'));
			assert.ok(config.README_CONTENT.includes('poderá'));
		});
	});

});
