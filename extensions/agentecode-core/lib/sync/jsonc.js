/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

/**
 * Scanner e manipulador tolerante de JSONC (JSON with Comments).
 * Suporta comentarios de linha (//), de bloco (/* *\/) e virgulas finais (trailing commas).
 * Permite remover propriedades de topo e aninhadas preservando a formatacao restante.
 */

/**
 * Divide o texto JSONC em uma lista de tokens com posicoes originais.
 * @param {string} text
 * @returns {Array<{ type: string, value: string, raw: string, start: number, end: number }>}
 */
function tokenize(text) {
	const tokens = [];
	let i = 0;
	const len = text.length;

	while (i < len) {
		const start = i;
		const ch = text[i];
		const next = text[i + 1];

		// Espacos e quebras de linha
		if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
			while (i < len && (text[i] === ' ' || text[i] === '\t' || text[i] === '\r' || text[i] === '\n')) {
				i++;
			}
			tokens.push({ type: 'whitespace', raw: text.slice(start, i), start, end: i });
			continue;
		}

		// Comentario de linha: // ... \n
		if (ch === '/' && next === '/') {
			i += 2;
			while (i < len && text[i] !== '\n') {
				i++;
			}
			if (i < len && text[i] === '\n') {
				i++; // consome o \n
			}
			tokens.push({ type: 'line-comment', raw: text.slice(start, i), start, end: i });
			continue;
		}

		// Comentario de bloco: /* ... */
		if (ch === '/' && next === '*') {
			i += 2;
			while (i < len && !(text[i] === '*' && text[i + 1] === '/')) {
				i++;
			}
			if (i < len) {
				i += 2; // consome */
			}
			tokens.push({ type: 'block-comment', raw: text.slice(start, i), start, end: i });
			continue;
		}

		// String: "..."
		if (ch === '"') {
			i++;
			let escaped = false;
			while (i < len) {
				const c = text[i];
				if (escaped) {
					escaped = false;
				} else if (c === '\\') {
					escaped = true;
				} else if (c === '"') {
					i++;
					break;
				}
				i++;
			}
			const raw = text.slice(start, i);
			let value;
			try {
				value = JSON.parse(raw);
			} catch {
				value = raw.slice(1, -1);
			}
			tokens.push({ type: 'string', value, raw, start, end: i });
			continue;
		}

		// Pontuacao
		if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ':' || ch === ',') {
			i++;
			tokens.push({ type: 'punct', value: ch, raw: ch, start, end: i });
			continue;
		}

		// Palavras-chave ou numeros
		while (i < len && !' \t\r\n/{}[],:"'.includes(text[i])) {
			i++;
		}
		const raw = text.slice(start, i);
		let val = raw;
		if (raw === 'true') {
			val = true;
		} else if (raw === 'false') {
			val = false;
		} else if (raw === 'null') {
			val = null;
		} else if (!Number.isNaN(Number(raw))) {
			val = Number(raw);
		}
		tokens.push({ type: 'literal', value: val, raw, start, end: i });
	}

	return tokens;
}

/**
 * Converte JSONC em texto JSON puro e compativel com JSON.parse
 * substituindo comentarios e virgulas finais por espacos.
 * @param {string} text
 * @returns {string}
 */
function cleanJsoncForParse(text) {
	const tokens = tokenize(text);
	let clean = '';
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		if (tok.type === 'line-comment') {
			// preserva quebras de linha para manter a contagem de linhas
			clean += tok.raw.endsWith('\n') ? '\n' : ' ';
		} else if (tok.type === 'block-comment') {
			clean += tok.raw.replace(/[^\r\n]/g, ' ');
		} else if (tok.type === 'punct' && tok.value === ',') {
			// Checa se a proxima pontuacao significativa e '}' ou ']' (virgula final)
			let isTrailing = false;
			for (let j = i + 1; j < tokens.length; j++) {
				const next = tokens[j];
				if (next.type === 'whitespace' || next.type === 'line-comment' || next.type === 'block-comment') {
					continue;
				}
				if (next.type === 'punct' && (next.value === '}' || next.value === ']')) {
					isTrailing = true;
				}
				break;
			}
			clean += isTrailing ? ' ' : ',';
		} else {
			clean += tok.raw;
		}
	}
	return clean;
}

/**
 * Leitura tolerante de JSONC.
 * @param {string} text
 * @returns {any}
 */
function parseJsonc(text) {
	if (text && typeof text === 'object' && typeof text.text === 'string') {
		text = text.text;
	}
	if (typeof text !== 'string' || !text.trim()) {
		return {};
	}
	const clean = cleanJsoncForParse(text);
	return JSON.parse(clean);
}

/**
 * Remove propriedades de um texto JSONC de acordo com a funcao predicate.
 * Preserva comentarios e formatacao das propriedades restantes.
 * @param {string} text
 * @param {(keyPath: string, keyName: string) => boolean} shouldExcludeFn
 * @returns {string}
 */
