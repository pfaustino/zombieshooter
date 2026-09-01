import { Game } from './game.js';

window.addEventListener('DOMContentLoaded', async () => {
  const game = new Game();
  await game.init();
  window.__game = game;
});
