/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionToMarkdown, projectSlug, slugify } = require('../lib/sessionMarkdown');

test('projectSlug e slugify', () => {
	assert.equal(projectSlug('c:/WorkStation/AgenteCode'), 'c--WorkStation-AgenteCode');
	assert.equal(slugify('Correção: Logos flat!'), 'correcao-logos-flat');
});

test('sessionToMarkdown converte conversa, ferramentas e protege blocos de código', () => {
	const entries = [
		{ type: 'user', timestamp: '2026-10-18T21:00:00Z', cwd: 'C:\p', gitBranch: 'main', message: { role: 'user', content: 'Oi, liste os arquivos' } },
		{ type: 'assistant', timestamp: '2026-10-18T21:00:05Z', message: { model: 'claude-sonnet-5-5', content: [{ type: 'thinking', thinking: 'segredo interno' }] } },
		{ type: 'assistant', timestamp: '2026-10-18T21:00:06Z', message: { model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }] } },
		{ type: 'user', timestamp: '2026-10-18T21:00:07Z', message: { content: [{ type: 'tool_result', content: 'a.txt\n```\nb.txt' }] } },
		{ type: 'assistant', timestamp: '2026-10-18T21:00:08Z', message: { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Pronto.' }] } },
		{ type: 'user', isMeta: true, message: { content: 'ignorar' } },
		{ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'subagente' }] } },
	];
	const md = sessionToMarkdown(entries, { title: 'Teste', sessionId: 'abc' });
	assert.match(md, /^# Teste/);
	assert.match(md, /\*\*Modelo:\*\* claude-sonnet-5-5/);
	assert.match(md, /## Usuário/);
	assert.match(md, /> \*\*Bash\*\* — `ls -la`/);
	assert.match(md, /````\na\.txt/, 'cerca maior que as crases do conteúdo');
	assert.match(md, /Pronto\./);
	assert.doesNotMatch(md, /segredo interno|ignorar|subagente/);

	const without = sessionToMarkdown(entries, { includeToolResults: false });
	assert.doesNotMatch(without, /a\.txt/);
});
