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

// Cache propio de productos (independiente de productos.js) para no
// acoplar los módulos: acá solo se usa para armar los <select> de la
// composición y calcular equivalentes.
let productosCache = [];
let modulosCache = [];

const formatoNumero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

function nombreProducto(id) {
  const p = productosCache.find((x) => x.id === id);
  return p ? p.nombre : "(producto eliminado)";
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

onSnapshot(query(productosRef, orderBy("nombre")), (snapshot) => {
  productosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  document.querySelectorAll(".composicion-producto").forEach((select) => {
    const valorPrevio = select.value;
    select.innerHTML = opcionesProductos();
    if (productosCache.some((p) => p.id === valorPrevio)) select.value = valorPrevio;
  });
  renderTablaModulos();
});

function opcionesProductos() {
  return (
    '<option value="" disabled selected>Elegir producto...</option>' +
    productosCache.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join("")
  );
}

// =====================================================================
// Tabla de módulos
// =====================================================================

const tablaModulosBody = document.getElementById("tabla-modulos-body");

function resumenComposicion(composicion) {
  if (!composicion || composicion.length === 0) return "Sin composición cargada";
  return composicion.map((c) => `${nombreProducto(c.productoId)} x${formatoNumero.format(c.cantidad)}`).join(", ");
}

// Cuántos módulos completos se podrían armar hoy con el stock actual de
// cada producto de la composición: el más escaso manda, y se redondea
// para abajo porque un módulo no se arma a medias.
function equivalentesHoy(composicion) {
  if (!composicion || composicion.length === 0) return null;
  let minimo = Infinity;
  for (const c of composicion) {
    const producto = productosCache.find((p) => p.id === c.productoId);
    const stockDisponible = producto ? producto.stockActual || 0 : 0;
    if (c.cantidad <= 0) continue;
    minimo = Math.min(minimo, stockDisponible / c.cantidad);
  }
  return minimo === Infinity ? null : Math.floor(minimo);
}

function renderTablaModulos() {
  if (modulosCache.length === 0) {
    tablaModulosBody.innerHTML = '<tr><td colspan="4" class="fila-vacia">Todavía no cargaste ningún módulo.</td></tr>';
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
// Modal: nuevo/editar módulo
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
  tituloModalModulo.textContent = "Nuevo módulo";
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
    tituloModalModulo.textContent = "Editar módulo";
    btnGuardarModulo.textContent = "Guardar cambios";
    abrirModal(modalModulo);
  }

  if (idComposicion) {
    abrirModalComposicion(idComposicion);
  }

  if (idEliminar) {
    const modulo = modulosCache.find((m) => m.id === idEliminar);
    if (!modulo) return;
    if (!confirm(`¿Eliminar el módulo "${modulo.nombre}"? Esta acción no se puede deshacer.`)) return;
    deleteDoc(doc(modulosRef, idEliminar)).catch((error) => {
      console.error(error);
      alert("No se pudo eliminar el módulo. Probá de nuevo.");
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
    errorModulo.textContent = "No se pudo guardar el módulo. Probá de nuevo.";
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

function crearFilaComposicion(productoId = "", cantidad = "") {
  const fila = document.createElement("div");
  fila.className = "fila-receta";
  fila.innerHTML = `
    <select class="composicion-producto">${opcionesProductos()}</select>
    <input type="number" class="composicion-cantidad" min="0.0001" step="any" placeholder="Cantidad" value="${cantidad}" />
    <button type="button" class="boton-quitar-fila" title="Quitar">×</button>
  `;
  if (productoId) fila.querySelector(".composicion-producto").value = productoId;
  fila.querySelector(".boton-quitar-fila").addEventListener("click", () => fila.remove());
  return fila;
}

function abrirModalComposicion(moduloId) {
  if (productosCache.length === 0) {
    alert("Primero tenés que cargar al menos un producto en la sección de arriba.");
    return;
  }
  const modulo = modulosCache.find((m) => m.id === moduloId);
  if (!modulo) return;

  moduloComposicionActualId = moduloId;
  tituloModalComposicion.textContent = `Composición de ${modulo.nombre}`;
  errorComposicion.hidden = true;
  composicionFilas.innerHTML = "";

  const composicion =
    modulo.composicion && modulo.composicion.length > 0 ? modulo.composicion : [{ productoId: "", cantidad: "" }];
  composicion.forEach((c) => composicionFilas.appendChild(crearFilaComposicion(c.productoId, c.cantidad)));

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
    const productoId = fila.querySelector(".composicion-producto").value;
    const cantidad = parseFloat(fila.querySelector(".composicion-cantidad").value);
    if (!productoId || !(cantidad > 0)) {
      errorComposicion.textContent = "Completá el producto y una cantidad mayor a 0 en cada fila (o quitá la fila).";
      errorComposicion.hidden = false;
      return;
    }
    composicion.push({ productoId, cantidad });
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
