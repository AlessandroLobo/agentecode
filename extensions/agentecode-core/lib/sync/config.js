/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

/**
 * Configuracoes e constantes do modulo de sincronizacao de configuracoes.
 */

/** Client ID publico do OAuth App "AgenteCode" (Fase 0 do plano). */
const DEFAULT_CLIENT_ID = 'Ov23li7cBIVavmFpRrXV';

/** Base URLs padrao. Podem ser sobrescritas por variaveis de ambiente nos testes. */
const DEFAULT_GITHUB_BASE = 'https://github.com';
const DEFAULT_GITHUB_API = 'https://api.github.com';

/** Marca identificadora do Gist secreto de sincronizacao do AgenteCode. */
const GIST_MARKER = '[agentecode-sync:v1]';
const GIST_DESCRIPTION = `AgenteCode Settings Sync ${GIST_MARKER}`;

/** Nomes de arquivos padrao no Gist. */
const MANIFEST_FILE = 'agentecode-sync.json';
const SETTINGS_FILE = 'settings.json';
const KEYBINDINGS_FILE = 'keybindings.json';
const EXTENSIONS_FILE = 'extensions.json';
const README_FILE = 'LEIA-ME.md';
const SNIPPET_PREFIX = 'snippets--';

/** Limite maximo de tamanho de arquivo individual antes de pular (~900 KB). */
const MAX_FILE_SIZE_BYTES = 900 * 1024;

/** Maximo de backups locais a manter. */
const MAX_BACKUPS_TO_KEEP = 10;

/** Configuracoes excluidas por padrao (segredos e caminhos locais). */
const EXCLUDED_SETTINGS_DEFAULT = [
	'claudeCode.environmentVariables',
	'claudeCode.claudeProcessWrapper',
	'claudeUsageBar.limitsSnapshotPath',
	'git.path',
	'python.defaultInterpreterPath'
];

/** Padrões regex para exclusão automática de chaves sensíveis por nome. */
const EXCLUDED_SETTING_PATTERNS = [
	/(?:senha|segredo|credencia[il]|credential|passw(?:or)?d|passwd|pwd|private[_-]?key|authorization|bearer|api[_-]?key|access[_-]?key|token|secret)/i
];

/** Padrões regex para escaneamento de valores sensíveis (defesa em profundidade). */
const VALUE_SECRET_PATTERNS = [
	/\bgh[pos]_[A-Za-z0-9_]{8,}/,
	/github_pat_[A-Za-z0-9_]{20,}/,
	/sk-ant-/,
	/sk-[A-Za-z0-9]{20,}/,
	/AKIA[0-9A-Z]{16}/,
	/xox[baprs]-/,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/,
	/:\/\/[^/\s:@]+:[^/\s:@]+@/
];

/** Prefixos de configuração que nunca devem ser sincronizados. */
const EXCLUDED_SETTING_PREFIXES = [
	'agentecode.sync.'
];

/** Caminhos e configurações de máquina conhecidas. */
const KNOWN_MACHINE_PATHS = [
	'git.path',
	'python.defaultInterpreterPath',
	'terminal.integrated.shell.windows',
	'terminal.integrated.shell.linux',
	'terminal.integrated.shell.osx',
	'terminal.integrated.shellArgs.windows',
	'terminal.integrated.shellArgs.linux',
	'terminal.integrated.shellArgs.osx'
];

/** Conteúdo do LEIA-ME.md colocado dentro do Gist. */
const README_CONTENT = `# AgenteCode Settings Sync

Este Gist armazena as configurações sincronizadas do AgenteCode.

> **Aviso de Privacidade:** Este Gist é **secreto**, o que significa que ele não aparece em buscas públicas, mas qualquer pessoa que possua este link poderá ler seu conteúdo. O AgenteCode exclui automaticamente chaves de API, segredos e caminhos locais antes de sincronizar.

**Por favor, não edite estes arquivos manualmente.** O AgenteCode atualiza este Gist automaticamente.
`;

function getClientId() {
	return process.env.AGENTECODE_GITHUB_CLIENT_ID || DEFAULT_CLIENT_ID;
}

function getGitHubBase() {
	return process.env.AGENTECODE_GITHUB_BASE || DEFAULT_GITHUB_BASE;
}

function getGitHubApi() {
	return process.env.AGENTECODE_GITHUB_API || DEFAULT_GITHUB_API;
}

module.exports = {
	DEFAULT_CLIENT_ID,
	DEFAULT_GITHUB_BASE,
	DEFAULT_GITHUB_API,
	GIST_MARKER,
	GIST_DESCRIPTION,
	MANIFEST_FILE,
	SETTINGS_FILE,
	KEYBINDINGS_FILE,
	EXTENSIONS_FILE,
	README_FILE,
	SNIPPET_PREFIX,
	MAX_FILE_SIZE_BYTES,
	MAX_BACKUPS_TO_KEEP,
	EXCLUDED_SETTINGS_DEFAULT,
	EXCLUDED_SETTING_PATTERNS,
	VALUE_SECRET_PATTERNS,
	EXCLUDED_SETTING_PREFIXES,
	KNOWN_MACHINE_PATHS,
	README_CONTENT,
	getClientId,
	getGitHubBase,
	getGitHubApi
};
