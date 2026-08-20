// Parser unit tests — node test/parse.test.js
global.window = global;
require('path'); process.chdir(__dirname);
require('../js/parse.js');
const today = new Date(2026, 7, 20);
let pass = 0, fail = 0;
function ok(name, cond, extra) { cond ? pass++ : (fail++, console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : '')); }

// two-pass: bare #blue resolves even though #color:blue appears BELOW it
let d = TT.parseDocument(`- [ ] paint fence #blue\n- [ ] buy paint #color:blue`, today);
ok('two-pass backward resolve', d.todos[0].selects.color === 'blue', d.todos[0].selects);

// bare stays a plain label until namespaced somewhere
d = TT.parseDocument(`- [ ] task #work`, today);
ok('untaught bare is a label', d.todos[0].labels[0] === 'work' && !Object.keys(d.todos[0].selects).length, d.todos[0]);

// first namespace wins; explicit form overrides
d = TT.parseDocument(`- [ ] a #color:blue\n- [ ] b #team:blue\n- [ ] c #blue\n- [ ] e #team:blue`, today);
ok('first namespace wins for bare', d.todos[2].selects.color === 'blue' && !d.todos[2].selects.team, d.todos[2].selects);
ok('explicit overrides', d.todos[3].selects.team === 'blue', d.todos[3].selects);

// quoted multi-word values
d = TT.parseDocument(`- [ ] a #status:"in progress" rest`, today);
ok('quoted value', d.todos[0].selects.status === 'in progress', d.todos[0].selects);
ok('quoted strip title', d.todos[0].title === 'a rest', d.todos[0].title);
d = TT.parseDocument(`- [ ] a #status:"in progress"\n- [ ] b #"in progress"`, today);

// priority built-in, both forms
d = TT.parseDocument(`- [ ] a #high\n- [ ] b !low\n- [ ] c #priority:med\n- [ ] d`, today);
ok('bare priority pre-seeded', d.todos[0].selects.priority === 'high', d.todos[0].selects);
ok('bang shorthand', d.todos[1].selects.priority === 'low', d.todos[1].selects);
ok('explicit priority', d.todos[2].selects.priority === 'med');
ok('priority rank sorts', d.todos.map(t => t.priorityRank).join() === '0,2,1,99', d.todos.map(t=>t.priorityRank));

// booleans: absence is explicit false
d = TT.parseDocument(`- [ ] a ~billable\n- [ ] b`, today);
ok('bool true', d.todos[0].bools.billable === true);
ok('bool explicit false', d.todos[1].bools.billable === false, d.todos[1].bools);

// heading is not a tag
d = TT.parseDocument(`# Heading\n## Sub\n- [ ] a`, today);
ok('heading not a tag', d.vocab.labels.size === 0 && d.lines[0].kind === 'heading', [...d.vocab.labels.keys()]);

// dates
ok('iso', TT.parseDate('2026-08-21', today) === '2026-08-21');
ok('today', TT.parseDate('today', today) === '2026-08-20');
ok('tomorrow', TT.parseDate('tomorrow', today) === '2026-08-21');
ok('md slash', TT.parseDate('9/1', today) === '2026-09-01');
ok('month name', TT.parseDate('aug-25', today) === '2026-08-25');
ok('month rolls to next year', TT.parseDate('jan-05', today) === '2027-01-05', TT.parseDate('jan-05', today));
ok('weekday next', TT.parseDate('fri', today) === '2026-08-21', TT.parseDate('fri', today));
ok('bad date', TT.parseDate('2026-02-31', today) === null);
ok('nonsense date', TT.parseDate('nextweek', today) === null);

// trailing punctuation not swallowed
d = TT.parseDocument(`- [ ] ship it #work, then rest #color:blue.`, today);
ok('trailing comma', [...d.vocab.labels.keys()].includes('work'), [...d.vocab.labels.keys()]);
ok('trailing period on value', d.todos[0].selects.color === 'blue', d.todos[0].selects);

// email / url should not become tags
d = TT.parseDocument(`- [ ] mail a@b.com see http://x.co/a#frag`, today);
ok('no false date from email', d.todos[0].due === null, d.todos[0]);
ok('no false tag from url frag', d.todos[0].labels.length === 0, d.todos[0].labels);

// todo forms
d = TT.parseDocument(`- [ ] a\n* [x] b\n[ ] c\n  - [X] d`, today);
ok('todo forms', d.todos.length === 4 && d.todos[1].done && d.todos[3].done, d.todos.map(t=>t.done));

// typo catcher
d = TT.parseDocument(`- [ ] a #status:"in progress"\n- [ ] b #status:"in progres"\n- [ ] c #wrok`, today);
const sus = TT.findSuspects(d.vocab);
ok('catches value typo', sus.some(s => s.kind === 'value'), sus);
d = TT.parseDocument(`- [ ] a #project:atlas\n- [ ] b #prject:atlas`, today);
ok('catches namespace typo', TT.findSuspects(d.vocab).some(s => s.kind === 'namespace'));
d = TT.parseDocument(`- [ ] a #client:acme\n- [ ] b #acmee`, today);
ok('catches label near-miss', TT.findSuspects(d.vocab).some(s => s.kind === 'label'), TT.findSuspects(d.vocab));

// code spans are literal: they must not teach vocabulary
d = TT.parseDocument("Write `#status:blocked` to make a column.\n- [ ] real one #work", today);
ok('code span teaches nothing', d.vocab.namespaces.size === 0, [...d.vocab.namespaces.keys()]);
ok('code span makes no label', !d.vocab.labels.has('status'), [...d.vocab.labels.keys()]);
ok('tag outside code still works', d.vocab.labels.has('work'));
d = TT.parseDocument("- [ ] see `@today` but due @2026-09-01", today);
ok('date in code ignored', d.todos[0].due === '2026-09-01', d.todos[0].due);
d = TT.parseDocument("- [ ] unclosed ` backtick #work", today);
ok('unclosed backtick is harmless', d.vocab.labels.has('work'), [...d.vocab.labels.keys()]);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
