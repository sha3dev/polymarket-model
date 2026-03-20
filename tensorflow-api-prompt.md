# tensorflow-api contract extension request

Quiero que implementes una ampliación del contrato de `tensorflow-api` para soportar un cliente upstream (`polymarket-model`) que entrena y predice modelos multitarea de series temporales, sin persistir artefactos localmente fuera de `tensorflow-api`.

Contexto:
- `tensorflow-api` ya expone:
  - `GET /`
  - `GET /api/state`
  - `GET /api/models`
  - `GET /api/models/:modelId`
  - `POST /api/models`
  - `POST /api/models/:modelId/training-jobs`
  - `POST /api/models/:modelId/prediction-jobs`
  - `GET /api/jobs/:jobId`
  - `GET /api/jobs/:jobId/result`
- Predicción ya es síncrona por request fast path.
- El nuevo cliente necesita que `tensorflow-api` sea la única fuente de verdad persistida para:
  - metadata del modelo
  - artefacto entrenado
  - estado del modelo

Objetivo:
Implementar soporte para:
1. metadata opaca persistida por modelo
2. sample weights multi-output en training
3. persistencia atómica de metadata actualizada al completar training
4. respuesta de predicción multi-output con outputs nombrados

Requisitos exactos:

## 1. Metadata opaca persistida por modelo

### Crear modelo
Extiende `POST /api/models` para aceptar un campo opcional:
- `metadata: Record<string, unknown>`

### Leer modelo(s)
Haz que `GET /api/models` y `GET /api/models/:modelId` devuelvan también:
- `metadata: Record<string, unknown> | null`

### Persistencia
- La metadata debe persistirse igual que el resto del modelo.
- Debe sobrevivir reinicios.
- No quiero hacks en memoria.

## 2. Training request con sample weights multi-output

Extiende `POST /api/models/:modelId/training-jobs`.

### Nuevo contrato
Dentro de `trainingInput`, soporta opcionalmente:
- `sampleWeights`
- `validationSampleWeights`

Ambos deben aceptar dos formas:
1. single-output:
- array plano, por ejemplo `[1, 0.5, 2]`
2. multi-output:
- objeto keyed por nombre de output, por ejemplo:

```json
{
  "regression": [1, 1, 1],
  "classification": [2, 0.5, 3]
}
```

### Comportamiento en el worker Python
- Debes mapear esto a `sample_weight` y `validation_data=(..., ..., sample_weight)` de Keras correctamente.
- Debe funcionar tanto para modelos single-output como multi-output.
- Debe fallar con `400 invalid_request` si la forma no cuadra con inputs/targets.

## 3. Metadata actualizada en training

Necesito poder mandar metadata nueva en el training job y que se persista solo si el training termina con éxito.

### Preferred contract
Extiende `POST /api/models/:modelId/training-jobs` para aceptar:
- `modelMetadata?: Record<string, unknown>`

### Semántica
- Si el training job falla, NO se actualiza metadata.
- Si el training job termina con éxito, la metadata del modelo se reemplaza por `modelMetadata`.
- Esta actualización debe ser atómica respecto al éxito del training.

## 4. Resultado de training job

Extiende `GET /api/jobs/:jobId/result` para training jobs exitosos y devuelve al menos:

```ts
{
  modelId: string;
  status: "succeeded";
  trainedAt: string;
  history?: Record<string, unknown>;
}
```

Si ya devuelves más datos, mantenlos si no rompen compatibilidad.

## 5. Predicción multi-output con outputs nombrados

Extiende `POST /api/models/:modelId/prediction-jobs` para que la respuesta preserve outputs por nombre.

### Nuevo shape requerido
Para modelos multi-output, responde algo como:

```json
{
  "modelId": "example-model",
  "outputs": {
    "regression": [[0.123]],
    "classification": [[1.2, -0.4, 0.1]]
  }
}
```

### Requisitos
- Si el modelo tiene un único output, puedes seguir respondiendo de forma compatible, pero prefiero un shape homogéneo con `outputs`.
- Para modelos con outputs nombrados de Keras, usa esos nombres reales.
- No quiero perder los nombres de salida en arrays posicionales ambiguos.

## 6. Tipos, validación y docs

Actualiza:
- tipos TypeScript exportados
- validación de requests
- README
- tests

### README
Documenta:
- `metadata` en modelos
- `sampleWeights` / `validationSampleWeights`
- `modelMetadata` en training jobs
- nuevo shape de prediction response
- nuevo shape de job result para training

## 7. Tests obligatorios

Añade tests para:
- crear modelo con metadata y leerla luego
- training single-output con sample weights
- training multi-output con sample weights keyed por output
- training exitoso actualiza metadata
- training fallido NO actualiza metadata
- prediction multi-output devuelve outputs nombrados
- reinicio del servicio conserva metadata
- validaciones 400 para shapes inválidos

## 8. Compatibilidad

Quiero minimizar ruptura:
- mantener endpoints
- mantener los casos antiguos funcionando cuando no se usan los nuevos campos
- si cambias response shape de predicción, hazlo de forma razonablemente compatible y documentada

## 9. Restricciones de implementación

- No metas lógica específica de `polymarket-model` dentro de `tensorflow-api`
- Esto debe quedar como una capacidad genérica del servicio
- Mantén la simplicidad del diseño
- Si necesitas tocar SQLite schema o storage, haz la migración de forma clara y testeada

## 10. Entrega esperada

Quiero que implementes el cambio completo:
- código
- tests
- README
- y que ejecutes la verificación del repo

Al final, dame:
1. resumen de cambios
2. endpoints/tipos modificados
3. ejemplos JSON finales de:
   - create model
   - training job multi-output con sampleWeights
   - prediction response multi-output
   - training job result
4. resultado de tests/checks
