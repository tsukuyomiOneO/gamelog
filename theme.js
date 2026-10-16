// Тема оформления и эффекты. Подключается в <head> до отрисовки, чтобы не было мигания.
// По умолчанию тёмная; светлую человек включает кнопкой в шапке. Прежнее значение «arcade» считается тёмной.
(function () {
  var t = 'dark', fx = 'on', d = document.documentElement;
  try {
    var s = localStorage.getItem('gamelog.skin'); if (s === 'light') t = 'light';
    if (localStorage.getItem('gamelog.fx') === 'off') fx = 'off';
  } catch (e) {}
  d.setAttribute('data-theme', t);
  d.setAttribute('data-fx', fx);
})();
