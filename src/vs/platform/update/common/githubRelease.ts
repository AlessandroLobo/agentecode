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

/**
 * Escolhe o instalador da plataforma entre os anexos da Release; sem correspondência, a página da Release.
 */
export function pickDownloadUrl(release: IGitHubRelease, platform: string): string | undefined {
	const pattern = platform === 'win32' ? /^AgenteCodeSetup-x64.*\.exe$/i : platform === 'linux' ? /\.deb$/i : undefined;
	const asset = pattern ? release.assets?.find(a => pattern.test(a.name)) : undefined;
	return asset?.browser_download_url ?? release.html_url;
}

/**
 * Converte uma Release do GitHub em `IUpdate`, ou `undefined` quando ela não é mais nova que `currentVersion`.
 */
export function toUpdate(release: IGitHubRelease, currentVersion: string | undefined, platform: string): IUpdate | undefined {
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
	};
}
