import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  writeBatch,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const categoriasGastoRef = collection(db, "categoriasGasto");
const egresosRef = collection(db, "egresos");
const ventasRef = collection(db, "ventas");
const movimientosCompraRef = collection(db, "movimientosCompra");

// Caches propios de este archivo (independientes de ventas.js y
// materias-primas.js, mismo criterio de desacople de toda la app).
let categoriasCache = [];
let egresosCache = [];
let ventasCache = [];
let comprasCache = [];

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
const formatoMesLargo = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function fechaInputADate(valorInput) {
  const [anio, mes, dia] = valorInput.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}
function dateAFechaInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function claveMes(date) {
  return dateAFechaInput(date).slice(0, 7);
}
function etiquetaMes(clave) {
  const [y, m] = clave.split("-").map(Number);
  const texto = formatoMesLargo.format(new Date(y, m - 1, 1));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

// =====================================================================
// Categorías de gasto (con siembra inicial de las 12 categorías base)
// =====================================================================

const CATEGORIAS_DEFECTO = [
  { nombre: "Materia prima y materiales", noSeleccionable: true },
  { nombre: "Mano de obra" },
  { nombre: "Sueldos y cargas sociales" },
  { nombre: "Impuestos y contribuciones (AFIP/IVA/Ingresos Brutos)" },
  { nombre: "Servicios básicos (agua/luz/gas/internet)" },
  { nombre: "Alquiler" },
  { nombre: "Mantenimiento de equipos y herramientas" },
  { nombre: "Logística y transporte" },
  { nombre: "Publicidad y marketing" },
  { nombre: "Administrativos/papelería" },
  { nombre: "Gastos no esenciales" },
  { nombre: "Otros" }
];

let seedIntentado = false;

async function sembrarCategoriasPorDefecto() {
  if (seedIntentado) return;
  seedIntentado = true;
  const batch = writeBatch(db);
  CATEGORIAS_DEFECTO.forEach((cat) => {
    const ref = doc(categoriasGastoRef);
    batch.set(ref, { nombre: cat.nombre, noSeleccionable: !!cat.noSeleccionable, activo: true, creadoEn: serverTimestamp() });
  });
  await batch.commit();
}

const selectEgresoCategoria = document.getElementById("egreso-categoria");
const selectFiltroCategoria = document.getElementById("egresos-filtro-categoria");

function nombreCategoria(id) {
  const c = categoriasCache.find((x) => x.id === id);
  return c ? c.nombre : "(categoría eliminada)";
}

function renderSelectsCategoria() {
  const seleccionables = categoriasCache.filter((c) => !c.noSeleccionable);

  const valorPrevioEgreso = selectEgresoCategoria.value;
  selectEgresoCategoria.innerHTML =
    '<option value="" disabled selected>Elegir categoría...</option>' +
    seleccionables.map((c) => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join("");
  if (seleccionables.some((c) => c.id === valorPrevioEgreso)) selectEgresoCategoria.value = valorPrevioEgreso;

  const valorPrevioFiltro = selectFiltroCategoria.value;
  selectFiltroCategoria.innerHTML =
    '<option value="">Todas</option>' + categoriasCache.map((c) => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join("");
  selectFiltroCategoria.value = valorPrevioFiltro;
}

onSnapshot(query(categoriasGastoRef, orderBy("nombre")), (snapshot) => {
  if (snapshot.empty) {
    sembrarCategoriasPorDefecto();
    return;
  }
  categoriasCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderSelectsCategoria();
  renderListaCategorias();
  renderTablaEgresos();
  recalcularTodo();
});

// ---------- Modal: administrar categorías ----------

const modalCategorias = document.getElementById("modal-categorias-gasto");
const listaCategorias = document.getElementById("lista-categorias-gasto");
const formNuevaCategoria = document.getElementById("form-nueva-categoria-gasto");
const errorCategoria = document.getElementById("error-categoria-gasto");
const inputNuevaCategoriaNombre = document.getElementById("nueva-categoria-nombre");
const etiquetaFormCategoria = document.getElementById("form-categoria-etiqueta");
const btnGuardarCategoria = document.getElementById("btn-guardar-categoria-gasto");
const btnCancelarEdicionCategoria = document.getElementById("btn-cancelar-edicion-categoria");

let editandoCategoriaId = null;

function renderListaCategorias() {
  if (categoriasCache.length === 0) {
    listaCategorias.innerHTML = '<li class="fila-vacia">Todavía no hay categorías cargadas.</li>';
    return;
  }
  listaCategorias.innerHTML = categoriasCache
    .map((c) => {
      if (c.noSeleccionable) {
        return `<li><span>${escapeHtml(c.nombre)} <span class="ayuda-modal" style="display:inline">(automática, desde Compras)</span></span></li>`;
      }
      return `
      <li>
        <span>${escapeHtml(c.nombre)}</span>
        <span class="acciones-fila">
          <button type="button" class="boton-accion-fila" data-editar-categoria="${c.id}">Editar</button>
          <button type="button" class="boton-accion-fila peligro" data-eliminar-categoria="${c.id}">Eliminar</button>
        </span>
      </li>`;
    })
    .join("");
}

function resetearFormCategoria() {
  editandoCategoriaId = null;
  formNuevaCategoria.reset();
  errorCategoria.hidden = true;
  etiquetaFormCategoria.textContent = "Nueva categoría";
  btnGuardarCategoria.textContent = "Crear";
  btnCancelarEdicionCategoria.hidden = true;
}

document.getElementById("btn-abrir-categorias").addEventListener("click", () => {
  resetearFormCategoria();
  abrirModal(modalCategorias);
});
btnCancelarEdicionCategoria.addEventListener("click", resetearFormCategoria);

listaCategorias.addEventListener("click", (e) => {
  const idEditar = e.target.dataset.editarCategoria;
  const idEliminar = e.target.dataset.eliminarCategoria;

  if (idEditar) {
    const categoria = categoriasCache.find((c) => c.id === idEditar);
    if (!categoria) return;
    editandoCategoriaId = idEditar;
    inputNuevaCategoriaNombre.value = categoria.nombre;
    errorCategoria.hidden = true;
    etiquetaFormCategoria.textContent = "Editar categoría";
    btnGuardarCategoria.textContent = "Guardar cambios";
    btnCancelarEdicionCategoria.hidden = false;
    inputNuevaCategoriaNombre.focus();
  }

  if (idEliminar) {
    const categoria = categoriasCache.find((c) => c.id === idEliminar);
    if (!categoria) return;
    if (!confirm(`¿Eliminar la categoría "${categoria.nombre}"? Los egresos ya cargados con ella no se modifican.`)) return;
    deleteDoc(doc(categoriasGastoRef, idEliminar)).catch((error) => {
      console.error(error);
      alert("No se pudo eliminar la categoría. Probá de nuevo.");
    });
    if (editandoCategoriaId === idEliminar) resetearFormCategoria();
  }
});

formNuevaCategoria.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorCategoria.hidden = true;
  const nombre = inputNuevaCategoriaNombre.value.trim();
  if (!nombre) return;

  formNuevaCategoria.querySelectorAll("input,button").forEach((el) => (el.disabled = true));
  try {
    if (editandoCategoriaId) {
      await updateDoc(doc(categoriasGastoRef, editandoCategoriaId), { nombre });
    } else {
      await addDoc(categoriasGastoRef, { nombre, noSeleccionable: false, activo: true, creadoEn: serverTimestamp() });
    }
    resetearFormCategoria();
  } catch (error) {
    console.error(error);
    errorCategoria.textContent = "No se pudo guardar la categoría. Probá de nuevo.";
    errorCategoria.hidden = false;
  } finally {
    formNuevaCategoria.querySelectorAll("input,button").forEach((el) => (el.disabled = false));
  }
});

// =====================================================================
// Egresos
// =====================================================================

const tablaEgresosBody = document.getElementById("tabla-egresos-body");
const modalEgreso = document.getElementById("modal-egreso");
const formEgreso = document.getElementById("form-egreso");
const errorEgreso = document.getElementById("error-egreso");
const inputEgresoFecha = document.getElementById("egreso-fecha");
const inputEgresoDescripcion = document.getElementById("egreso-descripcion");
const inputEgresoMonto = document.getElementById("egreso-monto");
const inputEgresoMedioPago = document.getElementById("egreso-medio-pago");
const inputEgresoTieneFactura = document.getElementById("egreso-tiene-factura");
const tituloModalEgreso = document.getElementById("titulo-modal-egreso");
const btnGuardarEgreso = document.getElementById("btn-guardar-egreso");

let editandoEgresoId = null;

document.getElementById("btn-abrir-egreso").addEventListener("click", () => {
  if (categoriasCache.filter((c) => !c.noSeleccionable).length === 0) {
    alert("Todavía no hay categorías cargadas.");
    return;
  }
  editandoEgresoId = null;
  formEgreso.reset();
  inputEgresoFecha.value = dateAFechaInput(new Date());
  errorEgreso.hidden = true;
  tituloModalEgreso.textContent = "Nuevo egreso";
  btnGuardarEgreso.textContent = "Registrar";
  abrirModal(modalEgreso);
});

// Igual que en Ventas: el mes en curso se muestra abierto y los
// anteriores agrupados y cerrados, para no volcar cientos de filas.
const mesesAbiertosEgresos = new Set();

function filaEgreso(e) {
  const fecha = e.fecha ? formatoFecha.format(e.fecha.toDate()) : "—";
  return `
    <tr>
      <td>${fecha}</td>
      <td>${escapeHtml(nombreCategoria(e.categoriaId))}</td>
      <td>${escapeHtml(e.descripcion)}</td>
      <td class="col-numero">${formatoMoneda.format(e.monto)}</td>
      <td>${escapeHtml(e.medioPago)}</td>
      <td>${e.tieneFactura ? "Sí" : "No"}</td>
      <td class="col-acciones">
        <button type="button" class="boton-accion-fila" data-editar-egreso="${e.id}">Editar</button>
        <button type="button" class="boton-accion-fila peligro" data-eliminar-egreso="${e.id}">Eliminar</button>
      </td>
    </tr>`;
}

function renderTablaEgresos() {
  const filtradas = aplicarFiltrosEgresos(egresosCache);
  if (filtradas.length === 0) {
    tablaEgresosBody.innerHTML = '<tr><td colspan="7" class="fila-vacia">No hay egresos que coincidan con el filtro.</td></tr>';
    return;
  }

  const mesActual = claveMes(new Date());
  const hayFiltro = inputFiltroMesEgreso.value || selectFiltroCategoria.value || inputFiltroTextoEgreso.value.trim();
  if (hayFiltro) {
    tablaEgresosBody.innerHTML = filtradas.map(filaEgreso).join("");
    return;
  }

  const grupos = new Map();
  filtradas.forEach((e) => {
    const k = e.fecha ? claveMes(e.fecha.toDate()) : "sin-fecha";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(e);
  });

  let html = "";
  for (const [clave, lista] of grupos) {
    const esActual = clave === mesActual;
    const abierto = esActual || mesesAbiertosEgresos.has(clave);
    const total = lista.reduce((a, e) => a + (e.monto || 0), 0);

    if (!esActual) {
      const etiqueta = clave === "sin-fecha" ? "Sin fecha" : etiquetaMes(clave);
      html += `
        <tr class="fila-grupo-mes" data-mes="${clave}">
          <td colspan="7">
            <span class="flecha">${abierto ? "▾" : "▸"}</span>
            ${escapeHtml(etiqueta)}
            <span class="resumen-grupo">${lista.length} egreso(s) · ${formatoMoneda.format(total)}</span>
          </td>
        </tr>`;
    }
    if (abierto) html += lista.map(filaEgreso).join("");
  }
  tablaEgresosBody.innerHTML = html;
}

tablaEgresosBody.addEventListener("click", (e) => {
  const fila = e.target.closest(".fila-grupo-mes");
  if (!fila) return;
  const mes = fila.dataset.mes;
  if (mesesAbiertosEgresos.has(mes)) mesesAbiertosEgresos.delete(mes);
  else mesesAbiertosEgresos.add(mes);
  renderTablaEgresos();
});

onSnapshot(query(egresosRef, orderBy("fecha", "desc"), limit(3000)), (snapshot) => {
  egresosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTablaEgresos();
  recalcularTodo();
});

tablaEgresosBody.addEventListener("click", (e) => {
  const idEditar = e.target.dataset.editarEgreso;
  const idEliminar = e.target.dataset.eliminarEgreso;

  if (idEditar) {
    const egreso = egresosCache.find((x) => x.id === idEditar);
    if (!egreso) return;
    editandoEgresoId = idEditar;
    inputEgresoFecha.value = egreso.fecha ? dateAFechaInput(egreso.fecha.toDate()) : dateAFechaInput(new Date());
    selectEgresoCategoria.value = egreso.categoriaId;
    inputEgresoDescripcion.value = egreso.descripcion;
    inputEgresoMonto.value = egreso.monto;
    inputEgresoMedioPago.value = egreso.medioPago;
    inputEgresoTieneFactura.checked = !!egreso.tieneFactura;
    errorEgreso.hidden = true;
    tituloModalEgreso.textContent = "Editar egreso";
    btnGuardarEgreso.textContent = "Guardar cambios";
    abrirModal(modalEgreso);
  }

  if (idEliminar) {
    const egreso = egresosCache.find((x) => x.id === idEliminar);
    if (!egreso) return;
    if (!confirm(`¿Eliminar este egreso ("${egreso.descripcion}")?`)) return;
    deleteDoc(doc(egresosRef, idEliminar)).catch((error) => {
      console.error(error);
      alert("No se pudo eliminar el egreso. Probá de nuevo.");
    });
  }
});

formEgreso.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEgreso.hidden = true;

  const fechaValor = inputEgresoFecha.value;
  const categoriaId = selectEgresoCategoria.value;
  const descripcion = inputEgresoDescripcion.value.trim();
  const monto = parseFloat(inputEgresoMonto.value);
  const medioPago = inputEgresoMedioPago.value.trim();
  const tieneFactura = inputEgresoTieneFactura.checked;

  if (!fechaValor || !categoriaId || !descripcion || !(monto >= 0) || !medioPago) return;

  const fecha = fechaInputADate(fechaValor);
  const datos = { fecha, categoriaId, descripcion, monto, medioPago, tieneFactura };

  formEgreso.querySelectorAll("input,select,button").forEach((el) => (el.disabled = true));
  try {
    if (editandoEgresoId) {
      await updateDoc(doc(egresosRef, editandoEgresoId), { ...datos, actualizadoEn: serverTimestamp() });
    } else {
      await addDoc(egresosRef, { ...datos, creadoEn: serverTimestamp() });
    }
    cerrarModal(modalEgreso);
  } catch (error) {
    console.error(error);
    errorEgreso.textContent = "No se pudo guardar el egreso. Probá de nuevo.";
    errorEgreso.hidden = false;
  } finally {
    formEgreso.querySelectorAll("input,select,button").forEach((el) => (el.disabled = false));
  }
});

