# TileForge Pipeline

이 문서는 사용자가 TileForge에서 실행 버튼을 누른 뒤 내부적으로 어떤 단계가 이어지는지 설명합니다.

## 전체 흐름

```text
Input
  ↓
Validation
  ↓
Analytical estimator
  ↓
Artifact preview
  ↓
Full-pipeline job queue
  ↓
Worker stages
  ├─ estimator 재실행
  ├─ SCALE-Sim cfg/topology/layout 생성
  ├─ SCALE-Sim 실행 및 report parsing
  ├─ IREE MLIR/transform 생성
  ├─ IREE compile 실행
  ├─ external validation merge
  ├─ report/artifact/integrity 생성
  └─ UI에서 job/report 조회
```

## 1. Input

입력은 `SearchRequest` 형태로 정규화됩니다.

```ts
{
  hardware: HardwareConfig,
  shapes: MatmulShape[],
  candidates: TileCandidates,
  objective: Objective,
  maxResultsPerOp?: number,
  scaleSim?: ScaleSimOverrides
}
```

핵심 입력:

- `arrayRows`, `arrayCols`
- `frequencyMHz`
- `sramKB`
- `dataflow`: `WS | OS | IS`
- `bytesPerElement`
- GEMM `M/N/K`
- tile 후보 `tileM/tileN/tileK`
- SCALE-Sim bandwidth/layout/bank 옵션

## 2. Validation

`src/lib/validation.ts`와 API route의 schema가 다음을 검사합니다.

- M/N/K, tile, array 크기가 양의 정수인지
- workload가 비어 있지 않은지
- candidate 수가 guardrail을 넘지 않는지
- dataflow/objective 값이 허용 범위인지
- artifact path와 job id가 안전한지

## 3. Analytical estimator

`estimateAll()`은 모든 shape와 tile 후보 조합을 평가합니다.

주요 계산:

- padded tile geometry
- active PE rows/cols
- utilization
- padding ratio
- tile scratch SRAM
- full-layer SRAM/DRAM footprint
- tile-policy cycle
- full-layer hardware-design cycle
- roofline point
- energy estimate
- bottleneck summary
- Top-K/Pareto candidate

중요한 구분:

- **full-layer cycle**: 하드웨어 설계와 SCALE-Sim full topology 검증 target
- **tile-policy cycle**: tileM/tileN/tileK ranking target

두 값을 섞으면 validation 해석이 틀어지므로 report와 Estimator Suite에서 target scope를 분리합니다.

## 4. Preview path

`POST /api/estimate`는 외부 도구를 실행하지 않고 즉시 `SearchResponse`를 반환합니다.

Preview에서 생성되는 주요 항목:

- 후보 tile table
- bottleneck/roofline/energy summary
- SCALE-Sim cfg/topology/layout text preview
- generated MLIR/transform preview
- Markdown report preview
- graph data

이 경로는 빠른 상호작용을 위한 것이며, 외부 검증 적용 상태는 `대기/skipped`로 보일 수 있습니다.

## 5. Full-pipeline job path

`POST /api/jobs`는 현재 request를 job store에 저장합니다. worker는 queued job을 가져와 stage별로 실행합니다.

대표 stage:

1. `queued`
2. `estimating`
3. `generating-artifacts`
4. `running-scalesim`
5. `parsing-scalesim`
6. `running-iree`
7. `merging-external-validation`
8. `writing-artifacts`
9. `completed` 또는 `failed`

UI는 events/log endpoint로 stage와 console log를 표시합니다.

## 6. SCALE-Sim integration

TileForge는 다음 파일을 생성합니다.

- `scalesim.cfg`
- `topology.csv`
- `layout.csv`
- `topology_top3.csv`
- `layout_top3.csv`

SCALE-Sim runner는 `.env`의 `TILEFORGE_SCALE_SIM_CMD`를 사용합니다. 실행 결과에서 `COMPUTE_REPORT.csv`와 memory/bandwidth report를 읽어 다음을 추출합니다.

- layer cycle
- total cycle
- SRAM/DRAM access
- bandwidth/stall 관련 raw data
- exit code/stdout/stderr

SCALE-Sim 결과는 full-layer validation target으로 사용합니다. top-k tile micro-run은 tile-policy 진단 용도입니다.

## 7. IREE integration

TileForge는 `generated.mlir`, `transform.mlir`, `iree-command.sh`를 생성하고 `.env`의 `TILEFORGE_IREE_COMPILE_CMD`로 compile을 시도합니다.

IREE stage의 목적:

- generated MLIR이 compiler pipeline을 통과하는지 확인
- `model.vmfb` 생성 여부 확인
- compiler warning/error를 artifact로 보관
- lowering hint/benchmark plan을 다음 실험 자료로 남김

IREE compile 성공은 runtime 성능 측정이 아닙니다. runtime 측정은 별도 TPU benchmark 또는 IREE runtime benchmark evidence가 필요합니다.

## 8. Report merge

worker는 estimator 결과와 외부 도구 결과를 합쳐 `report.md`를 다시 씁니다.

보고서에서 특히 중요한 섹션:

- 실제 외부 도구 반영 상태
- 예측 결과와 실제 실행 결과 비교
- full-layer cycle과 tile-policy cycle 해석
- top-k tile candidate
- memory traffic
- validation risk/warning

## 9. Artifact integrity

모든 주요 artifact는 job directory에 저장되고 `artifact_integrity.json`에 기록됩니다.

기록 항목:

- artifact name
- path
- size bytes
- SHA-256
- schema version, 가능한 경우
- verifiedAt

이 파일은 제출/공유 후 artifact가 바뀌었는지 확인하는 기준입니다.

## 10. Estimator Suite feedback loop

여러 job이 완료되면 Estimator Suite가 job에서 sample을 수집합니다.

```text
completed jobs
  ↓
collect-jobs
  ↓
merged dataset
  ↓
split full-layer / tile-policy
  ↓
train scope-specific model
  ↓
readiness gate
  ↓
activate model
  ↓
future estimates/design-space correction
```

sample에는 `targetScope`와 `measuredSource`가 포함됩니다. full-layer model은 full-layer cycle 보정에만 쓰고, tile-policy model은 tile ranking 보정에만 씁니다.

## 실패 처리 정책

- 외부 도구가 설정되지 않았으면 skipped artifact를 남깁니다.
- 외부 도구가 실패하면 stdout/stderr/exitCode를 artifact와 log에 남깁니다.
- job은 가능한 한 partial artifact를 남겨 원인 분석이 가능하게 합니다.
- path traversal, oversized artifact, runaway external process는 guardrail로 차단합니다.
