// Оформление «Аркада» (игровые автоматы США 2000-х) единственное. Подключается в <head> до отрисовки.
// Эффекты можно выключить галочкой в аккаунте («Анимации и свечение»).
(function () {
  var fx = 'on', d = document.documentElement;
  try { if (localStorage.getItem('gamelog.fx') === 'off') fx = 'off'; } catch (e) {}
  d.setAttribute('data-theme', 'dark');
  d.setAttribute('data-fx', fx);
})();
