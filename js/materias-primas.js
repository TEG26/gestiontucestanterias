import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  doc,
  runTransaction,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const materiasPrimasRef = collection(db, "materiasPrimas");
const movimientosCompraRef = collection(db, "movimientosCompra");

// Cache local de materiales, para no reconsultar al armar el <select> del
// modal de compra ni al mostrar nombres en la tabla de compras recientes.
let materialesCache = [];

const formatoNumero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const formatoMoneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2
});
const formatoFecha = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

// ---------- Tabla de materiales ----------

const tablaMaterialesBody = document.getElementById("tabla-materiales-body");
const selectCompraMateria = document.getElementById("compra-materia");

function renderTablaMateriales(materiales) {
  if (materiales.length === 0) {
    tablaMaterialesBody.innerHTML =
      '<tr><td colspan="3" class="fila-vacia">Todavía no cargaste ninguna materia prima.</td></tr>';
    return;
  }
  tablaMaterialesBody.innerHTML = materiales
    .map(
      (m) => `
      <tr>
        <td>${escapeHtml(m.nombre)}</td>
        <td>${escapeHtml(m.unidad)}</td>
        <td class="col-numero">${formatoNumero.format(m.stockActual || 0)}</td>
      </tr>`
    )
    .join("");
}

function renderSelectCompraMateria(materiales) {
  const valorPrevio = selectCompraMateria.value;
  selectCompraMateria.innerHTML =
    '<option value="" disabled selected>Elegir material...</option>' +
    materiales
      .map((m) => `<option value="${m.id}">${escapeHtml(m.nombre)} (${escapeHtml(m.unidad)})</option>`)
      .join("");
  if (materiales.some((m) => m.id === valorPrevio)) {
    selectCompraMateria.value = valorPrevio;
  }
}

onSnapshot(query(materiasPrimasRef, orderBy("nombre")), (snapshot) => {
  materialesCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaMateriales(materialesCache);
  renderSelectCompraMateria(materialesCache);
});

// ---------- Tabla de compras recientes ----------

const tablaComprasBody = document.getElementById("tabla-compras-body");

function nombreMaterial(materiaId) {
  const material = materialesCache.find((m) => m.id === materiaId);
  return material ? material.nombre : "(material eliminado)";
}

onSnapshot(
  query(movimientosCompraRef, orderBy("fecha", "desc"), limit(10)),
  (snapshot) => {
    if (snapshot.empty) {
      tablaComprasBody.innerHTML =
        '<tr><td colspan="5" class="fila-vacia">Todavía no hay compras registradas.</td></tr>';
      return;
    }
    tablaComprasBody.innerHTML = snapshot.docs
      .map((docSnap) => {
        const c = docSnap.data();
        const fecha = c.fecha ? formatoFecha.format(c.fecha.toDate()) : "—";
        return `
        <tr>
          <td>${fecha}</td>
          <td>${escapeHtml(nombreMaterial(c.materiaId))}</td>
          <td>${escapeHtml(c.proveedor)}</td>
          <td class="col-numero">${formatoNumero.format(c.cantidad)}</td>
          <td class="col-numero">${formatoMoneda.format(c.precioTotal)}</td>
        </tr>`;
      })
      .join("");
  }
);

// ---------- Modal: nueva materia prima ----------

const modalNuevaMateria = document.getElementById("modal-nueva-materia");
const formNuevaMateria = document.getElementById("form-nueva-materia");
const errorNuevaMateria = document.getElementById("error-nueva-materia");

document.getElementById("btn-abrir-nueva-materia").addEventListener("click", () => {
  formNuevaMateria.reset();
  errorNuevaMateria.hidden = true;
  abrirModal(modalNuevaMateria);
});

