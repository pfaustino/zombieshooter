export class InputManager {
  constructor(game) {
    this.game = game;
    this.keys = {};
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this.rightMouseDown = false;
  }

  init() {
    document.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  isDown(code) { return !!this.keys[code]; }
  isAnyDown(...codes) { return codes.some(c => this.keys[c]); }
}
