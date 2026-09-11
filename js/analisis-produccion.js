import { db } from "./firebase-config.js";
import { collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const productosRef = collection(db, "productos");
const materiasPrimasRef = collection(db, "materiasPrimas");

let productosCache = [];
let materialesCache = [];

const formatoNumero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

function nombreElemento(id) {
  const m = materialesCache.find((x) => x.id === id);
  return m ? m.nombre : "(elemento eliminado)";
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// =====================================================================
// Tabla: producible hoy
// =====================================================================

const tablaAnalisisBody = document.getElementById("tabla-analisis-body");

function resumenReceta(receta) {
  if (!receta || receta.length === 0) return "Sin receta";
  return receta.map((r) => `${nombreElemento(r.materiaId)} (${formatoNumero.format(r.cantidadPorUnidad)})`).join(", ");
}

// Cuántas unidades del producto se podrían armar hoy con el stock actual
// de cada elemento de la receta: el elemento más escaso manda.
function producibleHoy(receta) {
  if (!receta || receta.length === 0) return null;
  let minimo = Infinity;
  for (const r of receta) {
    const elemento = materialesCache.find((m) => m.id === r.materiaId);
    const stockDisponible = elemento ? elemento.stockActual || 0 : 0;
    if (r.cantidadPorUnidad <= 0) continue;
    minimo = Math.min(minimo, stockDisponible / r.cantidadPorUnidad);
  }
  return minimo === Infinity ? null : minimo;
}

function renderTablaAnalisis() {
  if (productosCache.length === 0) {
    tablaAnalisisBody.innerHTML = '<tr><td colspan="3" class="fila-vacia">Todavía no hay productos cargados.</td></tr>';
    return;
  }
  tablaAnalisisBody.innerHTML = productosCache
    .map((p) => {
      const resumen = resumenReceta(p.receta);
      const producible = producibleHoy(p.receta);
      return `
      <tr>
        <td>${escapeHtml(p.nombre)}</td>
        <td><span class="receta-resumen" title="${escapeHtml(resumen)}">${escapeHtml(resumen)}</span></td>
        <td class="col-numero">${producible === null ? "—" : formatoNumero.format(producible)}</td>
      </tr>`;
    })
    .join("");
}

onSnapshot(query(productosRef, orderBy("nombre")), (snapshot) => {
  productosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaAnalisis();
  renderSelectAnalisisProducto();
});

onSnapshot(query(materiasPrimasRef, orderBy("nombre")), (snapshot) => {
  materialesCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaAnalisis();
  actualizarCalculadora();
});

// =====================================================================
// Calculadora rápida (no registra nada, solo muestra)
// =====================================================================

const selectAnalisisProducto = document.getElementById("analisis-producto");
const inputAnalisisCantidad = document.getElementById("analisis-cantidad");
const previewAnalisis = document.getElementById("analisis-consumo-preview");
const previewAnalisisFilas = document.getElementById("analisis-consumo-filas");

function renderSelectAnalisisProducto() {
  const conReceta = productosCache.filter((p) => p.receta && p.receta.length > 0);
  const valorPrevio = selectAnalisisProducto.value;
  selectAnalisisProducto.innerHTML =
    '<option value="" disabled selected>Elegir producto...</option>' +
    conReceta.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join("");
  if (conReceta.some((p) => p.id === valorPrevio)) selectAnalisisProducto.value = valorPrevio;
}

function actualizarCalculadora() {
  const productoId = selectAnalisisProducto.value;
  const cantidad = parseFloat(inputAnalisisCantidad.value);
  if (!productoId || !(cantidad > 0)) {
    previewAnalisis.hidden = true;
    return;
  }
  const producto = productosCache.find((p) => p.id === productoId);
  if (!producto || !producto.receta) {
    previewAnalisis.hidden = true;
    return;
  }

  previewAnalisisFilas.innerHTML = producto.receta
    .map((r) => {
      const necesario = r.cantidadPorUnidad * cantidad;
      const elemento = materialesCache.find((m) => m.id === r.materiaId);
      const stockDisponible = elemento ? elemento.stockActual || 0 : 0;
      const insuficiente = necesario > stockDisponible;
      return `
      <div class="consumo-preview-fila ${insuficiente ? "insuficiente" : ""}">
        <span>${escapeHtml(nombreElemento(r.materiaId))}</span>
        <span>${formatoNumero.format(necesario)} (stock: ${formatoNumero.format(stockDisponible)})</span>
      </div>`;
    })
    .join("");
  previewAnalisis.hidden = false;
}

selectAnalisisProducto.addEventListener("change", actualizarCalculadora);
inputAnalisisCantidad.addEventListener("input", actualizarCalculadora);
