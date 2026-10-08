# Folio: especificación inicial de traducción EPUB

Este documento esta escrito para guiar a un modelo LLM barato en la implementacion de una pequena aplicacion web. El objetivo es construir una herramienta local/simple que permita subir un archivo EPUB en ingles, traducir su contenido al espanol usando un LLM remoto via API, y descargar un nuevo EPUB traducido.

No hay usuarios, sesiones, login, permisos, pagos, base de datos ni paneles de administracion.

## Objetivo del producto

Crear una webapp con:

- Frontend en React + TypeScript.
- Backend en Fastify + TypeScript.
- Traduccion mediante una API remota compatible con LLM.
- Entrada: archivo `.epub` en ingles.
- Salida: archivo `.epub` traducido al espanol.
- Uso previsto: ejecucion local o despliegue pequeno para uso personal.

## Alcance funcional

La aplicacion debe permitir:

1. Subir un archivo EPUB.
2. Mostrar el estado del procesamiento.
3. Extraer los documentos HTML/XHTML internos del EPUB.
4. Dividir el contenido textual en fragmentos manejables.
5. Enviar los fragmentos al LLM remoto para traducirlos de ingles a espanol.
6. Mantener la estructura del EPUB tanto como sea posible.
7. Reemplazar solo texto visible, sin romper etiquetas HTML, imagenes, estilos, enlaces ni metadatos basicos.
8. Generar un EPUB final descargable.
9. Informar errores de forma clara.

Fuera de alcance:

- Autenticacion.
- Gestion de usuarios.
- Historial persistente de traducciones.
- Cola distribuida de trabajos.
- Pagos.
- Edicion manual avanzada del texto traducido.
- Traduccion simultanea multiusuario.
- Soporte inicial para otros idiomas.

## Stack tecnico

Usar:

- Node.js con TypeScript.
- Backend: Fastify.
- Frontend: React + TypeScript + Vite.
- Estilos simples con CSS normal o una libreria ligera si ya esta configurada.
- Cliente HTTP desde frontend con `fetch`.
- API LLM configurable por variables de entorno.

Estructura recomendada:

```txt
folio/
  apps/
    web/
      src/
        App.tsx
        main.tsx
        styles.css
    api/
      src/
        server.ts
        routes/
          translate.ts
        services/
          epub.ts
          llm.ts
          jobs.ts
        types.ts
  package.json
  tsconfig.json
  README.md
  .env.example
```

Si se prefiere una estructura mas simple, tambien es aceptable:

```txt
src/
  client/
  server/
```

Lo importante es mantener frontend y backend claramente separados.

## Variables de entorno

Crear `.env.example` con:

```env
PORT=3001
LLM_API_BASE_URL=https://api.example.com/v1
LLM_API_KEY=replace-me
LLM_MODEL=replace-me
LLM_TIMEOUT_MS=120000
MAX_UPLOAD_MB=100
```

La implementacion debe asumir una API tipo OpenAI-compatible cuando sea posible:

```http
POST /chat/completions
Authorization: Bearer <LLM_API_KEY>
Content-Type: application/json
```

Pero el codigo debe aislar esta logica en `llm.ts` para poder cambiar de proveedor facilmente.

## Flujo de usuario

Pantalla unica:

1. Zona para seleccionar o arrastrar un archivo `.epub`.
2. Boton "Traducir".
3. Indicador de progreso:
   - Subiendo archivo.
   - Leyendo EPUB.
   - Traduciendo fragmento X de Y.
   - Generando EPUB.
   - Listo.
4. Boton para descargar el EPUB traducido.
5. Zona de errores si algo falla.

No crear landing page de marketing. La primera pantalla debe ser la herramienta usable.

## API backend

### `POST /api/translate`

Recibe un archivo EPUB mediante `multipart/form-data`.

Respuesta:

```json
{
  "jobId": "uuid"
}
```

El backend inicia el trabajo en memoria.

### `GET /api/jobs/:jobId`

Devuelve el estado del trabajo:

```json
{
  "id": "uuid",
  "status": "pending | processing | done | error",
  "progress": {
    "current": 12,
    "total": 80,
    "message": "Traduciendo fragmento 12 de 80"
  },
  "error": null,
  "downloadUrl": "/api/jobs/uuid/download"
}
```

