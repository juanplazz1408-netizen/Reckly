# Política de Seguridad — Reckly

Este documento define las prácticas de seguridad obligatorias para el proyecto Reckly (PWA de finanzas personales, alojada en GitHub Pages, sin backend propio, sincronizada con Google Sheets vía OAuth 2.0).

No contiene secretos, tokens, credenciales ni valores reales. Cualquier ejemplo de aquí es ilustrativo.

---

## 1. Prácticas obligatorias de seguridad

- **Todo dato dinámico insertado en el DOM debe pasar por una función de escape** (`escapeHtml`) antes de usarse en `innerHTML`. Preferir `textContent` siempre que no se necesite HTML real.
- **Ningún valor de texto proveniente del usuario o de una URL se envía a Google Sheets con `valueInputOption=USER_ENTERED` sin neutralizar previamente** los caracteres `= + - @` al inicio de la cadena (prevención de inyección de fórmulas).
- **Todo parámetro leído de `URLSearchParams` (ej. el flujo `quickadd` del Atajo) se trata como entrada no confiable**: se valida tipo, longitud y contenido antes de usarse en cualquier parte de la UI o de una petición a la API.
- **No se usa `eval()`, `new Function()` ni `document.write()`** en ningún punto del código.
- Antes de cada entrega de una nueva versión, se revisa que no se haya introducido HTML/JS sin escapar en ningún punto que reciba datos del usuario.
- Se mantiene una única fuente de verdad del archivo desplegado (el repositorio de GitHub); nunca se asume que una copia local de trabajo está sincronizada con lo publicado sin verificarlo explícitamente.

## 2. Gestión de secretos

- **Este proyecto no debe contener nunca**: claves privadas, client secrets de OAuth, API keys de servicios de pago, contraseñas, tokens de larga duración, ni archivos de credenciales de service account.
- El único identificador público embebido en el código es el **OAuth Client ID** de Google (tipo "Web application"). Esto es aceptable porque:
  - Los Client ID de aplicaciones web son públicos por diseño en el estándar OAuth 2.0.
  - La protección real la da la lista de **"Orígenes de JavaScript autorizados"** configurada en Google Cloud Console, no la confidencialidad del ID.
- **Nunca se debe agregar un Client Secret** a este proyecto. Si en el futuro se necesita un flujo que lo requiera (ej. Authorization Code flow con backend), eso implica introducir un servidor, y el secreto debe vivir únicamente en variables de entorno de ese servidor — nunca en el código que se sirve al navegador.
- Antes de cada `git push`, revisar manualmente (o con una herramienta como `gitleaks` / `trufflehog`) que no se haya pegado por error ningún valor sensible en el `index.html`.
- Si alguna vez se detecta un secreto expuesto en el historial de git, no basta con borrarlo del archivo actual: hay que revocarlo/regenerarlo en el proveedor (Google Cloud, etc.) y reescribir el historial si es necesario.

## 3. Política de contraseñas

- Reckly **no implementa un sistema de autenticación propio** (usuario/contraseña); toda identidad se delega en el proveedor de OAuth (cuenta de Google).
- Por lo tanto, no se almacenan ni gestionan contraseñas de ningún tipo dentro de este proyecto.
- Si en algún momento se agregara cualquier mecanismo de autenticación propio (ej. un PIN local para abrir la app), debe cumplir como mínimo:
  - No almacenarse en texto plano en ningún lugar (ni `localStorage` ni el código).
  - Usar un mecanismo de hash con sal si se guarda cualquier verificador (ej. `SubtleCrypto` del navegador), nunca comparación de texto plano.

## 4. Autenticación y autorización

- La autenticación se realiza exclusivamente vía **Google Identity Services (OAuth 2.0, flujo de token implícito para SPA)**. Reckly nunca ve, procesa ni almacena una contraseña — la identidad del usuario la verifica Google, no esta app.
- El scope usado es `drive.file` (acceso solo a archivos creados por la app), ya migrado desde el `spreadsheets` original.
- Los tokens de acceso:
  - Tienen vida corta (gestionada por Google, típicamente ~1 hora) y ya se revisan contra `expires_at` antes de reutilizarse.
  - Se solicitan de nuevo cuando expiran; no se debe implementar ningún mecanismo para extender su vida artificialmente.
  - El usuario tiene una opción visible en Ajustes ("Desconectar Google Drive") para **revocar el acceso** (`google.accounts.oauth2.revoke`) y limpiar el token local — implementado.
