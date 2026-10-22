/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const config = require('./config');
const { stripProperties, tokenize } = require('./jsonc');

/**
 * Avalia se um valor de texto contem credenciais, tokens ou chaves secretas (defesa em profundidade).
 * @param {any} value
 * @returns {boolean}
 */
function isSensitiveValue(value) {
	if (typeof value === 'string') {
		for (const pattern of config.VALUE_SECRET_PATTERNS) {
			if (pattern.test(value)) {
				return true;
			}
		}
		return false;
	}
	if (Array.isArray(value)) {
		return value.some(item => isSensitiveValue(item));
	}
	return false;
}

/**
 * Cria o objeto de retorno com o texto filtrado e a lista de itens omitidos.
 * Mantem compatibilidade com quem trata o retorno diretamente como string.
 * @param {string} text
 * @param {string[]} omitted
 */
function createFilterResult(text, omitted) {
	const res = {
		text,
		omitted,
		includes: (searchString, position) => text.includes(searchString, position),
		indexOf: (searchString, position) => text.indexOf(searchString, position),
		slice: (start, end) => text.slice(start, end),
		trim: () => text.trim(),
		toString: () => text,
		[Symbol.toPrimitive]: () => text
	};
	return res;
}

/**
 * Determina se uma chave de configuracao deve ser excluida da sincronizacao.
 * @param {string} keyPath Caminho completo da chave (ex.: 'claudeCode.environmentVariables' ou 'servico.apiKey')
 * @param {string} keyName Nome individual da chave (ex.: 'apiKey')
 * @param {any} [value] Valor da propriedade (para escaneamento em profundidade de segredos)
 * @param {string[]} [customExclusions] Lista adicional de exclusoes do usuario
 * @returns {boolean}
 */
