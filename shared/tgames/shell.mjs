// Menu, play and game-over flow, shared by the real terminal and the website's
// terminal screen. Front ends call tick() at STEP_SECONDS and draw render().
import bricks from './bricks.mjs';
import hop from './hop.mjs';
import paddle from './paddle.mjs';
import rocks from './rocks.mjs';
import snake from './snake.mjs';
import swarm from './swarm.mjs';
import { centre, grid, H, text, toLines } from './kit.mjs';

export const GAMES = [rocks, snake, swarm, bricks, paddle, hop];
export const findGame = (id) => GAMES.find((g) => g.id === id);

export function createShell({ scores = {}, onScore = () => {}, seed = () => Date.now() } = {}) {
  const self = {
    screen: 'menu', index: 0, game: null, state: null, scores, wantsQuit: false, held: {}, overFor: 0,
    start(id) {
      self.game = findGame(id);
      self.index = GAMES.indexOf(self.game);
      self.state = self.game.init(seed());
      self.screen = 'play';
    },
    // input: up, down, left, right, fire, pause, back
    tick(input) {
      const pressed = (k) => input[k] && !self.held[k];
      if (self.screen === 'menu') {
        if (pressed('up')) self.index = (self.index + GAMES.length - 1) % GAMES.length;
        if (pressed('down')) self.index = (self.index + 1) % GAMES.length;
        if (pressed('fire')) self.start(GAMES[self.index].id);
        else if (pressed('back')) self.wantsQuit = true;
      } else if (self.screen === 'play') {
        if (pressed('back')) self.screen = 'menu';
        else if (pressed('pause')) self.screen = 'paused';
        else {
          self.game.step(self.state, input);
          if (self.state.over) {
            const best = self.scores[self.game.id] ?? 0;
            self.newBest = self.state.score > best;
            if (self.newBest) {
              self.scores[self.game.id] = self.state.score;
              onScore(self.scores);
            }
            self.screen = 'over';
            self.overFor = 0;
          }
        }
      } else if (self.screen === 'paused') {
        if (pressed('pause') || pressed('fire')) self.screen = 'play';
        else if (pressed('back')) self.screen = 'menu';
      } else if (self.screen === 'over') {
        // A short delay stops a held fire key from skipping the score.
        self.overFor++;
        if (self.overFor > 15 && pressed('fire')) self.start(self.game.id);
        else if (pressed('back')) self.screen = 'menu';
      }
      self.held = { ...input };
    },
    render() {
      if (self.screen === 'play') return self.game.render(self.state);
      const g = grid();
      if (self.screen === 'menu') {
        centre(g, 2, 'R E T R O - Z I P');
        centre(g, 3, 'terminal mode');
        GAMES.forEach((game, i) => {
          const best = self.scores[game.id] ? `best ${self.scores[game.id]}` : '';
          const row = `${i === self.index ? '>' : ' '} ${game.name.padEnd(8)} ${best}`;
          text(g, 30, 6 + i * 2, row);
        });
        const cur = GAMES[self.index];
        centre(g, H - 5, cur.blurb);
        centre(g, H - 4, cur.controls);
        centre(g, H - 2, 'Up/down choose   Space play   Esc quit');
      } else if (self.screen === 'paused') {
        centre(g, 10, 'PAUSED');
        centre(g, 12, 'Space resume   Esc menu');
      } else {
        centre(g, 8, 'GAME OVER');
        centre(g, 10, `${self.game.name}: ${self.state.score}`);
        centre(g, 11, self.newBest ? 'New best score' : `Best: ${self.scores[self.game.id] ?? 0}`);
        centre(g, 14, 'Space play again   Esc menu');
      }
      return toLines(g);
    },
  };
  return self;
}
