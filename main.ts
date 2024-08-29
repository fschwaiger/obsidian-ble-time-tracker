import { setServers } from "dns";
import {
	App,
	Modal,
	Plugin,
	PluginSettingTab,
	Setting,
	addIcon,
} from "obsidian";

type Side = "BF" | "BR" | "BL" | "BB" | "TF" | "TR" | "TL" | "TB" | "__";
type State = "disconnected" | "connecting" | "connected" | "unavailable";

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
	state: State = "disconnected";
	side: Side;
	device: BluetoothDevice | undefined = undefined;
	statusBarItemEl: HTMLElement;
	ribbonIconEl: HTMLElement;

	async onReconnect() {
		if (this.state === "disconnected" || this.state == "unavailable") {
			return this.onConnect();
		} else {
			return this.onDisconnect();
		}
	}

	async onConnect() {
		this.updateState("connecting");
		if (!await navigator.bluetooth?.getAvailability()) {
			this.updateState("unavailable");
			return;
		}

		navigator.bluetooth.requestDevice({filters: [{name: this.settings.deviceName}]})
		.then(device => {
			this.device = device;
			return device.gatt?.connect();
		})
		.then(server => server?.getPrimaryService('battery_service')) // Replace with actual service UUID
		.then(service => service?.getCharacteristic(NOTIFICATION_CHARACTERISTIC_UUID))
		.then(characteristic => {
			if (characteristic) {
				characteristic.addEventListener('characteristicvaluechanged', this.onSideChange);
				return characteristic.startNotifications();
			}
		})
		.then(() => {
			this.updateState("connected");
			console.log('Connected and listening for notifications...');
		})
		.catch(error => {
			this.updateState("disconnected");
			console.error('Error connecting to device:', error);
		});
	}

	async onDisconnect() {
		this.updateState("disconnected");
		this.device?.gatt?.disconnect();
		this.device = undefined;
	}

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "connect",
			name: "Connect Time Tracker",
			callback: this.onConnect.bind(this)
		});

		this.addCommand({
			id: "disconnect",
			name: "Disconnect Time Tracker",
			callback: this.onDisconnect.bind(this)
		});

		addIcon(
			"time-tracker",
			'<g transform="scale(4,4)"><path stroke="currentColor" fill="none" d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0z"/><path stroke="currentColor" d="M8 12h8"/></g>'
		);

		this.ribbonIconEl = this.addRibbonIcon(
			"time-tracker",
			"Time Tracker",
			this.onReconnect.bind(this)
		);

		this.statusBarItemEl = this.addStatusBarItem();
		this.statusBarItemEl.addClass("mod-clickable");
		this.statusBarItemEl.addEventListener("click", this.onReconnect.bind(this));

		this.addSettingTab(new BluetoothTimeTrackerSettingTab(this.app, this));
		
		this.updateState("disconnected");
		this.onReconnect();
	}

	onunload() {}

	onSideChange(event: Event) {
		let value = (event.target as BluetoothRemoteGATTCharacteristic).value;
		this.side = decodeSide(value?.getUint8(0) || 0x00);
		this.updateState();
		console.log(this.side);
	}

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

	async updateState(state: State | undefined = undefined) {
		if (state !== undefined) {
			this.state = state;
		}

		this.ribbonIconEl.setAttr("aria-label", `Time Tracker: ${this.state}`);

		if (this.state == "connected") {
			this.ribbonIconEl.style.opacity = "1.0";
			this.ribbonIconEl.style.color = "rgb(0, 255, 0)";
			this.statusBarItemEl.setText(`◇ N/A <${this.side}>`);
		} else if (this.state == "connecting") {
			this.ribbonIconEl.style.opacity = "1.0";
			this.ribbonIconEl.style.color = "rgb(80, 160, 255)";
			this.statusBarItemEl.setText("◇ scanning ...");
		} else if (this.state == "unavailable") {
			this.ribbonIconEl.style.opacity = "0.5";
			this.ribbonIconEl.style.color = "inherit";
			this.statusBarItemEl.setText("◇ unavailable");
		} else {
			this.ribbonIconEl.style.opacity = "1.0";
			this.ribbonIconEl.style.color = "inherit";
			this.statusBarItemEl.setText("◇ disconnected");
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
