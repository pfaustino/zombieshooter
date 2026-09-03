import { Game } from './game.js?v=0.1.4m';

window.addEventListener('DOMContentLoaded', async () => {
  const game = new Game();
  await game.init();
  window.__game = game;
});
