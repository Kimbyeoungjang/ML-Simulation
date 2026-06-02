# Estimator Suite Readiness Gates

Estimator Suite는 correction model이므로 단순히 validation error만 낮다고 production에 적용하면 위험합니다. readiness gate는 model/dataset이 현재 의사결정에 충분히 넓은 근거를 갖는지 평가합니다.

## 왜 필요한가

TileForge는 세 가지 결정을 지원합니다.

1. 하드웨어 설계 비교
2. 타일링 정책 선택
3. IREE/lowering hint 실험

각 결정은 필요한 sample 범위가 다릅니다. 작은 local dataset은 특정 workload tile ranking에는 충분할 수 있지만, array size sweep 또는 dataflow 비교에는 부족할 수 있습니다.

## 생성 artifact

```text
datasets/merged/readiness.md
datasets/merged/readiness.json
datasets/full-layer/readiness.md
datasets/full-layer/readiness.json
datasets/tile-policy/readiness.md
datasets/tile-policy/readiness.json
estimator-suite/full-layer/readiness.md
estimator-suite/full-layer/readiness.json
estimator-suite/tile-policy/readiness.md
estimator-suite/tile-policy/readiness.json
```

## 주요 gate

| Gate | 목적 |
|---|---|
| `sample-count` | 너무 작은 dataset 차단 |
| `target-scope-contract` | `full-layer` 또는 `tile-policy` 명시 요구 |
| `scope-homogeneity` | full-layer와 tile-policy가 한 model에 섞이는 것 방지 |
| `hardware-coverage` | array/SRAM/bandwidth/dataflow 범위 확인 |
| `workload-coverage` | M/N/K scale과 model family 분포 확인 |
| `tile-coverage` | tile-policy model에서 tileM/N/K 다양성 확인 |
| `validation-error` | held-out error가 허용 범위인지 확인 |
| `domain-guard` | future prediction이 training domain 안인지 판단 가능성 확인 |

## Level 정의

| Level | 조건 예시 | 의미 |
|---|---|---|
| `ready` | sample/coverage/error가 사용 목적에 충분 | active 적용 가능 |
| `caution` | 일부 coverage가 좁거나 error가 경계선 | 보수적으로 사용, 중요 후보 재검증 |
| `blocked` | target 혼합, sample 부족, error 과다 | production decision에 사용 금지 |

## 권장 최소 기준

프로젝트의 최종 발표/보고서에서는 다음을 권장합니다.

| 사용 목적 | 권장 상태 |
|---|---|
| 단일 workload tile ranking | `caution` 이상 |
| 하드웨어 array sweep | `ready` 권장 |
| dataflow 비교 | 각 dataflow sample 포함, `ready` 권장 |
| 외부 발표 수치 | representative 후보 SCALE-Sim 재검증 필수 |

## Report에 써야 할 내용

- dataset sample 수
- target scope
- readiness level
- validation MAPE/median error
- coverage warning
- active model 적용 여부
- out-of-domain 후보 처리 방식

## Blocked일 때 할 일

1. `targetScope`가 섞였는지 확인합니다.
2. `collect-jobs`로 완료 job sample을 더 모읍니다.
3. 부족한 dataflow/array/workload 영역에 validation plan을 생성합니다.
4. `plan-and-queue`로 SCALE-Sim job을 추가 실행합니다.
5. 다시 `scope-pipeline`을 실행합니다.
