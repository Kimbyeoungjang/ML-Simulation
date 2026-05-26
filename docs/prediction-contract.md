# TileForge Prediction Contract

TileForge의 최종 목적은 빠른 estimate로 다음 세 가지 결정을 돕는 것이다.

1. **Hardware design**: array, SRAM, bandwidth, dataflow를 빠르게 비교한다.
2. **Tiling strategy**: MLIR/IREE lowering에 넘길 타일 후보를 고른다.
3. **IREE compiler hints**: `transform.mlir`, `compiler_hints.json`, `compiler_hints.md`로 A-B benchmark 후보를 만든다.

이 세 목적은 서로 다른 지표를 사용한다.

| 목적 | 대표 지표 | 산출물 | 주의 |
|---|---|---|---|
| Hardware design | `fullLayerCycles`, `summary.totalCycles` | `report.md`, `result.json`, `prediction_contract.json` | full-layer estimate는 전체 GEMM/layer 기준이다. tile micro-run 외삽값이 아니다. |
| Tiling strategy | `tilePolicyCycles`, `score`, Pareto 후보 | `best_tile_policy.csv`, `robust_policy.csv`, `tile_schedule.svg` | 타일 후보 ranking용 지표이며 hardware total cycle과 같은 의미가 아니다. |
| IREE compiler hints | workgroup/reduction/vector hint | `compiler_hints.md/json`, `transform.mlir`, `iree-command.sh` | compile 성공은 runtime 성능 검증이 아니다. benchmark가 필요하다. |

## Confidence

`fullLayerEstimator`는 다음 조건에서 confidence를 낮춘다.

- shape가 array보다 작아 PE under-fill 가능성이 큰 경우
- operand가 SRAM partition을 넘어 refill/spill 보정이 적용되는 경우
- DRAM roof가 compute cycle보다 커서 bandwidth 가정에 민감한 경우
- K reduction이 매우 길어 compiler/runtime scheduling 차이가 커질 수 있는 경우

낮은 confidence는 실패가 아니라 검증 우선순위 신호다. 해당 op는 SCALE-Sim 또는 IREE runtime measurement를 calibration sample로 추가하는 것이 좋다.

## IREE command policy

`iree-command.sh`는 기본적으로 안전한 baseline compile만 실행한다.

`transform.mlir` 적용은 IREE/MLIR 버전별 dialect 호환성 차이가 크기 때문에 주석 처리된 실험 옵션으로 제공한다. 실제 worker에서 강제로 적용하려면 다음 환경변수를 켠다.

```bash
TILEFORGE_IREE_USE_TRANSFORM_HINTS=1
```

이 옵션은 최적화 확정이 아니라 실험이다. baseline VMFB와 transform-hint VMFB를 runtime benchmark로 비교해야 한다.
