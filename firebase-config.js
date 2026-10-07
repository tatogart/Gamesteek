// Настройки Firebase для общей базы с входом через Google.
// Пока здесь null, сайт работает в локальном режиме: данные хранятся только в этом браузере.
// Как получить настройки, написано в README.md, раздел «Общая база через Google».
// Эти ключи не секретные: доступ к данным закрывают правила Firestore (firestore.rules).
window.FIREBASE_CONFIG = null;

/* Пример заполненных настроек:
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "gamesteek-xxxx.firebaseapp.com",
  projectId: "gamesteek-xxxx",
  storageBucket: "gamesteek-xxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
*/
