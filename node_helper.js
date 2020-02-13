const request = require('request');
var NodeHelper = require('node_helper')
var pathlib = require('path');
const api_base_url = '/apps/deck/api/v1.0'

function requestNcDeckApi(host, user, pass, path, query, callback, error_callback) {
    const options = {
        url: host + pathlib.join(api_base_url, path) + query,
        method: 'GET',
        headers: {
            'OCS-APIRequest': 'true',
            'Content-Type': 'application/json'
        },

        auth: {
            'user': user,
            'pass': pass
        }
    };
    //console.log("REQUEST(" + options.method + "): " + options.url)
    try {
        request.get(options, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                callback(JSON.parse(body))
            } else {
                if (error) {
                    error_callback(error, response, body);
                }
            }
        });
    } catch (e) {
        console.error(e)
        error_callback(e, { "statusCode": "NonHttp" }, { "message": "Nodejs Error" });
    };
}



module.exports = NodeHelper.create({

    requestNcDeckObjects: function (ncConfig, instanceId, path, callback) {
        var self = this
        //console.log(this.name + ": Request  " + path + "@" + ncConfig.host)
        requestNcDeckApi(ncConfig.host, ncConfig.user, ncConfig.pass, path, "", callback, function (error, response, body) {
            var error_payload = {}
            error_payload.moduleInstanceId = instanceId
            if (response) {
                switch (response.statusCode) {
                    case 401:
                        error_payload.message == "Nexcloud Login wrong?(401)";
                        break;
                    case 403:
                        error_payload.message == "You do not have permission for this Deckboard(403)";
                        break;
                    default:
                        error_payload.message == body.message;
                }
            }
            else {
                error_payload.message = error.toString()
            }
            console.error(self.name + ": " + error);
            self.sendSocketNotification("NC_DECK_API_ERROR", error_payload);
        });

    },
    sendBoardInfo: function (ncConfig, boardId, instanceId) {
        const self = this;
        var board = {}
        board.boardId = boardId
        var api_path_board = pathlib.join("boards", boardId.toString())
        // https://deck.readthedocs.io/en/latest/API/#get-boardsboardid-get-board-details
        this.requestNcDeckObjects(ncConfig, instanceId, api_path_board, function (response_body_board_info) {
            board.data = response_body_board_info
            board.moduleInstanceId = instanceId
            self.sendSocketNotification("NC_DECK_BOARD_INFO", board);
        });
    },
    sendBoardStacks: function (ncConfig, boardId, instanceId) {
        const self = this;
        var stacks = {}
        stacks.boardId = boardId
        var api_path_stacks = pathlib.join("boards", boardId.toString(), "stacks")
        // https://deck.readthedocs.io/en/latest/API/#get-boardsboardidstacks-get-stacks
        this.requestNcDeckObjects(ncConfig, instanceId, api_path_stacks, function (response_body_stacks) {
            stacks.data = response_body_stacks
            stacks.moduleInstanceId = instanceId
            self.sendSocketNotification("NC_DECK_BOARD_STACKS", stacks);
        });
    },
    socketNotificationReceived: function (notification, payload) {
        switch (notification) {
            case "GET_NC_DECK_BOARD_INFO":
                this.sendBoardInfo(payload.ncConfig, payload.boardId, payload.instanceId);
                break;
            case "GET_NC_DECK_BOARD_STACKS":
                this.sendBoardStacks(payload.ncConfig, payload.boardId, payload.instanceId);
                break;
        }
    }
});