# Changelog

## 2.1.0 (2026-11-25)

### New

* Upcoming view (`view: "upcoming"`): cards with due dates from all boards, in the columns
  Overdue, Today, Tomorrow, Next 7 days and Later, like the "Upcoming cards" page in Deck. Can be
  limited to some boards (`upcoming.boards`) and a number of days (`upcoming.days`). Column titles
  in English and German.

### Fixed

* Relative times just under an hour read "in 1 hour" instead of "in 60 minutes".

## 2.0.0 (2026-11-25)

Rewritten from scratch. Existing configurations keep working.

### Security

* The Nextcloud password no longer travels through the browser. The server takes host, user and
  password from its own `config.js` only. Before, any device on the network that could reach the
  MagicMirror port could make the server send the password to a host of its choice.
* Card titles, labels and names are shown as text. Before, a card title could inject HTML and
  scripts into the mirror page.
* Redirects are reported instead of followed, so the password is never sent to another address.
* Only the fields the mirror shows reach the browser (no descriptions, e-mail addresses, owners).
* Warning in the log if the password would be visible to browsers.

### New

* `hideDoneCards`: hide cards marked as done in Deck.
* `highlightDueCards` (on by default): overdue due dates in red, due within 24 hours in yellow.
* When Nextcloud is unreachable, the last data stays visible with a "Last update" note.
* Readable error messages on the mirror (wrong login, no access, unknown board, redirect,
  unreachable host).
* One request per board for all instances and browsers, instead of one per browser.
* A `header` set in the module entry replaces the board name.
* Colors can be changed with CSS variables.

### Fixed

* Error messages were never shown.
* Errors other than network errors (e.g. HTTP 401) were silently ignored, the mirror kept
  showing "Loading".
* The module could crash if the stacks arrived before the board details.
* If loading the board details failed once, the module never recovered.
* Board name and color changes were not picked up until a restart.
* Partial `complexLayout` settings switched the missing options off instead of using the defaults.

### Changed

* No dependencies: `request`, `moment` and `tinycolor` are gone. No `npm install` needed.
* The markup uses `div` elements instead of nested tables. Custom CSS that targets the old
  table structure needs to be adapted; see "Styling" in the README.
* Requires MagicMirror² 2.38 or newer for full protection of the password.