// ---------- Filtros del listado de egresos ----------

const inputFiltroMesEgreso = document.getElementById("egresos-filtro-mes");
const inputFiltroTextoEgreso = document.getElementById("egresos-filtro-texto");
const btnLimpiarFiltrosEgresos = document.getElementById("btn-limpiar-filtros-egresos");

function aplicarFiltrosEgresos(egresos) {
  const mes = inputFiltroMesEgreso.value;
  const categoriaId = selectFiltroCategoria.value;
  const texto = inputFiltroTextoEgreso.value.trim().toLowerCase();

  return egresos.filter((e) => {
    if (mes && e.fecha && claveMes(e.fecha.toDate()) !== mes) return false;
    if (categoriaId && e.categoriaId !== categoriaId) return false;
    if (texto && !e.descripcion.toLowerCase().includes(texto)) return false;
    return true;
  });
}
[inputFiltroMesEgreso, selectFiltroCategoria, inputFiltroTextoEgreso].forEach((input) => {
  input.addEventListener("input", renderTablaEgresos);
});
btnLimpiarFiltrosEgresos.addEventListener("click", () => {
  inputFiltroMesEgreso.value = "";
  selectFiltroCategoria.value = "";
  inputFiltroTextoEgreso.value = "";
  renderTablaEgresos();
});

