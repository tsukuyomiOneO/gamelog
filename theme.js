// Тема оформления. Подключается в <head> до отрисовки, чтобы не было мигания.
// По умолчанию светлая на всех устройствах, тёмную человек включает кнопкой в шапке.
(function () {
  var t = 'light';
  try { var s = localStorage.getItem('gamelog.theme'); if (s === 'dark' || s === 'light') t = s; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t);
})();
