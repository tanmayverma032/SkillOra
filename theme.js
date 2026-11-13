/**
 * SkillOra theme behaviour - purely cosmetic, mouse devices only.
 * The hero photo stack follows the pointer slightly. Nothing here touches
 * data, forms or login. Safe to delete together with theme.css.
 */
(function () {
  'use strict';
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (calm || !mouse) return;
  var hero = document.querySelector('.hero-section');
  var stack = document.querySelector('.hero-artwork-inner');
  if (!hero || !stack) return;
  hero.addEventListener('pointermove', function (e) {
    var r = hero.getBoundingClientRect();
    var px = (e.clientX - r.left) / r.width - 0.5;
    var py = (e.clientY - r.top) / r.height - 0.5;
    stack.style.setProperty('--hero-ry', (-8 + px * 7).toFixed(2) + 'deg');
    stack.style.setProperty('--hero-rx', (3 - py * 6).toFixed(2) + 'deg');
  }, { passive: true });
  hero.addEventListener('pointerleave', function () {
    stack.style.removeProperty('--hero-ry');
    stack.style.removeProperty('--hero-rx');
  });
})();