// =====================================================================
// Ventas y compras (solo para los cálculos de balance/IVA)
// =====================================================================

onSnapshot(query(ventasRef, orderBy("fecha", "desc"), limit(3000)), (snapshot) => {
  ventasCache = snapshot.docs.map((d) => d.data());
  recalcularTodo();
});
onSnapshot(query(movimientosCompraRef, orderBy("fecha", "desc"), limit(3000)), (snapshot) => {
  comprasCache = snapshot.docs.map((d) => d.data());
  recalcularTodo();
});

// =====================================================================
// Balance, desglose por categoría, evolución de IVA
// =====================================================================

const tablaBalanceBody = document.getElementById("tabla-balance-body");
const tablaIvaBody = document.getElementById("tabla-iva-body");
const tablaDesgloseBody = document.getElementById("tabla-desglose-body");
const inputDesgloseMes = document.getElementById("desglose-mes");
const inputIndicadoresMes = document.getElementById("indicadores-mes");
const grillaIndicadores = document.getElementById("grilla-indicadores");
const alertasIndicadores = document.getElementById("alertas-indicadores");
const graficoEvolucion = document.getElementById("grafico-evolucion");
const graficoCategorias = document.getElementById("grafico-categorias");

let mesesCalculados = {};
let clavesCalculadas = [];