- No existe (ni debe existir) un "rol" o "permiso" interno dentro de la app: cada usuario solo controla su propio dispositivo y su propia hoja de cálculo.

### 4.1 Modelo real de autorización (por qué no hay controles de servidor)

Reckly no tiene backend propio, por lo que categorías como sesiones de servidor, cookies `Secure/HttpOnly/SameSite`, CSRF clásico, rate limiting de login o IDOR/BOLA **se resuelven en la capa de Google, no en el código de esta app**:

- **MFA**: se activa en la cuenta de Google del usuario (myaccount.google.com/security → Verificación en dos pasos), no dentro de Reckly. Es la protección real, porque la identidad de Reckly ES la cuenta de Google.
- **IDOR/BOLA**: el identificador de la hoja (`sheetId`) se lee solo de `localStorage`, nunca de un parámetro manipulable por URL. Aunque se alterara localmente, el scope `drive.file` hace que Google rechace cualquier intento de acceder a un archivo que el token del usuario no esté autorizado a tocar — el control de acceso real lo aplica Google, por diseño del scope, no un chequeo propio de Reckly.
- **CSRF**: no aplica porque no hay cookies de sesión que un sitio externo pueda "montar" automáticamente; el token viaja en un header `Authorization` que solo el propio JavaScript de Reckly puede adjuntar.
- **Rate limiting hacia Google**: las sincronizaciones automáticas (movimientos programados, cuotas de tarjeta) pasan por una cola (`queueSync`) que las procesa una por una en vez de en ráfaga, para no agotar la cuota de la API de Google si se acumulan muchas pendientes.

## 5. Manejo seguro de archivos

- La app no permite subir archivos arbitrarios; toda persistencia de datos financieros ocurre en `localStorage` (local al dispositivo) y en Google Sheets (vía API oficial).
- Cualquier funcionalidad futura de importar/exportar archivos debe:
  - Validar extensión y tipo MIME antes de procesar.
  - Nunca ejecutar ni interpretar contenido de archivos subidos como código.
  - Limitar el tamaño máximo aceptado.

## 6. Requisitos para dependencias

- Toda librería de terceros cargada desde un CDN (ej. Chart.js) debe:
  - Fijarse a una **versión específica** (nunca `latest`).
  - Verificarse periódicamente contra avisos de seguridad conocidos (CVEs).
  - Incluir el atributo `integrity` (Subresource Integrity) siempre que el CDN lo soporte.
- No se agregan dependencias nuevas sin evaluar antes: origen, mantenimiento activo, y necesidad real (evitar dependencias innecesarias que amplíen la superficie de ataque).

## 7. Protección de APIs

- Todas las llamadas a la API de Google Sheets se hacen directamente desde el navegador del usuario con su propio token — no existe un backend intermedio que las reciba ni las reenvíe.
- Toda entrada de texto que se escriba en una celda de Sheets debe neutralizarse contra inyección de fórmulas (ver sección 1) antes de enviarse.
- Los errores de la API se muestran de forma legible al usuario, pero nunca se deben registrar ni enviar a un servicio externo de logging sin el consentimiento explícito del usuario.

## 8. Reglas para GitHub

- El repositorio que aloja este proyecto en GitHub Pages debe tratarse como **código público**: nunca asumir privacidad de nada que se suba.
- No se sube nunca ningún archivo `.env`, credenciales, ni volcados de datos personales reales (ej. una hoja de cálculo exportada con movimientos reales) al repositorio.
- Antes de cada `git push`, revisar el `diff` para confirmar que no se incluyen datos personales ni secretos.

### 8.1 Configuración obligatoria del repositorio (activar manualmente en GitHub → Settings)

Estos controles no se pueden activar desde el código; se configuran una sola vez en la interfaz web de GitHub:

- **Secret scanning + Push protection**: Settings → Code security → activar "Secret scanning" y "Push protection". En repositorios públicos, GitHub activa el escaneo básico de secretos automáticamente sin costo; "Push protection" (que bloquea el `push` antes de que el secreto llegue al repo) sí requiere activarse a mano.
- **Dependabot alerts**: Settings → Code security → activar "Dependabot alerts" y "Dependabot security updates". Ya existe `.github/dependabot.yml` en este repo listo para cuando haya algo que vigilar.
- **Protección de la rama principal (`main`)**: Settings → Branches → Add branch protection rule sobre `main`:
  - "Require a pull request before merging" (bloquea el push directo a `main`).
  - "Require approvals" con al menos 1 aprobación — solo tiene sentido real si en algún momento colaboras con alguien más; en un repo de un solo mantenedor, esta regla igual sirve como freno para no fusionar cambios propios sin pasar por una revisión consciente vía PR.
  - "Require review from Code Owners" (usa el `.github/CODEOWNERS` ya incluido en este repo).
  - "Do not allow bypassing the above settings" para que ni siquiera el administrador salte la regla sin querer.
- **Permisos de GitHub Actions** (aplica el día que agregues algún workflow): Settings → Actions → General → "Workflow permissions" dejarlo en **"Read repository contents permission"** (solo lectura) en vez de "Read and write", y activar "Require approval for first-time contributors" si el repo llegara a aceptar colaboradores externos.

### 8.2 Reglas para cualquier futuro workflow de GitHub Actions

Aunque **este proyecto no tiene ningún workflow de Actions actualmente** (se verificó explícitamente), si en el futuro se agrega alguno debe cumplir:

- Bloque `permissions:` explícito al inicio del workflow, con el mínimo necesario (ej. `contents: read`); nunca dejar los permisos por defecto ni usar `write-all`.
- Nunca usar el evento `pull_request_target` combinado con checkout del código de un PR externo — es una combinación insegura conocida (ejecuta el workflow con permisos/secretos del repo base sobre código no confiable).
- Toda Action de terceros (`uses: usuario/accion@...`) debe fijarse a un **commit SHA completo de 40 caracteres**, no a una etiqueta (`@v3`) ni a una rama — las etiquetas se pueden mover después de publicadas. El SHA se obtiene desde la página de "Releases" de la Action en GitHub.
- No exponer ningún `secrets.*` a steps que ejecuten código de terceros no auditado.
- No subir artefactos que contengan datos de usuarios reales ni credenciales.

## 9. Reglas para Google Drive / Google Sheets

- La hoja de cálculo creada por la app es propiedad del usuario dentro de su propia cuenta de Google Drive; Reckly no tiene ni debe tener acceso a hojas de otros usuarios.
- No se debe ampliar nunca el scope de OAuth más allá de lo estrictamente necesario para leer/escribir la hoja de la propia app. Scope actual: `drive.file` (verificado — no existe ningún otro scope en el código).
- El usuario es responsable de la configuración de compartición de su propia hoja (quién más tiene acceso); la app no gestiona permisos de compartición.
- **Reckly nunca implementa funciones de eliminar ni compartir archivos de Drive.** Si algún día se agrega cualquiera de las dos, debe pedirse confirmación explícita al usuario antes de ejecutar la acción (nunca automático ni silencioso).

### 9.1 Flujo OAuth usado y su límite conocido

Reckly usa `google.accounts.oauth2.initTokenClient()` (el "modelo de token" de Google Identity Services), que internamente es una variante del **flujo implícito de OAuth 2.0**. Puntos verificados:

- **No emite refresh tokens** — cada conexión pide un access token nuevo directamente; no hay nada de esa naturaleza que almacenar ni que pueda filtrarse.
- **No usa `redirect_uri`, `state` ni PKCE configurables por la app** — Google los maneja internamente en este modo; el control de origen equivalente es la lista de "Orígenes de JavaScript autorizados" en Google Cloud Console.
- Google **recomienda actualmente el flujo alternativo "código de autorización + PKCE"** por ser más resistente a interceptación de tokens. Esa alternativa **requiere un backend propio** (para intercambiar el código por el token usando un client secret, que nunca puede vivir en el navegador) — algo que este proyecto no tiene por decisión de diseño (sitio estático en GitHub Pages, sin costo de servidor).
- **Decisión consciente y documentada**: se acepta el flujo de token/implícito para esta app, dado que es de un solo usuario, el scope ya está acotado a `drive.file`, el token expira en ~1 hora, y existe revocación manual desde Ajustes. Si el proyecto alguna vez necesita el nivel de seguridad del flujo con PKCE, eso implica primero incorporar un backend (aunque sea una función serverless mínima) — es una decisión de arquitectura que debe tomarse explícitamente, no una tarea de "endurecimiento" incremental.

