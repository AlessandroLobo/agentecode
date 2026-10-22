/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const config = require('./config');
const { stripProperties } = require('./jsonc');

/**
 * Determina se uma chave de configuracao deve ser excluida da sincronizacao.
 * @param {string} keyPath Caminho completo da chave (ex.: 'claudeCode.environmentVariables' ou 'servico.apiKey')
 * @param {string} keyName Nome individual da chave (ex.: 'apiKey')
 * @param {string[]} [customExclusions] Lista adicional de exclusoes do usuario
 * @returns {boolean}
 */
function isExcludedSetting(keyPath, keyName, customExclusions = []) {
	const allExact = new Set([
		...config.EXCLUDED_SETTINGS_DEFAULT,
		...config.KNOWN_MACHINE_PATHS,
		...customExclusions
	]);

	// 1. Checagem exata por caminho completo ou nome individual
	if (allExact.has(keyPath) || allExact.has(keyName)) {
		return true;
	}

	// 2. Checagem por prefixo (ex.: 'agentecode.sync.')
	for (const prefix of config.EXCLUDED_SETTING_PREFIXES) {
		if (keyPath.startsWith(prefix)) {
			return true;
		}
	}

	// 3. Checagem por padroes de segredos/tokens/senhas
	for (const pattern of config.EXCLUDED_SETTING_PATTERNS) {
		if (pattern.test(keyName) || pattern.test(keyPath)) {
			return true;
		}
	}

	return false;
}

/**
 * Filtra o texto de configuracoes em JSONC, removendo chaves sensiveis e locais.
 * Preserva formatacao, comentarios e as demais propriedades intactas.
 * @param {string} settingsJsonc
 * @param {string[]} [customExclusions]
 * @returns {string}
 */
function filterSettings(settingsJsonc, customExclusions = []) {
	if (typeof settingsJsonc !== 'string' || !settingsJsonc.trim()) {
		return settingsJsonc;
	}
	return stripProperties(settingsJsonc, (keyPath, keyName) => isExcludedSetting(keyPath, keyName, customExclusions));
}

module.exports = {
	isExcludedSetting,
	filterSettings
};
