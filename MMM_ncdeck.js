Module.register("MMM_ncdeck", {
    // Default module config.
    defaults: {
        nextcloud: {
            host: "http://127.0.0.1",
            user: "",
            pass: ""
        },
        updateIntervalSec: 120,
        deckBoardId: null,
        hideStacks: [],
        coloredHeader: true,
        simpleLayout: false,
        complexLayout: {
            coloredLabels: true,
            showLabels: true,
            showAssignedUser: true,
        },
        maxCardsPerStack: null,
    },
    getScripts: function () {
        return [
            'moment.js',
            'tinycolor.js' // https://github.com/bgrins/TinyColor
        ]
    },
    getStyles: function () {
        return ["MMM_ncdeck.css"];
    },
    getTranslations: function () {
        return false;
    },
    start: function () {
        this.board = {}
        this.error = null
        Log.info("Starting module!: " + this.name + ", identifier: " + this.identifier);

        this.getData();
    },
    getData: function () {
        Log.info(this.name + ": Init Data for Board " + this.config.deckBoardId + "@" + this.config.nextcloud.host)
        const self = this;
        self.sendSocketNotification("GET_NC_DECK_BOARD_INFO", {
            "ncConfig": this.config.nextcloud,
            "boardId": this.config.deckBoardId,
            "instanceId": this.identifier
        });
        self.sendSocketNotification("GET_NC_DECK_BOARD_STACKS", {
            "ncConfig": this.config.nextcloud,
            "boardId": this.config.deckBoardId,
            "instanceId": this.identifier
        });
        setInterval(function () {
            self.sendSocketNotification("GET_NC_DECK_BOARD_STACKS", {
                "ncConfig": self.config.nextcloud,
                "boardId": self.config.deckBoardId,
                "instanceId": self.identifier
            });
        }, self.config.updateIntervalSec * 1000);
    },

    // Override getHeader method.
    getHeader: function () {
        if (Object.keys(this.board).length === 0 || !this.board.hasOwnProperty("info")) {
            // Board info is not yet loaded
            return "Nextcloud Deck"
        } else {
            return this.board.info.title
        }
    },

    // Override dom generator.
    getDom: function () {

        var wrapperTable = document.createElement("div");
        if (this.config.deckBoardId === null) {
            wrapperTable.className = "module dimmed light small";
            wrapperTable.innerHTML = "No config.deckBoardId set.";
            return wrapperTable;
        }
        if (Object.keys(this.board).length === 0) {
            wrapperTable.className = "module dimmed light small";
            wrapperTable.innerHTML = "Loading Deckboard from " + this.config.nextcloud.host + "...";
            return wrapperTable;
        }
        if (this.board.stacks.length === 0) {
            wrapperTable.className = "module dimmed light small";
            wrapperTable.innerHTML = "Loading Board Stacks from " + this.config.nextcloud.host + "...";
            return wrapperTable;
        }
        wrapper = document.createElement("table");
        wrapper.className = "module small ncdeck-table";
        wrapper.innerHTML = this.getHtml()
        return wrapper

    },

    getHtml: function () {
        const self = this
        let table_header_row_style = ''
        if (this.config.coloredHeader) {
            var textColor = "#313131"
            if (tinycolor("#" + this.board.info.color).isDark()) {
                textColor = "#d3d3d3"
            }
            table_header_row_style = "background: #" + this.board.info.color + "; color:" + textColor
        }

        let table_header_row = '<tr class="ncdeck-container-header-row" style="' + table_header_row_style + '">'
        let table_content_row = '<tr class="ncdeck-container-content-row">'
        for (let i = 0; i < this.board.stacks.length; i++) {
            let stack = this.board.stacks[i]
            if (this.config.hideStacks.includes(stack.title)) {
                // Skip hidden stacks
                continue;
            }
            table_header_row += '<th class="ncdeck-container-cell ncdeck-container-header-cell small">' + stack.title + '</th>'

            table_content_row += '<td class="ncdeck-container-cell ncdeck-container-content-cell">'
            table_content_row += self.renderStackContent(stack)
            table_content_row += '</td>'
        }
        table_content_row += '</tr>'
        table_header_row += '</tr>'


        let table = '<table class="ncdeck-table ncdeck-container">'
        table += table_header_row
        table += table_content_row
        table += '</table>'
        return table

    },

    renderStackContent(stackObject) {
        const self = this
        let html = '<table class="ncdeck-table ncdeck-stack-content">'
        var cards = []
        if (stackObject.hasOwnProperty("cards")) {
            cards = stackObject.cards
        } else {
            return html + "</table>"
        }
        for (let i = 0; i < stackObject.cards.length; i++) {
            var card = cards[i]
            html += '<tr><th><span class=ncdeck-stack-row>'
            if (self.config.simpleLayout) {
                html += card.title
            } else {
                html += self.renderCard(card)
            }
            html += '</span></th></tr>'
        }
        html += '</table>'
        return html
    },

    renderCard(cardObject) {
        var self = this
        var html = '<table class="ncdeck-table ncdeck-card">'
        html += '       <tr><th><span class="small light">' + cardObject.title + '</span></th></tr>'
        if (cardObject.hasOwnProperty("labels")) {
            html += '       <tr><td class="ncdeck-card-content-labels">'
            html += self.renderLabels(cardObject.labels)
            html += '       </td></tr>'
        }
        html += '       <tr><td>'
        if (cardObject.hasOwnProperty("assignedUsers")) {

            html += self.renderUsers(cardObject.assignedUsers)

        }
        if (cardObject.hasOwnProperty("duedate") && cardObject.duedate != null) {
            html += self.renderDueDate(cardObject.duedate)
        }
        html += '       </td></tr>'
        html += '</table>'
        return html
    },

    renderLabels(labels) {
        var self = this
        if (!self.config.complexLayout.showLabels) {
            return ''
        }
        var html = "<span>"
        if (!self.config.complexLayout.coloredLabels) {
            html = '<span style="mix-blend-mode: luminosity">'
        }
        labels.forEach(function (label) {
            var textColor = "#313131"
            if (tinycolor("#" + label.color).isDark()) {
                textColor = "#d3d3d3"
            }
            var style = 'background-color:#' + label.color
            style += ';color:' + textColor
            html += '<span class="ncdeck-label xsmall bold" style="' + style + '"><span class="text">' + label.title + '</span></span>'
        });
        return html + '</span>'
    },

    renderUsers(users) {
        if (!this.config.complexLayout.showAssignedUser) {
            return ''
        }
        if (users == undefined) {
            return ''
        }
        console.log("USERS", users)
        var html = ''
        for (let i = 0; users.length > i; i++) {
            let user = users[i]
            html += '<span class="ncdeck-user xsmall light">' + user.participant.displayname
            if (i < users.length - 1) {
                html += ', '
            }
            html += '</span>'
        }
        return html
    },

    renderDueDate(date) {
        return '<span class="ncdeck-duetime bright xsmall thin"> ' + moment(date).fromNow() + "</span>" //2020-02-13T21:01:26+00:00
    },



    pivotStacks(stacks) {
        largest_stack_length = stacks.map(x => x.length).reduce(function (a, b) {
            return Math.max(a, b)
        })
        rows = []
        for (let i = 0; i < largest_stack_length; i++) {
            rows[i] = []
            for (let s_i = 0; s_i < stacks.length; s_i++) {
                rows[i].push(stacks[s_i][i])
            }
        }
        return rows
    },

    notificationIsForThisInstance(payload) {
        if (payload.moduleInstanceId == this.identifier) {
            return true
        } else {
            return false
        }
    },

    socketNotificationReceived: function (notification, payload) {
        if (this.notificationIsForThisInstance(payload)) {
            this.error = null
            switch (notification) {
                case "NC_DECK_API_ERROR":
                    this.error = payload;
                    Log.error(payload)
                    break;
                case "NC_DECK_BOARD_INFO":
                    //Log.info("NC_DECK_BOARD_INFO", payload)
                    this.board.info = payload.data;
                    if (!this.board.hasOwnProperty("stacks")) {
                        this.board.stacks = []
                    }

                    break;
                case "NC_DECK_BOARD_STACKS":
                    this.board.stacks = payload.data;
                    break;
            }
            this.updateDom();
        }

    }



}

);