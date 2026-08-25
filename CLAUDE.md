# Plain Text Todo

## Read this first

Start every session by reading **`temp/chat-summary.md`**. It is the running
record of the project: every request Furkan has made, in order, with a note on
what came of it and — more usefully — *why* each decision went the way it did.
Several choices in this codebase look arbitrary until you read the entry that
explains what was tried first and why it was undone. Reading it before touching
anything will save you from re-proposing something already rejected.

`README.md` describes the app as it stands. The chat summary describes how it
got there. Read both; they answer different questions.

Note that `temp/` is gitignored, so the summary is local-only and will not be in
a fresh clone.

**Keep it current.** When you finish a request, append a numbered section to
`temp/chat-summary.md`: the request quoted verbatim, then a short note on what
you did and the reasoning behind it. Record reversals too — a decision that was
undone is worth more than one that stuck.

## The one idea

The textarea is the single source of truth. Every view is a projection of the
text, and every interaction writes back to the text. Nothing is stored in a
model beside it. When you add a feature, ask what it looks like as plain text
first, and route edits through the existing write-back so the browser's undo
stack survives.

## Working conventions

- Commit straight to `main`. No feature branches.
- One commit per message from Furkan, made before starting the next one.
- New features get their own file in `js/`, exported as a global from an IIFE
  matching the existing modules. Wire it up in `js/app.js` and add a
  `<script>` to `index.html` — load order matters.
- Zero dependencies, no build step. Everything is plain ES5-ish browser JS.
- `./test/run.sh` runs the whole suite: `node test/parse.test.js` plus every
  `test/*.test.html` in headless Chrome. New modules get their own
  `test/<name>.test.html`; it is picked up automatically.
- Verify briefly and say what you found. Furkan will say when he wants more.
