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

/** Padroes regex para exclusao automatica de chaves sensiveis. */
const EXCLUDED_SETTING_PATTERNS = [
	/token|secret|password|api[_-]?key/i
];

/** Prefixos de configuracao que nunca devem ser sincronizados. */
const EXCLUDED_SETTING_PREFIXES = [
	'agentecode.sync.'
];

/** Caminhos e configuracoes de maquina conhecidas. */
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

/** Conteudo do LEIA-ME.md colocado dentro do Gist. */
const README_CONTENT = `# AgenteCode Settings Sync

Este Gist armazena as configuracoes sincronizadas do AgenteCode.

> **Aviso de Privacidade:** Este Gist e **secreto**, o que significa que ele nao aparece em buscas publicas, mas qualquer pessoa que possua este link podera ler seu conteudo. O AgenteCode exclui automaticamente chaves de API, segredos e caminhos locais antes de sincronizar.

**Por favor, nao edite estes arquivos manualmente.** O AgenteCode atualiza este Gist automaticamente.
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
	EXCLUDED_SETTING_PREFIXES,
	KNOWN_MACHINE_PATHS,
	README_CONTENT,
	getClientId,
	getGitHubBase,
	getGitHubApi
};
