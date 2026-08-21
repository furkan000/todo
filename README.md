# Plain Text Todo

A task tool where the text *is* the database. You write in one plain-text surface;
todo lines can carry inline typed tags, and the same text is viewable as a
document, a table and a calendar. No forms, no schema setup — columns are
discovered from what you type.

Open `index.html` in a browser. No build step, no dependencies, no server.
The text is saved to `localStorage` as you type.

## Running it as a local server

`scripts/serve.sh` serves the app on <http://127.0.0.1:3111/> (Ctrl+C to stop). It uses
`python3 -m http.server` — nothing to install.

```bash
scripts/serve.sh                 # localhost, port 3111
PORT=8080 scripts/serve.sh       # another port
HOST=0.0.0.0 scripts/serve.sh    # reachable from your phone on the same network
```

To have it come back on its own after a reboot:

```bash
scripts/autostart-install.sh              # localhost only
scripts/autostart-install.sh --lan        # reachable from other devices
scripts/autostart-install.sh --port 8080
```

That installs a systemd **user** service — no root needed — and enables lingering
so it starts at boot rather than at login. Undo it with:

```bash
scripts/autostart-uninstall.sh
```

Note that `localStorage` is per-origin, so `http://127.0.0.1:3111` and a file you
opened directly keep **separate** documents. Pick one and stay with it, or move
your text across with the export/import menu.

Serving on `0.0.0.0` puts your todos on the local network with no password. Only
use `--lan` on a network you trust.

## Writing

A todo is any line with a checkbox. Everything else is just prose.

```markdown
# Studio — week of Aug 17

## Shipping

- [x] Rewrite the tag scanner @2026-08-18 !high #status:"in progress" #proj:atlas ~billable
- [ ] Write the calendar view @2026-08-21 #med #status:todo #proj:atlas
- [ ] Repaint the shed #blue #home
- [ ] Pick up two litres of #color:blue emulsion @sat #home
```

## Working on it

`- [>] task` is a third checkbox state: the arrow points at what you are doing
right now. It lives in the checkbox rather than trailing the line, so it cannot
contradict itself — a task is open, in flight, or done, never two of those at
once.

A digit says the same thing and puts it in an order — so every marker stays one
character wide and the raw text keeps its column alignment:

```markdown
- [1] Invoice for July retainer @2026-08-25 !high
- [2] Write the calendar view @2026-08-21
- [>] Repaint the shed
- [ ] Chase Vega for assets
```

Set the marker with the **▸** beside any task, or with `Ctrl+.` on the line the
caret is in. Numbering is optional: click the **–** that appears beside a marked
task to cycle it through 1…9 and back to unnumbered. Marked rows are tinted and
barred in the document, the table and the calendar, the editor colours the box to
match, and the status bar counts what is in flight.

The **Now** filter turns the document into a queue rather than a document: one
flat list, numbered work first in its own order, then the rest in the order the
text has it, each item carrying the section it came from. In the table the
marker rides with the task itself rather than taking a column of its own.

Finishing an in-flight task simply overwrites the marker with a tick, so nothing
else — the subtask cascade, archiving, the log — needed a special case for it.

## Subtasks

Indent a todo under another one and it becomes a subtask of it. That is all the
syntax there is — indenting a list already means this in plain text, so nothing
new had to be invented:

```markdown
- [ ] Two-pass resolver @2026-08-20 !high #proj:atlas
  - [x] Scan the whole document first
  - [x] Index every namespaced value
  - [ ] Resolve bare tags against the index
```

`Tab` on a todo line indents it into a subtask of the one above; `Shift+Tab`
promotes it back out. Both work over a multi-line selection.

Ticking follows the tree, in both directions:

- **Down** — finishing a task finishes everything under it, and reopening it
  reopens them. A task is not done while its parts are outstanding.
- **Up** — finishing the last open subtask finishes its parent, and its parent's
  parent if that was the last one there too. Reopening any subtask reopens
  everything it belongs to.

A parent carries a progress pill (`2/5`), counting every descendant rather than
just its direct children, and its checkbox shows a dash while the work is part
done. Subtasks nest as deep as you indent them.

Every other view understands the tree. The table grows a **Sub** column and
labels each subtask row with the task it belongs to — sorting scatters document
order, so a subtask has to say whose it is. Archiving moves a finished task
together with its subtasks, and refuses to touch a task with open work still
under it. The log records subtask completions with the parent alongside.