function isExcludedSetting(keyPath, keyName, value = null, customExclusions = []) {
	// Trata argumentos flexiveis caso customExclusions seja passado como 3o argumento
	let exclusionsList = customExclusions;
	let val = value;
	if (Array.isArray(value)) {
		// se for array de strings passado na posicao 3, e customExclusions
		if (value.length > 0 && typeof value[0] === 'string' && customExclusions.length === 0) {
			// Pode ser customExclusions se chamado com 3 parametros
		}
	}

	const allExact = new Set([
		...config.EXCLUDED_SETTINGS_DEFAULT,
		...config.KNOWN_MACHINE_PATHS,
		...(Array.isArray(exclusionsList) ? exclusionsList : [])
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

	// 3. Checagem por padroes de segredos/tokens/senhas no nome da chave ou caminho
	for (const pattern of config.EXCLUDED_SETTING_PATTERNS) {
		if (pattern.test(keyName) || pattern.test(keyPath)) {
			return true;
		}
	}

	// 4. Checagem de valores sensiveis (defesa em profundidade)
	if (val !== null && val !== undefined && isSensitiveValue(val)) {
		return true;
	}

	return false;
}

/**
 * Filtra o texto de configuracoes em JSONC, removendo chaves sensiveis e locais.
 * Preserva formatacao, comentarios e as demais propriedades intactas.
 * Retorna o texto filtrado e a lista de chaves omitidas por seguranca.
 *
 * @param {string} settingsJsonc
 * @param {string[]} [customExclusions]
 * @returns {{ text: string, omitted: string[], toString: () => string }}
 */
function filterSettings(settingsJsonc, customExclusions = []) {
	if (typeof settingsJsonc !== 'string' || !settingsJsonc.trim()) {
		return createFilterResult(settingsJsonc || '', []);
	}

	const omitted = [];
	const filtered = stripProperties(settingsJsonc, (keyPath, keyName, isTopLevel, val) => {
		const mustExclude = isExcludedSetting(keyPath, keyName, val, customExclusions);
		if (mustExclude) {
			omitted.push(keyPath || keyName);
		}
		return mustExclude;
	});

	return createFilterResult(filtered, omitted);
}

/**
 * Filtra atalhos de teclado (keybindings.json), removendo entradas que contenham
 * segredos ou credenciais em comandos ou argumentos.
 *
 * @param {string} keybindingsJsonc
 * @returns {{ text: string, omitted: string[], toString: () => string }}
 */
function filterKeybindings(keybindingsJsonc) {
	if (typeof keybindingsJsonc !== 'string' || !keybindingsJsonc.trim()) {
		return createFilterResult(keybindingsJsonc || '', []);
	}

	const omitted = [];
	const filtered = stripProperties(keybindingsJsonc, (keyPath, keyName, isTopLevel, val) => {
		// Se qualquer string contida no item do keybinding for sensivel
		if (val && isSensitiveValue(val)) {
			const label = Array.isArray(val) ? (val.find(s => s && s.length < 50) || 'keybinding') : 'keybinding';
			omitted.push(`keybinding:${label}`);
			return true;
		}
		return false;
	});

	return createFilterResult(filtered, omitted);
}

/**
 * Filtra snippets de codigo, removendo definicoes de snippets cujos corpos,
 * prefixos ou descricoes contenham segredos ou tokens.
 *
 * @param {string} snippetJsonc
 * @returns {{ text: string, omitted: string[], toString: () => string }}
 */
function filterSnippets(snippetJsonc) {
	if (typeof snippetJsonc !== 'string' || !snippetJsonc.trim()) {
		return createFilterResult(snippetJsonc || '', []);
	}

	const omitted = [];
	const filtered = stripProperties(snippetJsonc, (keyPath, keyName, isTopLevel, val) => {
		// Em snippets, keyName no nivel raiz e o nome do snippet
		if (isSensitiveValue(val) || (keyName && isExcludedSetting(keyPath, keyName, null, []))) {
			omitted.push(keyName || keyPath);
			return true;
		}
		return false;
	});

	return createFilterResult(filtered, omitted);
}

/**
 * Lista as propriedades de nivel raiz de um objeto JSONC, com o texto bruto de cada uma.
 * @param {string} text
 * @returns {{ key: string, raw: string, strings: string[] }[]}
 */
function extractTopLevelProperties(text) {
	const tokens = tokenize(text);
	const sig = tokens.filter(t => t.type !== 'whitespace' && t.type !== 'line-comment' && t.type !== 'block-comment');
	const result = [];
	let depth = 0;
	let i = 0;
	for (; i < sig.length; i++) {
		if (sig[i].value === '{' && sig[i].type !== 'string') {
			depth = 1;
			i++;
			break;
		}
	}
	while (i < sig.length && depth === 1) {
		const keyTok = sig[i];
		if (keyTok.type !== 'string') {
			if (keyTok.value === '}') {
				break;
			}
			i++;
			continue;
		}
		const colon = sig[i + 1];
		if (!colon || colon.value !== ':') {
			i++;
			continue;
		}
		let j = i + 2;
		let nested = 0;
		const strings = [];
		for (; j < sig.length; j++) {
			const t = sig[j];
			if (t.type === 'string') {
				if (nested > 0) {
					strings.push(t.value);
				} else if (j === i + 2) {
					strings.push(t.value);
				}
				continue;
			}
			if (t.value === '{' || t.value === '[') {
				nested++;
			} else if (t.value === '}' || t.value === ']') {
				if (nested === 0) {
					break;
				}
				nested--;
			} else if (t.value === ',' && nested === 0) {
				break;
			}
		}
		const last = sig[j - 1];
		result.push({ key: keyTok.value, raw: text.slice(keyTok.start, last.end), strings });
		i = j + (sig[j] && sig[j].value === ',' ? 1 : 0);
	}
	return result;
}

/**
 * Reinsere no texto remoto as propriedades de nivel raiz do settings local que o filtro
 * de envio omite (segredos, caminhos da maquina, config do proprio sync). Assim, baixar
 * nao apaga configuracoes que nunca sairam deste computador. O valor local prevalece.
 *
 * @param {string} remoteText
 * @param {string} localText
 * @param {string[]} [customExclusions]
 * @returns {string}
 */
function mergeExcludedSettings(remoteText, localText, customExclusions = []) {
	if (typeof localText !== 'string' || !localText.trim()) {
		return remoteText;
	}
	if (typeof remoteText !== 'string' || !remoteText.trim()) {
		remoteText = '{\n}\n';
	}

	// Pega o texto bruto de cada propriedade excluida do nivel raiz
	const props = extractTopLevelProperties(localText);
	const excluded = props.filter(p => isExcludedSetting(p.key, p.key, p.strings.length === 1 ? p.strings[0] : p.strings, customExclusions));
	if (excluded.length === 0) {
		return remoteText;
	}
	const inner = excluded.map(p => p.raw).join(',\n\t');
	const localKeys = new Set(excluded.map(p => p.key));
	const cleanedRemote = stripProperties(remoteText, (keyPath, keyName, isTopLevel) => isTopLevel && localKeys.has(keyName));

	const rOpen = cleanedRemote.indexOf('{');
	const rClose = cleanedRemote.lastIndexOf('}');
	if (rOpen === -1 || rClose <= rOpen) {
		return remoteText;
	}
	const head = cleanedRemote.slice(0, rClose).replace(/\s+$/, '');
	const needsComma = !/[{,]$/.test(head.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*$/, '').trimEnd());
	return `${head}${needsComma ? ',' : ''}\n\t${inner}\n${cleanedRemote.slice(rClose)}`;
}

module.exports = {
	mergeExcludedSettings,
	isSensitiveValue,
	isExcludedSetting,
	filterSettings,
	filterKeybindings,
	filterSnippets
};
