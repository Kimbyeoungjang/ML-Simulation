# v18 Validation Feedback Loop Hardening

TileForge의 최종 목적은 빠른 estimate를 하드웨어 설계, 타일링 전략, IREE 옵션 후보로 안전하게 승격하는 것이다. v17까지는 산출물 해석과 model card를 강화했지만, 실제 SCALE-Sim 검증 결과를 다음 Estimator Suite 학습 데이터로 되돌리는 경로가 아직 명확하지 않았다.

## Problem

외부 검증 결과에는 서로 성격이 다른 두 종류의 row가 섞일 수 있다.

1. **full-layer SCALE-Sim row**  
   전체 GEMM/layer topology를 대상으로 한 하드웨어 설계용 target이다. Estimator Suite의 full-layer correction 학습에 사용할 수 있다.

2. **top-k tile micro-run row**  
   tile 후보 ranking과 regret을 진단하기 위한 값이다. full-layer latency target과 섞으면 learned model이 잘못된 bias를 학습한다.

이 둘을 같은 `validation_report.csv`로만 보면, 나중에 재학습 데이터로 가져갈 때 target scope가 불명확해질 수 있다.

## Changes

새 server module을 추가했다.

```text
src/server/validationEvidence.ts
```

이 모듈은 full-pipeline 또는 external validation 결과에서 다음 산출물을 만든다.

```text
validation_evidence.json
validation_evidence.md
estimator_suite_feedback.csv
```

## Evidence contract

`validation_evidence.*`는 각 row에 다음 metadata를 기록한다.

| field | meaning |
|---|---|
| `targetScope` | `full-layer` 또는 `tile-policy` |
| `measuredSource` | `scalesim-compute-report`, `scalesim-topk-tile-extrapolated`, `missing-scalesim-layer` 등 |
| `reliability` | `design-target`, `ranking-diagnostic`, `unmatched` |
| `ratio` / `absErrorPct` | measured 대비 estimator 오차 |
| `sourceJobId` | 어떤 job에서 나온 evidence인지 |

## Feedback CSV

`estimator_suite_feedback.csv`는 Estimator Suite dataset manager에 바로 넣을 수 있는 CSV다. 단, 중요한 rule이 있다.

- `targetScope=full-layer` + `evidenceReliability=design-target` row는 full-layer 학습 target으로 사용할 수 있다.
- `targetScope=tile-policy` row는 tile-policy/ranking 진단용으로만 사용한다.
- `unmatched` row는 학습에서 제외하거나 수동 검토한다.

## Why this matters

이 변경은 estimate 정확도를 직접 높이는 패치가 아니다. 대신 정확도를 높이기 위한 **검증 데이터 축적 루프**를 안전하게 만든다.

```text
estimate
→ SCALE-Sim validation
→ validation evidence ledger
→ scoped Estimator Suite feedback CSV
→ readiness check
→ retrain
→ representative full-pipeline validation
```

이제 TileForge는 검증 결과를 단순 보고서로 끝내지 않고, 어떤 row를 학습 target으로 승격할 수 있는지 명시적으로 남긴다.
