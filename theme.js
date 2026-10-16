// Тема оформления и эффекты. Подключается в <head> до отрисовки, чтобы не было мигания.
// По умолчанию «Аркада»; светлую и тёмную человек включает кнопкой в шапке.
(function () {
  var t = 'arcade', fx = 'on', d = document.documentElement;
  try {
    var s = localStorage.getItem('gamelog.skin'); if (s === 'arcade' || s === 'dark' || s === 'light') t = s;
    if (localStorage.getItem('gamelog.fx') === 'off') fx = 'off';
  } catch (e) {}
  d.setAttribute('data-theme', t);
  d.setAttribute('data-fx', fx);
})();