### `GET /api/jobs/:jobId/download`

Devuelve el archivo EPUB traducido cuando el estado sea `done`.

Si el trabajo no esta listo, responder con HTTP `409`.
Si no existe, responder con HTTP `404`.

## Gestion de trabajos

Como no hay usuarios ni persistencia, usar almacenamiento en memoria.

Cada job debe guardar:

- `id`.
- `status`.
- `progress`.
- `inputFilePath`.
- `outputFilePath`.
- `error`.
- fecha de creacion.

Guardar archivos temporales en una carpeta local como `tmp/jobs/<jobId>/`.

Implementar una limpieza simple:

- Al arrancar, borrar trabajos temporales antiguos si existen.
- Opcionalmente, borrar trabajos con mas de 24 horas.

## Procesamiento EPUB

La implementacion debe:

1. Descomprimir el EPUB como ZIP.
2. Localizar los archivos `.html`, `.xhtml` o `.htm`.
3. Parsear cada documento como HTML/XML.
4. Recorrer nodos de texto visibles.
5. Ignorar texto dentro de:
   - `script`
   - `style`
   - `svg`
   - `code`
   - `pre`
6. Agrupar textos en fragmentos para traducir.
7. Reemplazar los nodos de texto originales por sus traducciones.
8. Volver a empaquetar el EPUB.

Librerias sugeridas:

- ZIP/EPUB: `adm-zip`, `yauzl` + `yazl`, o libreria equivalente mantenida.
- HTML parsing: `htmlparser2`, `parse5`, `cheerio` o `linkedom`.
- UUID: `uuid` o `crypto.randomUUID`.

Priorizar una implementacion robusta antes que una perfecta. Es aceptable que la primera version no preserve casos raros de EPUB, pero no debe romper EPUBs simples.

## Estrategia de traduccion

No enviar un libro entero al LLM de una vez.

Crear fragmentos con limites aproximados:

- Maximo recomendado: 2.000 a 4.000 caracteres por llamada.
- No cortar dentro de una etiqueta HTML.
- Traducir texto plano extraido de nodos, no HTML completo, salvo que se implemente un formato seguro.

Estrategia recomendada:

1. Extraer nodos de texto.
2. Crear una lista de items:

```ts
type TextItem = {
  id: string;
  text: string;
};
```

3. Enviar lotes al LLM como JSON:

```json
[
  { "id": "t1", "text": "Original sentence." },
  { "id": "t2", "text": "Another paragraph." }
]
```

4. Pedir que responda JSON con el mismo formato:

```json
[
  { "id": "t1", "text": "Frase original traducida." },
  { "id": "t2", "text": "Otro parrafo." }
]
```

5. Validar que:
   - La respuesta sea JSON parseable.
   - Todos los IDs enviados vuelvan.
   - No aparezcan IDs desconocidos.

Si la respuesta falla, reintentar el lote una vez. Si sigue fallando, marcar el job como `error`.

## Prompt recomendado

Sistema:

```txt
Eres un traductor profesional literario. Traduce del ingles al espanol de Espana con naturalidad, conservando el significado, tono, dialogos y estilo. No resumas. No expliques. No anadas comentarios. Devuelve exclusivamente JSON valido.
```

Usuario:

```txt
Traduce al espanol el campo "text" de cada item. Conserva exactamente el mismo "id". No cambies el orden. Devuelve solo un array JSON valido con objetos {"id": string, "text": string}.

Items:
<JSON_AQUI>
```

Reglas importantes:

- No pedir explicaciones al modelo.
- No aceptar Markdown en la respuesta.
- No permitir texto antes o despues del JSON.
- Aplicar timeout.
- Reintentar ante errores transitorios.

## API LLM

Crear una funcion:

```ts
async function translateBatch(items: TextItem[]): Promise<TextItem[]>
```

Responsabilidades:

- Leer configuracion desde variables de entorno.
- Construir la llamada HTTP.
- Aplicar timeout.
- Parsear respuesta.
- Validar estructura.
- Lanzar errores claros.

No mezclar esta logica con rutas Fastify ni con codigo de EPUB.

## Frontend

Componentes minimos:

- `App`.
- `FilePicker`.
- `ProgressView`.
- `ErrorMessage`.
- `DownloadButton`.

Estado frontend:

```ts
type JobStatus = {
  id: string;
  status: "pending" | "processing" | "done" | "error";
  progress: {
    current: number;
    total: number;
    message: string;
  };
  error: string | null;
  downloadUrl?: string;
};
```

Flujo:

1. Usuario elige archivo.
2. Frontend valida extension `.epub`.
3. Envia `POST /api/translate`.
4. Recibe `jobId`.
5. Hace polling cada 1-2 segundos a `/api/jobs/:jobId`.
6. Cuando `status === "done"`, muestra boton de descarga.
7. Cuando `status === "error"`, muestra el error.

## UX esperada

La interfaz debe ser simple y directa:

- Titulo: "Traductor EPUB".
- Selector de archivo visible.
- Boton principal claro.
- Barra de progreso o texto de progreso.
- Resultado descargable.

No usar una pagina de bienvenida. No meter tarjetas decorativas innecesarias. No explicar internamente como funciona la app dentro de la interfaz.

## Manejo de errores

Casos a cubrir:

- Archivo no enviado.
- Archivo no es `.epub`.
- Archivo supera `MAX_UPLOAD_MB`.
- EPUB invalido o corrupto.
- No se encuentran archivos HTML/XHTML dentro del EPUB.
- API LLM devuelve error.
- API LLM devuelve JSON invalido.
- Timeout de API.
- Error al generar EPUB final.

Los errores deben quedar en el job y mostrarse al frontend.

## Seguridad basica

Aunque no haya usuarios, aplicar medidas minimas:

- Limitar tamano de subida.
- No usar nombres de archivo originales como rutas.
- Guardar cada job en una carpeta con UUID.
- No permitir descargar rutas arbitrarias.
- No exponer `LLM_API_KEY` al frontend.
- Validar MIME/extension de forma basica.

## Criterios de aceptacion

La tarea se considera terminada cuando:

1. `npm install` funciona.
2. `npm run dev` levanta frontend y backend.
3. Se puede subir un EPUB.
4. Se crea un job y se puede consultar su progreso.
5. El backend llama al LLM remoto usando variables de entorno.
6. Se genera un EPUB descargable.
7. El EPUB descargado conserva estructura basica y contiene texto traducido.
8. TypeScript compila sin errores.
9. Hay instrucciones claras en `README.md`.
10. Hay `.env.example`.

## Scripts recomendados

En `package.json`:

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:api\" \"npm run dev:web\"",
    "dev:api": "tsx watch apps/api/src/server.ts",
    "dev:web": "vite --host 0.0.0.0",
    "build": "npm run build:api && npm run build:web",
    "build:api": "tsc -p apps/api/tsconfig.json",
    "build:web": "vite build apps/web",
    "typecheck": "tsc --noEmit"
  }
}
```

Ajustar segun la estructura real creada.

## Pruebas minimas recomendadas

No hace falta una suite enorme, pero si conviene probar:

- `translateBatch` valida JSON correcto.
- `translateBatch` rechaza JSON invalido.
- La extraccion de texto ignora `script` y `style`.
- La ruta `POST /api/translate` rechaza archivos no EPUB.

Para una primera version, tambien es aceptable incluir un modo mock:

```env
LLM_MOCK=true
```

En modo mock, `translateBatch` puede devolver el texto con un prefijo como `[ES]`. Esto permite probar el flujo completo sin gastar llamadas de API.

## Orden de implementacion sugerido

1. Crear proyecto TypeScript con React, Vite y Fastify.
2. Crear servidor Fastify con healthcheck.
3. Crear frontend con selector de archivo.
4. Implementar `POST /api/translate` con subida de archivo.
5. Implementar gestor de jobs en memoria.
6. Implementar extraccion y reempaquetado basico de EPUB.
7. Implementar cliente LLM con modo mock.
8. Conectar progreso real del job.
9. Implementar descarga.
10. Pulir errores, README y `.env.example`.

## Notas para el modelo implementador

- Mantener el codigo pequeno y legible.
- No crear funcionalidades no solicitadas.
- No introducir base de datos.
- No introducir autenticacion.
- No poner la clave del LLM en el frontend.
- Separar bien responsabilidades: rutas, jobs, EPUB y LLM.
- Preferir una version simple que funcione de punta a punta.
- Si hay dudas, elegir la opcion mas sencilla compatible con los criterios de aceptacion.
