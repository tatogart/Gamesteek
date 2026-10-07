// Настройки Firebase для общей базы с входом через Google.
// Если заменить объект на null, сайт вернётся в локальный режим: данные только в этом браузере.
// Как получить настройки, написано в README.md, раздел «Общая база через Google».
// Эти ключи не секретные: доступ к данным закрывают правила Firestore (firestore.rules).
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBFc5eMXE8g8KZ5GHLfUzCnQi5e5K_Xubw",
  authDomain: "gamestaak-48157.firebaseapp.com",
  projectId: "gamestaak-48157",
  storageBucket: "gamestaak-48157.firebasestorage.app",
  messagingSenderId: "231130212333",
  appId: "1:231130212333:web:af1eb5532d3cb7cb9429e4"
};

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
