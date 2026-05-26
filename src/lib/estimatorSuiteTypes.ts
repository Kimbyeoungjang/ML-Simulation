import type {
  LearnedEstimatorMetrics,
  LearnedEstimatorModel,
  TrainLearnedEstimatorOptions,
} from "./learnedEstimator";
import type {
  NeuralResidualEstimatorModel,
  TrainNeuralResidualOptions,
} from "./neuralResidualEstimator";
import type { DirectNeuralEstimatorModel } from "./directNeuralEstimator";
import type { MultiTargetEstimatorModel } from "./multiTargetEstimator";

export type EstimatorSuiteSplitKind =
  | "random"
  | "workload"
  | "array"
  | "dataflow"
  | "large-shape";
export type EstimatorSuiteModelName =
  | "analytical"
  | "tree-residual"
  | "neural-residual"
  | "direct-neural"
  | "ensemble";

export interface EstimatorSuiteWeights {
  analytical: number;
  tree: number;
  neural: number;
  directNeural?: number;
}

export interface EstimatorSuiteSplitReport {
  kind: EstimatorSuiteSplitKind;
  label: string;
  trainSamples: number;
  testSamples: number;
  baseline: LearnedEstimatorMetrics;
  tree: LearnedEstimatorMetrics;
  neural: LearnedEstimatorMetrics;
  ensemble: LearnedEstimatorMetrics;
  weights: EstimatorSuiteWeights;
  recommended: EstimatorSuiteModelName;
}

export interface EstimatorSuiteCycleCalibration {
  mode: "oof-log-residual-bucket";
  /** Multiplicative median correction in log space; applied as cycles *= exp(logBias). */
  globalLogBias: number;
  /** Safety clamp for any correction selected at prediction time. */
  clampLogBias: number;
  minBucketSamples: number;
  shrinkage: number;
  buckets: Array<{
    kind:
      | "dataflow"
      | "array"
      | "dataflow-array"
      | "regime"
      | "dataflow-regime";
    key: string;
    samples: number;
    logBias: number;
  }>;
  /**
   * v17 prediction-scale trend correction. OOF residuals often drift with
   * problem size: small GEMMs can be overhead-dominated while large GEMMs can
   * be memory/tiling dominated. This term corrects a smooth residual trend as
   * a function of log(predicted cycles), then buckets/local KNN handle the
   * categorical and nearby-shape residuals.
   */
  scaleTrend?: {
    mode: "log-predicted-cycle-trend";
    meanLogPredicted: number;
    slope: number;
    blend: number;
    validation?: LearnedEstimatorMetrics;
  };
  /**
   * v18 resource-pressure trend correction.  Residuals can drift with SRAM
   * fit, arithmetic intensity, and effective DRAM bandwidth even after the
   * generic prediction-size trend is removed.  This small ridge-linear term is
   * learned from OOF residuals and validation-gated, so it only activates when
   * it improves held-out error.
   */
  resourceTrend?: {
    mode: "resource-pressure-linear";
    featureNames: string[];
    means: number[];
    stds: number[];
    coefficients: number[];
    blend: number;
    validation?: LearnedEstimatorMetrics;
  };
  /**
   * v19 tiling-geometry trend correction.  SCALE-Sim cycle ratios often jump
   * around ceil-div tile boundaries: edge tiles, padding waste, and a high
   * number of waves can add overhead that smooth resource features miss.
   * This term learns a tiny ridge-linear correction from OOF residuals and is
   * validation-gated together with the other calibration layers.
   */
  tilingTrend?: {
    mode: "tiling-geometry-linear";
    featureNames: string[];
    means: number[];
    stds: number[];
    coefficients: number[];
    blend: number;
    validation?: LearnedEstimatorMetrics;
  };
  /**
   * v16 local correction prototypes. Each point is an out-of-fold residual, stored
   * in normalized feature space so nearby hardware/workload/tile samples can
   * correct smooth local bias that coarse dataflow/array buckets cannot capture.
   */
  local?: {
    mode: "knn-log-residual";
    featureNames: string[];
    means: number[];
    stds: number[];
    prototypes: Array<{
      features: number[];
      logResidual: number;
    }>;
    k: number;
    minNeighbors: number;
    maxDistance: number;
    blend: number;
  };
  validation?: LearnedEstimatorMetrics;
}

export interface EstimatorSuiteAdaptiveStackWeights {
  mode: "oof-domain-adaptive-stack";
  minBucketSamples: number;
  shrinkage: number;
  buckets: Array<{
    kind:
      | "dataflow"
      | "array"
      | "regime"
      | "dataflow-regime"
      | "dataflow-array";
    key: string;
    samples: number;
    weights: EstimatorSuiteWeights;
    validation: LearnedEstimatorMetrics;
  }>;
  validation?: LearnedEstimatorMetrics;
}

export interface EstimatorSuiteModel {
  kind: "tileforge-estimator-suite-v1";
  createdAt: string;
  target: "log_measured_over_estimator";
  tree: LearnedEstimatorModel;
  neural: NeuralResidualEstimatorModel;
  /** Optional v2 component: predicts log(measuredCycles) directly instead of residual. */
  directNeural?: DirectNeuralEstimatorModel;
  /** Optional v3 component: separately predicts SRAM/DRAM/utilization targets when CSV columns exist. */
  multiTarget?: MultiTargetEstimatorModel;
  weights: EstimatorSuiteWeights;
  /** Optional v2/v3 stacker: tuned on split holdouts; improves MAPE/P90 over static inverse-error weights. */
  blend?: {
    mode: "log-space-geometric";
    weights: EstimatorSuiteWeights;
    domainGuard: {
      enabled: boolean;
      minConfidence: number;
      analyticalBlendAtMinConfidence: number;
    };
    validation?: LearnedEstimatorMetrics;
    /** Optional v20 adaptive stacking: choose smoothed OOF-tuned weights for the current domain bucket. */
    adaptiveWeights?: EstimatorSuiteAdaptiveStackWeights;
  };
  /** Optional v4 post-stack calibration learned from out-of-fold split residuals. */
  calibration?: EstimatorSuiteCycleCalibration;
  recommended: EstimatorSuiteModelName;
  validationSuite: EstimatorSuiteSplitReport[];
  metadata: {
    samples: number;
    trainSamples: number;
    seed: number;
    trees: number;
    maxDepth: number;
    minLeaf: number;
    hiddenUnits: number;
    epochs: number;
    learningRate: number;
    l2: number;
    strategy:
      | "analytical_plus_residual_ensemble"
      | "hybrid_residual_and_direct_neural"
      | "multi_target_hybrid_estimator";
    /** Training-domain summary used to damp neural predictions outside the sampled space. */
    featureDomain?: {
      numeric: Record<string, { min: number; max: number }>;
      arrays: string[];
      dataflows: string[];
      workloads: string[];
      opNames: string[];
      targetScopes?: string[];
      primaryTargetScope?: "full-layer" | "tile-policy" | "mixed";
    };
  };
}

export interface TrainEstimatorSuiteOptions
  extends TrainLearnedEstimatorOptions, TrainNeuralResidualOptions {
  hiddenUnits?: number;
  epochs?: number;
  learningRate?: number;
  l2?: number;
  maxSplitTrainSamples?: number;
  maxFinalTrainSamples?: number;
  splitKinds?: EstimatorSuiteSplitKind[];
}
