/*
 * MMM_ncdeck node_helper: thin glue between MagicMirror and lib/service.js.
 * All Nextcloud requests happen here, with credentials from the server-side config only.
 */
const NodeHelper = require("node_helper");
const Log = require("logger");
const { DeckService } = require("./lib/service");

module.exports = NodeHelper.create({
	start () {
		this.service = new DeckService({
			moduleName: this.name,
			// global.config holds the real values, global.configRedacted (MagicMirror 2.38+) what browsers get
			getModules: () => ({ full: global.config?.modules, redacted: global.configRedacted?.modules }),
			send: (notification, payload) => this.sendSocketNotification(notification, payload),
			log: Log
		});
	},

	stop () {
		this.service?.stop();
	},

	socketNotificationReceived (notification, payload) {
		if (notification === "NCDECK_SUBSCRIBE") this.service.subscribe(payload);
	}
});
