# Artifact and Schema Reference

TileForge는 UI state가 아니라 job artifact를 기준으로 결과를 보관합니다. production 제출/공유 시에는 job bundle과 `artifact_integrity.json`을 함께 보관하는 것이 좋습니다.

## Artifact 저장 원칙

- artifact는 job directory에 atomic write/rename으로 저장합니다.
- 모든 주요 artifact는 `artifact_integrity.json`에 size와 SHA-256을 기록합니다.
- JSON artifact는 가능한 경우 schema version을 포함합니다.
- 외부 도구가 skipped/failed여도 해당 상태를 설명하는 artifact/log를 남깁니다.
- release source zip에는 job artifact를 포함하지 않습니다. job artifact는 실행 결과물로 별도 보관합니다.

## 핵심 artifact

| 파일 | 설명 | 사용처 |
|---|---|---|
| `report.md` | 최종 사람이 읽는 Markdown 보고서 | 발표/보고서/검증 |
| `best_tile_policy.csv` | op별 추천 tile과 주요 metric | 타일 정책 비교 |
| `project.json` | 재실행 가능한 입력 설정 | 재현성 |
| `manifest.json` | 생성 artifact와 버전 metadata | bundle 관리 |
| `artifact_guide.md` | artifact 읽는 법 | 제출자/검토자 |
| `artifact_guide.json` | artifact 설명 구조화 데이터 | 자동화 |
| `artifact_integrity.json` | SHA-256/size manifest | 무결성 검증 |
| `summary.svg` | 핵심 summary graph | 발표 자료 |
| `tile_schedule.svg` | tile schedule 시각화 | 타일링 설명 |
| `policy_table.tex` | LaTeX table export | 논문/보고서 |

## SCALE-Sim artifact

| 파일 | 설명 |
|---|---|
| `scalesim.cfg` | SCALE-Sim accelerator/config 입력 |
| `topology.csv` | full topology layer 입력 |
| `layout.csv` | operand/bank layout 입력 |
| `topology_top3.csv` | top-k tile diagnostic용 topology |
| `layout_top3.csv` | top-k tile diagnostic용 layout |
| `validation_report.md` | TileForge vs SCALE-Sim/IREE 검증 요약 |
| `validation_report.csv` | 검증 결과 구조화 데이터 |
| `memory_traffic.csv` | SRAM/DRAM access 추정/검증 데이터 |
| `scalesim_summary.json` | SCALE-Sim 실행 요약, 가능한 경우 |

## IREE artifact

| 파일 | 설명 |
|---|---|
| `generated.mlir` | IREE compile 입력 MLIR |
| `transform.mlir` | transform dialect sketch |
| `iree-command.sh` | 재현 가능한 compile command |
| `compiler_hints.md/json` | lowering/tile/compiler hint 설명 |
| `iree_benchmark_plan.md/json` | IREE benchmark를 확장할 때 쓸 계획 |
| `iree_summary.json` | compile 결과 요약, 가능한 경우 |
| `iree-output/model.vmfb` | IREE compile 결과 binary, 실제 외부 도구 실행 시 |

## 설계 설명 artifact

| 파일 | 설명 |
|---|---|
| `hardware_design_plan.md/json` | array/SRAM/bandwidth 관점 설계 권고 |
| `tiling_strategy.md/json` | tile 후보 선택 이유와 위험 |
| `prediction_contract.json` | full-layer/tile-policy/SRAM/DRAM metric 의미 계약 |
| `robust_policy.md/csv` | uncertainty와 guardrail을 반영한 tile 정책 |
| `dataflow_comparison.csv` | WS/OS/IS 비교 결과 |
| `prune_report.txt` | candidate pruning 과정 요약 |

## JSON schema

JSON Schema 파일은 `schemas/`에 있습니다.

| Schema | 파일 | 의미 |
|---|---|---|
| `tileforge.result.v1` | `schemas/result.schema.json` | estimator result 구조 |
| `tileforge.manifest.v1` | `schemas/manifest.schema.json` | artifact manifest 구조 |
| `tileforge.project.v1` | `schemas/project.schema.json` | project import/export 구조 |
| `tileforge.policy-db.v1` | `schemas/policy-db.schema.json` | policy database 구조 |
| artifact integrity | `schemas/artifact-integrity.schema.json` | checksum/size manifest 구조 |

## `project.json` 예시 구조

```json
{
  "version": "tileforge.project.v1",
  "name": "vit-s-tpuv2-like",
  "createdAt": "2026-06-02T00:00:00.000Z",
  "hardware": {
    "name": "TPUv2-like 128x128",
    "arrayRows": 128,
    "arrayCols": 128,
    "frequencyMHz": 700,
    "sramKB": 8192,
    "dataflow": "WS",
    "bytesPerElement": 2
  },
  "shapes": [],
  "candidates": {
    "tileM": [16, 32, 64, 128],
    "tileN": [32, 64, 128, 256],
    "tileK": [32, 64, 128, 256]
  },
  "objective": "hardware-design"
}
```

## Artifact 검증

```bash
npm run verify:artifacts
```

또는 job bundle을 받은 뒤 `artifact_integrity.json`의 SHA-256을 별도 스크립트로 비교합니다.

## 제출 권장 구성

source release zip에는 다음만 포함합니다.

- source code
- package files
- docs
- examples
- presets
- schemas
- tests

제외 대상:

- `.env`
- `.tileforge/`
- `.next/`
- `node_modules/`
- `external/`
- `release/`
- `benchmarks/results/`
- `*.vmfb`, `COMPUTE_REPORT.csv`, raw log

실행 결과를 제출해야 할 때는 source release zip과 별도로 job bundle zip을 첨부합니다.