### 9.2 Manejo de archivos (para cuando aplique)

Reckly no sube, descarga, ni procesa archivos hoy (no hay `<input type="file">` en el proyecto). Si en el futuro se agrega cualquier funcionalidad de este tipo, debe cumplir obligatoriamente:

- Validar el tipo real del archivo por contenido (magic bytes), no solo por extensión o por el MIME que reporta el navegador.
- Límite de tamaño máximo explícito antes de leer el archivo completo en memoria.
- Nunca aceptar ni ejecutar archivos con extensión ejecutable (`.exe`, `.sh`, `.js`, `.html` como adjunto, etc.).
- Generar un nombre de archivo propio (no reutilizar el nombre que trae el archivo del usuario) para evitar path traversal (`../../`) si alguna vez se guarda en algún almacenamiento.
- Cualquier archivo temporal debe vivir aislado de otros datos del usuario y borrarse inmediatamente después de procesarse.

### 9.3 SSRF

Verificado exhaustivamente: todas las peticiones de red del proyecto (`fetch`/`window.open`) apuntan a dominios fijos de Google (`sheets.googleapis.com`, `docs.google.com`, `accounts.google.com`) escritos directamente en el código — nunca a una URL provista por el usuario. No existe ningún campo de la app donde el usuario pueda escribir una URL que la aplicación luego solicite. Si en el futuro se agrega una funcionalidad así (por ejemplo, "importar desde una URL"), debe implementarse con una **lista blanca de dominios permitidos** y bloqueo explícito de `localhost`, `127.0.0.1`, rangos privados (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) y cualquier endpoint de metadata de nube (`169.254.169.254`).

### 9.4 CORS y headers HTTP de seguridad — limitación real de GitHub Pages

**GitHub Pages (modo "Deploy from a branch", el que usa este proyecto) no permite configurar headers HTTP de respuesta personalizados.** No existe un archivo `_headers` ni configuración de servidor equivalente. Esto determina todo lo siguiente:

- **CORS**: Reckly no es un servidor y no emite ningún header `Access-Control-Allow-Origin` propio — no hay nada que auditar de ese lado porque no existe superficie servidora propia. Los dos "servidores" reales involucrados son:
  - **GitHub Pages**, que sirve los archivos estáticos de la app (HTML/CSS/JS/íconos) — no contienen datos privados del usuario ni credenciales, así que su política de CORS (fuera de nuestro control) no representa riesgo real.
  - **La API de Google** (`sheets.googleapis.com`), que sí contiene los datos privados — el control de acceso real ahí no es CORS, es la combinación de token OAuth + scope `drive.file` + "Orígenes de JavaScript autorizados" configurados en Google Cloud Console (ya restringido únicamente al dominio real de la app).
- **Headers que SÍ se pudieron aplicar** (vía `<meta>`, la única vía disponible sin servidor propio):
  - `Content-Security-Policy` ✅ ya implementado.
  - `Referrer-Policy: strict-origin-when-cross-origin` ✅ implementado en esta ronda.
- **Headers que NO se pueden aplicar en este hosting** (solo funcionan como header HTTP real, nunca vía `<meta>`, técnicamente ignorados por el navegador si se intentan así):
  - `Strict-Transport-Security` (HSTS) — mitigado parcialmente porque el dominio `github.io` completo ya viene precargado en la lista HSTS de los navegadores modernos (fuerzan HTTPS igual, sin depender del header).
  - `X-Content-Type-Options: nosniff`.
  - `X-Frame-Options`.
  - `Permissions-Policy` (su soporte vía `<meta>` no es fiable entre navegadores).
  - La directiva `frame-ancestors` dentro del CSP actual **también cae en esta categoría**: el estándar de CSP indica explícitamente que `frame-ancestors` solo se aplica cuando el CSP llega por header HTTP real, no vía `<meta>` — queda en el código como documentación de intención, pero el navegador la ignora en la práctica.
- **Mitigación de clickjacking implementada igual**: ya que la vía de headers está bloqueada, se agregó protección anti-clickjacking en JavaScript (comprobación `window.top !== window.self` que saca la página de cualquier iframe ajeno, con una salida de emergencia que oculta el contenido si ni siquiera se puede leer `window.top` por política de mismo origen).
- **Si en algún momento se quiere el conjunto completo de headers reales**, la única solución es migrar el hosting a una plataforma que sí soporte headers personalizados manteniendo los mismos archivos estáticos (por ejemplo Cloudflare Pages o Netlify, ambos con planes gratuitos) — es un cambio de hosting, no de código, y debe decidirse explícitamente, no aplicarse de forma incremental.