## The four tag types

| Type | Looks like | Becomes |
| --- | --- | --- |
| **Date** | `@2026-08-21`, `@today`, `@fri`, `@aug-21`, `@9/1` | a due date — sortable `Due` column, and the calendar |
| **Priority** | `!high`, `#med`, `#priority:low` | a built-in select |
| **Namespaced select** | `#color:blue`, `#person:"Max Weber"` | a category; each namespace is one table column |
| **Boolean** | `~billable` | yes/no. Present is true, **absent is an explicit false**, so it sorts cleanly |
| **Plain label** | `#work` | free-form and multi-value; casual tags coexist with typed columns |

## Resolution rules

These are the non-obvious part, and they hold exactly:

- **Teach once.** After `#color:blue` appears *anywhere*, a later bare `#blue`
  resolves to `color:blue`.
- **Bare stays plain.** A bare tag is a plain label until its value has been
  namespaced somewhere.
- **Two-pass parse.** The whole vocabulary is learned first, then everything is
  resolved — so a bare `#blue` resolves even when `#color:blue` appears *below* it.
- **First namespace wins.** If two namespaces claim the same value, the first one
  wins for bare tags; the explicit `#ns:value` form always overrides.
- **Priority is pre-seeded.** `high` / `med` / `low` belong to `priority` from the
  start, so `#high` works on line one without being taught.
- **Quote to include spaces.** `#person:"Max Weber"` is one value, not two.
- **Repeat means multi.** A namespace is single-choice until some todo carries two
  of them — `#person:Max #person:Anna` — and from then on that namespace holds
  several values per todo, document-wide, its column showing every one. The arity
  is discovered from what you type, like the columns themselves. Repeating the same
  value collapses, and `priority` is exempt: a task has one priority.
- **Code is literal.** Tags inside `` `backticks` `` are examples, not vocabulary —
  writing docs about the syntax never defines a column.

## Views

- **Text** — the source itself, full width. The other four are projections of it.
- **Document** — readable text; todos are interactive checkboxes, nested by indent.
- **Table** — rows are todos; columns auto-generated per namespace and per boolean.
  Rows keep the order the text is written in until you sort them; clicking a
  column heading cycles ascending → descending → back to document order.
- **Calendar** — dated todos on a month grid.
- **Log** — when you finished things. See below.
- **Tags** — the discovery surface: every namespace, value, boolean and label that
  was found, with counts. It doubles as a typo catcher, flagging near-duplicate
  values (`in progres` vs `in progress`), near-duplicate namespaces, bare labels one
  edit away from a real typed value, and dates that did not parse.

Every view writes back to the text: ticking a checkbox anywhere rewrites its line.
Click any tag to filter; click it again to clear.

## Layout and theme

**Text** is a tab like the rest. The button at the far left opens and closes the
editor — it is that pane's own toggle, so it sits on the side it opens — and
`Ctrl+\` does the same. Leaving Text returns you to whichever arrangement you
were last in.
The reading column stays centred in every mode. In split, drag the divider to
resize; double-click it to reset, or focus it and use the arrow keys (`Shift`
for bigger steps). Neither side can be squeezed below 260px, and the width sticks.

Scrollbars stay out of the way: the thumb is invisible until you scroll, and
fades again about a second after you stop. Reaching for the edge of a pane brings
it back too, since a thumb you cannot see is a thumb you cannot grab. Only the
colour comes and goes — the gutter is reserved either way, so nothing reflows.

The theme button cycles **follow system → light → dark**, and the choice sticks.
Both themes are built to be quiet: warm off-white paper or warm near-black, muted
ink, one calm accent, and tag colours derived from the namespace name so a column
keeps its hue.

## Syntax highlighting

The editor colours the source from the parse result rather than from its own
regexes, so what lights up is exactly what the parser understood: a tag that
stays grey will not become a column. Namespaces keep the same hue they have in
the table, taught bare tags get a dotted underline, dates that cannot be read
get a red squiggle, and anything inside `` ` `` backticks stays literal.

## Archiving done work

**Archive done (n)** in the editor header moves every finished todo to a `# Done`
section at the end of the document, grouped by the heading each one came from.
Each section keeps the rank it was written at, so the shape of the document
survives the move:

