# MMM_ncdeck

A [MagicMirror](https://magicmirror.builders/) module for viewing a board of the [Nextcloud](https://nextcloud.com/) [Deck](https://apps.nextcloud.com/apps/deck) app.

## Screenshots

**Complex Mode Colored**

![simple mode](https://raw.githubusercontent.com/motey/MMM_ncdeck/master/doc/colored_non_simple.png)

**Complex Mode Non Colored**

![complex mode](https://raw.githubusercontent.com/motey/MMM_ncdeck/master/doc/non-colored-non-simple.png)

**Simple Mode Non Colored**

![complex mode colored](https://raw.githubusercontent.com/motey/MMM_ncdeck/master/doc/non-colored-simple.png)

## Options

| Option                         | Type            | required | Default            | Example                                                                               | Description                                                                                                                                                                            |
| ------------------------------ | --------------- | -------- | ------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nextcloud.host                 | string (url)    | ✓        | "http://127.0.0.1" | "https://mycloud.domain.org                                                           | The base url where your Nextcloud instance is reachable                                                                                                                                |
| nextcloud.user                 | string          | ✓        | ""                 | "myusername"                                                                          | Your Nextcloud username                                                                                                                                                                |
| nextcloud.pass                 | string          | ✓        | ""                 | "SupersecretPassword!34"                                                              | Your Nextcloud pasword                                                                                                                                                                 |
| deckBoardId                    | int             | ✓        | null               | 5                                                                                     | The Id of the deck you want to view.<br>You can obtain the ID from the Url in you Nextcloud Deck app<br>Example: `https://mycloud.com/index.php/apps/deck/#!/board/3/`<br>is Deck ID 3 |
| updateIntervalSec              | int             |          | 120                | 60                                                                                    | Duration between pooling deck data                                                                                                                                                     |
| hideStacks                     | list of strings |          | []                 | ["Done","Backlog"]                                                                    | Stack you dont want to see in the MagicMirror Deck Module                                                                                                                              |
| coloredHeader                  | bool            |          | true               | false                                                                                 | If set to true the header row will be colored as the deck in you nextclou app                                                                                                          |
| simpleLayout                   | bool            |          | false              | true                                                                                  | Show only Deck cards titles without any glitter                                                                                                                                        |
| maxCardsPerStack               | int             |          | null               | 6                                                                                     | If you only want to show the top card of every stack you can limit the amount of cards per stack here                                                                                  |
| complexLayout.</br>coloredLabels    | bool            |          | true               | complexLayout: {coloredLabels: true,<br>showLabels: true,<br>showAssignedUser: true,} | <br>If set to true labels will have the same color as labels in the nextcloud app.<br>If set to false labels will be of gray colors                                                    |
| complexLayout.</br>showLabels       | bool            |          | true               | see complexLayout.coloredLabels                                                       | If set to false no labels will be shown on cards.                                                                                                                                      |
| complexLayout.</br>showAssignedUser | bool            |          | true               | see complexLayout.coloredLabels                                                       | If set to false not users will be shown. If set to true assigned user will be shown on cards                                                                                           |

## Install

### Requirements

- A running instance of MagicMirror
- A running instance of Nextcloud with Deck app enabled

### Copy module

Go into the module directory of your MagicMirror instance

run `git clone git@github.com:motey/MMM_ncdeck.git`

### Configure

Go into the config.js file of your MagicMirror instance

Add a MMM_ncdeck config
Example:

```js
var config = {
  address: "0.0.0.0",
  port: 8080,
  ipWhitelist: [],
  language: "en",
  timeFormat: 24,
  units: "metric",
  modules: [
    {
      module: "MMM_ncdeck",
      position: "bottom_left",
      config: {
        nextcloud: {
          host: "https://cloud.mydomain.org",
          user: "Username",
          pass: "SuperPassword"
        },
        updateIntervalSec: 60,
        deckBoardId: 5,
        hideStacks: ["Done"],
        coloredHeader: false,
        simpleLayout: true,
        complexLayout: {
          coloredLabels: false,
          showLabels: true,
          showAssignedUser: true
        },
        maxCardsPerStack: 3
      }
    }
  ]
};
```
