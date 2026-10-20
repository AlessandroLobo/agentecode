/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// allow-any-unicode-comment-file

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { ILifecycleMainService, LifecycleMainPhase } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { DisablementReason, IUpdateService, State, StateType, UpdateType } from '../common/update.js';
import { IGitHubRelease, parseVersion, toUpdate } from '../common/githubRelease.js';

const LATEST_RELEASE_URL = 'https://api.github.com/repos/agentecode/agentecode/releases/latest';
/** Variável de ambiente que troca a URL consultada, para testar o aviso sem publicar uma Release. */
const UPDATE_URL_OVERRIDE_ENV = 'AGENTECODE_UPDATE_URL';
const FIRST_CHECK_DELAY = 30 * 1000;
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

/**
 * Serviço de atualização do AgenteCode: consulta a última Release estável no GitHub e, havendo versão
 * maior, entra em `AvailableForDownload`. A interface (item "Check for Updates..." e marcador na
 * engrenagem) é a mesma do VS Code, guiada por este estado. O download abre o instalador no navegador.
 *
 * Respeita `update.mode`: `none` desliga tudo, `manual` só verifica sob demanda, `start` verifica uma
 * vez ao abrir e `default` verifica ao abrir e a cada 24 h.
 */
export class GitHubUpdateService extends Disposable implements IUpdateService {

	declare readonly _serviceBrand: undefined;

	private _state: State = State.Uninitialized;
	private readonly _onStateChange = this._register(new Emitter<State>());
	readonly onStateChange: Event<State> = this._onStateChange.event;

	private readonly firstCheckTimer = this._register(new MutableDisposable());
	private readonly intervalTimer = this._register(new MutableDisposable());

	get state(): State {
		return this._state;
	}

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService,
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@INativeHostMainService private readonly nativeHostMainService: INativeHostMainService,
		@IProductService private readonly productService: IProductService,
	) {
		super();

		lifecycleMainService.when(LifecycleMainPhase.AfterWindowOpen).then(() => this.configure());
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('update.mode')) {
				this.configure();
			}
		}));
	}

	/** Versão instalada, lida do `nameLong` do produto (ex.: "Agente Code IDE v1.0.0"). */
	private get currentVersion(): string | undefined {
		return parseVersion(this.productService.nameLong)?.join('.');
	}

	private setState(state: State): void {
		this.logService.info('update#setState', state.type);
		this._state = state;
		this._onStateChange.fire(state);
	}

	private configure(): void {
		const mode = this.configurationService.getValue<string>('update.mode');
		this.firstCheckTimer.clear();
		this.intervalTimer.clear();

		if (mode === 'none') {
			this.setState(State.Disabled(DisablementReason.ManuallyDisabled));
			return;
		}
		if (!this.currentVersion) {
			// Build de desenvolvimento, sem versão no nome do produto: não há com o que comparar.
			this.setState(State.Disabled(DisablementReason.NotBuilt));
			return;
		}
		if (this._state.type === StateType.Uninitialized || this._state.type === StateType.Disabled) {
			this.setState(State.Idle(UpdateType.Setup));
		}
		if (mode === 'manual') {
			return;
		}

		const timer = setTimeout(() => {
			this.checkForUpdates(false);
			if (mode !== 'start') {
				const interval = setInterval(() => this.checkForUpdates(false), CHECK_INTERVAL);
				this.intervalTimer.value = { dispose: () => clearInterval(interval) };
			}
		}, FIRST_CHECK_DELAY);
		this.firstCheckTimer.value = { dispose: () => clearTimeout(timer) };
	}

	async checkForUpdates(explicit: boolean): Promise<void> {
		const type = this._state.type;
		if (type !== StateType.Idle && type !== StateType.AvailableForDownload) {
			return;
		}
		if (type === StateType.AvailableForDownload && !explicit) {
			return;
		}

		this.setState(State.CheckingForUpdates(explicit));
		try {
			const context = await this.requestService.request({
				url: process.env[UPDATE_URL_OVERRIDE_ENV] || LATEST_RELEASE_URL,
				headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': `AgenteCode/${this.currentVersion}` },
				callSite: 'updateService.github',
			}, CancellationToken.None);

			// 404: o repositório ainda não tem Release estável (pré-lançamentos não contam em /releases/latest).
			const release = context.res.statusCode === 404 ? undefined : await asJson<IGitHubRelease>(context);
			const update = release ? toUpdate(release, this.currentVersion, process.platform) : undefined;

			if (update) {
				this.setState(State.AvailableForDownload(update));
			} else {
				this.setState(State.Idle(UpdateType.Setup, undefined, explicit || undefined));
			}
		} catch (error) {
			this.logService.error('update#checkForUpdates(): failed to query GitHub', error);
			this.setState(State.Idle(UpdateType.Setup, error instanceof Error ? error.message : String(error)));
		}
	}

	async downloadUpdate(_explicit: boolean): Promise<void> {
		if (this._state.type !== StateType.AvailableForDownload) {
			return;
		}
		const url = this._state.update.url;
		if (url) {
			await this.nativeHostMainService.openExternal(undefined, url);
		}
	}

	async applyUpdate(): Promise<void> {
		// A instalação é feita pelo próprio instalador baixado.
	}

	async quitAndInstall(): Promise<void> {
		// Sem atualização automática: o usuário executa o instalador baixado.
	}

	async isLatestVersion(): Promise<boolean | undefined> {
		return this._state.type === StateType.AvailableForDownload ? false : undefined;
	}

	async _applySpecificUpdate(_packagePath: string): Promise<void> {
		// sem uso
	}

	async setInternalOrg(_internalOrg: string | undefined): Promise<void> {
		// sem uso
	}
}
