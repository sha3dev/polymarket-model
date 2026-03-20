/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { ModelTensorflowArchitecture } from "../model/model.types.ts";
import type { TensorflowApiCreateModelRequest, TensorflowApiModelDefinition } from "./tensorflow-api.types.ts";

/**
 * @section types
 */

type TensorflowApiModelDefinitionServiceOptions = {
  learningRate: number;
};

type TensorReference = {
  dtype: string;
  kerasHistory: [string, number, number];
  shape: Array<number | null>;
};

/**
 * @section class
 */

export class TensorflowApiModelDefinitionService {
  /**
   * @section private:attributes
   */

  private readonly learningRate: number;

  /**
   * @section constructor
   */

  public constructor(options: TensorflowApiModelDefinitionServiceOptions) {
    this.learningRate = options.learningRate;
  }

  /**
   * @section factory
   */

  public static createDefault(): TensorflowApiModelDefinitionService {
    const tensorflowApiModelDefinitionService = new TensorflowApiModelDefinitionService({
      learningRate: config.MODEL_TF_LEARNING_RATE,
    });
    return tensorflowApiModelDefinitionService;
  }

  /**
   * @section private:methods
   */

  private buildTensorReference(layerName: string, shape: Array<number | null>): TensorReference {
    const tensorReference: TensorReference = {
      dtype: "float32",
      kerasHistory: [layerName, 0, 0],
      shape,
    };
    return tensorReference;
  }

  private buildTensorArgument(layerName: string, shape: Array<number | null>): Record<string, unknown> {
    const tensorArgument: Record<string, unknown> = {
      class_name: "__keras_tensor__",
      config: {
        dtype: "float32",
        keras_history: this.buildTensorReference(layerName, shape).kerasHistory,
        shape,
      },
    };
    return tensorArgument;
  }

  private buildInboundNode(layerName: string, shape: Array<number | null>): Array<Record<string, unknown>> {
    const inboundNode: Array<Record<string, unknown>> = [
      {
        args: [this.buildTensorArgument(layerName, shape)],
        kwargs: {},
      },
    ];
    return inboundNode;
  }

  private buildInputLayer(architecture: ModelTensorflowArchitecture): Record<string, unknown> {
    const inputLayer: Record<string, unknown> = {
      class_name: "InputLayer",
      config: {
        batch_shape: [null, architecture.sequenceLength, architecture.featureCount],
        dtype: "float32",
        name: "sequence_input",
        ragged: false,
        sparse: false,
      },
      inbound_nodes: [],
      module: "keras.layers",
      name: "sequence_input",
      registered_name: null,
    };
    return inputLayer;
  }

  private buildDenseLayer(
    layerName: string,
    units: number,
    activation: string | null,
    inputLayerName: string,
    inputShape: Array<number | null>,
  ): Record<string, unknown> {
    const denseLayer: Record<string, unknown> = {
      build_config: {
        input_shape: inputShape,
      },
      class_name: "Dense",
      config: {
        activation: activation === null ? "linear" : activation,
        bias_constraint: null,
        bias_initializer: { class_name: "Zeros", config: {}, module: "keras.initializers", registered_name: null },
        bias_regularizer: null,
        dtype: "float32",
        kernel_constraint: null,
        kernel_initializer: { class_name: "GlorotUniform", config: { seed: null }, module: "keras.initializers", registered_name: null },
        kernel_regularizer: null,
        name: layerName,
        trainable: true,
        units,
        use_bias: true,
      },
      inbound_nodes: this.buildInboundNode(inputLayerName, inputShape),
      module: "keras.layers",
      name: layerName,
      registered_name: null,
    };
    return denseLayer;
  }