inputDesgloseMes.value = claveMes(new Date());
inputDesgloseMes.addEventListener("input", renderTablaDesglose);
inputIndicadoresMes.value = claveMes(new Date());
inputIndicadoresMes.addEventListener("input", () => {
  renderIndicadores();
  renderGraficoCategorias();
});

function recalcularTodo() {
  const meses = {};
  function obtenerMes(key) {
    if (!meses[key]) meses[key] = { ingresos: 0, egresosGeneral: 0, egresosMateriaPrima: 0, ivaVentas: 0, ivaCompras: 0, cantidadVentas: 0 };
    return meses[key];
  }

  ventasCache.forEach((v) => {
    if (!v.fecha) return;
    const m = obtenerMes(claveMes(v.fecha.toDate()));
    m.ingresos += v.montoTotal || 0;
    m.ivaVentas += v.ivaTotal || 0;
    m.cantidadVentas += 1;
  });
  comprasCache.forEach((c) => {
    if (!c.fecha) return;
    const m = obtenerMes(claveMes(c.fecha.toDate()));
    m.egresosMateriaPrima += c.precioTotalConIva || 0;
    m.ivaCompras += c.ivaTotal || 0;
  });
  egresosCache.forEach((e) => {
    if (!e.fecha) return;
    const m = obtenerMes(claveMes(e.fecha.toDate()));
    m.egresosGeneral += e.monto || 0;
  });

  const claves = Object.keys(meses).sort();
  mesesCalculados = meses;
  clavesCalculadas = claves;
  renderTablaBalance(claves, meses);
  renderTablaIva(claves, meses);
  renderTablaDesglose();
  renderIndicadores();
  renderGraficoEvolucion();
  renderGraficoCategorias();
}

