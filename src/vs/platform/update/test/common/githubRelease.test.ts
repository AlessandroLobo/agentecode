/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { buildWindowsInstallScript, IGitHubRelease, isNewerVersion, parseChecksum, parseVersion, pickChecksumUrl, pickDownloadUrl, toUpdate } from '../../common/githubRelease.js';

suite('GitHub release helpers', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const release: IGitHubRelease = {
		tag_name: 'v1.2.0',
		html_url: 'https://github.com/agentecode/agentecode/releases/tag/v1.2.0',
		published_at: '2026-10-20T12:00:00Z',
		assets: [
			{ name: 'AgenteCodeSetup-x64-v1.2.0.exe.sha256', browser_download_url: 'https://example.test/setup.exe.sha256' },
			{ name: 'AgenteCodeSetup-x64-v1.2.0.exe', browser_download_url: 'https://example.test/setup.exe' },
			{ name: 'agentecode_1.2.0_amd64.deb', browser_download_url: 'https://example.test/pkg.deb' },
		]
	};

	test('parseVersion', () => {
		assert.deepStrictEqual(
			[parseVersion('Agente Code IDE v1.0.0'), parseVersion('v0.0.6-test'), parseVersion('sem versão')],
			[[1, 0, 0], [0, 0, 6], undefined]
		);
	});

	test('isNewerVersion compara numericamente e ignora versões ilegíveis', () => {
		assert.deepStrictEqual(
			[
				isNewerVersion('1.0.0', 'v1.0.1'),
				isNewerVersion('1.9.0', 'v1.10.0'),
				isNewerVersion('1.0.0', 'v1.0.0'),
				isNewerVersion('1.2.0', 'v1.1.9'),
				isNewerVersion('1.0.0', 'latest'),
				isNewerVersion(undefined, 'v2.0.0'),
			],
			[true, true, false, false, false, false]
		);
	});

	test('pickDownloadUrl escolhe o instalador da plataforma', () => {
		assert.deepStrictEqual(
			[pickDownloadUrl(release, 'win32'), pickDownloadUrl(release, 'linux'), pickDownloadUrl(release, 'darwin')],
			['https://example.test/setup.exe', 'https://example.test/pkg.deb', release.html_url]
		);
	});

	test('pickChecksumUrl só devolve o .sha256 do instalador da plataforma', () => {
		assert.deepStrictEqual(
			[pickChecksumUrl(release, 'win32'), pickChecksumUrl(release, 'linux'), pickChecksumUrl({ assets: [release.assets![1]] }, 'win32')],
			['https://example.test/setup.exe.sha256', undefined, undefined]
		);
	});

	test('parseChecksum lê o formato "hash  nome" e recusa o resto', () => {
		const hash = 'a'.repeat(64);
		assert.deepStrictEqual(
			[parseChecksum(`${hash.toUpperCase()}  AgenteCodeSetup-x64-v1.exe\n`), parseChecksum(hash), parseChecksum('abc  x'), parseChecksum(`<html>${hash}`), parseChecksum(null)],
			[hash, hash, undefined, undefined, undefined]
		);
	});

	test('buildWindowsInstallScript espera a IDE fechar, protege aspas e reabre a IDE', () => {
		assert.deepStrictEqual(
			buildWindowsInstallScript(`C:\\Users\\o'brien\\Temp\\Setup.exe`, 4321),
			`$ErrorActionPreference = 'SilentlyContinue'; Wait-Process -Id 4321 -Timeout 300; Start-Sleep -Seconds 2; Start-Process -FilePath 'C:\\Users\\o''brien\\Temp\\Setup.exe' -ArgumentList '/SILENT', '/NORESTART', '/MERGETASKS=runcode,!desktopicon,!quicklaunchicon'`
		);
	});

	test('toUpdate só devolve quando a Release é mais nova', () => {
		assert.deepStrictEqual(toUpdate(release, '1.0.0', 'win32'), {
			version: 'v1.2.0',
			productVersion: '1.2.0',
			timestamp: Date.parse('2026-10-20T12:00:00Z'),
			url: 'https://example.test/setup.exe',
			releaseUrl: release.html_url,
			sha256Url: 'https://example.test/setup.exe.sha256',
		});
		assert.strictEqual(toUpdate(release, '1.2.0', 'win32'), undefined);
		assert.strictEqual(toUpdate({}, '1.0.0', 'win32'), undefined);
	});
});
