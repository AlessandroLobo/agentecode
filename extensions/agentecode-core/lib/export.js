/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const vscode = require('vscode');
const path = require('path');
const { listSessionFiles, readSessionSummary, exportSessionFile, slugify } = require('./sessionMarkdown');

async function exportSession() {
	const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
	const files = await listSessionFiles(folders);
	if (!files.length) {
		void vscode.window.showInformationMessage(folders.length
			? 'Nenhuma sessão do agente foi encontrada para esta pasta.'
			: 'Nenhuma sessão do agente foi encontrada.');
		return;
	}

	const items = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Lendo sessões do agente…' }, () =>
		Promise.all(files.map(async f => {
			const summary = await readSessionSummary(f.file);
			return {
				label: summary.title,
				description: new Date(f.mtime).toLocaleString('pt-BR'),
				detail: folders.length ? undefined : summary.cwd,
				file: f,
			};
		})));

	const picked = await vscode.window.showQuickPick(items, {
		title: 'Exportar sessão para Markdown',
		placeHolder: 'Escolha a sessão que será exportada',
		matchOnDetail: true,
	});
	if (!picked) {
		return;
	}

	const config = vscode.workspace.getConfiguration('agentecode.export');
	let markdown;
	try {
		markdown = await exportSessionFile(picked.file.file, {
			title: picked.label,
			sessionId: picked.file.id,
			includeToolResults: config.get('includeToolResults', true),
			maxToolResultChars: config.get('maxToolResultChars', 1500),
		});
	} catch (error) {
		void vscode.window.showErrorMessage(`Não foi possível ler a sessão: ${error.message}`);
		return;
	}

	const date = new Date(picked.file.mtime).toISOString().slice(0, 10);
	const base = vscode.workspace.workspaceFolders?.[0]?.uri;
	const suggestion = base
		? vscode.Uri.joinPath(base, 'docs', 'sessoes', `${date}-${slugify(picked.label)}.md`)
		: vscode.Uri.file(path.join(require('os').homedir(), `${date}-${slugify(picked.label)}.md`));

	const target = await vscode.window.showSaveDialog({
		defaultUri: suggestion,
		filters: { Markdown: ['md'] },
		saveLabel: 'Exportar',
		title: 'Salvar sessão como Markdown',
	});
	if (!target) {
		return;
	}

	await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
	await vscode.workspace.fs.writeFile(target, Buffer.from(markdown, 'utf8'));
	const open = 'Abrir';
	const choice = await vscode.window.showInformationMessage(`Sessão exportada para ${path.basename(target.fsPath)}.`, open);
	if (choice === open) {
		await vscode.commands.executeCommand('vscode.open', target);
	}
}

/** @param {vscode.ExtensionContext} context */
function registerExport(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand('agentecode.exportSessionToMarkdown', exportSession),
	);
}

module.exports = { registerExport };