function renderTablaBalance(claves, meses) {
  if (claves.length === 0) {
    tablaBalanceBody.innerHTML = '<tr><td colspan="5" class="fila-vacia">Todavía no hay datos para calcular el balance.</td></tr>';
    return;
  }
  let acumulado = 0;
  tablaBalanceBody.innerHTML = claves
    .map((clave) => {
      const m = meses[clave];
      const egresosTotal = m.egresosGeneral + m.egresosMateriaPrima;
      const resultado = m.ingresos - egresosTotal;
      acumulado += resultado;
      return `
      <tr>
        <td>${etiquetaMes(clave)}</td>
        <td class="col-numero">${formatoMoneda.format(m.ingresos)}</td>
        <td class="col-numero">${formatoMoneda.format(egresosTotal)}</td>
        <td class="col-numero">${formatoMoneda.format(resultado)}</td>
        <td class="col-numero">${formatoMoneda.format(acumulado)}</td>
      </tr>`;
    })
    .join("");
}

function renderTablaIva(claves, meses) {
  if (claves.length === 0) {
    tablaIvaBody.innerHTML = '<tr><td colspan="4" class="fila-vacia">Todavía no hay datos para calcular el IVA.</td></tr>';
    return;
  }
  tablaIvaBody.innerHTML = claves
    .map((clave) => {
      const m = meses[clave];
      const diferencia = m.ivaVentas - m.ivaCompras;
      return `
      <tr>
        <td>${etiquetaMes(clave)}</td>
        <td class="col-numero">${formatoMoneda.format(m.ivaVentas)}</td>
        <td class="col-numero">${formatoMoneda.format(m.ivaCompras)}</td>
        <td class="col-numero">${formatoMoneda.format(diferencia)}</td>
      </tr>`;
    })
    .join("");
}

