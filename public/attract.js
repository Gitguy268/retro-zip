// The little screen on the home page: Rocks playing itself, like an arcade attract mode.
import { STEP_SECONDS } from '/shared/tgames/kit.mjs';
import { findGame } from '/shared/tgames/shell.mjs';

export function mountAttract(host) {
  const game = findGame('rocks');
  const pre = document.createElement('pre');
  pre.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'tube-label';
  label.textContent = 'Open terminal mode';
  host.append(pre, label);

  let s = game.init(11);
  const autopilot = (i) => ({ left: i % 90 < 30, up: i % 150 < 25, fire: i % 7 === 0 });
  let i = 0;
  const step = () => {
    game.step(s, autopilot(i++));
    if (s.over) s = game.init(Date.now());
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (let n = 0; n < 200; n++) step();
  pre.textContent = game.render(s).join('\n');
  if (reduced) return () => {};
  const timer = setInterval(() => {
    step();
    pre.textContent = game.render(s).join('\n');
  }, STEP_SECONDS * 1000);
  return () => clearInterval(timer);
}
