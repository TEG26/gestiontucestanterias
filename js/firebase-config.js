// Configuración del proyecto Firebase "Tucuman Estanterias"
// Estos valores identifican el proyecto (no son secretos: es normal que
// queden visibles en el código del frontend). La seguridad real la dan
// las reglas de Firestore (ver firestore.rules) y la whitelist de emails.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyByh7cSQFjxP2ro_B3scdkEp2mrWp1T_vE",
  authDomain: "tucuman-estanterias.firebaseapp.com",
  projectId: "tucuman-estanterias",
  storageBucket: "tucuman-estanterias.firebasestorage.app",
  messagingSenderId: "803259716055",
  appId: "1:803259716055:web:022d7acaba725e954ffb92"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