function renderTablaDesglose() {
  const mes = inputDesgloseMes.value || claveMes(new Date());
  const porCategoria = {};

  egresosCache
    .filter((e) => e.fecha && claveMes(e.fecha.toDate()) === mes)
    .forEach((e) => {
      porCategoria[e.categoriaId] = (porCategoria[e.categoriaId] || 0) + (e.monto || 0);
    });

  const totalMateriaPrima = comprasCache
    .filter((c) => c.fecha && claveMes(c.fecha.toDate()) === mes)
    .reduce((acc, c) => acc + (c.precioTotalConIva || 0), 0);

  const filas = Object.entries(porCategoria).map(([categoriaId, monto]) => ({
    nombre: nombreCategoria(categoriaId),
    monto: round2(monto)
  }));
  if (totalMateriaPrima > 0) {
    filas.push({ nombre: "Materia prima y materiales", monto: round2(totalMateriaPrima) });
  }
  filas.sort((a, b) => b.monto - a.monto);

  if (filas.length === 0) {
    tablaDesgloseBody.innerHTML = '<tr><td colspan="2" class="fila-vacia">Sin gastos cargados para ese mes.</td></tr>';
    return;
  }
  tablaDesgloseBody.innerHTML = filas
    .map((f) => `<tr><td>${escapeHtml(f.nombre)}</td><td class="col-numero">${formatoMoneda.format(f.monto)}</td></tr>`)
    .join("");
}

// =====================================================================
// Indicadores y gráficos
// =====================================================================

function datosDelMes(clave) {
  return mesesCalculados[clave] || { ingresos: 0, egresosGeneral: 0, egresosMateriaPrima: 0, ivaVentas: 0, ivaCompras: 0, cantidadVentas: 0 };
}

function porcentaje(valor, base) {
  if (!base) return null;
  return (valor / base) * 100;
}

function formatoPorcentaje(p) {
  return p === null ? "—" : `${formatoNumero.format(p)}%`;
}

