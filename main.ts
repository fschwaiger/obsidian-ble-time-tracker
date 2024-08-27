import { App, Command, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
let noble = require('noble');

type Action = {
	command?: string;
	template?: string;
	actionSet?: string;
}

type ActionSet = {
	BF: Action;
	BR: Action;
	BL: Action;
	BB: Action;
	TF: Action;
	TR: Action;
	TL: Action;
	TB: Action;
	__: Action;
}

const SIDES = [
 '__',
 'BF',
 'BR',
 'BL',
 'BB',
 'TF',
 'TR',
 'TL',
 'TB',
]

function decodeSide(data: number): 'BF' | 'BR' | 'BL' | 'BB' | 'TF' | 'TR' | 'TL' | 'TB' | '__' {
	switch (data) {
		case 0x01:
			return 'BF';
		case 0x02:
			return 'BR';
		case 0x03:
			return 'BL';
		case 0x04:
			return 'BB';
		case 0x05:
			return 'TF';
		case 0x06:
			return 'TR';
		case 0x07:
			return 'TL';
		case 0x08:
			return 'TB';
		default:
			return '__';
	}
}

interface BluetoothTimeTrackerPluginSettings {
	deviceName: string;
	templateTargetFile: string;
	activeActionSet: string;
	actionSetsByName: { [key: string]: ActionSet }
}

const DEFAULT_SETTINGS: BluetoothTimeTrackerPluginSettings = {
	deviceName: 'Timeular Tracker',
	templateTargetFile: 'Daily/{{date}}.md',
	activeActionSet: 'default',
	actionSetsByName: {
		'default': {
			BF: {
				template: '{{time}} BF'
			},
			BR: {
				template: '{{time}} BR'
			},
			BL: {
				template: '{{time}} BL'
			},
			BB: {
				template: '{{time}} BB'
			},
			TF: {
				template: '{{time}} TF'
			},
			TR: {
				template: '{{time}} TR'
			},
			TL: {
				template: '{{time}} TL'
			},
			TB: {
				template: '{{time}} TB'
			},
			__: {
				template: '{{time}} __'
			}
		}
	}
}

const NOTIFICATION_CHARACTERISTIC_UUID = 'c7e70012_c847_11e6_8175_8c89a55d403c';

export default class BluetoothTimeTrackerPlugin extends Plugin {
	settings: BluetoothTimeTrackerPluginSettings;
	state: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
	statusBarItemEl: HTMLElement;

	async onload() {
		await this.loadSettings();

		const connectCommand = this.addCommand({
			id: 'connect',
			name: 'Connect Time Tracker',
			callback: () => {
				this.state = 'connecting';

				noble.on('stateChange', (state: string) => {
					if (state === 'poweredOn') {
						noble.startScanning();
						this.setStatus('Tracker: scanning...');
					} else {
						this.setStatus('Tracker: offline');
					}
				});

				noble.on('discover', (peripheral: any) => {
					if (peripheral.advertisement.localName === this.settings.deviceName) {
						noble.stopScanning();
						this.setStatus('Tracker: connecting...');
						peripheral.connect((error: any) => {
							if (error) {
								this.setStatus('Tracker: connection error');
								return;
							}

							peripheral.discoverAllServicesAndCharacteristics([], [NOTIFICATION_CHARACTERISTIC_UUID], (error: any, services: any, characteristics: any) => {
								const notificationCharacteristic = characteristics.find((c: any) => c.uuid === NOTIFICATION_CHARACTERISTIC_UUID);
								if (!notificationCharacteristic) {
									return;
								}

								notificationCharacteristic.subscribe((error: any) => {
									if (error) {
										this.setStatus('Tracker: subscription error');
										return;
									}

									this.setStatus('Tracker: connected');
									this.state = 'connected';
								});

								notificationCharacteristic.on('data', (data: number) => {
									let side = decodeSide(data);
									this.setStatus(`Tracker: connected &lt;${side}&gt;`);

									const actionSet = this.settings.actionSetsByName[this.settings.activeActionSet];
									const action = actionSet[side];

									if (action.template) {
										new BluetoothTimeTrackerModal(this.app, `Template: ${action.template}`).open();
									}
									if (action.command) {
										new BluetoothTimeTrackerModal(this.app, `Command: ${action.command}`).open();
									}
									if (action.actionSet) {
										this.settings.activeActionSet = action.actionSet;
										this.saveSettings();
									}
								});
							});
						});
					}
				});
			}
		});

		const disconnectCommand = this.addCommand({
			id: 'disconnect',
			name: 'Disconnect Time Tracker',
			callback: () => {
				this.state = 'disconnected';
				noble.stopScanning();
				noble.removeAllListeners();
				this.setStatus('Tracker: disconnected');
			}
		});

		const ribbonIconEl = this.addRibbonIcon('diamond-minus', 'Time Tracker', (evt: MouseEvent) => {
			if (this.state === 'disconnected') {
				connectCommand.callback?.();
			} else {
				disconnectCommand.callback?.();
			}
		});

		this.statusBarItemEl = this.addStatusBarItem();
		this.addSettingTab(new BluetoothTimeTrackerSettingTab(this.app, this));
		this.setStatus('Tracker: disconnected');
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async setStatus(status: string) {
		this.statusBarItemEl.setText(status);
	}
}

class BluetoothTimeTrackerModal extends Modal {
	constructor(app: App, public text: string) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText(this.text);
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class BluetoothTimeTrackerSettingTab extends PluginSettingTab {
	plugin: BluetoothTimeTrackerPlugin;

	constructor(app: App, plugin: BluetoothTimeTrackerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Device Name')
			.setDesc('The name of the time tracker device')
			.addText(text => text
				.setPlaceholder('Enter the device name')
				.setValue(this.plugin.settings.deviceName)
				.onChange(async (value) => {
					this.plugin.settings.deviceName = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Template Target File')
			.setDesc('The file to write the time entries to')
			.addText(text => text
				.setPlaceholder('Enter the template target file')
				.setValue(this.plugin.settings.templateTargetFile)
				.onChange(async (value) => {
					this.plugin.settings.templateTargetFile = value;
					await this.plugin.saveSettings();
				}));
	}
}