```markdown
## Shipping

- [ ] Two-pass resolver @2026-08-20

# Done

## Shipping

- [x] Rewrite the tag scanner @2026-08-18 !high

## Client work

- [x] Refund the duplicate charge @2026-08-14 #client:vega
```

The one thing a section cannot keep is a rank that would outrank `Done` itself —
a sibling heading would end the Done section rather than sit inside it — so a
top-level `#` section is written one step under it.

Lines move whole — tags, dates and all — so the table, calendar and Tags view are
unchanged by it. Running it again does nothing until something new is finished, and
later archives merge into the subsections already there rather than repeating them.
Todos already under `Done` are left alone. The rewrite goes through the editor
itself, so `Ctrl+Z` undoes the whole move.

## Activity log

Ticking a todo off records the moment — whichever way you ticked it. A checkbox in
the document, the table or the calendar, or the letter `x` typed straight into the
text: the app diffs each parse against the last and catches the open → done
transition either way.

The log lives beside the document rather than inside it, so finished lines do not
accumulate stamps. Each entry keeps a snapshot — time, task, section, due date,
priority — so later edits to the document never rewrite history. Reopening a todo
is not an event; finishing it again is. Loading or importing a file that already
contains done todos records nothing, since none of that happened just now.

The **Log** tab shows it grouped by day. Export it as Markdown or CSV from the
export menu, and it rides inside the main JSON export too, so it round-trips.

If finished work in the text is what distracts you, the **Open** filter now hides
done todos in the document view as well — the lines stay in your text, they just
stop competing for attention, and a footnote says how many are hidden.

## Selection echo

Select any text in the editor and every other copy of it is boxed, so you can see
at a glance where else a tag, a name or a phrase appears. Matching is exact and
case-sensitive, the selection itself is left alone, and single characters,
whitespace and multi-line selections are ignored — they would light up half the
document without telling you anything.

## Find & replace

`Ctrl+F` opens find & replace over the source text (it takes over the browser's
own find, since the text is the thing you want to search). Every match is
highlighted in the editor with the current one picked out; `Enter` and
`Shift+Enter` step through them, wrapping at the ends.

Options for **match case**, **whole word** and **regex**. In regex mode `$1`
style backreferences work in the replacement; outside it, `$1` is literal. A
malformed pattern is reported in the panel rather than throwing.

## Import / export

Export as **Markdown** (the text verbatim), **JSON** (resolved todos plus the
discovered vocabulary, with the source text embedded so it round-trips exactly),
or **CSV** (the table, one column per namespace; multi-valued cells separate their
values with `; `). Import accepts `.md`, `.txt`,
`.json` and `.csv` — a CSV with a `task` or `title` header is rebuilt back into
tagged plain text.

## Keyboard

| | |
| --- | --- |
| `Ctrl+1` | Text |
| `Ctrl+2..6` | Document / Table / Calendar / Tags / Log |
| `Ctrl+K` | search / filter by tag |
| `Ctrl+F` | find & replace in the text |
| `Ctrl+\` | open/close the editor |
| `Esc` | close the export menu |
| `Enter` | continue the list; again on an empty item to end it |
| `Tab` / `Shift+Tab` | indent a todo into a subtask, or promote it back out |
| `Ctrl+.` | mark the current line as what you are working on |
| `Alt+↑` / `Alt+↓` | move the line, or the selected lines, up and down |
| `Ctrl+X` | with nothing selected, cut the whole line |

## Layout of the code

```
index.html      shell and toolbar
css/app.css     all styling, light and dark
js/parse.js     scanner, two-pass resolver, date parsing, typo detection
js/views.js     document / table / calendar / discovery renderers
js/overlay.js   pins the editor's layers to its text box
js/highlight.js syntax colouring, painted from the parse result
js/log.js       completion log: watches parses for open -> done
js/archive.js   moves finished todos into a Done section
js/subtasks.js  the indent tree, ticking that follows it, and Tab authoring
js/focus.js     the [>] "working on it" state
js/lines.js     moving lines, and cutting one whole
js/scrollbars.js  shows a scrollbar only while it is in use
js/occurrences.js  echoes the current selection everywhere else it appears
js/find.js      find & replace over the source text (self-contained)
js/app.js       state, text write-back, import/export
scripts/        serve.sh and the systemd autostart install/uninstall
test/run.sh     parser suite (node) + browser suites (headless chrome);
                every test/*.test.html is picked up automatically
```

Run the tests with `./test/run.sh`.
