/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

/**
 * Notas de versao: o arquivo RELEASE_NOTES.md tem uma secao por versao, com titulo "## v1.2.3 - data".
 * Estas funcoes escolhem quais secoes mostrar. Sao usadas tambem pelo workflow de release (corpo da Release).
 */

/**
 * "Agente Code IDE v1.0.0", "v0.0.6-test" ou "1.2.3" -> [major, minor, patch].
 * @param {string | undefined | null} text
 * @returns {[number, number, number] | undefined}
 */
function parseVersion(text) {
	const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ''));
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** @returns {number} negativo se a < b, 0 se iguais, positivo se a > b */
function compareVersions(a, b) {
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) {
			return a[i] - b[i];
		}
	}
	return 0;
}

/**
 * Divide o arquivo em secoes de versao. Texto antes da primeira secao e ignorado.
 * @param {string} markdown
 * @returns {{ version: [number, number, number], text: string }[]}
 */
function parseSections(markdown) {
	const sections = [];
	let current;
	for (const line of String(markdown).replace(/\r\n/g, '\n').split('\n')) {
		if (/^##\s/.test(line)) {
			const version = parseVersion(line);
			current = version ? { version, lines: [line] } : undefined;
			if (current) {
				sections.push(current);
			}
		} else if (current) {
			current.lines.push(line);
		}
	}
	return sections.map(s => ({ version: s.version, text: s.lines.join('\n').trim() }));
}

/**
 * Secoes das versoes maiores que `lastSeen` e ate `current`, da mais nova para a mais antiga.
 * Sem `lastSeen`, so a da versao atual.
 * @param {string} markdown
 * @param {string | undefined} lastSeen
 * @param {string} current
 * @returns {string} texto em Markdown, vazio se nao houver nada a mostrar
 */
function notesBetween(markdown, lastSeen, current) {
	const to = parseVersion(current);
	if (!to) {
		return '';
	}
	const from = parseVersion(lastSeen);
	return parseSections(markdown)
		.filter(s => compareVersions(s.version, to) <= 0 && (!from || compareVersions(s.version, from) > 0))
		.sort((a, b) => compareVersions(b.version, a.version))
		.map(s => s.text)
		.join('\n\n');
}

/**
 * Secao de uma versao especifica (aceita tags como "v1.0.0" ou "v1.0.0-rc.1").
 * @param {string} markdown
 * @param {string} tag
 */
function sectionFor(markdown, tag) {
	const version = parseVersion(tag);
	return version ? parseSections(markdown).find(s => compareVersions(s.version, version) === 0)?.text ?? '' : '';
}

module.exports = { parseVersion, compareVersions, parseSections, notesBetween, sectionFor };
