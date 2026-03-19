/**
 * @section class
 */

export class PythonTemplateService {
  /**
   * @section factory
   */

  public static createDefault(): PythonTemplateService {
    const pythonTemplateService = new PythonTemplateService();
    return pythonTemplateService;
  }

  /**
   * @section private:methods
   */

  private buildMainBody(): string {
    const mainBody = `import json
import math
import os
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import tensorflow as tf

AUTH_TOKEN = os.environ["POLYMARKET_MODEL_AUTH_TOKEN"]
HOST = os.environ.get("POLYMARKET_MODEL_HOST", "127.0.0.1")
PORT = int(os.environ["POLYMARKET_MODEL_PORT"])
TREND_MODELS = {}
CLOB_MODELS = {}
HUBER_DELTA = 0.01
MIN_CLASS_WEIGHT = 0.25


def clamp(value, minimum_value, maximum_value):
    return min(maximum_value, max(minimum_value, value))


def build_model(architecture, class_weights):
    input_layer = tf.keras.Input(shape=(architecture["sequenceLength"], architecture["featureCount"]))
    current_tensor = tf.keras.layers.Dense(
        architecture["channelCount"],
        activation="gelu",
        kernel_regularizer=tf.keras.regularizers.l2(1e-5),
    )(input_layer)
    for dilation in architecture["dilations"][: architecture["blockCount"]]:
        residual_tensor = current_tensor
        block_tensor = tf.keras.layers.LayerNormalization()(current_tensor)
        block_tensor = tf.keras.layers.Conv1D(
            filters=architecture["channelCount"],
            kernel_size=3,
            dilation_rate=dilation,
            padding="causal",
            activation="gelu",
            kernel_regularizer=tf.keras.regularizers.l2(1e-5),
        )(block_tensor)
        block_tensor = tf.keras.layers.Dropout(architecture["dropout"])(block_tensor)
        block_tensor = tf.keras.layers.Conv1D(
            filters=architecture["channelCount"],
            kernel_size=1,
            padding="same",
            kernel_regularizer=tf.keras.regularizers.l2(1e-5),
        )(block_tensor)
        if residual_tensor.shape[-1] != block_tensor.shape[-1]:
            residual_tensor = tf.keras.layers.Conv1D(
                filters=architecture["channelCount"],
                kernel_size=1,
                padding="same",
                kernel_regularizer=tf.keras.regularizers.l2(1e-5),
            )(residual_tensor)
        current_tensor = tf.keras.layers.Add()([residual_tensor, block_tensor])
    trunk_tensor = tf.keras.layers.GlobalAveragePooling1D()(current_tensor)
    trunk_tensor = tf.keras.layers.Dense(128, activation="gelu", kernel_regularizer=tf.keras.regularizers.l2(1e-5))(trunk_tensor)
    trunk_tensor = tf.keras.layers.Dropout(architecture["dropout"])(trunk_tensor)
    trunk_tensor = tf.keras.layers.Dense(64, activation="gelu", kernel_regularizer=tf.keras.regularizers.l2(1e-5))(trunk_tensor)
    regression_output = tf.keras.layers.Dense(1, name="regression")(trunk_tensor)
    classification_output = tf.keras.layers.Dense(3, name="classification")(trunk_tensor)
    model = tf.keras.Model(inputs=input_layer, outputs=[regression_output, classification_output])

    def weighted_cross_entropy(labels, predictions):
        weight_tensor = tf.constant(class_weights, dtype=tf.float32)
        row_weights = tf.reduce_sum(labels * weight_tensor, axis=-1)
        row_losses = tf.keras.losses.categorical_crossentropy(labels, predictions, from_logits=True)
        return tf.reduce_mean(row_losses * row_weights)

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss={"regression": tf.keras.losses.Huber(delta=HUBER_DELTA), "classification": weighted_cross_entropy},
    )
    return model


def build_medians(sequences):
    feature_count = len(sequences[0][0]) if sequences and sequences[0] else 0
    medians = []
    for feature_index in range(feature_count):
        values = sorted(row[feature_index] for sequence in sequences for row in sequence)
        middle_index = len(values) // 2
        median = 0.0
        if values:
            median = values[middle_index] if len(values) % 2 == 1 else (values[middle_index - 1] + values[middle_index]) / 2
        medians.append(median)
    return medians


def build_scales(sequences, medians):
    scales = []
    for feature_index, feature_median in enumerate(medians):
        deviations = sorted(abs(row[feature_index] - feature_median) for sequence in sequences for row in sequence)
        middle_index = len(deviations) // 2
        mad = 0.0
        if deviations:
            mad = deviations[middle_index] if len(deviations) % 2 == 1 else (deviations[middle_index - 1] + deviations[middle_index]) / 2
        scales.append(max(1.4826 * mad, 1e-8))
    return scales


def scale_sequences(sequences, medians, scales):
    scaled_sequences = []
    for sequence in sequences:
        scaled_sequence = []
        for row in sequence:
            scaled_row = []
            for feature_index, feature_value in enumerate(row):
                scaled_row.append(clamp((feature_value - medians[feature_index]) / scales[feature_index], -10, 10))
            scaled_sequence.append(scaled_row)
        scaled_sequences.append(scaled_sequence)
    return scaled_sequences


def build_threshold(targets, minimum_threshold):
    absolute_targets = sorted(abs(target) for target in targets)
    threshold = minimum_threshold
    if absolute_targets:
        middle_index = len(absolute_targets) // 2
        median_target = absolute_targets[middle_index] if len(absolute_targets) % 2 == 1 else (
            absolute_targets[middle_index - 1] + absolute_targets[middle_index]
        ) / 2
        threshold = max(minimum_threshold, median_target * 0.5)
    return threshold


def classify_value(value, threshold):
    label = 1
    if value > threshold:
        label = 0
    if value < -threshold:
        label = 2
    return label


def build_labels(targets, minimum_threshold):
    threshold = build_threshold(targets, minimum_threshold)
    labels = [classify_value(target, threshold) for target in targets]
    counts = [labels.count(0), labels.count(1), labels.count(2)]
    maximum_count = max(counts + [1])
    class_weights = [max(MIN_CLASS_WEIGHT, maximum_count / max(count, 1)) for count in counts]
    return {"classWeights": class_weights, "labels": labels, "threshold": threshold}


def decode_regression_value(value, target_encoding):
    decoded_value = value
    if target_encoding == "logit_probability":
        clipped_value = clamp(value, -20, 20)
        decoded_value = 1 / (1 + math.exp(-clipped_value))
    return decoded_value


def build_probabilities(logits):
    maximum_logit = max(logits)
    exponentials = [math.exp(logit - maximum_logit) for logit in logits]
    denominator = sum(exponentials)
    probabilities = {"up": 0.0, "flat": 0.0, "down": 0.0}
    if denominator > 0:
        probabilities = {
            "up": exponentials[0] / denominator,
            "flat": exponentials[1] / denominator,
            "down": exponentials[2] / denominator,
        }
    return probabilities


def classify_probability(probabilities, threshold):
    label = 1
    if probabilities["up"] >= max(probabilities["flat"], probabilities["down"]) and probabilities["up"] >= min(0.5 + threshold, 0.95):
        label = 0
    if probabilities["down"] >= max(probabilities["flat"], probabilities["up"]) and probabilities["down"] >= min(0.5 + threshold, 0.95):
        label = 2
    return label


def build_metrics(predictions, targets, labels, threshold):
    errors = [prediction["predictedValue"] - target for prediction, target in zip(predictions, targets)]
    mae = None
    rmse = None
    huber = None
    if errors:
        mae = sum(abs(error) for error in errors) / len(errors)
        rmse = math.sqrt(sum(error * error for error in errors) / len(errors))
        huber = sum(
            0.5 * abs(error) * abs(error) if abs(error) <= HUBER_DELTA else HUBER_DELTA * (abs(error) - 0.5 * HUBER_DELTA)
            for error in errors
        ) / len(errors)
    predicted_labels = [classify_probability(prediction["probabilities"], threshold) for prediction in predictions]
    support = {"up": labels.count(0), "flat": labels.count(1), "down": labels.count(2)}
    macro_f1 = 0.0
    for label_class in [0, 1, 2]:
        true_positive = sum(1 for truth, predicted in zip(labels, predicted_labels) if truth == label_class and predicted == label_class)
        false_positive = sum(1 for truth, predicted in zip(labels, predicted_labels) if truth != label_class and predicted == label_class)
        false_negative = sum(1 for truth, predicted in zip(labels, predicted_labels) if truth == label_class and predicted != label_class)
        precision = 0.0 if true_positive + false_positive == 0 else true_positive / (true_positive + false_positive)
        recall = 0.0 if true_positive + false_negative == 0 else true_positive / (true_positive + false_negative)
        f1 = 0.0 if precision + recall == 0 else (2 * precision * recall) / (precision + recall)
        macro_f1 += f1 / 3
    return {
        "regressionMae": mae,
        "regressionRmse": rmse,
        "regressionHuber": huber,
        "directionMacroF1": macro_f1,
        "directionSupport": support,
        "sampleCount": len(targets),
    }


def save_artifact(model, artifact_directory_path, preprocessing_payload):
    os.makedirs(artifact_directory_path, exist_ok=True)
    model.save(os.path.join(artifact_directory_path, "model.keras"))
    with open(os.path.join(artifact_directory_path, "preprocessing.json"), "w", encoding="utf8") as preprocessing_file:
        json.dump(preprocessing_payload, preprocessing_file, indent=2)
    with open(os.path.join(artifact_directory_path, "architecture.json"), "w", encoding="utf8") as architecture_file:
        json.dump(preprocessing_payload["architecture"], architecture_file, indent=2)
    with open(os.path.join(artifact_directory_path, "metrics.json"), "w", encoding="utf8") as metrics_file:
        json.dump(preprocessing_payload["metrics"], metrics_file, indent=2)


def load_metadata(artifact_directory_path):
    with open(os.path.join(artifact_directory_path, "preprocessing.json"), "r", encoding="utf8") as preprocessing_file:
        metadata = json.load(preprocessing_file)
    return metadata


def train_head(payload, head):
    sequence_field = "trendSequence" if head == "trend" else "clobSequence"
    regression_field = "trendTarget" if head == "trend" else "clobTarget"
    classification_field = "trendTarget" if head == "trend" else "clobDirectionTarget"
    training_samples = [sample for sample in payload["trainingSamples"] if sample.get(regression_field) is not None]
    validation_samples = [sample for sample in payload["validationSamples"] if sample.get(regression_field) is not None]
    training_sequences = [sample[sequence_field] for sample in training_samples]
    validation_sequences = [sample[sequence_field] for sample in validation_samples]
    training_targets = [sample[regression_field] for sample in training_samples]
    validation_targets = [sample[regression_field] for sample in validation_samples]
    labeling = build_labels([sample[classification_field] for sample in training_samples], 0.0001 if head == "trend" else 0.0025)
    validation_labeling = build_labels([sample[classification_field] for sample in validation_samples], 0.0001 if head == "trend" else 0.0025)
    medians = build_medians(training_sequences)
    scales = build_scales(training_sequences, medians)
    scaled_training_sequences = scale_sequences(training_sequences, medians, scales)
    scaled_validation_sequences = scale_sequences(validation_sequences, medians, scales)
    model = build_model(payload["architecture"], labeling["classWeights"])
    regression_tensor = tf.constant([[target] for target in training_targets], dtype=tf.float32)
    classification_tensor = tf.one_hot(tf.constant(labeling["labels"], dtype=tf.int32), 3)
    sequence_tensor = tf.constant(scaled_training_sequences, dtype=tf.float32)
    model.fit(
        sequence_tensor,
        {"regression": regression_tensor, "classification": classification_tensor},
        batch_size=max(1, min(32, len(training_sequences))),
        epochs=25,
        shuffle=True,
        verbose=0,
        callbacks=[tf.keras.callbacks.EarlyStopping(monitor="loss", patience=3, restore_best_weights=True)],
    )
    validation_predictions = []
    if validation_sequences:
        prediction_outputs = model.predict(tf.constant(scaled_validation_sequences, dtype=tf.float32), verbose=0)
        regression_values = prediction_outputs[0].numpy().reshape(-1).tolist()
        classification_values = prediction_outputs[1].numpy().tolist()
        for regression_value, logits in zip(regression_values, classification_values):
            validation_predictions.append(
                {
                    "predictedValue": decode_regression_value(regression_value, payload["targetEncoding"]),
                    "probabilities": build_probabilities(logits),
                }
            )
    metrics = build_metrics(
        validation_predictions,
        [decode_regression_value(target, payload["targetEncoding"]) for target in validation_targets],
        validation_labeling["labels"],
        labeling["threshold"],
    )
    preprocessing_payload = {
        "architecture": payload["architecture"],
        "classWeights": labeling["classWeights"],
        "directionThreshold": labeling["threshold"],
        "featureMedians": medians,
        "featureNames": payload["featureNames"],
        "featureScales": scales,
        "metrics": metrics,
        "targetEncoding": payload["targetEncoding"],
    }
    save_artifact(model, payload["artifactDirectoryPath"], preprocessing_payload)
    return {
        "artifact": {
            "artifact": {
                "architecture": payload["architecture"],
                "classWeights": labeling["classWeights"],
                "directionThreshold": labeling["threshold"],
                "featureMedians": medians,
                "featureNames": payload["featureNames"],
                "featureScales": scales,
                "metrics": metrics,
                "modelPath": payload["artifactDirectoryPath"],
                "targetEncoding": payload["targetEncoding"],
            },
            "lastTrainWindowEnd": payload["trainingSamples"][-1]["decisionTime"] if payload["trainingSamples"] else None,
            "lastTrainWindowStart": payload["trainingSamples"][0]["decisionTime"] if payload["trainingSamples"] else None,
            "lastValidationWindowEnd": payload["validationSamples"][-1]["decisionTime"] if payload["validationSamples"] else None,
            "lastValidationWindowStart": payload["validationSamples"][0]["decisionTime"] if payload["validationSamples"] else None,
            "trainedAt": tf.timestamp().numpy().item(),
            "trainingSampleCount": len(training_samples),
            "validationSampleCount": len(validation_samples),
        }
    }


def ensure_loaded(registry, registry_key, artifact_directory_path):
    if registry_key not in registry:
        metadata = load_metadata(artifact_directory_path)
        registry[registry_key] = {
            "metadata": metadata,
            "model": tf.keras.models.load_model(os.path.join(artifact_directory_path, "model.keras"), compile=False),
        }
    return registry[registry_key]


def predict_head(payload, registry, registry_key, artifact_directory_path, sequence_field):
    registry_entry = ensure_loaded(registry, registry_key, artifact_directory_path)
    metadata = registry_entry["metadata"]
    scaled_sequence = scale_sequences([payload["input"][sequence_field]], metadata["featureMedians"], metadata["featureScales"])[0]
    prediction_outputs = registry_entry["model"].predict(tf.constant([scaled_sequence], dtype=tf.float32), verbose=0)
    regression_value = prediction_outputs[0].numpy().reshape(-1).tolist()[0]
    classification_logits = prediction_outputs[1].numpy().tolist()[0]
    return {
        "prediction": {
            "predictedValue": decode_regression_value(regression_value, metadata.get("targetEncoding", "identity")),
            "probabilities": build_probabilities(classification_logits),
        }
    }


class RequestHandler(BaseHTTPRequestHandler):
    def _respond(self, status_code, payload):
        body = json.dumps(payload).encode("utf8")
        self.send_response(status_code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_payload(self):
        content_length = int(self.headers.get("content-length", "0"))
        payload = {}
        if content_length > 0:
            payload = json.loads(self.rfile.read(content_length).decode("utf8"))
        return payload

    def _is_authorized(self):
        return self.headers.get("x-model-auth-token", "") == AUTH_TOKEN

    def do_GET(self):
        if not self._is_authorized():
            self._respond(401, {"error": "unauthorized"})
        elif self.path == "/health":
            self._respond(200, {"isHealthy": True, "loadedTrendModelCount": len(TREND_MODELS), "loadedClobModelCount": len(CLOB_MODELS)})
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self):
        if not self._is_authorized():
            self._respond(401, {"error": "unauthorized"})
            return
        try:
            payload = self._read_payload()
            if self.path == "/models/trend/train":
                self._respond(200, train_head(payload, "trend"))
            elif self.path == "/models/clob/train":
                self._respond(200, train_head(payload, "clob"))
            elif self.path == "/models/trend/load":
                ensure_loaded(TREND_MODELS, payload["artifact"]["trendKey"], os.path.join(payload["stateDirectoryPath"], payload["artifact"]["model"]["modelPath"]))
                self._respond(200, {"ok": True})
            elif self.path == "/models/clob/load":
                ensure_loaded(CLOB_MODELS, payload["artifact"]["modelKey"], os.path.join(payload["stateDirectoryPath"], payload["artifact"]["model"]["modelPath"]))
                self._respond(200, {"ok": True})
            elif self.path == "/models/trend/unload":
                TREND_MODELS.pop(payload["trendKey"], None)
                self._respond(200, {"ok": True})
            elif self.path == "/models/clob/unload":
                CLOB_MODELS.pop(payload["modelKey"], None)
                self._respond(200, {"ok": True})
            elif self.path == "/models/trend/predict":
                self._respond(
                    200,
                    predict_head(
                        payload,
                        TREND_MODELS,
                        payload["trendKey"],
                        os.path.join(payload["stateDirectoryPath"], payload["artifact"]["modelPath"]),
                        "trendSequence",
                    ),
                )
            elif self.path == "/models/clob/predict":
                self._respond(
                    200,
                    predict_head(
                        payload,
                        CLOB_MODELS,
                        payload["modelKey"],
                        os.path.join(payload["stateDirectoryPath"], payload["artifact"]["modelPath"]),
                        "clobSequence",
                    ),
                )
            else:
                self._respond(404, {"error": "not found"})
        except Exception as error:
            self._respond(500, {"error": str(error), "traceback": traceback.format_exc()})


server = ThreadingHTTPServer((HOST, PORT), RequestHandler)
server.serve_forever()
`;
    return mainBody;
  }

  /**
   * @section public:methods
   */

  public buildRequirements(): string {
    const requirements = ["tensorflow==2.17.1"].join("\n");
    return requirements;
  }

  public buildMainScript(): string {
    const mainScript = this.buildMainBody();
    return mainScript;
  }
}