  private buildLayerNormalizationLayer(layerName: string, inputLayerName: string, inputShape: Array<number | null>): Record<string, unknown> {
    const normalizationLayer: Record<string, unknown> = {
      build_config: {
        input_shape: inputShape,
      },
      class_name: "LayerNormalization",
      config: {
        axis: -1,
        beta_constraint: null,
        beta_initializer: { class_name: "Zeros", config: {}, module: "keras.initializers", registered_name: null },
        beta_regularizer: null,
        center: true,
        dtype: "float32",
        epsilon: 0.001,
        gamma_constraint: null,
        gamma_initializer: { class_name: "Ones", config: {}, module: "keras.initializers", registered_name: null },
        gamma_regularizer: null,
        name: layerName,
        scale: true,
        trainable: true,
      },
      inbound_nodes: this.buildInboundNode(inputLayerName, inputShape),
      module: "keras.layers",
      name: layerName,
      registered_name: null,
    };
    return normalizationLayer;
  }

  private buildConvLayer(
    layerName: string,
    inputLayerName: string,
    inputShape: Array<number | null>,
    filterCount: number,
    kernelSize: number,
    dilationRate: number,
    padding: "causal" | "same",
    activation: string | null,
  ): Record<string, unknown> {
    const convLayer: Record<string, unknown> = {
      build_config: {
        input_shape: inputShape,
      },
      class_name: "Conv1D",
      config: {
        activation: activation === null ? "linear" : activation,
        activity_regularizer: null,
        bias_constraint: null,
        bias_initializer: { class_name: "Zeros", config: {}, module: "keras.initializers", registered_name: null },
        bias_regularizer: null,
        data_format: "channels_last",
        dilation_rate: [dilationRate],
        dtype: "float32",
        filters: filterCount,
        groups: 1,
        kernel_constraint: null,
        kernel_initializer: { class_name: "GlorotUniform", config: { seed: null }, module: "keras.initializers", registered_name: null },
        kernel_regularizer: null,
        kernel_size: [kernelSize],
        name: layerName,
        padding,
        strides: [1],
        trainable: true,
        use_bias: true,
      },
      inbound_nodes: this.buildInboundNode(inputLayerName, inputShape),
      module: "keras.layers",
      name: layerName,
      registered_name: null,
    };
    return convLayer;
  }

  private buildDropoutLayer(layerName: string, inputLayerName: string, inputShape: Array<number | null>, dropout: number): Record<string, unknown> {
    const dropoutLayer: Record<string, unknown> = {
      build_config: {
        input_shape: inputShape,
      },
      class_name: "Dropout",
      config: {
        dtype: "float32",
        name: layerName,
        noise_shape: null,
        rate: dropout,
        seed: null,
        trainable: true,
      },
      inbound_nodes: this.buildInboundNode(inputLayerName, inputShape),
      module: "keras.layers",
      name: layerName,
      registered_name: null,
    };
    return dropoutLayer;
  }

  private buildAddLayer(layerName: string, leftLayerName: string, rightLayerName: string, inputShape: Array<number | null>): Record<string, unknown> {
    const addLayer: Record<string, unknown> = {
      build_config: {
        input_shape: [inputShape, inputShape],
      },
      class_name: "Add",
      config: {
        dtype: "float32",
        name: layerName,
        trainable: true,
      },
      inbound_nodes: [
        {
          args: [[this.buildTensorArgument(leftLayerName, inputShape), this.buildTensorArgument(rightLayerName, inputShape)]],
          kwargs: {},
        },
      ],
      module: "keras.layers",
      name: layerName,
      registered_name: null,
    };
    return addLayer;
  }

  private buildGlobalAveragePoolingLayer(layerName: string, inputLayerName: string, inputShape: Array<number | null>): Record<string, unknown> {
    const poolingLayer: Record<string, unknown> = {
      build_config: {
        input_shape: inputShape,
      },
      class_name: "GlobalAveragePooling1D",
      config: {
        data_format: "channels_last",
        dtype: "float32",
        keepdims: false,
        name: layerName,
        trainable: true,
      },
      inbound_nodes: this.buildInboundNode(inputLayerName, inputShape),
      module: "keras.layers",
      name: layerName,
      registered_name: null,
    };
    return poolingLayer;
  }

