import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const modulosRef = collection(db, "modulos");
const productosRef = collection(db, "productos");
const materiasPrimasRef = collection(db, "materiasPrimas");

// Caches propios (independientes de productos.js y materias-primas.js)
// para no acoplar los archivos entre sí.
let productosCache = [];
let materialesCache = [];
let modulosCache = [];

const formatoNumero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// La composición de un conjunto puede traer productos fabricados
// (piezas con receta y producción propia) o elementos comprados
// directo (como tornillos, que ya vienen listos de la compra y no
// pasan por producción). Cada ítem guarda { tipo, refId, cantidad }.
// Los conjuntos creados antes de esto guardaban { productoId, cantidad }
// sin "tipo" — se normalizan acá como si fueran de tipo "producto".
function normalizarItem(item) {
  if (item.tipo && item.refId) return item;
  return { tipo: "producto", refId: item.productoId, cantidad: item.cantidad };
}

function nombreItem(tipo, refId) {
  if (tipo === "elemento") {
    const m = materialesCache.find((x) => x.id === refId);
    return m ? m.nombre : "(elemento eliminado)";
  }
  const p = productosCache.find((x) => x.id === refId);
  return p ? p.nombre : "(producto eliminado)";
}

function stockItem(tipo, refId) {
  if (tipo === "elemento") {
    const m = materialesCache.find((x) => x.id === refId);
    return m ? m.stockActual || 0 : 0;
  }
  const p = productosCache.find((x) => x.id === refId);
  return p ? p.stockActual || 0 : 0;
}

function opcionesComposicion() {
  const opcionesProductos = productosCache
    .map((p) => `<option value="producto:${p.id}">${escapeHtml(p.nombre)}</option>`)
    .join("");
  const opcionesElementos = materialesCache
    .map((m) => `<option value="elemento:${m.id}">${escapeHtml(m.nombre)}</option>`)
    .join("");
  return (
    '<option value="" disabled selected>Elegir...</option>' +
    `<optgroup label="Productos fabricados">${opcionesProductos}</optgroup>` +
    `<optgroup label="Elementos comprados directo">${opcionesElementos}</optgroup>`
  );
}

function refrescarSelectsComposicionAbiertos() {
  document.querySelectorAll(".composicion-item").forEach((select) => {
    const valorPrevio = select.value;
    select.innerHTML = opcionesComposicion();
    select.value = valorPrevio;
  });
}

onSnapshot(query(productosRef, orderBy("nombre")), (snapshot) => {
  productosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  refrescarSelectsComposicionAbiertos();
  renderTablaModulos();
});

onSnapshot(query(materiasPrimasRef, orderBy("nombre")), (snapshot) => {
  materialesCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  refrescarSelectsComposicionAbiertos();
  renderTablaModulos();
});

// =====================================================================
// Tabla de conjuntos
// =====================================================================

const tablaModulosBody = document.getElementById("tabla-modulos-body");

function resumenComposicion(composicion) {
  if (!composicion || composicion.length === 0) return "Sin composición cargada";
  return composicion
    .map(normalizarItem)
    .map((c) => `${nombreItem(c.tipo, c.refId)} x${formatoNumero.format(c.cantidad)}`)
    .join(", ");
}

// Cuántos conjuntos completos se podrían armar hoy con el stock actual
// de cada ítem de la composición: el más escaso manda, redondeado para
// abajo porque un conjunto no se arma a medias.
function equivalentesHoy(composicion) {
  if (!composicion || composicion.length === 0) return null;
  let minimo = Infinity;
  for (const itemCrudo of composicion) {
    const c = normalizarItem(itemCrudo);
    if (c.cantidad <= 0) continue;
    const stockDisponible = stockItem(c.tipo, c.refId);
    minimo = Math.min(minimo, stockDisponible / c.cantidad);
  }
  return minimo === Infinity ? null : Math.floor(minimo);
}

function renderTablaModulos() {
  if (modulosCache.length === 0) {
    tablaModulosBody.innerHTML = '<tr><td colspan="4" class="fila-vacia">Todavía no cargaste ningún conjunto.</td></tr>';
    return;
  }
  tablaModulosBody.innerHTML = modulosCache
    .map((m) => {
      const resumen = resumenComposicion(m.composicion);
      const equivalentes = equivalentesHoy(m.composicion);
      return `
      <tr>
        <td>${escapeHtml(m.nombre)}</td>
        <td><span class="receta-resumen" title="${escapeHtml(resumen)}">${escapeHtml(resumen)}</span></td>
        <td class="col-numero">${equivalentes === null ? "—" : formatoNumero.format(equivalentes)}</td>
        <td class="col-acciones">
          <button type="button" class="boton-accion-fila" data-editar-modulo="${m.id}">Editar</button>
          <button type="button" class="boton-accion-fila" data-editar-composicion="${m.id}">Composición</button>
          <button type="button" class="boton-accion-fila peligro" data-eliminar-modulo="${m.id}">Eliminar</button>
        </td>
      </tr>`;
    })
    .join("");
}

onSnapshot(query(modulosRef, orderBy("nombre")), (snapshot) => {
  modulosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaModulos();
});

// =====================================================================
// Modal: nuevo/editar conjunto
// =====================================================================

const modalModulo = document.getElementById("modal-nuevo-modulo");
const formModulo = document.getElementById("form-nuevo-modulo");
const errorModulo = document.getElementById("error-nuevo-modulo");
const inputModuloNombre = document.getElementById("nuevo-modulo-nombre");
const tituloModalModulo = document.getElementById("titulo-modal-modulo");
const btnGuardarModulo = document.getElementById("btn-guardar-modulo");

let editandoModuloId = null;