function renderIndicadores() {
  const mes = inputIndicadoresMes.value || claveMes(new Date());
  const d = datosDelMes(mes);
  const egresosTotal = d.egresosGeneral + d.egresosMateriaPrima;
  const resultado = d.ingresos - egresosTotal;

  // Margen: qué porción de cada peso vendido queda después de todos los
  // gastos del mes. Es margen sobre lo efectivamente facturado, no un
  // margen por producto.
  const margen = porcentaje(resultado, d.ingresos);
  // Peso de la materia prima sobre las ventas: si sube mes a mes,
  // significa que el costo de producir se está comiendo el precio.
  const pesoMateriaPrima = porcentaje(d.egresosMateriaPrima, d.ingresos);
  const ticketPromedio = d.cantidadVentas > 0 ? d.ingresos / d.cantidadVentas : null;
  const saldoIva = d.ivaVentas - d.ivaCompras;

  // Comparación contra el mes anterior con datos
  const indiceMes = clavesCalculadas.indexOf(mes);
  const mesAnterior = indiceMes > 0 ? clavesCalculadas[indiceMes - 1] : null;
  const dAnterior = mesAnterior ? datosDelMes(mesAnterior) : null;
  const variacionIngresos = dAnterior && dAnterior.ingresos ? porcentaje(d.ingresos - dAnterior.ingresos, dAnterior.ingresos) : null;

  const tarjetas = [
    {
      etiqueta: "Ingresos del mes",
      valor: formatoMoneda.format(d.ingresos),
      detalle:
        variacionIngresos === null
          ? `${d.cantidadVentas} venta(s)`
          : `${variacionIngresos >= 0 ? "▲" : "▼"} ${formatoPorcentaje(Math.abs(variacionIngresos))} vs mes anterior`
    },
    { etiqueta: "Egresos del mes", valor: formatoMoneda.format(egresosTotal), detalle: `Materia prima: ${formatoMoneda.format(d.egresosMateriaPrima)}` },
    {
      etiqueta: "Resultado del mes",
      valor: formatoMoneda.format(resultado),
      clase: resultado >= 0 ? "positivo" : "negativo",
      detalle: `Margen: ${formatoPorcentaje(margen)}`
    },
    {
      etiqueta: "Peso de materia prima",
      valor: formatoPorcentaje(pesoMateriaPrima),
      detalle: "Sobre los ingresos del mes"
    },
    {
      etiqueta: "Ticket promedio",
      valor: ticketPromedio === null ? "—" : formatoMoneda.format(ticketPromedio),
      detalle: `${d.cantidadVentas} venta(s) registradas`
    },
    {
      etiqueta: "Saldo de IVA",
      valor: formatoMoneda.format(saldoIva),
      clase: saldoIva > 0 ? "negativo" : "positivo",
      detalle: saldoIva > 0 ? "A pagar" : "A favor"
    }
  ];

  grillaIndicadores.innerHTML = tarjetas
    .map(
      (t) => `
      <div class="tarjeta-indicador">
        <p class="etiqueta">${escapeHtml(t.etiqueta)}</p>
        <p class="valor ${t.clase || ""}">${t.valor}</p>
        <p class="detalle">${escapeHtml(t.detalle)}</p>
      </div>`
    )
    .join("");

  renderAlertas(mes, d, { resultado, margen, pesoMateriaPrima, variacionIngresos });
}

// Detecta situaciones que conviene mirar de cerca. No son diagnósticos
// automáticos: son señales para revisar si el dato está bien cargado o
// si efectivamente algo cambió en el negocio.
function renderAlertas(mes, d, { resultado, margen, pesoMateriaPrima, variacionIngresos }) {
  const alertas = [];

  if (d.ingresos === 0 && (d.egresosGeneral > 0 || d.egresosMateriaPrima > 0)) {
    alertas.push({ grave: true, texto: "Hay gastos cargados este mes pero ninguna venta registrada. Revisá si faltan cargar ventas." });
  }
  if (resultado < 0 && d.ingresos > 0) {
    alertas.push({ grave: true, texto: `El mes cerró en pérdida (${formatoMoneda.format(resultado)}). Los egresos superaron a los ingresos.` });
  }
  if (margen !== null && margen >= 0 && margen < 10) {
    alertas.push({ grave: false, texto: `Margen muy ajustado (${formatoPorcentaje(margen)}). Puede convenir revisar precios de venta.` });
  }
  if (pesoMateriaPrima !== null && pesoMateriaPrima > 70) {
    alertas.push({ grave: false, texto: `La materia prima representa ${formatoPorcentaje(pesoMateriaPrima)} de los ingresos. Puede ser una compra grande de stock, o precios de venta desactualizados.` });
  }
  if (variacionIngresos !== null && variacionIngresos < -30) {
    alertas.push({ grave: false, texto: `Los ingresos cayeron ${formatoPorcentaje(Math.abs(variacionIngresos))} respecto del mes anterior.` });
  }

  const egresosSinFactura = egresosCache.filter((e) => e.fecha && claveMes(e.fecha.toDate()) === mes && !e.tieneFactura);
  if (egresosSinFactura.length > 0) {
    const total = egresosSinFactura.reduce((acc, e) => acc + (e.monto || 0), 0);
    alertas.push({ grave: false, texto: `${egresosSinFactura.length} egreso(s) sin factura por ${formatoMoneda.format(total)} — no generan crédito fiscal.` });
  }

  alertasIndicadores.innerHTML = alertas
    .map((a) => `<div class="alerta-indicador ${a.grave ? "grave" : ""}">${escapeHtml(a.texto)}</div>`)
    .join("");
}

