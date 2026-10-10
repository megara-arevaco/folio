# Límites de uso IA dentro de Folio

Folio mantiene reservas persistentes en `<FOLIO_DATA_DIR>/ai-budget.json` y las muestra en **Ajustes** y en el preflight. Antes de cada llamada remota reserva una solicitud, los bytes UTF-8 del cuerpo serializado más 256 bytes como aproximación de entrada, y el máximo de tokens de salida solicitado. Esta aproximación **no es una garantía ni un límite de tokens**: el tokenizador del modelo puede producir un recuento distinto y no se consulta. En conversión PDF, los bytes del PDF tampoco predicen el tamaño del texto extraído ni de la carga de imágenes/plugins; la extracción/OCR puede expandir el contenido y el proveedor aplica su propio tokenizador y tratamiento multimodal. Los límites locales reservan la cota configurada por Folio, no garantizan el consumo facturado real. Las reservas no se devuelven tras fallo, timeout o respuesta inválida; los intentos de retry también cuentan.

Los límites son topes de lo que envía esta instalación de Folio. No controlan consumo externo, uso de otras aplicaciones, cargos finales ni cuotas/configuración del proveedor. OpenRouter u otro proveedor puede contar tokens y facturar de forma distinta. Las muestras remotas también generan solicitudes.

## Variables y valores por defecto

Añádelas a la configuración del servidor y reinicia la API para aplicarlas. Los valores representan solicitudes, bytes de entrada aproximados y/o tokens máximos de salida, no unidades monetarias.

| Variable | Alcance | Valor inicial |
|---|---|---:|
| `AI_BUDGET_MAX_REQUESTS` | Todas las solicitudes IA de la instancia | 50 000 |
| `AI_BUDGET_MAX_INPUT_TOKEN_BOUND` | Bytes aproximados de entrada, acumulados en la instancia | 50 000 000 |
| `AI_BUDGET_MAX_OUTPUT_TOKENS` | Máximo de salida reservado, acumulado en la instancia | 20 000 000 |
| `AI_BUDGET_MAX_JOB_REQUESTS` | Solicitudes por trabajo | 1 000 |
| `AI_BUDGET_MAX_JOB_INPUT_TOKEN_BOUND` | Bytes aproximados de entrada por trabajo | 2 000 000 |
| `AI_BUDGET_MAX_JOB_OUTPUT_TOKENS` | Máximo de salida reservado por trabajo | 1 000 000 |
| `AI_BUDGET_MAX_SAMPLE_TOTAL_REQUESTS` | Solicitudes acumuladas en todas las muestras | 1 000 |
| `AI_BUDGET_MAX_SAMPLE_TOTAL_INPUT_TOKEN_BOUND` | Bytes aproximados acumulados en todas las muestras | 10 000 000 |
| `AI_BUDGET_MAX_SAMPLE_TOTAL_OUTPUT_TOKENS` | Máximo de salida reservado acumulado en muestras | 5 000 000 |
| `AI_BUDGET_MAX_SAMPLE_REQUESTS` | Solicitudes por vista previa | 20 |
| `AI_BUDGET_MAX_SAMPLE_INPUT_TOKEN_BOUND` | Bytes aproximados por vista previa | 1 000 000 |
| `AI_BUDGET_MAX_SAMPLE_OUTPUT_TOKENS` | Máximo de salida reservado por vista previa | 300 000 |
| `LLM_MAX_OUTPUT_TOKENS` | `max_tokens` de cada llamada de traducción/glosario/revisión | 4 096 |
| `PDF_MAX_OUTPUT_TOKENS` | `max_tokens` de cada llamada de conversión PDF remota | 24 000 |

Los valores deben ser enteros positivos dentro de los rangos admitidos por Folio. El cap por solicitud controla el máximo enviado en esa llamada; los cap de instancia/trabajo/muestra limitan reservas acumuladas. Para un trabajo que agota su cupo, aumenta el límite correspondiente para poder reanudarlo; el checkpoint y las reservas no se borran automáticamente.

El ledger se conserva tras reinicios y restauración. Restaurar fusiona los contadores actuales y archivados tomando el máximo por contador, para no reducir el historial de uso. No existe un botón de reinicio de contadores. La simulación Mock no contacta proveedores.
