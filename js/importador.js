import { db, auth } from "./firebase-config.js";
import { EMAILS_AUTORIZADOS } from "./whitelist.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Marca que llevan todos los documentos creados por esta importación,
// para poder identificarlos y deshacerlos sin tocar lo cargado a mano.
const ORIGEN = "migracion-excel";

const productosRef = collection(db, "productos");
const categoriasGastoRef = collection(db, "categoriasGasto");
const ventasRef = collection(db, "ventas");
const egresosRef = collection(db, "egresos");
const modulosRef = collection(db, "modulos");

const TASA_IVA = 0.21;

// =====================================================================
// Login (mismo criterio que la app)
// =====================================================================

const pantallaLogin = document.getElementById("pantalla-login");
const pantallaApp = document.getElementById("pantalla-app");
const pantallaNoAutorizado = document.getElementById("pantalla-no-autorizado");

function mostrarSolo(p) {
  [pantallaLogin, pantallaApp, pantallaNoAutorizado].forEach((el) => (el.hidden = el !== p));
}

document.getElementById("btn-login").addEventListener("click", () => {
  signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => console.error(e));
});
document.getElementById("btn-volver-login").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (!user) return mostrarSolo(pantallaLogin);
  if (!EMAILS_AUTORIZADOS.includes(user.email)) {
    document.getElementById("email-no-autorizado").textContent = user.email;
    return mostrarSolo(pantallaNoAutorizado);
  }
  mostrarSolo(pantallaApp);
});

// =====================================================================
// Utilidades
// =====================================================================

function escribirLog(idLog, texto, clase = "") {
  const el = document.getElementById(idLog);
  el.hidden = false;
  const linea = document.createElement("div");
  if (clase) linea.className = clase;
  linea.textContent = texto;
  el.appendChild(linea);
  el.scrollTop = el.scrollHeight;
}

function fechaISOaDate(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Firestore acepta hasta 500 operaciones por lote: se parte en tandas.
async function escribirEnLotes(operaciones, idLog, etiqueta, onProgreso) {
  const TAM = 400;
  let hechas = 0;
  for (let i = 0; i < operaciones.length; i += TAM) {
    const batch = writeBatch(db);
    operaciones.slice(i, i + TAM).forEach((op) => op(batch));
    await batch.commit();
    hechas += Math.min(TAM, operaciones.length - i);
    escribirLog(idLog, `   ${etiqueta}: ${hechas}/${operaciones.length}`);
    if (onProgreso) onProgreso(hechas, operaciones.length);
  }
}

// =====================================================================
// Paso 1: leer el archivo
// =====================================================================

let datos = null;

document.getElementById("archivo").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    datos = JSON.parse(await file.text());
    const totalV = datos.ventas.reduce((a, v) => a + v.montoTotal, 0);
    const totalE = datos.egresos.reduce((a, x) => a + x.monto, 0);
    document.getElementById("resumen-archivo").innerHTML = `
      <div class="log" style="display:block">
        Ventas:    ${datos.ventas.length} — $${totalV.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
        Egresos:   ${datos.egresos.length} — $${totalE.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
        Productos: ${datos.productos.length}
        Categorías:${datos.categorias.length}
      </div>`;
    document.getElementById("btn-verificar").disabled = false;
    document.getElementById("btn-importar").disabled = false;
  } catch (err) {
    console.error(err);
    document.getElementById("resumen-archivo").innerHTML =
      '<p class="error-form">No se pudo leer el archivo. ¿Es el JSON correcto?</p>';
  }
});

// =====================================================================
// Paso 2: verificar estado actual
// =====================================================================

async function contarImportados(ref) {
  const snap = await getDocs(query(ref, where("origenImportacion", "==", ORIGEN)));
  return snap.size;
}

