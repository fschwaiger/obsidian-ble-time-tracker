import {
	App,
	Modal,
	Plugin,
	PluginSettingTab,
	Setting,
	addIcon,
} from "obsidian";
let noble = require("@abandonware/noble");

type Side = "BF" | "BR" | "BL" | "BB" | "TF" | "TR" | "TL" | "TB" | "__";

type Action = {
	command?: string;
	template?: string;
	actionSet?: string;
};

type ActionSet = {
	[key in Side]: Action;
};

function decodeSide(
	data: number
): Side {
	switch (data) {
		case 0x01:
			return "BF";
		case 0x02:
			return "BR";
		case 0x03:
			return "BL";
		case 0x04:
			return "BB";
		case 0x05:
			return "TF";
		case 0x06:
			return "TR";
		case 0x07:
			return "TL";
		case 0x08:
			return "TB";
		default:
			return "__";
	}
}

interface BluetoothTimeTrackerPluginSettings {
	deviceName: string;
	templateTargetFile: string;
	activeActionSet: string;
	actionSetsByName: { [key: string]: ActionSet };
}

const DEFAULT_SETTINGS: BluetoothTimeTrackerPluginSettings = {
	deviceName: "Timeular Tracker",
	templateTargetFile: "Daily/{{date}}.md",
	activeActionSet: "default",
	actionSetsByName: {
		default: ["BF", "BR", "BL", "BB", "TF", "TR", "TL", "TB", "__"].reduce(
			(set: ActionSet, side: Side) => {
				set[side] = {
					template: `{{time}} ${side}`,
				};
				return set;
			},
			{} as ActionSet
		),
	},
};

const NOTIFICATION_CHARACTERISTIC_UUID = "c7e70012_c847_11e6_8175_8c89a55d403c";

export default class BluetoothTimeTrackerPlugin extends Plugin {
	settings: BluetoothTimeTrackerPluginSettings;
	state: "disconnected" | "connecting" | "connected" = "disconnected";
	side: "BF" | "BR" | "BL" | "BB" | "TF" | "TR" | "TL" | "TB" | "__";
	statusBarItemEl: HTMLElement;
	ribbonIconEl: HTMLElement;

	async onload() {
		await this.loadSettings();

		const connectCommand = this.addCommand({
			id: "connect",
			name: "Connect Time Tracker",
			callback: () => {
				this.state = "connecting";
				this.updateStatus();

				noble.on("stateChange", async (state: string) => {
					if (state === "poweredOn") {
						await noble.startScanningAsync();
						this.state = "connecting";
					}
					this.updateStatus();
				});

				noble.on("discover", async (peripheral: any) => {
					if (
						peripheral.advertisement.localName !==
						this.settings.deviceName
					) {
						return;
					}

					await noble.stopScanningAsync();
					await peripheral.connectAsync();
					this.state = 'disconnected';
					const { characteristics } =
						await peripheral.discoverSomeServicesAndCharacteristicsAsync(
							[],
							[NOTIFICATION_CHARACTERISTIC_UUID]
						);
					await characteristics[0].subscribe((error: any) => {
						if (!error) {
							this.state = "connected";
						}
						this.updateStatus();
					});
					characteristics[0].on("data", (data: number) => {
						this.side = decodeSide(data);
						this.updateStatus();

						const actionSet =
							this.settings.actionSetsByName[
								this.settings.activeActionSet
							];
						const action = actionSet[this.side];

						if (action.template) {
							new BluetoothTimeTrackerModal(
								this.app,
								`Template: ${action.template}`
							).open();
						}
						if (action.command) {
							new BluetoothTimeTrackerModal(
								this.app,
								`Command: ${action.command}`
							).open();
						}
						if (action.actionSet) {
							this.settings.activeActionSet = action.actionSet;
							this.saveSettings();
						}
					});
				});
			},
		});

		const disconnectCommand = this.addCommand({
			id: "disconnect",
			name: "Disconnect Time Tracker",
			callback: () => {
				this.state = "disconnected";
				noble.stopScanning();
				noble.removeAllListeners();
				this.updateStatus();
			},
		});

		addIcon(
			"time-tracker",
			'<g transform="scale(4,4)"><path stroke="currentColor" fill="none" d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0z"/><path stroke="currentColor" d="M8 12h8"/></g>'
		);

		this.ribbonIconEl = this.addRibbonIcon(
			"time-tracker",
			"Time Tracker",
			(evt: MouseEvent) => {
				if (this.state === "disconnected") {
					connectCommand.callback?.();
				} else {
					disconnectCommand.callback?.();
				}
			}
		);

		this.statusBarItemEl = this.addStatusBarItem();
		this.addSettingTab(new BluetoothTimeTrackerSettingTab(this.app, this));
		this.updateStatus();
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async updateStatus() {
		if (this.state == "connected") {
			this.ribbonIconEl.style.color = "rgb(0, 255, 0)";
			this.statusBarItemEl.setText("tracker 72% <TB>");
		} else if (this.state == "connecting") {
			this.ribbonIconEl.style.color = "rgb(80, 160, 255)";
			this.statusBarItemEl.setText("scanning ...");
		} else {
			this.ribbonIconEl.style.color = "inherit";
			this.statusBarItemEl.setText("no tracker");
		}
	}
}

class BluetoothTimeTrackerModal extends Modal {
	constructor(app: App, public text: string) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText(this.text);
	}

	onClose() {
		const { contentEl } = this;
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
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Device Name")
			.setDesc("The name of the time tracker device")
			.addText((text) =>
				text
					.setPlaceholder("Enter the device name")
					.setValue(this.plugin.settings.deviceName)
					.onChange(async (value) => {
						this.plugin.settings.deviceName = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Template Target File")
			.setDesc("The file to write the time entries to")
			.addText((text) =>
				text
					.setPlaceholder("Enter the template target file")
					.setValue(this.plugin.settings.templateTargetFile)
					.onChange(async (value) => {
						this.plugin.settings.templateTargetFile = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
