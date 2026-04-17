/* ============================================================
   Firebase — Configuración e inicialización (SDK Compat / CDN)
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyDmXCQUoK7Yb_3umOYBE_uHZ_j8H7diySw",
  authDomain: "esteticawandacuadrado.firebaseapp.com",
  projectId: "esteticawandacuadrado",
  storageBucket: "esteticawandacuadrado.firebasestorage.app",
  messagingSenderId: "429537751825",
  appId: "1:429537751825:web:660d0c5347bb86c45412b0"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);

// Referencias globales usadas en todos los módulos
const auth = firebase.auth();
const db = firebase.firestore();

// ─── Cache persistente en IndexedDB ───
// Reduce lecturas al servidor: las consultas ya leídas quedan disponibles
// offline y entre recargas de la página. synchronizeTabs habilita el uso
// simultáneo en múltiples pestañas del mismo navegador.
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('[firestore] Persistencia no habilitada: otra pestaña sin soporte está abierta.');
  } else if (err.code === 'unimplemented') {
    console.warn('[firestore] Persistencia no soportada en este navegador.');
  }
});

// Idioma de errores en español
auth.languageCode = 'es';
