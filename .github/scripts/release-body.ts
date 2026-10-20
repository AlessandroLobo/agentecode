/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

/**
 * Monta o corpo da Release do GitHub: as notas da versão (extensions/agentecode-core/RELEASE_NOTES.md)
 * seguidas do bloco de instalação. Usado pelo workflow release.yml.
 *
 * Variáveis de ambiente: RELEASE_TAG (ex.: v1.0.0), INSTALLER_NAME, INSTALLER_HASH. Escreve release-body.md.
 */

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { sectionFor } = require('../../extensions/agentecode-core/lib/releaseNotes.js') as { sectionFor(markdown: string, tag: string): string };

const tag = process.env.RELEASE_TAG ?? '';
const name = process.env.INSTALLER_NAME ?? '';
const hash = process.env.INSTALLER_HASH ?? '';

const notes = sectionFor(readFileSync('extensions/agentecode-core/RELEASE_NOTES.md', 'utf8'), tag);

// allow-any-unicode-next-line
const install = [
	// allow-any-unicode-next-line
	'## Instalação (Windows x64)',
	// allow-any-unicode-next-line
	`Baixe \`${name}\` e execute. Quem já usa o AgenteCode recebe o aviso de atualização dentro da IDE.`,
	'',
	`**SHA-256:** \`${hash}\``,
	'',
	// allow-any-unicode-next-line
	'Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações** e depois em **Executar assim mesmo**. O instalador ainda não tem assinatura digital.',
].join('\n');

if (!notes) {
	console.warn(`Nenhuma seção de ${tag} em RELEASE_NOTES.md; a Release sai só com o bloco de instalação.`);
}
writeFileSync('release-body.md', `${notes ? `${notes}\n\n---\n\n` : ''}${install}\n`, 'utf8');
console.log(`release-body.md gerado para ${tag}.`);
