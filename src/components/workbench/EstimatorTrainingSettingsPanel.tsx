"use client";

import { MiniField } from "./primitives";

export function EstimatorTrainingSettingsPanel({ options, updateOptions }: { options: any; updateOptions: (patch: any) => void }) {
  return (
    <section className="suite-section" title="학습 모델 하이퍼파라미터입니다.">
      <h4>4. 학습 설정</h4>
      <div className="row4">
        <MiniField label="topK" tip="현재 설정 기반 단순 설계 CSV에 포함할 상위 tile 후보 개수입니다."><input type="number" value={options.topK} onChange={(e) => updateOptions({ topK: +e.target.value })} /></MiniField>
        <MiniField label="trees" tip="Tree residual ensemble의 tree 개수입니다."><input type="number" value={options.trees} onChange={(e) => updateOptions({ trees: +e.target.value })} /></MiniField>
        <MiniField label="maxDepth" tip="Tree residual 모델의 최대 깊이입니다."><input type="number" value={options.maxDepth} onChange={(e) => updateOptions({ maxDepth: +e.target.value })} /></MiniField>
        <MiniField label="minLeaf" tip="Tree leaf 최소 sample 수입니다."><input type="number" value={options.minLeaf} onChange={(e) => updateOptions({ minLeaf: +e.target.value })} /></MiniField>
      </div>
      <div className="row4">
        <MiniField label="hidden" tip="Neural residual estimator의 hidden unit 개수입니다."><input type="number" value={options.hiddenUnits} onChange={(e) => updateOptions({ hiddenUnits: +e.target.value })} /></MiniField>
        <MiniField label="epochs" tip="Neural residual estimator 학습 epoch 수입니다."><input type="number" value={options.epochs} onChange={(e) => updateOptions({ epochs: +e.target.value })} /></MiniField>
        <MiniField label="maxFinalTrain" tip="최종 모델 학습에 사용할 최대 sample 수입니다. 검증에는 전체 split을 사용하되 최종 학습 시간을 제한할 수 있습니다."><input type="number" value={options.maxFinalTrainSamples} onChange={(e) => updateOptions({ maxFinalTrainSamples: +e.target.value })} /></MiniField>
        <MiniField label="splits" tip="검증 split 목록입니다. random,workload,array,dataflow,large-shape를 사용할 수 있습니다."><input value={options.splits} onChange={(e) => updateOptions({ splits: e.target.value })} /></MiniField>
      </div>
    </section>
  );
}
