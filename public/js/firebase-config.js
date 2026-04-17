/* ============================================================
   Firebase — Configuración e inicialización (SDK Compat / CDN)
   ============================================================ */

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDrt2WM4bN82-MAJNtmZHi1omI2aEE-qSY",
  authDomain: "novapaddlecenter.firebaseapp.com",
  projectId: "novapaddlecenter",
  storageBucket: "novapaddlecenter.firebasestorage.app",
  messagingSenderId: "84884509257",
  appId: "1:84884509257:web:100ec56cfad6aabd592598"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

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
