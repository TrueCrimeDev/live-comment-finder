// Simulated live-comment feed for manual / integration testing of the extension.
// Repeats authors and phrases, includes emoji + international text, simulates DOM
// virtualization (drops old nodes) and duplicate mutations (re-appends a node).
const AUTHORS = ['Ann', 'Bob', 'Chen', 'Diego', 'Priya', 'Yuki'];
const PHRASES = [
  'great stream! 🎉',
  'привет всем',
  'こんにちは',
  'LOL same 😂',
  'where is the link?',
  'first!',
  'great stream! 🎉',
];
const feed = document.getElementById('feed');
let timer = null;
let n = 0;

function add(author, text) {
  const li = document.createElement('li');
  li.className = 'msg';
  li.id = 'c' + n++;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = author;
  const body = document.createElement('span');
  body.className = 'body';
  body.textContent = text;
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString();
  li.append(who, body, document.createTextNode(' '), time);
  feed.appendChild(li);

  // Duplicate mutation: re-append the same node — must NOT double-count.
  if (n % 7 === 0) feed.appendChild(li);

  // Virtualization: drop oldest beyond the cap.
  const max = +document.getElementById('maxnodes').value;
  while (feed.children.length > max) feed.removeChild(feed.firstElementChild);
}

function tick() {
  add(AUTHORS[n % AUTHORS.length], PHRASES[n % PHRASES.length]);
}

document.getElementById('start').onclick = () => {
  if (!timer) timer = setInterval(tick, +document.getElementById('interval').value);
};
document.getElementById('pause').onclick = () => {
  clearInterval(timer);
  timer = null;
};
document.getElementById('burst').onclick = () => {
  for (let i = 0; i < 50; i++) tick();
};
document.getElementById('reset').onclick = () => {
  feed.replaceChildren();
  n = 0;
};
