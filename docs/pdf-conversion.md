# Conversión PDF a EPUB

El conversor usa OpenRouter para transcribir páginas del PDF a contenido estructurado y construye el EPUB localmente. Reutiliza `LLM_API_BASE_URL` y `LLM_API_KEY`; no necesita una clave de Mistral. El modelo de conversión es independiente del modelo de traducción.

La API carga automáticamente el `.env` de la raíz del proyecto al arrancar, antes de inicializar los servicios. Esto también se aplica a `pnpm dev:api`. Las variables ya proporcionadas por el entorno o Docker tienen prioridad.

## Configuración

Añadir o ajustar estas variables en `.env` y reiniciar la API (con Docker Compose, recrear el servicio `api` para aplicar variables nuevas):

```dotenv
LLM_API_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=tu-clave-de-openrouter
PDF_CONVERSION_PROVIDER=openrouter
PDF_OPENROUTER_MODEL=google/gemini-3.8-flash
PDF_OPENROUTER_ENGINE=native
PDF_PAGES_PER_BATCH=3
PDF_TIMEOUT_MS=180000
PDF_MAX_OUTPUT_TOKENS=24000
```

- `native`: entrega el PDF al modelo visual. Es el modo inicial para conservar la estructura de la página. El modelo debe admitir archivos PDF y respuestas JSON estructuradas.
- `mistral-ocr`: usa el procesador PDF de OpenRouter antes del modelo. Tiene un coste de OCR además del coste del modelo. No equivale a llamar directamente a todas las funciones de Mistral OCR.
- `cloudflare-ai`: usa el procesador Markdown de OpenRouter; las llamadas al modelo siguen teniendo coste.
- `PDF_CONVERSION_PROVIDER=local`: selecciona explícitamente el conversor anterior, con PDF.js y Tesseract. Los fallos de OpenRouter no provocan una conversión local silenciosa.

`LLM_MOCK` se aplica a la traducción de EPUB, **no** a esta conversión: el modo `openrouter` hace llamadas reales. Sin una clave válida muestra un error de configuración. Las variables `PDF_OCR` y `PDF_OCR_LANG` corresponden al modo local.

Los modelos y motores pueden cambiar de disponibilidad. El modelo inicial se comprobó en el catálogo de OpenRouter al implementar la integración; `PDF_OPENROUTER_MODEL` permite sustituirlo. La petición exige soporte para salida estructurada a través de `provider.require_parameters`.

## Conservación del contenido

La transcripción conserva el idioma original, títulos, párrafos, énfasis, listas, tablas y notas. Las ilustraciones se recortan de la página original con `pdftoppm`; no se generan imágenes. Poppler está incluido en la imagen Docker de la API. Para ejecutar fuera de Docker es necesario instalar `poppler-utils` o proporcionar `PDF_RENDER_COMMAND`.

Si el proveedor rechaza un bloque por su filtro de contenido, esas páginas se conservan como imágenes completas del original, sin repetir la solicitud rechazada. El resto del libro sigue siendo texto adaptable. En esas páginas el texto no es seleccionable ni reajustable; la lista `facsimilePages` en `report.json` identifica las páginas afectadas. Las imágenes también se guardan para reanudar sin nuevas solicitudes. Los errores de permisos, saldo o autenticación siguen deteniendo el trabajo.

El índice navegable usa los marcadores internos del PDF y sus destinos cuando existen; en su ausencia usa los títulos extraídos. Las entradas del índice impreso se enlazan cuando coinciden inequívocamente con un título. También se incluye una lista de páginas originales. El EPUB tiene texto adaptable: la paginación del lector no coincide con la del PDF.

La calidad de las coordenadas de ilustraciones y del orden de lectura depende de lo que el modelo recibe. El motor nativo conserva la información visual. Los motores que convierten a texto/Markdown pueden perder geometría; OpenRouter también limita las imágenes extraídas que envía al modelo. Conviene comparar especialmente los PDF ilustrados antes de cambiar de motor.

## Reanudación y controles

Cada trabajo guarda páginas extraídas en `tmp/jobs/<id>/pdf-cache/<huella>/`, junto con las ilustraciones, las anotaciones de OpenRouter cuando están disponibles y un `report.json` con uso y solicitudes de la ejecución. La huella incluye PDF, modelo, motor y configuración de extracción. Una nueva ejecución con esos mismos parámetros reutiliza las páginas validadas; cambiar el generador de EPUB no exige volver a extraerlas. Eliminar el trabajo elimina también esta caché.

La pausa termina en el siguiente punto de guardado, después de la petición en curso. Las respuestas truncadas se repiten con grupos más pequeños. Se rechazan páginas omitidas, números duplicados, estructuras inválidas, caracteres de sustitución excesivos y pérdidas grandes de texto frente a una capa textual utilizable o al texto de las anotaciones OCR. Estos controles detectan problemas claros; no garantizan una transcripción perfecta, especialmente en escaneos procesados en modo nativo sin texto de referencia independiente.

## Comparar motores con un libro

El comando siguiente **usa saldo de OpenRouter** y compara las mismas primeras seis páginas con ambos motores:

```sh
pnpm pdf:compare /ruta/libro.pdf --pages 6 --engines native,mistral-ocr
```

Genera dos EPUB, `comparison.json` con tiempos/errores y las extracciones cacheadas en `tmp/pdf-comparison`. Puede añadirse `--out /ruta/salida`. Para comparar modelos, repetir con otro `PDF_OPENROUTER_MODEL` y otro directorio `--out`. Los resultados cacheados permiten ajustar y volver a evaluar el formato sin nuevas llamadas al modelo.

Revisar frente al PDF: palabras y signos conservados, párrafos, columnas, títulos, notas, tablas, ilustraciones y destinos del índice. Un EPUB que se abre correctamente puede contener errores de transcripción; esta comparación visual sigue siendo necesaria. No se declara un motor ganador basándose solo en la documentación.

Referencias: [PDF en OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/pdfs), [salida estructurada](https://openrouter.ai/docs/guides/features/structured-outputs).
