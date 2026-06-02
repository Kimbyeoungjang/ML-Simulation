# Learned Estimator Lab

Learned Estimator Lab은 analytical estimator를 SCALE-Sim/job sample로 보정하는 실험 환경입니다. production에서는 Estimator Suite 문서를 우선하고, 이 문서는 실험/확장용 참고로 사용합니다.

## 목표

- analytical estimator의 systematic bias 확인
- workload/hardware/dataflow별 correction factor 학습
- tabular model, stacking, neural residual model 비교
- validation error와 domain confidence 측정
- design-space active validation 후보 제안

## 빠른 명령

```bash
npm run estimator:design
npm run estimator:train
npm run estimator:evaluate
npm run estimator:compare
npm run estimator:suite
```

neural residual:

```bash
npm run estimator:train-neural
npm run estimator:evaluate-neural
```

## Dataset 생성 방법

1. UI에서 full-pipeline job을 여러 개 실행합니다.
2. Estimator Suite에서 completed job을 collect합니다.
3. scope pipeline으로 `full-layer`/`tile-policy`를 분리합니다.
4. 필요하면 CSV를 내려받아 수동 검토합니다.

CSV sample은 다음 정보를 포함해야 합니다.

- target scope
- predicted cycles
- measured cycles
- hardware feature
- workload feature
- dataflow
- tile feature, tile-policy인 경우
- measured source

## 실험 설계 팁

좋은 학습 dataset은 다음 축을 골고루 포함합니다.

| 축 | 예시 |
|---|---|
| array | 32×32, 64×64, 128×128, 256×256 |
| dataflow | WS, OS, IS |
| workload | ViT, ResNet, LLM-like GEMM |
| shape scale | small, medium, large M/N/K |
| SRAM | 0.5×, 1×, 2× |
| bandwidth | low, baseline, high |
| tile | 작은 tile, array-aligned tile, 큰 tile |

## 평가

기본 평가 지표:

- MAPE
- median absolute percentage error
- p90 error
- signed bias
- rank agreement, tile-policy인 경우
- readiness level
- out-of-domain rate

## Active validation

Design-space에서 높은 성능으로 보이지만 confidence가 낮은 후보는 active validation 대상으로 삼습니다.

권장 순서:

1. design-space graph에서 low-confidence/high-score 후보 확인
2. Estimator Suite `plan` 또는 `plan-and-queue` 실행
3. SCALE-Sim job 완료 후 sample collect
4. scope pipeline 재학습
5. confidence와 recommendation 변화 확인

## production에서의 주의

- `full-layer`와 `tile-policy`를 같은 model로 학습하지 않습니다.
- validation error만 보지 말고 readiness를 봅니다.
- active model 적용 후에도 대표 후보는 SCALE-Sim으로 다시 검증합니다.
- neural residual model은 설명 가능성이 낮으므로 발표에서는 tabular/analytical 대비 보조 결과로 제시하는 것이 안전합니다.
