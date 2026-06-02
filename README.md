# TileForge Workbench

TileForge Workbench는 TPU-like systolic array에서 딥러닝 행렬 연산이 어떤 cycle, memory traffic, utilization, energy 특성을 보일지 빠르게 예측하고, 필요할 때 SCALE-Sim/IREE로 검증하는 로컬 설계 탐색 도구입니다.

production 정리 기준의 핵심 목적은 다음 세 가지입니다.

1. **하드웨어 설계 탐색**: array 크기, SRAM, bandwidth, dataflow가 GEMM/Conv workload 성능에 미치는 영향을 비교합니다.
2. **타일링 정책 선택**: tileM/tileN/tileK 후보를 cycle, utilization, padding, SRAM 위험 관점에서 ranking합니다.
3. **검증 가능한 보고서 생성**: estimator 결과, SCALE-Sim 결과, IREE compile 산출물, 그래프, CSV, JSON, checksum을 job 단위 artifact로 남깁니다.

TileForge의 원칙은 **빠른 estimator로 후보를 좁히고, 중요한 후보는 외부 도구로 검증한다**입니다. estimator 단독 수치를 최종 실측값처럼 주장하지 않고, report에서 예측값과 검증값의 차이를 분리해 보여줍니다.

## 문서 목차

production handoff용 문서는 `docs/README.md`에서 한 번에 볼 수 있습니다.

| 문서 | 내용 |
|---|---|
| [`docs/product-overview.md`](docs/product-overview.md) | 목적, 대상 사용자, 사용 가능한 곳, 현재 범위 |
| [`docs/architecture.md`](docs/architecture.md) | 프로그램 구조와 모듈 책임 |
| [`docs/pipeline.md`](docs/pipeline.md) | estimator → job queue → SCALE-Sim/IREE → report 전체 파이프라인 |
| [`docs/user-guide.md`](docs/user-guide.md) | 설치, 실행, UI 사용법, production 실행법 |
| [`docs/api-reference.md`](docs/api-reference.md) | 주요 API route와 script 명령 |
| [`docs/artifact-schema.md`](docs/artifact-schema.md) | job artifact, schema, integrity manifest |
| [`docs/estimator-model.md`](docs/estimator-model.md) | analytical estimator와 full-layer/tile-policy 구분 |
| [`docs/estimator-suite.md`](docs/estimator-suite.md) | 학습형 보정 Estimator Suite |
| [`docs/design-space.md`](docs/design-space.md) | sweet spot, Pareto, uncertainty-aware ranking |
| [`docs/external-tools.md`](docs/external-tools.md) | SCALE-Sim/IREE 설치와 검증 |
| [`docs/validation.md`](docs/validation.md) | 테스트/검증 전략과 release check |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | 자주 발생하는 오류 대응 |
| [`docs/research-references.md`](docs/research-references.md) | 관련 논문, 공식 문서, 읽는 순서 |
| [`docs/production-handoff.md`](docs/production-handoff.md) | 제출/배포 전 체크리스트 |

## 빠른 시작

처음 받았거나 깨끗한 환경에서 시작할 때:

```bash
npm install
npm run setup:env
npm run doctor
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. `npm run dev`는 Next.js 웹 서버와 TileForge worker를 함께 실행합니다.

외부 도구까지 설치하려면:

```bash
npm run setup:external
npm run doctor:external
npm run validate:external:required
```

SCALE-Sim/IREE가 없어도 estimator, graph, report preview는 동작합니다. 다만 full-pipeline의 외부 검증 단계는 skipped artifact로 기록됩니다.

## production 실행

개발 서버가 아니라 build된 Next.js 앱으로 실행할 때는 웹 서버와 worker를 별도 프로세스로 실행합니다.

```bash
npm run build
npm run start
```

다른 터미널에서:

```bash
npm run worker
```

full-pipeline 작업은 worker가 처리하므로 production 모드에서도 worker 프로세스가 떠 있어야 SCALE-Sim/IREE 검증과 artifact 생성이 완료됩니다.

## 기본 workflow

1. **하드웨어**: array size, clock, SRAM, bytes/element, dataflow를 정합니다.
2. **타일링**: tileM/tileN/tileK 후보와 objective를 정합니다.
3. **워크로드**: GEMM을 직접 입력하거나 CSV/ONNX/Conv2D에서 가져옵니다.
4. **실행**: server estimate로 빠르게 preview하거나 full-pipeline job을 queue에 넣습니다.
5. **작업 큐**: 진행률, worker log, SCALE-Sim/IREE 원본 log를 확인합니다.
6. **보고서/그래프**: `report.md`, Top-K graph, full-layer comparison, design-space sweet spot을 확인합니다.
7. **검증/학습**: 완료 job에서 sample을 모아 Estimator Suite를 학습하고 active model로 적용합니다.

## 핵심 개념

| 개념 | 의미 |
|---|---|
| Full-layer cycle | 전체 layer/topology를 대상으로 한 hardware-design cycle입니다. SCALE-Sim full topology 결과와 비교하는 대표값입니다. |
| Tile-policy cycle | tile 후보 ranking용 cycle입니다. tile shape 선택에는 유용하지만 full-layer 검증 target과 섞으면 안 됩니다. |
| SCALE-Sim | systolic array DNN accelerator를 cycle/memory 관점에서 검증하는 외부 simulator입니다. |
| IREE | MLIR 기반 compiler/runtime입니다. TileForge에서는 generated MLIR이 compiler pipeline을 통과하는지 확인합니다. |
| Estimator Suite | SCALE-Sim/job 결과로 analytical estimator를 보정하는 학습형 correction layer입니다. |
| Design-space sweet spot | array/frequency/SRAM/DRAM/workload 축을 sweep해 speedup, throughput, score, uncertainty를 함께 비교하는 그래프입니다. |

## 주요 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 웹 UI와 worker를 같이 실행합니다. |
| `npm run build` | production build를 만듭니다. |
| `npm run start` | build된 Next.js 앱을 실행합니다. |
| `npm run worker` | full-pipeline job worker를 실행합니다. |
| `npm run setup:env` | SCALE-Sim/IREE 명령을 탐색해 `.env`에 저장합니다. |
| `npm run setup:external` | SCALE-Sim fork와 IREE Python package를 설치합니다. |
| `npm run doctor` | 기본 runtime/readiness를 점검합니다. |
| `npm run doctor:external` | 외부 도구 감지 상태를 점검합니다. |
| `npm run validate:external:required` | 실제 SCALE-Sim/IREE를 필수로 실행해 검증합니다. |
| `npm run test:all` | typecheck, smoke, unit, docs/examples/mock external 검증을 실행합니다. |
| `npm run clean:generated` | `.tileforge`, build cache, 외부 도구 산출물 등 생성물을 정리합니다. |
| `npm run check:clean` | release zip에 들어가면 안 되는 산출물이 남았는지 검사합니다. |
| `npm run release:zip` | deterministic release zip을 생성합니다. |

## 환경 변수

`npm run setup:env`가 자동으로 `.env`를 생성합니다. 수동으로 고정할 때는 `.env.example`을 복사해 수정하세요.

```dotenv
TILEFORGE_SCALE_SIM_CMD="py -3 -m scalesim.scale"
TILEFORGE_IREE_COMPILE_CMD="py -3 -m iree.compiler.tools.scripts.iree_compile"
TILEFORGE_MAX_PARALLEL_JOBS="6"
TILEFORGE_JOB_TIMEOUT_MS="1800000"
TILEFORGE_DISABLE_CACHE="0"
```

Windows에서는 `py -3`가 우선이고, macOS/Linux에서는 `python3`가 우선입니다.

## 산출물 위치

기본 workspace는 `.tileforge/`입니다. job별 artifact는 workspace 내부 job 디렉터리에 저장되고 UI의 작업 큐/보고서 탭에서 내려받을 수 있습니다.

주요 artifact:

- `report.md`
- `best_tile_policy.csv`
- `scalesim.cfg`, `topology.csv`, `layout.csv`
- `generated.mlir`, `transform.mlir`, `iree-command.sh`
- `validation_report.md`, `validation_report.csv`
- `memory_traffic.csv`, `summary.svg`, `tile_schedule.svg`
- `compiler_hints.md/json`, `hardware_design_plan.md/json`, `tiling_strategy.md/json`
- `prediction_contract.json`, `artifact_guide.md/json`, `artifact_integrity.json`

## release 전 권장 순서

```bash
npm run clean:generated
npm run check:clean
npm run test:all
npm run validate:external:required
npm run release:zip
```

외부 도구가 없는 환경에서는 다음 mock 검증으로 최소 확인을 수행합니다.

```bash
npm run validate:external:mock
npm run test:docs
npm run test:examples
npm run test:windows-scripts
```
