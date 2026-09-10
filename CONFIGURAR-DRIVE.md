# Configurar Google Drive

Guía para dejar funcionando el modo Drive de la app (el que permite usarla desde
el celular). Son 4 revisiones en Google Cloud Console y un dato para pegar en el
código.

Todo se hace en <https://console.cloud.google.com> con el **mismo proyecto**
donde ya creaste el cliente OAuth.

---

## 1. La API de Drive tiene que estar habilitada

**APIs y servicios → Biblioteca → "Google Drive API" → Habilitar.**

Si dice "Administrar" en vez de "Habilitar", ya está lista.

Esta es la causa más común de que el login funcione pero después no se vea
ninguna carpeta: Google entrega el token igual, y solo al pedir archivos
responde `403 accessNotConfigured`.

---

## 2. Orígenes autorizados de JavaScript

**APIs y servicios → Credenciales → (tu ID de cliente OAuth 2.0).**

En **Orígenes autorizados de JavaScript** deben estar, cada uno en su renglón:

```
https://gestion-documental-phi.vercel.app
http://localhost:8777
```

Reglas que Google aplica al pie de la letra:

- **Sin barra al final.** `https://...app/` con barra NO sirve.
- **Sin ruta.** Solo el dominio, nada de `/index.html`.
- **`localhost` y `127.0.0.1` son orígenes DISTINTOS** para Google, aunque para
  el computador sean lo mismo. Si registras uno y abres el otro en el
  navegador, falla. Elige uno y sé consistente: aquí usamos `localhost`.
- El de `localhost` es solo para probar desde el computador; para el uso real
  (y para el celular) lo que cuenta es el de Vercel.

**URIs de redireccionamiento autorizados** puede quedar vacío: este flujo no
usa redirección, todo pasa en una ventana emergente.

Los cambios pueden tardar unos minutos en tomar efecto.

---

## 3. Pantalla de consentimiento: permisos y usuarios

**APIs y servicios → Pantalla de consentimiento de OAuth.**

### Permisos (scopes)

Tiene que estar agregado:

```
https://www.googleapis.com/auth/drive
```

Google lo marca como permiso **restringido** y da una advertencia. Es necesario
y no hay alternativa más pequeña: el permiso `drive.file`, que es el que Google
sugiere, solo deja ver archivos creados por la propia app — no vería tu carpeta
maestra, que ya existía desde antes.

### Usuarios de prueba

Con la app en estado **Prueba**, solo entran los correos que estén en la lista
de **Usuarios de prueba**. Agrega ahí todos los correos que vayan a usar la app
(hasta 100). Si falta uno, a esa persona Google le dirá "acceso denegado".

### ¿Hay que publicar la app?

**No, y es mejor dejarla en Prueba.** Publicarla con un permiso restringido
obliga a pasar por la verificación de Google, que incluye una evaluación de
seguridad — semanas de trámite y costo, para una app de uso interno.

La advertencia típica de que "en modo Prueba la sesión caduca a los 7 días" **no
aplica aquí**: esa regla es para los *refresh tokens*, y esta app no usa
ninguno. Funciona con tokens de acceso de 1 hora que se renuevan solos en
segundo plano mientras haya sesión de Google abierta en ese navegador — que en
un celular es prácticamente siempre.

---

## 4. Pegar el Client ID

En `index.html`, cerca del principio, está esta línea:

```html
<script>window.DRIVE_CLIENT_ID = 'PEGAR_AQUI_EL_CLIENT_ID.apps.googleusercontent.com';</script>
```

Reemplaza el texto por tu Client ID completo. Sale en **Credenciales**, en la
columna **ID de cliente**, y termina en `.apps.googleusercontent.com`.

No es un secreto: en cualquier aplicación web el Client ID viaja en el código y
se puede leer. Lo que protege el acceso es la lista de orígenes autorizados del
paso 2 y la de usuarios de prueba del paso 3. El **Client Secret**, ese sí es
secreto, y esta app no lo usa ni lo necesita.

---

## Cómo se usa

1. Abrir la app → **Google Drive** en el panel izquierdo.
2. Iniciar sesión con Google y aceptar los permisos (solo la primera vez).
3. Navegar hasta la carpeta maestra y pulsar **Usar esta carpeta**.

### Si la carpeta maestra te la compartieron

Es el caso normal aquí. Cuando alguien te comparte una carpeta y tú usas
*"Añadir acceso directo a Drive"*, Drive **no mueve** la carpeta a tu unidad:
crea un **acceso directo**, que es un tipo de archivo distinto a una carpeta.
La carpeta real sigue viviendo en **Compartido conmigo**.

El selector llega por los dos caminos, elige el que prefieras:

- **Compartido conmigo** → la carpeta. Es el camino directo.
- **Mi unidad** → el acceso directo (aparece marcado como "Acceso directo").

Da igual cuál uses: el selector resuelve el acceso directo y guarda siempre el
identificador de la carpeta real.

De ahí en adelante la carpeta queda recordada en ese dispositivo. Al volver a
abrir la app, entra sola: reanuda la sesión en silencio y vuelve directo a la
misma carpeta. Aunque la sesión de Google caduque del todo y toque volver a
iniciar, la carpeta sigue recordada — no hay que buscarla otra vez.

Para cambiar de carpeta o cerrar sesión: **Cambiar origen** en el panel
izquierdo.

---

## Si algo falla

| Lo que ves | Qué revisar |
|---|---|
| "Google rechazó el origen" | Paso 2. La URL debe ir exacta, sin barra final. |
| "Acceso denegado" | Paso 3. Tu correo no está en usuarios de prueba. |
| Entra pero no aparece ningún proyecto | Paso 1 (API sin habilitar), o elegiste una carpeta que no es la maestra. |
| "El navegador bloqueó el popup" | Permitir ventanas emergentes para el sitio. |
| El botón "Carpeta local" no aparece | Correcto: estás en celular o en Firefox/Safari, donde esa opción no existe. |

Para ver el detalle real de un error: F12 → pestaña **Console**.

---

## Nota sobre los dos modos

En computador conviene seguir usando **Carpeta local**: lee del disco a través
de Drive Desktop, no gasta cuota de API y es bastante más rápido. El modo Drive
es para el celular, o para cualquier equipo donde no esté sincronizada la
carpeta.

Los dos apuntan a los mismos archivos, así que se pueden combinar sin problema.