formNuevaMateria.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorNuevaMateria.hidden = true;
  const nombre = document.getElementById("nueva-materia-nombre").value.trim();
  const unidad = document.getElementById("nueva-materia-unidad").value.trim();

  if (!nombre || !unidad) return;

  deshabilitarForm(formNuevaMateria, true);
  try {
    await addDoc(materiasPrimasRef, {
      nombre,
      unidad,
      stockActual: 0,
      activo: true,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp()
    });
    cerrarModal(modalNuevaMateria);
  } catch (error) {
    console.error(error);
    errorNuevaMateria.textContent = "No se pudo crear el material. Probá de nuevo.";
    errorNuevaMateria.hidden = false;
  } finally {
    deshabilitarForm(formNuevaMateria, false);
  }
});

// ---------- Modal: registrar compra ----------

const modalCompra = document.getElementById("modal-compra");
const formCompra = document.getElementById("form-compra");
const errorCompra = document.getElementById("error-compra");
const inputCantidad = document.getElementById("compra-cantidad");
const inputPrecioUnitario = document.getElementById("compra-precio-unitario");
const totalCalculadoEl = document.getElementById("compra-total-calculado");

document.getElementById("btn-abrir-compra").addEventListener("click", () => {
  if (materialesCache.length === 0) {
    alert("Primero tenés que cargar al menos una materia prima.");
    return;
  }
  formCompra.reset();
  errorCompra.hidden = true;
  totalCalculadoEl.textContent = formatoMoneda.format(0);
  abrirModal(modalCompra);
});

function actualizarTotalCalculado() {
  const cantidad = parseFloat(inputCantidad.value) || 0;
  const precioUnitario = parseFloat(inputPrecioUnitario.value) || 0;
  totalCalculadoEl.textContent = formatoMoneda.format(cantidad * precioUnitario);
}
inputCantidad.addEventListener("input", actualizarTotalCalculado);
inputPrecioUnitario.addEventListener("input", actualizarTotalCalculado);

formCompra.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorCompra.hidden = true;

  const materiaId = selectCompraMateria.value;
  const proveedor = document.getElementById("compra-proveedor").value.trim();
  const cantidad = parseFloat(inputCantidad.value);
  const precioUnitario = parseFloat(inputPrecioUnitario.value);

  if (!materiaId || !proveedor || !(cantidad > 0) || !(precioUnitario >= 0)) return;

  deshabilitarForm(formCompra, true);
  try {
    await registrarCompra({ materiaId, proveedor, cantidad, precioUnitario });
    cerrarModal(modalCompra);
  } catch (error) {
    console.error(error);
    errorCompra.textContent = "No se pudo registrar la compra. Probá de nuevo.";
    errorCompra.hidden = false;
  } finally {
    deshabilitarForm(formCompra, false);
  }
});

async function registrarCompra({ materiaId, proveedor, cantidad, precioUnitario }) {
  const materiaRef = doc(db, "materiasPrimas", materiaId);
  const precioTotal = Math.round(cantidad * precioUnitario * 100) / 100;

  await runTransaction(db, async (tx) => {
    const materiaSnap = await tx.get(materiaRef);
    if (!materiaSnap.exists()) {
      throw new Error("El material ya no existe.");
    }
    const stockActual = materiaSnap.data().stockActual || 0;

    tx.update(materiaRef, {
      stockActual: stockActual + cantidad,
      actualizadoEn: serverTimestamp()
    });

    tx.set(doc(movimientosCompraRef), {
      materiaId,
      proveedor,
      cantidad,
      precioUnitario,
      precioTotal,
      fecha: serverTimestamp()
    });
  });
}

// ---------- Helpers de modal ----------

function abrirModal(modal) {
  modal.hidden = false;
}
function cerrarModal(modal) {
  modal.hidden = true;
}
document.querySelectorAll("[data-cerrar-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    cerrarModal(document.getElementById(btn.dataset.cerrarModal));
  });
});

function deshabilitarForm(form, disabled) {
  form.querySelectorAll("input, select, button").forEach((el) => (el.disabled = disabled));
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