// Gráfico de barras de ingresos vs egresos por mes, dibujado como SVG
// simple (sin librerías externas, para no sumar dependencias).
function renderGraficoEvolucion() {
  const claves = clavesCalculadas.slice(-12);
  if (claves.length === 0) {
    graficoEvolucion.innerHTML = '<p class="ayuda">Todavía no hay datos para graficar.</p>';
    return;
  }

  const alto = 220;
  const anchoGrupo = 70;
  const ancho = Math.max(claves.length * anchoGrupo + 40, 320);
  const maximo = Math.max(
    ...claves.map((c) => {
      const d = datosDelMes(c);
      return Math.max(d.ingresos, d.egresosGeneral + d.egresosMateriaPrima);
    }),
    1
  );

  const barras = claves
    .map((clave, i) => {
      const d = datosDelMes(clave);
      const egresosTotal = d.egresosGeneral + d.egresosMateriaPrima;
      const x = 30 + i * anchoGrupo;
      const altoIngresos = (d.ingresos / maximo) * (alto - 50);
      const altoEgresos = (egresosTotal / maximo) * (alto - 50);
      const etiqueta = clave.split("-").reverse().join("/");
      return `
        <rect x="${x}" y="${alto - 30 - altoIngresos}" width="22" height="${altoIngresos}" fill="#2f7d5c"></rect>
        <rect x="${x + 25}" y="${alto - 30 - altoEgresos}" width="22" height="${altoEgresos}" fill="#b3432f"></rect>
        <text x="${x + 23}" y="${alto - 12}" text-anchor="middle" font-size="10" fill="#5b6470">${etiqueta}</text>`;
    })
    .join("");

  graficoEvolucion.innerHTML = `
    <svg width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}" xmlns="http://www.w3.org/2000/svg">
      <line x1="25" y1="${alto - 30}" x2="${ancho - 10}" y2="${alto - 30}" stroke="#d7d9dc"></line>
      ${barras}
    </svg>
    <div class="grafico-leyenda">
      <span><i style="background:#2f7d5c"></i> Ingresos</span>
      <span><i style="background:#b3432f"></i> Egresos</span>
    </div>`;
}

// Barras horizontales con el peso de cada categoría de gasto del mes.
function renderGraficoCategorias() {
  const mes = inputIndicadoresMes.value || claveMes(new Date());
  const porCategoria = {};

  egresosCache
    .filter((e) => e.fecha && claveMes(e.fecha.toDate()) === mes)
    .forEach((e) => {
      porCategoria[nombreCategoria(e.categoriaId)] = (porCategoria[nombreCategoria(e.categoriaId)] || 0) + (e.monto || 0);
    });

  const totalMateriaPrima = comprasCache
    .filter((c) => c.fecha && claveMes(c.fecha.toDate()) === mes)
    .reduce((acc, c) => acc + (c.precioTotalConIva || 0), 0);
  if (totalMateriaPrima > 0) porCategoria["Materia prima y materiales"] = totalMateriaPrima;

  const filas = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
  if (filas.length === 0) {
    graficoCategorias.innerHTML = '<p class="ayuda">Sin gastos cargados para ese mes.</p>';
    return;
  }
  const total = filas.reduce((acc, [, monto]) => acc + monto, 0);

  graficoCategorias.innerHTML = filas
    .map(([nombre, monto]) => {
      const pct = (monto / total) * 100;
      return `
      <div class="barra-categoria">
        <div class="barra-etiqueta">
          <span>${escapeHtml(nombre)}</span>
          <span>${formatoMoneda.format(monto)} · ${formatoNumero.format(pct)}%</span>
        </div>
        <div class="barra-pista"><div class="barra-relleno" style="width:${pct}%"></div></div>
      </div>`;
    })
    .join("");
}

// =====================================================================
// Helpers de modal
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