function stripProperties(text, shouldExcludeFn) {
	if (typeof text !== 'string' || !text.trim()) {
		return text;
	}

	const tokens = tokenize(text);
	let tokenIndex = 0;

	// Pula espacos e comentarios iniciais ate a primeira pontuacao
	function nextSignificant(idx = tokenIndex) {
		while (idx < tokens.length) {
			const t = tokens[idx];
			if (t.type !== 'whitespace' && t.type !== 'line-comment' && t.type !== 'block-comment') {
				return idx;
			}
			idx++;
		}
		return -1;
	}

	const rangesToRemove = [];

	/**
	 * Processa um objeto JSON a partir de `{` e marca os intervalos de propriedades a remover.
	 * @param {string} currentPath
	 */
	function parseObject(currentPath) {
		const firstPunct = nextSignificant();
		if (firstPunct === -1 || tokens[firstPunct].value !== '{') {
			return;
		}
		tokenIndex = firstPunct + 1;

		let prevCommaIndex = -1;

		while (tokenIndex < tokens.length) {
			const sig = nextSignificant();
			if (sig === -1) {
				break;
			}
			if (tokens[sig].value === '}') {
				tokenIndex = sig + 1;
				break;
			}

			// Localiza comentarios colados imediatamente anteriores a esta propriedade
			let entryStartToken = sig;
			let backward = sig - 1;
			while (backward > (prevCommaIndex !== -1 ? prevCommaIndex : firstPunct)) {
				const t = tokens[backward];
				if (t.type === 'line-comment' || t.type === 'block-comment') {
					entryStartToken = backward;
					backward--;
				} else if (t.type === 'whitespace') {
					// se tiver mais de uma quebra de linha em branco entre o comentario e o item, para
					if (t.raw.includes('\n\n') || t.raw.includes('\r\n\r\n')) {
						break;
					}
					backward--;
				} else {
					break;
				}
			}

			// Chave da propriedade
			const keyTok = tokens[sig];
			if (keyTok.type !== 'string') {
				tokenIndex = sig + 1;
				continue;
			}
			const key = keyTok.value;
			const fullKeyPath = currentPath ? `${currentPath}.${key}` : key;

			// Procura dois pontos ':'
			tokenIndex = sig + 1;
			const colonSig = nextSignificant();
			if (colonSig === -1 || tokens[colonSig].value !== ':') {
				break;
			}
			tokenIndex = colonSig + 1;

			// Valor da propriedade
			const valSig = nextSignificant();
			if (valSig === -1) {
				break;
			}
			const valTok = tokens[valSig];

			// Avanca pelo valor (pode ser objeto ou array aninhado)
			let valEndIndex;
			if (valTok.value === '{') {
				parseObject(fullKeyPath);
				valEndIndex = tokenIndex;
			} else if (valTok.value === '[') {
				parseArray();
				valEndIndex = tokenIndex;
			} else {
				tokenIndex = valSig + 1;
				valEndIndex = tokenIndex;
			}

			// Checa virgula separadora apos o valor
			const commaSig = nextSignificant(valEndIndex);
			let commaIndex = -1;
			if (commaSig !== -1 && tokens[commaSig].value === ',') {
				commaIndex = commaSig;
				tokenIndex = commaSig + 1;
			} else {
				tokenIndex = valEndIndex;
			}

			// Extrai o valor escalar ou lista de strings contidas
			let propertyValue;
			if (valTok.type === 'string') {
				propertyValue = valTok.value;
			} else if (valTok.value === '{' || valTok.value === '[') {
				const innerStrings = [];
				for (let k = valSig; k < valEndIndex; k++) {
					if (tokens[k].type === 'string') {
						innerStrings.push(tokens[k].value);
					}
				}
				propertyValue = innerStrings;
			} else {
				propertyValue = valTok.value;
			}

			// Avalia se a propriedade deve ser excluida
			const isTopLevel = currentPath === '';
			const mustExclude = shouldExcludeFn(fullKeyPath, key, isTopLevel, propertyValue);
			if (mustExclude) {
				let startPos = tokens[entryStartToken].start;
				let endPos;

				if (commaIndex !== -1) {
					// Remove tambem a virgula posterior e qualquer espaco subsequente na mesma linha
					endPos = tokens[commaIndex].end;
					// se houver espaco logo apos a virgula, inclui
					if (commaIndex + 1 < tokens.length && tokens[commaIndex + 1].type === 'whitespace') {
						const ws = tokens[commaIndex + 1].raw;
						const nl = ws.indexOf('\n');
						if (nl !== -1) {
							endPos += nl + 1;
						} else {
							endPos += ws.length;
						}
					}
				} else if (prevCommaIndex !== -1) {
					// Ultimo item: remove a virgula anterior
					startPos = tokens[prevCommaIndex].start;
					endPos = tokens[valEndIndex - 1].end;
				} else {
					// Unico item do objeto
					endPos = tokens[valEndIndex - 1].end;
				}

				rangesToRemove.push({ start: startPos, end: endPos });
			} else {
				prevCommaIndex = commaIndex;
			}
		}
	}

	function parseArray() {
		const firstPunct = nextSignificant();
		if (firstPunct === -1 || tokens[firstPunct].value !== '[') {
			return;
		}
		tokenIndex = firstPunct + 1;
		while (tokenIndex < tokens.length) {
			const sig = nextSignificant();
			if (sig === -1) {
				break;
			}
			if (tokens[sig].value === ']') {
				tokenIndex = sig + 1;
				break;
			}
			if (tokens[sig].value === '{') {
				parseObject('');
			} else if (tokens[sig].value === '[') {
				parseArray();
			} else {
				tokenIndex = sig + 1;
			}
		}
	}

	function parseRootArray() {
		const firstPunct = nextSignificant();
		if (firstPunct === -1 || tokens[firstPunct].value !== '[') {
			return;
		}
		tokenIndex = firstPunct + 1;
		let prevCommaIndex = -1;

		while (tokenIndex < tokens.length) {
			const sig = nextSignificant();
			if (sig === -1) {
				break;
			}
			if (tokens[sig].value === ']') {
				tokenIndex = sig + 1;
				break;
			}

			let entryStartToken = sig;
			let backward = sig - 1;
			while (backward > (prevCommaIndex !== -1 ? prevCommaIndex : firstPunct)) {
				const t = tokens[backward];
				if (t.type === 'line-comment' || t.type === 'block-comment') {
					entryStartToken = backward;
					backward--;
				} else if (t.type === 'whitespace') {
					if (t.raw.includes('\n\n') || t.raw.includes('\r\n\r\n')) {
						break;
					}
					backward--;
				} else {
					break;
				}
			}

			const itemStartSig = sig;
			let itemEndIndex;
			const itemTok = tokens[sig];
			if (itemTok.value === '{') {
				parseObject('');
				itemEndIndex = tokenIndex;
			} else if (itemTok.value === '[') {
				parseArray();
				itemEndIndex = tokenIndex;
			} else {
				tokenIndex = sig + 1;
				itemEndIndex = tokenIndex;
			}

			const commaSig = nextSignificant(itemEndIndex);
			let commaIndex = -1;
			if (commaSig !== -1 && tokens[commaSig].value === ',') {
				commaIndex = commaSig;
				tokenIndex = commaSig + 1;
			} else {
				tokenIndex = itemEndIndex;
			}

			const innerStrings = [];
			for (let k = itemStartSig; k < itemEndIndex; k++) {
				if (tokens[k].type === 'string') {
					innerStrings.push(tokens[k].value);
				}
			}

			const mustExclude = shouldExcludeFn('', '', false, innerStrings);
			if (mustExclude) {
				let startPos = tokens[entryStartToken].start;
				let endPos;

				if (commaIndex !== -1) {
					endPos = tokens[commaIndex].end;
					if (commaIndex + 1 < tokens.length && tokens[commaIndex + 1].type === 'whitespace') {
						const ws = tokens[commaIndex + 1].raw;
						const nl = ws.indexOf('\n');
						if (nl !== -1) {
							endPos += nl + 1;
						} else {
							endPos += ws.length;
						}
					}
				} else if (prevCommaIndex !== -1) {
					startPos = tokens[prevCommaIndex].start;
					endPos = tokens[itemEndIndex - 1].end;
				} else {
					endPos = tokens[itemEndIndex - 1].end;
				}

				rangesToRemove.push({ start: startPos, end: endPos });
			} else {
				prevCommaIndex = commaIndex;
			}
		}
	}

	const rootPunct = nextSignificant(0);
	if (rootPunct !== -1) {
		if (tokens[rootPunct].value === '{') {
			parseObject('');
		} else if (tokens[rootPunct].value === '[') {
			parseRootArray();
		}
	}

	// Ordena intervalos do final para o inicio para nao deslocar os indices
	rangesToRemove.sort((a, b) => b.start - a.start);

	let result = text;
	for (const range of rangesToRemove) {
		result = result.slice(0, range.start) + result.slice(range.end);
	}

	// Limpa virgulas residuais invalidas caso reste algo antes de '}' ou ']'
	result = result.replace(/,\s*([}\]])/g, '$1');

	// Estetica (E5.4): normaliza objetos/arrays vazios resultantes de remocoes
	result = result.replace(/\{\s*\}/g, '{}');
	result = result.replace(/\[\s*\]/g, '[]');

	// Remove espacos em branco residuais em linhas vazias
	result = result.replace(/\n[ \t]+(?=\r?\n)/g, '\n');

	// Normaliza quebras de linha excessivas
	result = result.replace(/(?:\r?\n){3,}/g, '\n\n');

	return result;
}

/**
 * Remove propriedades de topo (na raiz do objeto JSON) preservando comentarios e formatacao.
 * @param {string} text
 * @param {string[] | Set<string>} propertyNames
 * @returns {string}
 */
function stripTopLevelProperties(text, propertyNames) {
	const set = propertyNames instanceof Set ? propertyNames : new Set(propertyNames);
	return stripProperties(text, (keyPath, keyName, isTopLevel) => isTopLevel && (set.has(keyPath) || set.has(keyName)));
}

module.exports = {
	tokenize,
	cleanJsoncForParse,
	parseJsonc,
	stripProperties,
	stripTopLevelProperties
};
