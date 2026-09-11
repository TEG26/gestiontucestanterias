import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { auth } from "./firebase-config.js";
import { EMAILS_AUTORIZADOS } from "./whitelist.js";

const provider = new GoogleAuthProvider();

const pantallaLogin = document.getElementById("pantalla-login");
const pantallaApp = document.getElementById("pantalla-app");
const pantallaNoAutorizado = document.getElementById("pantalla-no-autorizado");
const btnLogin = document.getElementById("btn-login");
const btnLogout = document.getElementById("btn-logout");
const nombreUsuario = document.getElementById("nombre-usuario");
const emailNoAutorizado = document.getElementById("email-no-autorizado");
const btnVolverLogin = document.getElementById("btn-volver-login");

function mostrarSolo(pantalla) {
  [pantallaLogin, pantallaApp, pantallaNoAutorizado].forEach((el) => {
    el.hidden = el !== pantalla;
  });
}

btnLogin.addEventListener("click", async () => {
  btnLogin.disabled = true;
  btnLogin.textContent = "Conectando...";
  try {
    await signInWithPopup(auth, provider);
    // onAuthStateChanged se encarga de qué pantalla mostrar después
  } catch (error) {
    console.error("Error al iniciar sesión:", error);
    btnLogin.disabled = false;
    btnLogin.textContent = "Continuar con Google";
  }
});

btnLogout.addEventListener("click", () => signOut(auth));
btnVolverLogin.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (!user) {
    mostrarSolo(pantallaLogin);
    btnLogin.disabled = false;
    btnLogin.textContent = "Continuar con Google";
    return;
  }

  const emailAutorizado = EMAILS_AUTORIZADOS.includes(user.email);

  if (!emailAutorizado) {
    emailNoAutorizado.textContent = user.email;
    mostrarSolo(pantallaNoAutorizado);
    return;
  }

  nombreUsuario.textContent = user.displayName || user.email;
  mostrarSolo(pantallaApp);
});