  private buildModelConfig(architecture: ModelTensorflowArchitecture): Record<string, unknown> {
    const layers: Record<string, unknown>[] = [];
    const sequenceShape: Array<number | null> = [null, architecture.sequenceLength, architecture.featureCount];
    const channelShape: Array<number | null> = [null, architecture.sequenceLength, architecture.channelCount];
    let currentLayerName = "sequence_input";

    layers.push(this.buildInputLayer(architecture));
    layers.push(this.buildDenseLayer("stem_dense", architecture.channelCount, "gelu", currentLayerName, sequenceShape));
    currentLayerName = "stem_dense";

    architecture.dilations.slice(0, architecture.blockCount).forEach((dilation, blockIndex) => {
      const normalizationName = `block_${blockIndex}_norm`;
      const convName = `block_${blockIndex}_conv`;
      const dropoutName = `block_${blockIndex}_dropout`;
      const projectionName = `block_${blockIndex}_projection`;
      const addName = `block_${blockIndex}_add`;
      layers.push(this.buildLayerNormalizationLayer(normalizationName, currentLayerName, channelShape));
      layers.push(this.buildConvLayer(convName, normalizationName, channelShape, architecture.channelCount, 3, dilation, "causal", "gelu"));
      layers.push(this.buildDropoutLayer(dropoutName, convName, channelShape, architecture.dropout));
      layers.push(this.buildConvLayer(projectionName, dropoutName, channelShape, architecture.channelCount, 1, 1, "same", null));
      layers.push(this.buildAddLayer(addName, currentLayerName, projectionName, channelShape));
      currentLayerName = addName;
    });

    layers.push(this.buildGlobalAveragePoolingLayer("global_pool", currentLayerName, channelShape));
    layers.push(this.buildDenseLayer("trunk_dense_1", 128, "gelu", "global_pool", [null, architecture.channelCount]));
    layers.push(this.buildDropoutLayer("trunk_dropout", "trunk_dense_1", [null, 128], architecture.dropout));
    layers.push(this.buildDenseLayer("trunk_dense_2", 64, "gelu", "trunk_dropout", [null, 128]));
    layers.push(this.buildDenseLayer("regression", 1, null, "trunk_dense_2", [null, 64]));
    layers.push(this.buildDenseLayer("classification", 3, null, "trunk_dense_2", [null, 64]));

    const modelConfig: Record<string, unknown> = {
      input_layers: [["sequence_input", 0, 0]],
      layers,
      name: "polymarket_multitask_tcn",
      output_layers: [
        ["regression", 0, 0],
        ["classification", 0, 0],
      ],
      trainable: true,
    };
    return modelConfig;
  }

  private buildDefinition(architecture: ModelTensorflowArchitecture): TensorflowApiModelDefinition {
    const definition: TensorflowApiModelDefinition = {
      compileConfig: {
        loss: {
          classification: {
            class_name: "CategoricalCrossentropy",
            config: {
              from_logits: true,
              reduction: "sum_over_batch_size",
            },
            module: "keras.losses",
            registered_name: null,
          },
          regression: {
            class_name: "Huber",
            config: {
              delta: 0.01,
              reduction: "sum_over_batch_size",
            },
            module: "keras.losses",
            registered_name: null,
          },
        },
        metrics: [],
        optimizer: {
          class_name: "Adam",
          config: {
            amsgrad: false,
            beta_1: 0.9,
            beta_2: 0.999,
            clipnorm: null,
            clipvalue: null,
            ema_momentum: 0.99,
            ema_overwrite_frequency: null,
            epsilon: 0.0000001,
            global_clipnorm: null,
            gradient_accumulation_steps: null,
            learning_rate: this.learningRate,
            loss_scale_factor: null,
            name: "adam",
            use_ema: false,
            weight_decay: null,
          },
          module: "keras.optimizers",
          registered_name: null,
        },
      },
      format: "keras-functional",
      modelConfig: this.buildModelConfig(architecture),
    };
    return definition;
  }

  /**
   * @section public:methods
   */

  public buildCreateModelRequest(modelId: string, architecture: ModelTensorflowArchitecture): TensorflowApiCreateModelRequest {
    const createModelRequest: TensorflowApiCreateModelRequest = {
      definition: this.buildDefinition(architecture),
      modelId,
    };
    return createModelRequest;
  }
}