## 10. Logging y monitoreo

- La app **no envía telemetría, analítica ni logs a ningún servidor externo**. Todo registro ocurre únicamente en la consola del navegador del propio usuario (visible solo para él, con las herramientas de desarrollador).
- **Eventos de seguridad registrados** (función `logSecurityEvent()`, con marca de tiempo ISO en cada línea):
  - `login_success` / `login_failure` — al conectar con Google Drive.
  - `logout` — al revocar el acceso desde Ajustes.
  - `quickadd_rejected` / `quickadd_success` — validación de los parámetros que llegan por la URL del Atajo (el equivalente más cercano a un "error de autorización" en una app sin backend: una cuenta o monto que no supera la lista blanca).
  - `sync_call_failed` — cualquier llamada a la API de Google que falle.
- **Nunca se registran**: el token de acceso, montos, descripciones, nombres de cuenta/tarjeta, ni ningún otro dato financiero — los eventos anteriores solo incluyen el tipo de evento y, cuando aplica, el mensaje de error ya sanitizado (nunca el objeto de error completo ni su `stack`).
- No se debe agregar en el futuro ningún servicio de analítica de terceros sin: (a) que sea estrictamente necesario, (b) que se documente qué datos recoge, y (c) que se informe al usuario.

### 10.1 Manejo de errores frente al usuario

- Verificado: el proyecto no tiene stack traces, rutas de servidor, consultas SQL, variables de entorno ni credenciales que pudieran filtrarse en un mensaje de error, porque ninguna de esas cosas existe en esta arquitectura (sin servidor, sin base de datos).
- Los dos únicos puntos que muestran detalle técnico al usuario (`showError()`) solo exponen el **mensaje de error ya sanitizado que devuelve la propia API de Google** (por ejemplo "la API no está habilitada" o un código HTTP) — nunca un objeto crudo, nunca el token. Esto es intencional: como no hay un equipo de soporte detrás, el propio usuario necesita ver el detalle real para poder resolverlo o compartirlo para pedir ayuda.
- Si en el futuro se agrega cualquier lógica de servidor, debe devolver siempre un mensaje genérico al usuario ("Ocurrió un error, intenta de nuevo") y guardar el detalle técnico completo únicamente en un log seguro del lado servidor, nunca en la respuesta al cliente.

## 11. Reporte de vulnerabilidades

- Si se detecta una vulnerabilidad en este proyecto, se debe:
  1. Documentarla en detalle (archivo, línea, cómo reproducirla).
  2. Priorizar su corrección según severidad (Crítico > Alto > Medio > Bajo), atendiendo primero cualquier hallazgo Crítico o Alto.
  3. Aplicar el arreglo y volver a desplegar antes de continuar con nuevas funcionalidades no relacionadas.
- Al ser un proyecto personal sin canal público de reporte, cualquier hallazgo se atiende directamente entre el desarrollador y quien lo detecte.

## 12. Respuesta ante incidentes

Si se sospecha que el token de Google fue comprometido (por ejemplo, tras detectar cambios no reconocidos en la hoja de cálculo):

1. **Revocar inmediatamente el acceso** desde [myaccount.google.com/permissions](https://myaccount.google.com/permissions), buscando la app y quitando su acceso.
2. Revisar el historial de versiones de la hoja de Google Sheets afectada (Archivo > Historial de versiones) para identificar y revertir cambios no autorizados.
3. Si se sospecha que la causa fue un XSS explotado, dejar de usar la app hasta que el hallazgo correspondiente (ver sección de análisis de seguridad del proyecto) esté corregido y verificado.
4. Volver a conectar la app únicamente después de confirmar que la causa raíz fue corregida.
5. Si se sospecha compromiso del propio Client ID (por ejemplo, orígenes autorizados modificados sin tu intervención), revisar inmediatamente la configuración en Google Cloud Console y regenerar credenciales si es necesario.

---

*Última actualización de este documento: al momento de la auditoría de seguridad inicial del proyecto. Debe revisarse y actualizarse cada vez que se implemente una recomendación de la auditoría o se agregue una nueva integración externa.*
