# Architecture

TileForge는 Next.js 웹 UI, 순수 TypeScript estimator library, job worker/server runtime, 외부 도구 runner, artifact/schema 계층으로 나뉩니다.

```text
사용자 UI
  ↓
Next.js API routes
  ↓
입력 validation / estimator / artifact generation
  ↓                         ↘
즉시 preview response          job queue
                              ↓
                          worker process
                              ↓
                 SCALE-Sim / IREE / report merge
                              ↓
                       job artifact + UI
```

## 디렉터리 구조

| 경로 | 책임 |
|---|---|
| `src/app` | Next.js App Router UI와 API route |
| `src/components/workbench` | 워크벤치 탭, 그래프, 작업 큐, 보고서 UI 컴포넌트 |
| `src/lib` | estimator, dataflow, memory traffic, report, MLIR, SCALE-Sim artifact 생성 등 순수 로직 |
| `src/server` | job store, worker runner, external command, SQLite/file store, system status |
| `src/types` | domain type, job type |
| `scripts` | 설치, 검증, benchmark, worker, release, cleanup CLI |
| `tests` | Vitest/Playwright 기반 테스트 |
| `schemas` | JSON artifact schema |
| `presets` | 기본/사용자 프리셋 |
| `examples` | shape CSV, calibration CSV, project 예시 |
| `docs` | production handoff 문서 |

## UI 계층

`src/app/page.tsx`가 메인 워크벤치입니다. 입력 영역은 다음 탭으로 나뉩니다.

- 하드웨어
- 타일링
- 워크로드
- 실행
- 도구
- 설정

결과 영역은 다음 탭으로 나뉩니다.

- 타일 후보
- 병목
- Roofline
- 에너지
- 배열 탐색
- 컴파일
- 파일
- 그래프
- TPU 비교
- 보고서
- 작업 큐
- 시스템

UI는 estimator를 직접 계산하지 않고 API route 또는 hook을 통해 서버 로직을 호출합니다. 그래프와 표는 API response의 `SearchResponse`, `JobRecord`, artifact metadata를 표시합니다.

## API 계층

주요 API route는 다음과 같습니다.

| Route | 목적 |
|---|---|
| `POST /api/estimate` | 현재 입력으로 빠른 estimator preview 생성 |
| `POST /api/jobs` | full-pipeline job 생성 |
| `GET /api/jobs` | job 목록과 상태 조회 |
| `GET /api/jobs/:id` | 단일 job 상세 조회 |
| `GET /api/jobs/:id/artifacts` | artifact 목록 조회 |
| `GET /api/jobs/:id/artifacts/:name` | artifact 다운로드 |
| `GET /api/jobs/:id/events` | live event stream |
| `GET /api/jobs/:id/external-logs` | SCALE-Sim/IREE 원본 log 조회 |
| `POST /api/estimator-suite` | dataset 생성, split/train, activate |
| `GET/PATCH /api/env` | `.env` 설정 조회/수정 |
| `GET /api/system/status` | CPU/RAM/job store 상태 조회 |
| `GET/PATCH /api/system/config` | 병렬 실행 수 같은 runtime 설정 조회/수정 |

## Core estimator 계층

`src/lib`는 가능한 한 side effect 없는 함수로 구성됩니다. 주요 모듈은 다음과 같습니다.

| 모듈 | 역할 |
|---|---|
| `estimator.ts` | tile 후보 탐색과 ranking |
| `fullLayerEstimator.ts` | hardware-design용 full-layer cycle baseline |
| `dataflow.ts` | WS/OS/IS 관련 factor와 설명 |
| `memoryTraffic.ts` | SRAM/DRAM access 추정 |
| `roofline.ts` | arithmetic intensity와 bound 분석 |
| `energy.ts` | MAC/SRAM/DRAM/static energy 추정 |
| `designSpace.ts` | hardware/workload sweep row 생성 |
| `designSpaceScoring.ts` | sweet spot, Pareto, ROI, uncertainty score |
| `scalesim.ts` | SCALE-Sim cfg/topology/layout 생성 |
| `mlir.ts` | generated MLIR/transform artifact 생성 |
| `report.ts` | Markdown report 생성 |
| `estimatorSuite*.ts` | dataset, 학습, stacking, readiness, active model 적용 |
| `predictionContract.ts` | 보고서/산출물의 수치 의미 계약 |

## Server/worker 계층

full-pipeline은 시간이 오래 걸리고 외부 명령을 실행하므로 worker가 처리합니다.

| 모듈 | 역할 |
|---|---|
| `jobStore.ts` | file-backed job metadata |
| `sqliteStore.ts` | SQLite job/artifact metadata 저장소 |
| `workerRunner.ts` | job stage 실행 orchestration |
| `externalCommand.ts` | shell 없이 안전하게 외부 command spawn |
| `externalJobRunners.ts` | SCALE-Sim/IREE runner |
| `jobArtifactWriter.ts` | job artifact 저장 |
| `artifactIntegrity.ts` | SHA-256 checksum manifest 생성 |
| `systemStatus.ts` | CPU/RAM/storage/job count 상태 |
| `pathSafety.ts` | artifact path traversal 방지 |

## 저장소/런타임 모델

- 소스 코드에는 생성 artifact를 넣지 않습니다.
- `.tileforge/`는 workspace, cache, artifact root로 사용됩니다.
- SQLite가 가능하면 job metadata는 SQLite에 저장되고, 불가능하면 file fallback을 사용합니다.
- artifact는 atomic write/rename으로 기록합니다.
- `artifact_integrity.json`에 size와 SHA-256을 기록해 제출본에서 artifact 변조 여부를 확인할 수 있습니다.

## 외부 도구 경계

SCALE-Sim과 IREE는 optional runner입니다. estimator preview는 외부 도구 없이 동작해야 합니다. 외부 도구가 없으면 job은 실패 대신 skipped artifact를 남기고 report에 적용 여부를 표시합니다. 외부 검증을 필수로 요구하는 상황에서는 `npm run validate:external:required`를 사용합니다.

## 설계 원칙

1. **계산과 UI 분리**: estimator/score/report는 UI에서 분리된 순수 TypeScript 함수로 유지합니다.
2. **예측 target 분리**: full-layer와 tile-policy를 섞지 않습니다.
3. **artifact 우선**: 모든 중요한 결과는 UI state가 아니라 파일 artifact로 남깁니다.
4. **실패 투명성**: 외부 도구 실패/skipped 상태를 report에 숨기지 않습니다.
5. **production cleanup**: release zip에는 source, docs, examples, schemas만 포함하고 local runtime artifact는 제외합니다.
