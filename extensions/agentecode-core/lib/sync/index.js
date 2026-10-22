/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const vscode = require('vscode');
const { SyncController } = require('./syncController');
const { registerGuide } = require('./guia');

/**
 * Registra os comandos, barra de status e servicos de sincronizacao de configuracoes.
 * @param {vscode.ExtensionContext} context
 * @returns {SyncController}
 */
function registerSync(context) {
	const controller = new SyncController(context);

	// Registra o comando de guia dedicado
	registerGuide(context);

	// Registra os comandos do modulo de sincronizacao
	const commands = [
		vscode.commands.registerCommand('agentecode.sync.menu', () => controller.showMenu()),
		vscode.commands.registerCommand('agentecode.sync.connect', () => controller.connectAndUpload()),
		vscode.commands.registerCommand('agentecode.sync.upload', () => controller.uploadNow()),
		vscode.commands.registerCommand('agentecode.sync.download', () => controller.downloadFromGitHub()),
		vscode.commands.registerCommand('agentecode.sync.copyGistUrl', () => controller.copyGistUrl()),
		vscode.commands.registerCommand('agentecode.sync.openGist', () => controller.openGist()),
		vscode.commands.registerCommand('agentecode.sync.toggleAuto', () => controller.toggleAutoSync()),
		vscode.commands.registerCommand('agentecode.sync.undoLast', () => controller.undoLastSync()),
		vscode.commands.registerCommand('agentecode.sync.disconnect', () => controller.disconnect())
	];

	for (const cmd of commands) {
		context.subscriptions.push(cmd);
	}

	// Inicializa observadores e verificacao em segundo plano
	controller.setupStartupCheck();
	controller.setupFileWatchers();

	return controller;
}

module.exports = {
	registerSync
};
