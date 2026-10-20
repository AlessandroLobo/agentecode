/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

import { IUpdate } from './update.js';

/**
 * Subconjunto da resposta de `GET /repos/{owner}/{repo}/releases/latest` usado pelo AgenteCode.
 */
export interface IGitHubRelease {
	readonly tag_name?: string;
	readonly html_url?: string;
	readonly published_at?: string;
	readonly assets?: readonly { readonly name: string; readonly browser_download_url: string }[];
}

/**
 * Extrai `[major, minor, patch]` de textos como `v1.2.3`, `Agente Code IDE v1.0.0` ou `v0.0.6-test`.
 * Sufixos de pré-lançamento são ignorados.
 */
export function parseVersion(text: string | undefined): [number, number, number] | undefined {
	const match = /(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)/.exec(text ?? '');
	if (!match?.groups) {
		return undefined;
	}
	return [Number(match.groups.major), Number(match.groups.minor), Number(match.groups.patch)];
}

/**
 * `true` se `latest` for maior que `current`. Versões ilegíveis nunca indicam atualização.
 */
export function isNewerVersion(current: string | undefined, latest: string | undefined): boolean {
	const a = parseVersion(current);
	const b = parseVersion(latest);
	if (!a || !b) {
		return false;
	}
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) {
			return b[i] > a[i];
		}
	}
	return false;
}

function pickInstallerAsset(release: IGitHubRelease, platform: string) {
	const pattern = platform === 'win32' ? /^AgenteCodeSetup-x64.*\.exe$/i : platform === 'linux' ? /\.deb$/i : undefined;
	return pattern ? release.assets?.find(a => pattern.test(a.name)) : undefined;
}

/**
 * Escolhe o instalador da plataforma entre os anexos da Release; sem correspondência, a página da Release.
 */
export function pickDownloadUrl(release: IGitHubRelease, platform: string): string | undefined {
	return pickInstallerAsset(release, platform)?.browser_download_url ?? release.html_url;
}

/**
 * URL do arquivo `<instalador>.sha256` anexado pelo workflow de release, quando existe.
 */
export function pickChecksumUrl(release: IGitHubRelease, platform: string): string | undefined {
	const installer = pickInstallerAsset(release, platform);
	return installer ? release.assets?.find(a => a.name === `${installer.name}.sha256`)?.browser_download_url : undefined;
}

/**
 * Lê o SHA-256 (64 caracteres hexadecimais) de um arquivo `.sha256` no formato "hash  nome".
 */
export function parseChecksum(text: string | null | undefined): string | undefined {
	const match = /^\s*(?<hash>[0-9a-fA-F]{64})(?:\s|$)/.exec(text ?? '');
	return match?.groups?.hash.toLowerCase();
}

/**
 * `IUpdate` com o que o AgenteCode precisa para baixar e instalar dentro da IDE.
 */
export interface IGitHubUpdate extends IUpdate {
	/** Página da Release, usada quando o download dentro da IDE não é possível. */
	readonly releaseUrl?: string;
	/** Arquivo `.sha256` anexado ao instalador. Sem ele, o download dentro da IDE não é usado. */
	readonly sha256Url?: string;
}

/**
 * Converte uma Release do GitHub em atualização, ou `undefined` quando ela não é mais nova que `currentVersion`.
 */
export function toUpdate(release: IGitHubRelease, currentVersion: string | undefined, platform: string): IGitHubUpdate | undefined {
	const tag = release.tag_name;
	if (!tag || !isNewerVersion(currentVersion, tag)) {
		return undefined;
	}
	const timestamp = release.published_at ? Date.parse(release.published_at) : NaN;
	return {
		version: tag,
		productVersion: parseVersion(tag)?.join('.'),
		timestamp: isNaN(timestamp) ? undefined : timestamp,
		url: pickDownloadUrl(release, platform),
		releaseUrl: release.html_url,
		sha256Url: pickChecksumUrl(release, platform),
	};
}

/** Argumentos do instalador (Inno Setup): sem perguntas, sem reiniciar o Windows, e reabre a IDE no fim. */
export const WINDOWS_INSTALLER_ARGS = ['/SILENT', '/NORESTART', '/MERGETASKS=runcode,!desktopicon,!quicklaunchicon'];

/**
 * Script PowerShell que espera a IDE (processo `mainPid`) terminar e só então executa o instalador.
 * Assim o instalador nunca encontra a IDE aberta e a nova versão abre sozinha ao fim da instalação.
 */
export function buildWindowsInstallScript(installerPath: string, mainPid: number): string {
	const quote = (value: string) => `'${value.replace(/'/g, `''`)}'`;
	return [
		`$ErrorActionPreference = 'SilentlyContinue'`,
		`Wait-Process -Id ${Math.trunc(mainPid)} -Timeout 300`,
		'Start-Sleep -Seconds 2',
		`Start-Process -FilePath ${quote(installerPath)} -ArgumentList ${WINDOWS_INSTALLER_ARGS.map(quote).join(', ')}`,
	].join('; ');
}
