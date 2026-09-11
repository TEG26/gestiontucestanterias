# Tucumán Estanterías — Gestión interna

Etapa 1 en construcción (Stock y Producción). Por ahora este repo tiene
el esqueleto de login y el shell de navegación — todavía no las
pantallas de datos.

## Publicar en GitHub Pages

1. Creá un repositorio nuevo en GitHub (puede ser privado — GitHub
   Pages funciona igual, aunque con cuenta gratuita el repo privado
   no publica Pages; si tu plan es gratuito, este repo debería ser
   público, ya que no tiene datos sensibles: las claves de Firebase no
   son secretas, y las reglas de Firestore son las que protegen los
   datos).
2. Subí todos los archivos de esta carpeta a la raíz del repo.
3. En GitHub: **Settings → Pages → Source → Deploy from a branch**,
   elegí la rama `main` y la carpeta `/ (root)`. Guardá.
4. GitHub te va a dar una URL tipo
   `https://tu-usuario.github.io/nombre-repo/`. Anotala, la necesitás
   para el siguiente paso.

## Terminar de configurar Firebase

1. **Authentication → Sign-in method → Google**: activarlo (si todavía
   no lo hiciste).
2. **Authentication → Settings → Authorized domains**: agregar el
   dominio de GitHub Pages (`tu-usuario.github.io`) — si no está en
   esta lista, el login con Google va a fallar en producción aunque
   funcione en local.
3. **Firestore Database → Create database**: modo producción (si
   todavía no lo hiciste).
4. **Firestore Database → Rules**: pegar el contenido de
   `firestore.rules` (de esta misma carpeta) y publicar.

## Probar en local antes de publicar

Como usa módulos ES (`type="module"`), no se puede abrir `index.html`
directo con doble click (el navegador bloquea los imports por CORS
en `file://`). Hace falta un servidor local mínimo, por ejemplo:

```
npx serve .
```

o cualquier extensión tipo "Live Server" de VS Code.