document.getElementById("btn-abrir-nuevo-modulo").addEventListener("click", () => {
  editandoModuloId = null;
  formModulo.reset();
  errorModulo.hidden = true;
  tituloModalModulo.textContent = "Nuevo conjunto";
  btnGuardarModulo.textContent = "Crear";
  abrirModal(modalModulo);
});

tablaModulosBody.addEventListener("click", (e) => {
  const idEditar = e.target.dataset.editarModulo;
  const idComposicion = e.target.dataset.editarComposicion;
  const idEliminar = e.target.dataset.eliminarModulo;

  if (idEditar) {
    const modulo = modulosCache.find((m) => m.id === idEditar);
    if (!modulo) return;
    editandoModuloId = idEditar;
    inputModuloNombre.value = modulo.nombre;
    errorModulo.hidden = true;
    tituloModalModulo.textContent = "Editar conjunto";
    btnGuardarModulo.textContent = "Guardar cambios";
    abrirModal(modalModulo);
  }

  if (idComposicion) {
    abrirModalComposicion(idComposicion);
  }

  if (idEliminar) {
    const modulo = modulosCache.find((m) => m.id === idEliminar);
    if (!modulo) return;
    if (!confirm(`¿Eliminar el conjunto "${modulo.nombre}"? Esta acción no se puede deshacer.`)) return;
    deleteDoc(doc(modulosRef, idEliminar)).catch((error) => {
      console.error(error);
      alert("No se pudo eliminar el conjunto. Probá de nuevo.");
    });
  }
});

formModulo.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorModulo.hidden = true;
  const nombre = inputModuloNombre.value.trim();
  if (!nombre) return;

  deshabilitarForm(formModulo, true);
  try {
    if (editandoModuloId) {
      await updateDoc(doc(modulosRef, editandoModuloId), { nombre, actualizadoEn: serverTimestamp() });
    } else {
      await addDoc(modulosRef, {
        nombre,
        composicion: [],
        activo: true,
        creadoEn: serverTimestamp(),
        actualizadoEn: serverTimestamp()
      });
    }
    cerrarModal(modalModulo);
  } catch (error) {
    console.error(error);
    errorModulo.textContent = "No se pudo guardar el conjunto. Probá de nuevo.";
    errorModulo.hidden = false;
  } finally {
    deshabilitarForm(formModulo, false);
  }
});

// =====================================================================
// Modal: composición
// =====================================================================

const modalComposicion = document.getElementById("modal-composicion-modulo");
const tituloModalComposicion = document.getElementById("titulo-modal-composicion");
const composicionFilas = document.getElementById("composicion-filas");
const errorComposicion = document.getElementById("error-composicion");
const btnAgregarFilaComposicion = document.getElementById("btn-agregar-fila-composicion");
const btnGuardarComposicion = document.getElementById("btn-guardar-composicion");

let moduloComposicionActualId = null;

function crearFilaComposicion(item = {}) {
  const fila = document.createElement("div");
  fila.className = "fila-receta";
  fila.innerHTML = `
    <select class="composicion-item">${opcionesComposicion()}</select>
    <input type="number" class="composicion-cantidad" min="0.0001" step="any" placeholder="Cantidad" value="${item.cantidad ?? ""}" />
    <button type="button" class="boton-quitar-fila" title="Quitar">×</button>
  `;
  if (item.tipo && item.refId) {
    fila.querySelector(".composicion-item").value = `${item.tipo}:${item.refId}`;
  }
  fila.querySelector(".boton-quitar-fila").addEventListener("click", () => fila.remove());
  return fila;
}

function abrirModalComposicion(moduloId) {
  if (productosCache.length === 0 && materialesCache.length === 0) {
    alert("Primero tenés que cargar al menos un producto o un elemento.");
    return;
  }
  const modulo = modulosCache.find((m) => m.id === moduloId);
  if (!modulo) return;

  moduloComposicionActualId = moduloId;
  tituloModalComposicion.textContent = `Composición de ${modulo.nombre}`;
  errorComposicion.hidden = true;
  composicionFilas.innerHTML = "";

  const composicion =
    modulo.composicion && modulo.composicion.length > 0 ? modulo.composicion.map(normalizarItem) : [{}];
  composicion.forEach((c) => composicionFilas.appendChild(crearFilaComposicion(c)));

  abrirModal(modalComposicion);
}

btnAgregarFilaComposicion.addEventListener("click", () => {
  composicionFilas.appendChild(crearFilaComposicion());
});

btnGuardarComposicion.addEventListener("click", async () => {
  errorComposicion.hidden = true;
  const filas = Array.from(composicionFilas.querySelectorAll(".fila-receta"));
  const composicion = [];

  for (const fila of filas) {
    const valorSelect = fila.querySelector(".composicion-item").value;
    const cantidad = parseFloat(fila.querySelector(".composicion-cantidad").value);
    if (!valorSelect || !(cantidad > 0)) {
      errorComposicion.textContent = "Completá el producto/elemento y una cantidad mayor a 0 en cada fila (o quitá la fila).";
      errorComposicion.hidden = false;
      return;
    }
    const [tipo, refId] = valorSelect.split(":");
    composicion.push({ tipo, refId, cantidad });
  }

  btnGuardarComposicion.disabled = true;
  try {
    await updateDoc(doc(modulosRef, moduloComposicionActualId), {
      composicion,
      actualizadoEn: serverTimestamp()
    });
    cerrarModal(modalComposicion);
  } catch (error) {
    console.error(error);
    errorComposicion.textContent = "No se pudo guardar la composición. Probá de nuevo.";
    errorComposicion.hidden = false;
  } finally {
    btnGuardarComposicion.disabled = false;
  }
});

// =====================================================================
// Helpers
// =====================================================================

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
