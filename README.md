# Plain Text Todo

A task tool where the text *is* the database. You write in one plain-text surface;
todo lines can carry inline typed tags, and the same text is viewable as a
document, a table and a calendar. No forms, no schema setup — columns are
discovered from what you type.

Open `index.html` in a browser. No build step, no dependencies, no server.
The text is saved to `localStorage` as you type.

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
- **Document** — readable text; todos are interactive checkboxes.
- **Table** — rows are todos; columns auto-generated per namespace and per boolean,
  all sortable, filterable by done/open.
- **Calendar** — dated todos on a month grid.
- **Log** — when you finished things. See below.
- **Tags** — the discovery surface: every namespace, value, boolean and label that
  was found, with counts. It doubles as a typo catcher, flagging near-duplicate
  values (`in progres` vs `in progress`), near-duplicate namespaces, bare labels one
  edit away from a real typed value, and dates that did not parse.

Every view writes back to the text: ticking a checkbox anywhere rewrites its line.
Click any tag to filter; click it again to clear.

## Layout and theme

**Text** is a tab like the rest. The control at top right decides whether the
editor sits beside the view (**split**) or gets out of the way (**view only**);
`Ctrl+\` toggles it, and leaving Text returns you to whichever you were last in.
The reading column stays centred in every mode. In split, drag the divider to
resize; double-click it to reset, or focus it and use the arrow keys (`Shift`
for bigger steps). Neither side can be squeezed below 260px, and the width sticks.

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
| `Ctrl+\` | show/hide the editor |
| `Esc` | close the export menu |
| `Enter` | continue the list; again on an empty item to end it |
| `Tab` | indent |

## Layout of the code

```
index.html      shell and toolbar
css/app.css     all styling, light and dark
js/parse.js     scanner, two-pass resolver, date parsing, typo detection
js/views.js     document / table / calendar / discovery renderers
js/overlay.js   pins the editor's layers to its text box
js/highlight.js syntax colouring, painted from the parse result
js/log.js       completion log: watches parses for open -> done
js/occurrences.js  echoes the current selection everywhere else it appears
js/find.js      find & replace over the source text (self-contained)
js/app.js       state, text write-back, import/export
test/run.sh     parser suite (node) + browser suites (headless chrome);
                every test/*.test.html is picked up automatically
```

Run the tests with `./test/run.sh`.