document.getElementById("btn-verificar").addEventListener("click", async () => {
  const btn = document.getElementById("btn-verificar");
  btn.disabled = true;
  document.getElementById("log-verificar").innerHTML = "";
  try {
    const [pv, pe, pp, pc] = await Promise.all([
      contarImportados(ventasRef),
      contarImportados(egresosRef),
      contarImportados(productosRef),
      contarImportados(categoriasGastoRef)
    ]);
    const totalProd = (await getDocs(productosRef)).size;
    const totalCat = (await getDocs(categoriasGastoRef)).size;
    escribirLog("log-verificar", `Ya importado anteriormente:`);
    escribirLog("log-verificar", `   ventas: ${pv} · egresos: ${pe} · productos: ${pp} · categorías: ${pc}`);
    escribirLog("log-verificar", `En la base en total: ${totalProd} productos, ${totalCat} categorías`);
    if (pv + pe > 0) {
      escribirLog("log-verificar", "Atención: ya hay datos importados. Si volvés a importar se duplican — usá 'Deshacer' primero.", "err");
    } else {
      escribirLog("log-verificar", "Todo limpio, se puede importar.", "ok");
    }
  } catch (err) {
    console.error(err);
    escribirLog("log-verificar", "Error al verificar: " + err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

// =====================================================================
// Paso 3: importar
// =====================================================================

document.getElementById("btn-importar").addEventListener("click", async () => {
  if (!datos) return;
  if (!confirm(`Se van a cargar ${datos.ventas.length} ventas y ${datos.egresos.length} egresos. ¿Continuar?`)) return;

  const btn = document.getElementById("btn-importar");
  btn.disabled = true;
  document.getElementById("log-importar").innerHTML = "";
  document.getElementById("barra").hidden = false;
  const relleno = document.getElementById("barra-relleno");

  try {
    // ---- Productos: se crean solo los que no existan por nombre ----
    escribirLog("log-importar", "Leyendo productos existentes...");
    const snapProd = await getDocs(productosRef);
    const idPorProducto = {};
    snapProd.forEach((d) => (idPorProducto[d.data().nombre] = d.id));

    const productosNuevos = datos.productos.filter((p) => !idPorProducto[p.nombre]);
    const opsProd = productosNuevos.map((p) => {
      const ref = doc(productosRef);
      idPorProducto[p.nombre] = ref.id;
      return (batch) =>
        batch.set(ref, {
          nombre: p.nombre,
          unidad: p.unidad,
          receta: [],
          stockActual: 0,
          activo: true,
          origenImportacion: ORIGEN,
          creadoEn: serverTimestamp(),
          actualizadoEn: serverTimestamp()
        });
    });
    escribirLog("log-importar", `Productos nuevos a crear: ${productosNuevos.length} (ya existían ${datos.productos.length - productosNuevos.length})`);
    if (opsProd.length) await escribirEnLotes(opsProd, "log-importar", "productos");

    // ---- Categorías de gasto ----
    escribirLog("log-importar", "Leyendo categorías existentes...");
    const snapCat = await getDocs(categoriasGastoRef);
    const idPorCategoria = {};
    snapCat.forEach((d) => (idPorCategoria[d.data().nombre] = d.id));

    const catsNuevas = datos.categorias.filter((c) => !idPorCategoria[c]);
    const opsCat = catsNuevas.map((c) => {
      const ref = doc(categoriasGastoRef);
      idPorCategoria[c] = ref.id;
      return (batch) =>
        batch.set(ref, {
          nombre: c,
          noSeleccionable: c === "Materia prima y materiales",
          activo: true,
          origenImportacion: ORIGEN,
          creadoEn: serverTimestamp()
        });
    });
    escribirLog("log-importar", `Categorías nuevas a crear: ${catsNuevas.length}`);
    if (opsCat.length) await escribirEnLotes(opsCat, "log-importar", "categorías");

    // ---- Ventas ----
    // Se escriben directo en la colección: no pasan por la transacción de
    // venta de la app, así que NO descuentan stock. Es lo buscado: son
    // registro histórico para balance y análisis.
    const opsVentas = datos.ventas.map((v) => {
      const total = v.montoTotal;
      const neto = v.facturaA ? total / (1 + TASA_IVA) : total;
      const iva = total - neto;
      const items = v.items.map((i) => ({
        tipo: "producto",
        refId: idPorProducto[i.nombre] || null,
        nombreSnapshot: i.nombre,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
        subtotal: i.subtotal
      }));
      return (batch) =>
        batch.set(doc(ventasRef), {
          cliente: v.cliente,
          fecha: fechaISOaDate(v.fecha),
          items,
          medioPago: v.medioPago,
          facturaA: v.facturaA,
          montoNeto: round2(neto),
          ivaTotal: round2(iva),
          montoTotal: round2(total),
          origenImportacion: ORIGEN,
          filaExcel: v.fila_excel,
          creadoPor: auth.currentUser ? auth.currentUser.uid : null
        });
    });
    escribirLog("log-importar", `Cargando ${opsVentas.length} ventas...`);
    await escribirEnLotes(opsVentas, "log-importar", "ventas", (h, t) => {
      relleno.style.width = `${(h / t) * 50}%`;
    });

    // ---- Egresos ----
    const opsEgresos = datos.egresos.map((e) => {
      return (batch) =>
        batch.set(doc(egresosRef), {
          fecha: fechaISOaDate(e.fecha),
          categoriaId: idPorCategoria[e.categoria] || null,
          descripcion: e.descripcion,
          monto: e.monto,
          medioPago: e.medioPago,
          tieneFactura: e.tieneFactura,
          origenImportacion: ORIGEN,
          filaExcel: e.fila_excel,
          creadoEn: serverTimestamp()
        });
    });
    escribirLog("log-importar", `Cargando ${opsEgresos.length} egresos...`);
    await escribirEnLotes(opsEgresos, "log-importar", "egresos", (h, t) => {
      relleno.style.width = `${50 + (h / t) * 50}%`;
    });

    relleno.style.width = "100%";
    escribirLog("log-importar", "Importación terminada.", "ok");
    escribirLog("log-importar", "Revisá el panel de Balance en la app para confirmar los totales.", "ok");
  } catch (err) {
    console.error(err);
    escribirLog("log-importar", "ERROR: " + err.message, "err");
    escribirLog("log-importar", "Puede haber quedado a medias. Usá 'Deshacer' y volvé a intentar.", "err");
  } finally {
    btn.disabled = false;
  }
});


// =====================================================================
// Importación de recetas y costos de producción
// =====================================================================

let datosProd = null;

document.getElementById("archivo-prod").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    datosProd = JSON.parse(await file.text());
    document.getElementById("resumen-archivo-prod").innerHTML = `
      <div class="log" style="display:block">
        Elementos: ${datosProd.elementos.length}
        Productos: ${datosProd.productos.length}
        Conjuntos: ${datosProd.conjuntos.length}
      </div>`;
    document.getElementById("btn-importar-prod").disabled = false;
  } catch (err) {
    console.error(err);
    document.getElementById("resumen-archivo-prod").innerHTML =
      '<p class="error-form">No se pudo leer el archivo.</p>';
  }
});

document.getElementById("btn-importar-prod").addEventListener("click", async () => {
  if (!datosProd) return;
  if (!confirm("Se van a crear/completar elementos, recetas de productos y composiciones de conjuntos. ¿Continuar?")) return;

  const btn = document.getElementById("btn-importar-prod");
  btn.disabled = true;
  document.getElementById("log-importar-prod").innerHTML = "";
  const LOG = "log-importar-prod";

  try {
    // ---- Elementos (materia prima) ----
    escribirLog(LOG, "Leyendo elementos existentes...");
    const snapMat = await getDocs(collection(db, "materiasPrimas"));
    const idPorElemento = {};
    snapMat.forEach((d) => (idPorElemento[d.data().nombre] = d.id));

    const opsMat = [];
    datosProd.elementos.forEach((el) => {
      if (idPorElemento[el.nombre]) return;
      const ref = doc(collection(db, "materiasPrimas"));
      idPorElemento[el.nombre] = ref.id;
      // El costo del Excel entra como punto de partida: la próxima
      // compra real de ese elemento lo pisa automáticamente.
      opsMat.push((batch) =>
        batch.set(ref, {
          nombre: el.nombre,
          unidad: el.unidad,
          stockActual: 0,
          activo: true,
          ultimoCostoNeto: el.costoReferencia,
          origenImportacion: ORIGEN,
          creadoEn: serverTimestamp(),
          actualizadoEn: serverTimestamp()
        })
      );
    });
    escribirLog(LOG, `Elementos nuevos: ${opsMat.length}`);
    if (opsMat.length) await escribirEnLotes(opsMat, LOG, "elementos");

    // ---- Productos con receta ----
    escribirLog(LOG, "Leyendo productos existentes...");
    const snapProd = await getDocs(productosRef);
    const idPorProducto = {};
    snapProd.forEach((d) => (idPorProducto[d.data().nombre] = d.id));

    const opsProd = [];
    let nuevos = 0, actualizados = 0;
    datosProd.productos.forEach((p) => {
      const receta = p.receta.map((r) => ({
        materiaId: idPorElemento[r.elemento],
        cantidadPorUnidad: r.cantidadPorUnidad
      })).filter((r) => r.materiaId);

      const existente = idPorProducto[p.nombre];
      if (existente) {
        actualizados++;
        opsProd.push((batch) =>
          batch.update(doc(productosRef, existente), { receta, actualizadoEn: serverTimestamp() })
        );
      } else {
        nuevos++;
        const ref = doc(productosRef);
        idPorProducto[p.nombre] = ref.id;
        opsProd.push((batch) =>
          batch.set(ref, {
            nombre: p.nombre,
            unidad: p.unidad,
            receta,
            stockActual: 0,
            activo: true,
            origenImportacion: ORIGEN,
            creadoEn: serverTimestamp(),
            actualizadoEn: serverTimestamp()
          })
        );
      }
    });
    escribirLog(LOG, `Productos: ${nuevos} nuevos, ${actualizados} con receta completada`);
    if (opsProd.length) await escribirEnLotes(opsProd, LOG, "productos");

    // ---- Conjuntos con composición ----
    escribirLog(LOG, "Leyendo conjuntos existentes...");
    const snapMod = await getDocs(modulosRef);
    const idPorConjunto = {};
    snapMod.forEach((d) => (idPorConjunto[d.data().nombre] = d.id));

    const opsMod = [];
    const sinResolver = new Set();
    datosProd.conjuntos.forEach((c) => {
      const composicion = c.composicion.map((it) => {
        const refId = it.tipo === "elemento" ? idPorElemento[it.nombre] : idPorProducto[it.nombre];
        if (!refId) { sinResolver.add(it.nombre); return null; }
        return { tipo: it.tipo, refId, cantidad: it.cantidad };
      }).filter(Boolean);

      const existente = idPorConjunto[c.nombre];
      if (existente) {
        opsMod.push((batch) =>
          batch.update(doc(modulosRef, existente), { composicion, actualizadoEn: serverTimestamp() })
        );
      } else {
        opsMod.push((batch) =>
          batch.set(doc(modulosRef), {
            nombre: c.nombre,
            composicion,
            activo: true,
            origenImportacion: ORIGEN,
            creadoEn: serverTimestamp(),
            actualizadoEn: serverTimestamp()
          })
        );
      }
    });
    if (sinResolver.size) {
      escribirLog(LOG, `Piezas que no se pudieron enlazar: ${[...sinResolver].join(", ")}`, "err");
    }
    escribirLog(LOG, `Conjuntos a cargar: ${opsMod.length}`);
    if (opsMod.length) await escribirEnLotes(opsMod, LOG, "conjuntos");

    escribirLog(LOG, "Listo. Revisá el panel de Análisis de producción.", "ok");
  } catch (err) {
    console.error(err);
    escribirLog(LOG, "ERROR: " + err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

// =====================================================================
// Deshacer
// =====================================================================

async function borrarImportados(ref, etiqueta) {
  const snap = await getDocs(query(ref, where("origenImportacion", "==", ORIGEN)));
  if (snap.empty) {
    escribirLog("log-deshacer", `   ${etiqueta}: nada que borrar`);
    return 0;
  }
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  escribirLog("log-deshacer", `   ${etiqueta}: ${docs.length} borrados`);
  return docs.length;
}

document.getElementById("btn-deshacer").addEventListener("click", async () => {
  if (!confirm("Se van a borrar TODOS los registros que entraron por la importación (ventas, egresos, productos y categorías creados por ella). Lo cargado a mano no se toca. ¿Continuar?")) return;
  const btn = document.getElementById("btn-deshacer");
  btn.disabled = true;
  document.getElementById("log-deshacer").innerHTML = "";
  try {
    escribirLog("log-deshacer", "Borrando...");
    await borrarImportados(ventasRef, "ventas");
    await borrarImportados(egresosRef, "egresos");
    await borrarImportados(productosRef, "productos");
    await borrarImportados(modulosRef, "conjuntos");
    await borrarImportados(collection(db, "materiasPrimas"), "elementos");
    await borrarImportados(categoriasGastoRef, "categorías");
    escribirLog("log-deshacer", "Listo, la base quedó como antes de importar.", "ok");
  } catch (err) {
    console.error(err);
    escribirLog("log-deshacer", "ERROR: " + err.message, "err");
  } finally {
    btn.disabled = false;
  }
});
